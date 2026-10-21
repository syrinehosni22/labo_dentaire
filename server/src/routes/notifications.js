const express = require('express');
const { col, out, toId, nowStamp, setSetting, nextId } = require('../db');
const { requirePerm } = require('../auth');
const { bad } = require('../util');
const notifier = require('../services/notifier');

const router = express.Router();

router.get('/notifications', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const filter = { user_id: req.user.id };
  if (req.query.unread === '1') filter.read_at = null;
  if (req.query.type) filter.type = String(req.query.type);
  const [items, total, unread] = await Promise.all([
    col('notifications').find(filter).sort({ created_at: -1, _id: -1 }).skip(offset).limit(limit).toArray(),
    col('notifications').countDocuments(filter),
    col('notifications').countDocuments({ user_id: req.user.id, read_at: null }),
  ]);
  const reqs = new Map((await col('requests').find({ _id: { $in: items.map((n) => n.request_id).filter(Boolean) } }, { projection: { numero: 1, status: 1 } }).toArray()).map((r) => [r._id, r]));
  res.json({
    items: items.map((n) => ({ ...out(n), overdue: n.overdue ? 1 : 0, request_numero: reqs.get(n.request_id)?.numero || null, request_status: reqs.get(n.request_id)?.status || null })),
    total, unread,
  });
});

router.get('/notifications/unread-count', async (req, res) => {
  res.json({ unread: await col('notifications').countDocuments({ user_id: req.user.id, read_at: null }) });
});

router.post('/notifications/read', async (req, res) => {
  const { ids, all } = req.body || {};
  if (all) await col('notifications').updateMany({ user_id: req.user.id, read_at: null }, { $set: { read_at: nowStamp() } });
  else if (Array.isArray(ids)) {
    await col('notifications').updateMany({ _id: { $in: ids.map(toId).filter(Boolean) }, user_id: req.user.id, read_at: null }, { $set: { read_at: nowStamp() } });
  } else throw bad('Précisez les notifications à marquer comme lues.');
  res.json({ ok: true });
});

// ---- Web push (PWA)
router.get('/push/public-key', async (req, res) => res.json({ publicKey: (await notifier.vapid()).publicKey }));

router.post('/push/subscribe', async (req, res) => {
  const s = req.body;
  if (!s?.endpoint || !s?.keys) throw bad('Abonnement invalide.');
  const existing = await col('push_subscriptions').findOne({ endpoint: s.endpoint });
  if (existing) await col('push_subscriptions').updateOne({ _id: existing._id }, { $set: { user_id: req.user.id, keys: s.keys } });
  else {
    try {
      await col('push_subscriptions').insertOne({ _id: await nextId('push_subscriptions'), user_id: req.user.id, endpoint: s.endpoint, keys: s.keys, created_at: nowStamp() });
    } catch (e) {
      if (e.code !== 11000) throw e;          // subscribed twice at the same time: keep one
      await col('push_subscriptions').updateOne({ endpoint: s.endpoint }, { $set: { user_id: req.user.id, keys: s.keys } });
    }
  }
  res.json({ ok: true });
});

router.post('/push/unsubscribe', async (req, res) => {
  await col('push_subscriptions').deleteOne({ endpoint: req.body?.endpoint || '', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/push/test', async (req, res) => {
  const last = await col('notification_deliveries').find().sort({ _id: -1 }).limit(1).toArray();
  const before = last[0]?._id || 0;
  await notifier.sendPush(req.user, { title: 'Notification de test', body: 'Les notifications fonctionnent sur cet appareil.', url: '/notifications' }, null);
  res.json({ deliveries: (await col('notification_deliveries').find({ _id: { $gt: before }, user_id: req.user.id }).toArray()).map(out) });
});

// ---- Admin settings & delivery log
router.get('/notification-settings', requirePerm('settings_manage'), async (req, res) => {
  const s = await notifier.settings();
  // never send secrets back in clear
  const masked = JSON.parse(JSON.stringify(s));
  for (const c of Object.values(masked.channels)) for (const k of ['pass', 'auth_token']) if (c[k]) c[k] = '********';
  res.json({ ...masked, type_labels: notifier.TYPE_LABELS });
});

router.put('/notification-settings', requirePerm('settings_manage'), async (req, res) => {
  const cur = await notifier.settings();
  const b = req.body || {};
  for (const rem of b.reminders || []) {
    if (!['day_before', 'same_day', 'hours_before'].includes(rem.kind)) throw bad('Type de rappel invalide.');
    if (rem.kind === 'hours_before' && !(Number(rem.hours) > 0)) throw bad('Le délai personnalisé doit être un nombre d\'heures positif.');
    if (rem.hour != null && (rem.hour < 0 || rem.hour > 23)) throw bad('Heure de rappel invalide.');
  }
  const channels = { ...cur.channels };
  for (const [k, v] of Object.entries(b.channels || {})) {
    channels[k] = { ...cur.channels[k], ...v };
    for (const s of ['pass', 'auth_token']) if (v[s] === '********') channels[k][s] = cur.channels[k][s];
  }
  await setSetting('notifications', { types: b.types || cur.types, reminders: b.reminders || cur.reminders, phone_privacy: b.phone_privacy ?? cur.phone_privacy, channels });
  notifier.scan();
  res.json({ ok: true });
});

router.get('/notification-deliveries', requirePerm('settings_manage'), async (req, res) => {
  const rows = await col('notification_deliveries').find().sort({ _id: -1 }).limit(300).toArray();
  const [users, notifs] = await Promise.all([
    col('users').find({ _id: { $in: [...new Set(rows.map((r) => r.user_id))] } }, { projection: { name: 1 } }).toArray(),
    col('notifications').find({ _id: { $in: rows.map((r) => r.notification_id).filter(Boolean) } }, { projection: { title: 1 } }).toArray(),
  ]);
  const uBy = new Map(users.map((u) => [u._id, u.name])); const nBy = new Map(notifs.map((n) => [n._id, n.title]));
  res.json(rows.map((d) => ({ ...out(d), user_name: uBy.get(d.user_id) || null, title: nBy.get(d.notification_id) || null })));
});

router.post('/notifications/scan', requirePerm('settings_manage'), async (req, res) => { await notifier.scan(); res.json({ ok: true }); });

module.exports = router;
