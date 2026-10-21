const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { col, insert, nextId, nowStamp, getSetting, setSetting } = require('../db');
const { parseLocal, hasTime, isPast, dateOnly, today, pad } = require('../util');
const { defaultPrefs, obj } = require('../auth');

const ALL_ROLES = ['admin', 'production', 'administratif'];
const TYPE_LABELS = {
  try1: 'Premier essayage', try2: 'Deuxième essayage', delivery: 'Livraison prévue',
  try_overdue: 'Essayage en retard', delivery_overdue: 'Livraison en retard', daily_summary: 'Récapitulatif quotidien',
};

const DEFAULT_SETTINGS = {
  types: {
    try1: { enabled: true, roles: ALL_ROLES, channels: ['platform', 'push'] },
    try2: { enabled: true, roles: ALL_ROLES, channels: ['platform', 'push'] },
    delivery: { enabled: true, roles: ALL_ROLES, channels: ['platform', 'push'] },
    try_overdue: { enabled: true, roles: ['admin', 'production'], channels: ['platform', 'push'] },
    delivery_overdue: { enabled: true, roles: ['admin', 'administratif'], channels: ['platform', 'push'] },
    daily_summary: { enabled: true, roles: ALL_ROLES, channels: ['platform'], hour: 7 },
  },
  reminders: [
    { id: 'veille', kind: 'day_before', enabled: true, hour: 9, label: "La veille de l'échéance" },
    { id: 'jour', kind: 'same_day', enabled: true, hour: 7, label: "Le jour même, en début de journée" },
    { id: 'custom48', kind: 'hours_before', enabled: false, hours: 48, label: '48 heures avant' },
  ],
  phone_privacy: true,
  channels: {
    email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '' },
    sms: { enabled: false, provider: 'twilio', account_sid: '', auth_token: '', from: '', webhook_url: '' },
    whatsapp: { enabled: false, provider: 'twilio', account_sid: '', auth_token: '', from: '' },
  },
};

async function settings() {
  const s = (await getSetting('notifications')) || {};
  return {
    ...DEFAULT_SETTINGS, ...s,
    types: Object.fromEntries(Object.entries(DEFAULT_SETTINGS.types).map(([k, v]) => [k, { ...v, ...(s.types?.[k] || {}) }])),
    channels: Object.fromEntries(Object.entries(DEFAULT_SETTINGS.channels).map(([k, v]) => [k, { ...v, ...(s.channels?.[k] || {}) }])),
    reminders: s.reminders || DEFAULT_SETTINGS.reminders,
  };
}

let vapidKeys = null;
async function vapid() {
  if (vapidKeys) return vapidKeys;
  // keys from .env if provided (they survive a database restore), otherwise generated once and stored
  let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } : await getSetting('vapid');
  if (!keys) { keys = webpush.generateVAPIDKeys(); await setSetting('vapid', keys); }
  vapidKeys = keys;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@laboratoire.local', keys.publicKey, keys.privateKey);
  return keys;
}

const fmtDue = (s) => {
  const d = parseLocal(s);
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return hasTime(s) ? `${date} à ${pad(d.getHours())}h${pad(d.getMinutes())}` : date;
};
const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const initials =(name) => name.split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(' ');

// Moment at which a deadline is considered reached (date-only => end of that day)
function dueEnd(s) { const d = parseLocal(s); if (!hasTime(s)) d.setDate(d.getDate() + 1); return d; }

function reminderFireTime(rem, due) {
  const d = parseLocal(due);
  if (rem.kind === 'day_before') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, rem.hour ?? 9, 0);
  if (rem.kind === 'same_day') return new Date(d.getFullYear(), d.getMonth(), d.getDate(), rem.hour ?? 7, 0);
  // hours_before: date-only deadlines are anchored at the start of the working day
  const anchor = hasTime(due) ? d : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
  return new Date(anchor.getTime() - (Number(rem.hours) || 24) * 3600000);
}

async function recipients(type, cfg) {
  const t = cfg.types[type];
  if (!t?.enabled) return [];
  const users = await col('users').find({ active: true, role: { $in: t.roles } }).toArray();
  return users.map((u) => ({ ...u, id: u._id, _prefs: { ...defaultPrefs(), ...obj(u.notif_prefs, {}) } }))
    .filter((u) => u._prefs.types.includes(type));
}

async function logDelivery(notificationId, userId, channel, recipient, status, error) {
  await insert('notification_deliveries', { notification_id: notificationId, user_id: userId, channel, recipient: recipient || null, status, error: error ? String(error).slice(0, 500) : null, at: nowStamp() });
}

