// Google Agenda: connecting a user's Google account, their sync preferences, and the admin setup.
const express = require('express');
const { col, getSetting, setSetting, nowStamp } = require('../db');
const { requirePerm, findUser } = require('../auth');
const { bad, audit } = require('../util');
const gcal = require('../services/gcal');

/* ---------- public: Google sends the browser back here (no Authorization header) ---------- */
const publicRouter = express.Router();

publicRouter.get('/google/callback', async (req, res) => {
  const back = async (ok, message) => {
    const q = new URLSearchParams({ google: ok ? 'ok' : 'erreur', ...(message ? { message } : {}) });
    res.redirect(`${await gcal.clientUrl()}/profil?${q}`);
  };
  if (req.query.error) {
    return back(false, req.query.error === 'access_denied' ? 'Vous avez refusé l\'accès à Google Agenda.' : `Google a renvoyé une erreur : ${req.query.error}.`);
  }
  const st = gcal.readState(req.query.state);
  if (!st) return back(false, 'Le lien de connexion a expiré. Recommencez depuis « Mon compte ».');
  const user = await findUser(st.uid);
  if (!user || !user.active || (user.token_version || 0) !== (st.tv || 0)) return back(false, 'Votre session a changé entre-temps. Reconnectez-vous puis recommencez.');
  if (!req.query.code) return back(false, 'Réponse de Google incomplète.');
  try {
    const acc = await gcal.completeConnection(user, String(req.query.code));
    req.user = user;
    audit(req, 'connexion Google Agenda', 'user', user.id, { compte_google: acc.google_email });
    gcal.syncAll();
    return back(true);
  } catch (e) {
    console.error('[google agenda] connexion :', e.message);
    return back(false, e.message);
  }
});

/* ---------- authenticated (mounted after the auth middleware) ---------- */
const router = express.Router();

router.get('/google/status', async (req, res) => {
  const c = await gcal.config();
  res.json({ configured: c.configured, kinds: gcal.KINDS, account: await gcal.publicAccount(req.user.id) });
});

router.post('/google/connect', async (req, res) => {
  try { res.json({ url: await gcal.authUrl(req.user) }); } catch (e) { throw bad(e.message); }
});

router.put('/google/prefs', async (req, res) => {
  if (!(await col('google_accounts').findOne({ _id: req.user.id }, { projection: { _id: 1 } }))) throw bad("Aucun compte Google n'est connecté.");
  const kinds = await gcal.setKinds(req.user.id, req.body?.kinds);
  gcal.syncAll();
  res.json({ kinds });
});

router.post('/google/sync', async (req, res) => {
  if (!(await col('google_accounts').findOne({ _id: req.user.id }, { projection: { _id: 1 } }))) throw bad("Aucun compte Google n'est connecté.");
  // a revoked account is retried when the person asks explicitly
  await col('google_accounts').updateOne({ _id: req.user.id, status: 'revoked' }, { $set: { status: 'error' } });
  await gcal.syncAll();
  res.json({ account: await gcal.publicAccount(req.user.id) });
});

router.post('/google/disconnect', async (req, res) => {
  const r = await gcal.disconnect(req.user.id, { deleteCalendar: !!req.body?.delete_calendar });
  audit(req, 'déconnexion Google Agenda', 'user', req.user.id, { agenda_supprime: r.calendar_deleted });
  res.json({ ok: true, ...r });
});

/* ---------- admin ---------- */
router.get('/google-settings', requirePerm('settings_manage'), async (req, res) => {
  const c = await gcal.config();
  const accounts = await col('google_accounts').find({}, { projection: { refresh_token: 0 } }).toArray();
  const users = new Map((await col('users').find({ _id: { $in: accounts.map((a) => a._id) } }, { projection: { name: 1, active: 1 } }).toArray()).map((u) => [u._id, u]));
  res.json({
    client_id: c.source === 'parametres' ? c.client_id : '',
    client_secret: c.source === 'parametres' && c.client_secret ? '********' : '',
    from_env: c.source === 'env', configured: c.configured, full_names: c.full_names, redirect_uri: c.redirect_uri,
    accounts: accounts.map((a) => ({
      user_id: a._id, user_name: users.get(a._id)?.name || '?', user_active: !!users.get(a._id)?.active,
      google_email: a.google_email, status: a.status, last_error: a.last_error, last_sync_at: a.last_sync_at,
    })),
  });
});

router.put('/google-settings', requirePerm('settings_manage'), async (req, res) => {
  const b = req.body || {};
  const cur = (await getSetting('google')) || {};
  const clientId = String(b.client_id ?? cur.client_id ?? '').trim();
  if (clientId && !/\.apps\.googleusercontent\.com$/.test(clientId)) throw bad("L'ID client doit se terminer par « .apps.googleusercontent.com ».");
  const secretIn = b.client_secret === '********' ? cur.client_secret : String(b.client_secret ?? cur.client_secret ?? '').trim();
  const next = { client_id: clientId, client_secret: clientId ? secretIn : '', full_names: !!b.full_names, updated_at: nowStamp() };
  const changedClient = clientId !== (cur.client_id || '');
  await setSetting('google', next);
  // Google accounts were authorised for the previous OAuth client: their access no longer works
  if (changedClient && cur.client_id) {
    await col('google_accounts').updateMany({}, { $set: { status: 'revoked', last_error: "L'application Google a changé : reconnectez votre compte Google." } });
  }
  audit(req, 'paramètres Google Agenda', 'settings', null, { client_modifie: changedClient, noms_complets: next.full_names });
  gcal.syncAll();
  res.json({ ok: true });
});

module.exports = { publicRouter, router };