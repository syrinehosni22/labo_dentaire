// Google Agenda (Google Calendar) synchronisation.
//
// Each user may connect their own Google account (OAuth 2.0, offline access). The app then creates
// a dedicated calendar in that account ("<laboratoire> — demandes") and keeps it in step with the
// requests: one event per 1st try-in, 2nd try-in and planned delivery. The app is the source of
// truth: events are created, updated and removed automatically, and edits made in Google are
// overwritten at the next change of the request.
//
// Only the dedicated calendar is touched: the scope `calendar.app.created` lets the app manage the
// calendars it created, and nothing else in the user's Google account.
//
// Sync runs a few seconds after any change to a request, every 10 minutes as a safety net, and on
// demand. It compares what each calendar should contain with what was last sent (a hash per event
// stored in `calendar_events`) and only calls Google for the differences.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { col, nextId, nowStamp, getSetting } = require('../db');
const { parseLocal, hasTime, pad, dateOnly, STATUS_LABELS } = require('../util');
const { secret, effectivePermissions } = require('../auth');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SCOPES = ['openid', 'email', CAL_SCOPE];

const KINDS = { try1: 'Premier essayage', try2: 'Deuxième essayage', delivery: 'Livraison' };
const SHORT = { try1: '1er essayage', try2: '2e essayage', delivery: 'Livraison' };
const DEFAULT_KINDS = Object.keys(KINDS);
const PAST_DAYS = 30;            // new events are only created from this many days back
const EVENT_MINUTES = 30;        // length of events that have a time
const PERIOD_MS = 10 * 60e3;     // safety-net full sync
const DEBOUNCE_MS = 3000;        // after a change to a request

const timeZone = () => process.env.GOOGLE_CALENDAR_TZ || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Tunis';

/* ---------------- configuration ---------------- */

const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
const labInfo = async () => (await getSetting('lab')) || {};

// Address of this API server, as Google must call it back. Must match the redirect URI declared
// in Google Cloud exactly.
async function redirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  const base = trimUrl(process.env.APP_URL) || trimUrl((await labInfo()).app_url) || `http://localhost:${process.env.PORT || 4000}`;
  return `${base}/api/google/callback`;
}

// Where the React interface runs (for the return after Google, and links inside events)
async function clientUrl() {
  return trimUrl(process.env.CLIENT_URL) || trimUrl(process.env.APP_URL) || trimUrl((await labInfo()).app_url);
}

// Settings screen first, then GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env
async function config() {
  const s = (await getSetting('google')) || {};
  const fromScreen = !!(s.client_id && s.client_secret);
  const client_id = fromScreen ? s.client_id : (process.env.GOOGLE_CLIENT_ID || '');
  const client_secret = fromScreen ? s.client_secret : (process.env.GOOGLE_CLIENT_SECRET || '');
  return {
    client_id, client_secret, configured: !!(client_id && client_secret),
    source: fromScreen ? 'parametres' : (client_id ? 'env' : null),
    full_names: !!s.full_names, redirect_uri: await redirectUri(),
  };
}

/* ---------------- OAuth ---------------- */

class GoogleError extends Error {
  constructor(message, { status, reason, revoked } = {}) { super(message); this.status = status; this.reason = reason; this.revoked = !!revoked; }
}

async function postForm(url, params) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// The state carries the user id and is signed: Google sends it back to /google/callback, which
// is reached by a plain browser redirect (no Authorization header).
async function authUrl(user) {
  const c = await config();
  if (!c.configured) throw new GoogleError("La connexion à Google Agenda n'est pas encore configurée par l'administrateur.");
  const state = jwt.sign({ uid: user.id, tv: user.token_version || 0, p: 'gcal', n: crypto.randomBytes(8).toString('hex') }, secret(), { expiresIn: '15m' });
  const q = new URLSearchParams({
    client_id: c.client_id, redirect_uri: c.redirect_uri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
  });
  if (user.email) q.set('login_hint', user.email);
  return `${AUTH_URL}?${q}`;
}