async function sendPush(user, payload, nid) {
  await vapid();
  const subs = await col('push_subscriptions').find({ user_id: user.id }).toArray();
  if (!subs.length) return logDelivery(nid, user.id, 'push', null, 'non_configure', "Aucun appareil abonné");
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: typeof s.keys === 'string' ? JSON.parse(s.keys) : s.keys }, JSON.stringify(payload));
      await logDelivery(nid, user.id, 'push', s.endpoint.slice(0, 60), 'envoye');
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await col('push_subscriptions').deleteOne({ _id: s._id });
      await logDelivery(nid, user.id, 'push', s.endpoint.slice(0, 60), 'echec', e.body || e.message);
    }
  }
}

async function sendEmail(user, subject, text, nid) {
  const c = await require('./mailer').smtpConfig();
  if (!c) return logDelivery(nid, user.id, 'email', user.email, 'non_configure', 'Serveur SMTP non configuré');
  try {
    const t = nodemailer.createTransport({ host: c.host, port: Number(c.port), secure: !!c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
    await t.sendMail({ from: c.from || c.user, to: user.email, subject, text });
    logDelivery(nid, user.id, 'email', user.email, 'envoye');
  } catch (e) { logDelivery(nid, user.id, 'email', user.email, 'echec', e.message); }
}

async function sendTwilio(c, to, body) {
  const auth = Buffer.from(`${c.account_sid}:${c.auth_token}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: c.from, Body: body }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
}

async function sendPhoneMessage(channel, user, text, nid, cfg) {
  const c = cfg.channels[channel];
  if (!user.phone) return logDelivery(nid, user.id, channel, null, 'non_configure', 'Numéro de téléphone non renseigné');
  if (!c.enabled) return logDelivery(nid, user.id, channel, user.phone, 'non_configure', 'Canal non configuré');
  try {
    if (c.provider === 'webhook' && c.webhook_url) {
      const r = await fetch(c.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, to: user.phone, message: text }) });
      if (!r.ok) throw new Error(`Webhook ${r.status}`);
    } else {
      await sendTwilio(c, channel === 'whatsapp' ? `whatsapp:${user.phone}` : user.phone, text);
    }
    logDelivery(nid, user.id, channel, user.phone, 'envoye');
  } catch (e) { logDelivery(nid, user.id, channel, user.phone, 'echec', e.message); }
}

// Inserts a platform notification unless the same (user, dedup_key) exists. Returns its id, or null if it already existed.
// The unique index on { user_id, dedup_key } makes this safe even if two scans run at once.
async function notifyOnce(doc) {
  if (await col('notifications').findOne({ user_id: doc.user_id, dedup_key: doc.dedup_key }, { projection: { _id: 1 } })) return null;
  const _id = await nextId('notifications');
  try {
    await col('notifications').insertOne({ _id, read_at: null, created_at: nowStamp(), ...doc });
    return _id;
  } catch (e) {
    if (e.code === 11000) return null;      // created by a concurrent scan
    throw e;
  }
}

// Creates the in-platform notification (deduplicated), then fans out to phone channels.
async function emit({ type, request, due, dedup, title, message, phoneText, overdue = false }, cfg) {
  const users = await recipients(type, cfg);
  const channels = cfg.types[type].channels || [];
  for (const u of users) {
    const nid = await notifyOnce({ user_id: u.id, request_id: request?.id ?? null, type, due_at: due || null, title, message, overdue: !!overdue, dedup_key: dedup });
    if (!nid) continue;                     // already sent for this deadline
    await logDelivery(nid, u.id, 'platform', u.email, 'envoye');
    const url = request ? `/demandes/${request.id}` : '/notifications';
    const tasks = [];
    if (channels.includes('push') && u._prefs.push) tasks.push(sendPush(u, { title, body: phoneText, url, tag: dedup }, nid));
    if (channels.includes('email') && u._prefs.email) tasks.push(sendEmail(u, title, `${message}\n`, nid));
    if (channels.includes('sms') && u._prefs.sms) tasks.push(sendPhoneMessage('sms', u, phoneText, nid, cfg));
    if (channels.includes('whatsapp') && u._prefs.whatsapp) tasks.push(sendPhoneMessage('whatsapp', u, phoneText, nid, cfg));
    await Promise.allSettled(tasks);
  }
}

let running = false;
async function scan(now = new Date()) {
  if (running) return; running = true;
  try {
    const cfg = await settings();
    const raw = await col('requests').find({ deleted_at: null, status: { $ne: 'livree' } }, { projection: { works: 0, history: 0 } }).toArray();
    const docs = new Map((await col('doctors').find({ _id: { $in: [...new Set(raw.map((r) => r.doctor_id))] } }).toArray()).map((d) => [d._id, d]));
    const reqs = raw.map((r) => ({ ...r, id: r._id, doctor_name: `${docs.get(r.doctor_id)?.last_name || ''} ${docs.get(r.doctor_id)?.first_name || ''}`.trim() }));
    const reminders = cfg.reminders.filter((r) => r.enabled);
    for (const r of reqs) {
      const active = ['en_cours', 'attente_essayage'].includes(r.status);
      const deadlines = [];
      if (active && r.try1_date && !r.try1_done) deadlines.push({ type: 'try1', due: r.try1_date, over: 'try_overdue' });
      if (active && r.try2_date && !r.try2_done) deadlines.push({ type: 'try2', due: r.try2_date, over: 'try_overdue' });
      if (r.delivery_planned) deadlines.push({ type: 'delivery', due: r.delivery_planned, over: 'delivery_overdue' });
      for (const dl of deadlines) {
        const label = TYPE_LABELS[dl.type];
        const patient = cfg.phone_privacy ? initials(r.patient_name) : r.patient_name;
        if (isPast(dl.due, now)) {
          const t = TYPE_LABELS[dl.over];
          await emit({
            type: dl.over, request: r, due: dl.due, overdue: true, dedup: `${dl.over}:${r.id}:${dl.type}:${dl.due}`,
            title: `${t} — ${r.numero}`,
            message: `Échéance « ${label.toLowerCase()} » du ${fmtDue(dl.due)} dépassée sans changement de statut. Patient : ${r.patient_name}. Médecin : Dr ${r.doctor_name}.`,
            phoneText: `${t} : ${r.numero} (${patient}), Dr ${r.doctor_name}, échéance ${fmtDue(dl.due)}.`,
          }, cfg);
          continue;
        }
        // pick the most recent reminder whose fire time has passed (avoids duplicates for one deadline)
        const end = dueEnd(dl.due);
        const applicable = reminders.map((rem) => ({ rem, at: reminderFireTime(rem, dl.due) }))
          .filter((x) => x.at <= now && now < end).sort((a, b) => b.at - a.at);
        if (!applicable.length) continue;
        const { rem } = applicable[0];
        const dupBase = `${dl.type}:${r.id}:${dl.due}`;
        // two reminders for the same deadline are never sent less than 6h apart
        const escaped = dupBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const already = await col('notifications').findOne({ dedup_key: new RegExp(`^${escaped}:`), created_at: { $gte: localStamp(new Date(now.getTime() - 6 * 3600000)) } }, { projection: { _id: 1 } });
        if (already) continue;
        await emit({
          type: dl.type, request: r, due: dl.due, dedup: `${dupBase}:${rem.id}`,
          title: `${label} — ${r.numero}`,
          message: `${label} le ${fmtDue(dl.due)}. Patient : ${r.patient_name}. Médecin : Dr ${r.doctor_name}.`,
          phoneText: `Rappel ${label.toLowerCase()} le ${fmtDue(dl.due)} : ${r.numero} (${patient}), Dr ${r.doctor_name}.`,
        }, cfg);
      }
    }
    // Daily summary
    const ds = cfg.types.daily_summary;
    if (ds.enabled && now.getHours() >= (ds.hour ?? 7)) {
      const t = today();
      const all = raw;
      const tries = all.filter((r) => ['en_cours', 'attente_essayage'].includes(r.status)).reduce((n, r) =>
        n + [r.try1_done ? null : r.try1_date, r.try2_done ? null : r.try2_date].filter((d) => d && dateOnly(d) === t).length, 0);
      const deliveries = all.filter((r) => dateOnly(r.delivery_planned) === t).length;
      const [y, m, d] = t.split('-');
      await emit({
        type: 'daily_summary', dedup: `summary:${t}`, title: `Récapitulatif du ${d}/${m}/${y}`,
        message: `Aujourd'hui : ${tries} essayage(s) et ${deliveries} livraison(s) prévus.`,
        phoneText: `Aujourd'hui : ${tries} essayage(s), ${deliveries} livraison(s) prévus.`,
      }, cfg);
    }
  } catch (e) {
    console.error('[notifications]', e);
  } finally { running = false; }
}

let timer = null;
function start(intervalMs = 60000) {
  vapid().catch((e) => console.error('[notifications] clés push :', e.message));
  setTimeout(() => scan(), 2000);
  timer = setInterval(() => scan(), intervalMs);
}
function stop() { clearInterval(timer); }

module.exports = { scan, start, stop, settings, DEFAULT_SETTINGS, TYPE_LABELS, vapid, sendPush, emit, notifyOnce };