function readState(state) {
  try {
    const p = jwt.verify(String(state || ''), secret());
    return p.p === 'gcal' ? p : null;
  } catch { return null; }
}

// Exchanges the code from Google's redirect and stores the account. Returns the stored account.
async function completeConnection(user, code) {
  const c = await config();
  const r = await postForm(TOKEN_URL, { code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: c.redirect_uri, grant_type: 'authorization_code' });
  if (!r.ok) throw new GoogleError(`Google a refusé la connexion (${r.data.error_description || r.data.error || r.status}).`);
  const t = r.data;
  if (!String(t.scope || '').split(' ').includes(CAL_SCOPE)) {
    throw new GoogleError("L'accès à l'agenda n'a pas été accordé. Recommencez et cochez la case autorisant l'application à gérer ses agendas.");
  }
  if (!t.refresh_token) throw new GoogleError("Google n'a pas fourni d'accès durable. Recommencez la connexion.");
  let googleEmail = null;
  try { googleEmail = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString('utf8')).email || null; } catch { /* optional */ }

  const prev = await col('google_accounts').findOne({ _id: user.id });
  const sameAccount = prev && prev.google_email && prev.google_email === googleEmail;
  if (!sameAccount) await col('calendar_events').deleteMany({ user_id: user.id });
  const doc = {
    user_id: user.id, google_email: googleEmail, refresh_token: t.refresh_token,
    calendar_id: sameAccount ? prev.calendar_id : null,
    kinds: prev?.kinds || DEFAULT_KINDS,
    status: 'ok', last_error: null, last_sync_at: prev && sameAccount ? prev.last_sync_at : null,
    connected_at: nowStamp(),
  };
  await col('google_accounts').replaceOne({ _id: user.id }, doc, { upsert: true });
  tokens.set(user.id, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 });
  return { _id: user.id, ...doc };
}

const tokens = new Map();   // user id -> { token, exp }

async function accessToken(acc) {
  const cached = tokens.get(acc._id);
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const c = await config();
  if (!c.configured) throw new GoogleError("Identifiants Google non configurés (Paramètres → Google Agenda).");
  const r = await postForm(TOKEN_URL, { client_id: c.client_id, client_secret: c.client_secret, refresh_token: acc.refresh_token, grant_type: 'refresh_token' });
  if (!r.ok) {
    const revoked = r.data.error === 'invalid_grant';
    throw new GoogleError(revoked
      ? "L'accès à Google Agenda a été retiré ou a expiré. Reconnectez votre compte Google."
      : `Renouvellement de l'accès Google impossible (${r.data.error_description || r.data.error || r.status}).`, { status: r.status, revoked });
  }
  tokens.set(acc._id, { token: r.data.access_token, exp: Date.now() + (Number(r.data.expires_in) || 3000) * 1000 });
  return r.data.access_token;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Calendar API call. Retries on rate limits / server errors and once on an expired token.
// Returns { status, data }; throws GoogleError for errors other than 404/410 when `allow` lists them.
async function gapi(acc, method, path, body, { allow = [] } = {}) {
  let refreshed = false;
  for (let attempt = 0; ; attempt += 1) {
    const token = await accessToken(acc);
    let r;
    try {
      r = await fetch(`${API}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      throw new GoogleError(`Google Agenda est injoignable (${e.message}).`);
    }
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (r.ok || allow.includes(r.status)) return { status: r.status, data };
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status;
    if (r.status === 401 && !refreshed) { tokens.delete(acc._id); refreshed = true; continue; }
    const limited = r.status === 429 || (r.status === 403 && /rateLimit|userRateLimit|quotaExceeded/i.test(reason || ''));
    if ((limited || r.status >= 500) && attempt < 4) { await sleep(1000 * 2 ** attempt + Math.random() * 500); continue; }
    throw new GoogleError(`Google Agenda : ${data?.error?.message || `erreur ${r.status}`}`, { status: r.status, reason });
  }
}

/* ---------------- what each calendar should contain ---------------- */

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(' ');
const fmt = (s) => { const d = parseLocal(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}${hasTime(s) ? ` à ${pad(d.getHours())}h${pad(d.getMinutes())}` : ''}`; };
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

async function loadContext() {
  const [requests, cfg, lab, url] = await Promise.all([
    col('requests').find({ deleted_at: null }, { projection: { history: 0 } }).toArray(),
    config(), labInfo(), clientUrl(),
  ]);
  const doctors = new Map((await col('doctors').find({ _id: { $in: [...new Set(requests.map((r) => r.doctor_id))] } }, { projection: { last_name: 1, first_name: 1 } }).toArray())
    .map((d) => [d._id, `${d.last_name || ''} ${d.first_name || ''}`.trim()]));
  return { requests, doctors, fullNames: cfg.full_names, labName: lab.name || 'Laboratoire dentaire', url: /^https?:\/\//.test(url) ? url : '', tz: timeZone(), since: localDate(new Date(Date.now() - PAST_DAYS * 86400e3)) };
}

function eventFor(r, kind, ctx) {
  const due = kind === 'delivery' ? r.delivery_planned : r[`${kind}_date`];
  if (!due) return null;
  const done = kind === 'delivery' ? r.status === 'livree' : !!r[`${kind}_done`];
  const doctor = ctx.doctors.get(r.doctor_id) || '';
  const patient = ctx.fullNames ? r.patient_name : initials(r.patient_name);
  const works = [...new Set((r.works || []).map((w) => w.designation_label).filter(Boolean))].join(', ');
  const link = ctx.url ? `${ctx.url}/demandes/${r._id}` : '';
  const start = parseLocal(due);
  const when = hasTime(due)
    ? { start: { dateTime: localDateTime(start), timeZone: ctx.tz }, end: { dateTime: localDateTime(new Date(start.getTime() + EVENT_MINUTES * 60e3)), timeZone: ctx.tz } }
    : { start: { date: localDate(start) }, end: { date: localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)) } };
  const lines = [
    `${KINDS[kind]} ${kind === 'delivery' ? 'prévue' : 'prévu'} le ${fmt(due)}${done ? (kind === 'delivery' ? ` : livrée${r.delivery_actual ? ` le ${fmt(r.delivery_actual)}` : ''}` : ' : effectué') : ''}.`,
    '',
    `Demande : ${r.numero}`,
    `Patient : ${patient}`,
    doctor ? `Médecin : Dr ${doctor}` : null,
    `Statut : ${STATUS_LABELS[r.status] || r.status}`,
    works ? `Travaux : ${works}` : null,
    link ? `\nOuvrir la demande : ${link}` : null,
    '',
    `Événement mis à jour automatiquement par ${ctx.labName} : les modifications faites ici seront remplacées.`,
  ].filter((l) => l !== null);
  const body = {
    summary: `${done ? '✓ ' : ''}${SHORT[kind]} — ${r.numero} — ${patient}${doctor ? ` (Dr ${doctor})` : ''}`,
    description: lines.join('\n'),
    ...when,
    status: 'confirmed',
    transparency: 'transparent',                       // does not mark the person as busy
    colorId: done ? '8' : kind === 'delivery' ? '10' : '5',   // graphite / basil / banana
    extendedProperties: { private: { labo: '1', labo_request: String(r._id), labo_kind: kind } },
    ...(link ? { source: { title: `${ctx.labName} — ${r.numero}`, url: link } } : {}),
  };
  return { key: `${r._id}:${kind}`, request_id: r._id, kind, body, hash: hash(body), recent: dateOnly(due) >= ctx.since };
}

function desiredFor(acc, ctx) {
  const kinds = (acc.kinds || DEFAULT_KINDS).filter((k) => KINDS[k]);
  const out = new Map();
  for (const r of ctx.requests) for (const k of kinds) { const e = eventFor(r, k, ctx); if (e) out.set(e.key, e); }
  return out;
}

/* ---------------- synchronisation ---------------- */

async function ensureCalendar(acc, ctx) {
  if (acc.calendar_id) {
    const r = await gapi(acc, 'GET', `/calendars/${encodeURIComponent(acc.calendar_id)}`, null, { allow: [404, 410] });
    if (r.status === 200) return acc.calendar_id;
    // the person deleted the calendar in Google: start a fresh one
  }
  await col('calendar_events').deleteMany({ user_id: acc._id });
  const r = await gapi(acc, 'POST', '/calendars', {
    summary: `${ctx.labName} — demandes`,
    description: `Essayages et livraisons des demandes du laboratoire, tenus à jour automatiquement par l'application ${ctx.labName}.`,
    timeZone: ctx.tz,
  });
  acc.calendar_id = r.data.id;
  await col('google_accounts').updateOne({ _id: acc._id }, { $set: { calendar_id: acc.calendar_id } });
  return acc.calendar_id;
}

// Rebuilds the event map from the calendar itself (e.g. after the map was lost), so nothing is duplicated.
async function adopt(acc, cal) {
  let pageToken = '';
  let n = 0;
  do {
    const q = new URLSearchParams({ privateExtendedProperty: 'labo=1', maxResults: '2500', showDeleted: 'false', ...(pageToken ? { pageToken } : {}) });
    const r = await gapi(acc, 'GET', `/calendars/${encodeURIComponent(cal)}/events?${q}`);
    for (const ev of r.data.items || []) {
      const p = ev.extendedProperties?.private || {};
      if (!p.labo_request || !KINDS[p.labo_kind]) continue;
      const key = `${p.labo_request}:${p.labo_kind}`;
      try {
        await col('calendar_events').insertOne({ _id: await nextId('calendar_events'), user_id: acc._id, key, request_id: Number(p.labo_request), kind: p.labo_kind, event_id: ev.id, hash: '', updated_at: nowStamp() });
        n += 1;
      } catch (e) {
        if (e.code !== 11000) throw e;
        await gapi(acc, 'DELETE', `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(ev.id)}`, null, { allow: [404, 410] });   // duplicate
      }
    }
    pageToken = r.data.nextPageToken || '';
  } while (pageToken);
  return n;
}

async function syncAccount(acc, ctx) {
  const cal = await ensureCalendar(acc, ctx);
  const calPath = `/calendars/${encodeURIComponent(cal)}/events`;
  let maps = await col('calendar_events').find({ user_id: acc._id }).toArray();
  if (!maps.length && await adopt(acc, cal)) maps = await col('calendar_events').find({ user_id: acc._id }).toArray();

  const desired = desiredFor(acc, ctx);
  const current = new Map(maps.map((m) => [m.key, m]));
  const stats = { created: 0, updated: 0, deleted: 0 };

  const insertEvent = async (d, existingId) => {
    const r = await gapi(acc, 'POST', calPath, d.body);
    const set = { event_id: r.data.id, hash: d.hash, updated_at: nowStamp() };
    if (existingId) await col('calendar_events').updateOne({ _id: existingId }, { $set: set });
    else await col('calendar_events').insertOne({ _id: await nextId('calendar_events'), user_id: acc._id, key: d.key, request_id: d.request_id, kind: d.kind, ...set });
    stats.created += 1;
  };

  for (const d of desired.values()) {
    const m = current.get(d.key);
    current.delete(d.key);
    if (!m) { if (d.recent) await insertEvent(d); continue; }
    if (m.hash === d.hash) continue;
    const r = await gapi(acc, 'PUT', `${calPath}/${encodeURIComponent(m.event_id)}`, d.body, { allow: [404, 410] });
    if (r.status === 404 || r.status === 410) await insertEvent(d, m._id);
    else { await col('calendar_events').updateOne({ _id: m._id }, { $set: { hash: d.hash, updated_at: nowStamp() } }); stats.updated += 1; }
  }
  // events whose request was deleted, whose date was removed, or whose kind the person no longer wants
  for (const m of current.values()) {
    await gapi(acc, 'DELETE', `${calPath}/${encodeURIComponent(m.event_id)}`, null, { allow: [404, 410] });
    await col('calendar_events').deleteOne({ _id: m._id });
    stats.deleted += 1;
  }
  return stats;
}

async function syncAllNow() {
  if (!(await config()).configured) return;
  const accounts = await col('google_accounts').find({ status: { $ne: 'revoked' } }).toArray();
  if (!accounts.length) return;
  const users = new Map((await col('users').find({ _id: { $in: accounts.map((a) => a._id) } }).toArray()).map((u) => [u._id, u]));
  const ctx = await loadContext();
  for (const acc of accounts) {
    const u = users.get(acc._id);
    // inactive users and users who may not see requests get nothing new
    if (!u || !u.active || !effectivePermissions(u).includes('requests_view')) continue;
    try {
      const stats = await syncAccount(acc, ctx);
      await col('google_accounts').updateOne({ _id: acc._id }, { $set: { status: 'ok', last_error: null, last_sync_at: nowStamp(), last_stats: stats } });
      if (stats.created + stats.updated + stats.deleted) console.log(`[google agenda] ${u.name} : ${stats.created} ajouté(s), ${stats.updated} modifié(s), ${stats.deleted} retiré(s)`);
    } catch (e) {
      console.error(`[google agenda] ${u.name} :`, e.message);
      await col('google_accounts').updateOne({ _id: acc._id }, { $set: { status: e.revoked ? 'revoked' : 'error', last_error: String(e.message).slice(0, 500), last_error_at: nowStamp() } });
    }
  }
}

// One sync at a time; a request made during a sync triggers exactly one more afterwards.
let running = null;
let again = false;
function syncAll() {
  if (running) { again = true; return running; }
  running = (async () => {
    try { do { again = false; await syncAllNow(); } while (again); } catch (e) { console.error('[google agenda]', e); }
  })().finally(() => { running = null; });
  return running;
}

let debounce = null;
function requestChanged() {
  clearTimeout(debounce);
  debounce = setTimeout(() => syncAll(), DEBOUNCE_MS);
}

let timer = null;
function start() {
  setTimeout(() => syncAll(), 5000);
  timer = setInterval(() => syncAll(), PERIOD_MS);
}
function stop() { clearInterval(timer); clearTimeout(debounce); }

async function disconnect(userId, { deleteCalendar = false } = {}) {
  const acc = await col('google_accounts').findOne({ _id: userId });
  if (!acc) return { calendar_deleted: false };
  let calendarDeleted = false;
  if (deleteCalendar && acc.calendar_id) {
    try {
      await gapi(acc, 'DELETE', `/calendars/${encodeURIComponent(acc.calendar_id)}`, null, { allow: [404, 410] });
      calendarDeleted = true;
    } catch (e) { console.error('[google agenda] suppression de l\'agenda :', e.message); }
  }
  try { await postForm(REVOKE_URL, { token: acc.refresh_token }); } catch { /* already revoked or offline */ }
  await col('google_accounts').deleteOne({ _id: userId });
  await col('calendar_events').deleteMany({ user_id: userId });
  tokens.delete(userId);
  return { calendar_deleted: calendarDeleted };
}

async function publicAccount(userId) {
  const acc = await col('google_accounts').findOne({ _id: userId });
  if (!acc) return null;
  return {
    google_email: acc.google_email, status: acc.status, last_error: acc.last_error, last_sync_at: acc.last_sync_at,
    connected_at: acc.connected_at, kinds: acc.kinds || DEFAULT_KINDS, has_calendar: !!acc.calendar_id,
    events: await col('calendar_events').countDocuments({ user_id: userId }),
  };
}

async function setKinds(userId, kinds) {
  const clean = [...new Set((kinds || []).filter((k) => KINDS[k]))];
  await col('google_accounts').updateOne({ _id: userId }, { $set: { kinds: clean } });
  return clean;
}

module.exports = {
  KINDS, DEFAULT_KINDS, config, redirectUri, clientUrl, authUrl, readState, completeConnection,
  syncAll, requestChanged, start, stop, disconnect, publicAccount, setKinds,
  _internal: { eventFor, desiredFor, loadContext, tokens },
};