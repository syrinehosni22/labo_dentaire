const { insert } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Élément introuvable.') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

// Activity log. Never blocks or breaks the action being logged.
async function audit(req, action, entity, entityId, details) {
  try {
    await insert('audit_log', {
      user_id: req?.user?.id ?? null, user_name: req?.user?.name ?? 'système', action, entity,
      entity_id: entityId ?? null, details: details ? JSON.stringify(details) : null,
    });
  } catch (e) { console.error('[journal]', e.message); }
}

const roundMoney = (n) => Math.round((Number(n) || 0) * 1000) / 1000; // 3 decimals: TND millimes

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// Local date helpers (server local time)
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function currentPeriod() { return today().slice(0, 7); }
function nowLocal() { const d = new Date(); return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// Parse 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' as local Date. Date-only => start of day.
function parseLocal(s) {
  if (!s) return null;
  const [d, t] = String(s).split(/[T ]/);
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0);
}
const hasTime = (s) => !!s && /[T ]\d{2}:\d{2}/.test(s);
const dateOnly = (s) => (s ? String(s).slice(0, 10) : null);

// A deadline is "past" when its moment has passed (date-only: when its day is over).
function isPast(s, now = new Date()) {
  if (!s) return false;
  const d = parseLocal(s);
  if (!hasTime(s)) d.setDate(d.getDate() + 1);
  return d <= now;
}

// Case/accent-insensitive key, used for unique indexes (doctor names, designations, e-mails)
const keyOf = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function normalizeName(last, first) {
  return `${last} ${first}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function validDate(s, label, required = false) {
  if (!s) { if (required) throw bad(`${label} est obligatoire.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(s) || isNaN(parseLocal(s))) throw bad(`${label} n'est pas une date valide.`);
  return String(s).replace(' ', 'T');
}

const STATUS_LABELS = { en_cours: 'En cours', attente_essayage: "En attente d'essayage", a_livrer: 'À livrer', livree: 'Livrée' };

module.exports = { keyOf, HttpError, bad, notFound, conflict, audit, roundMoney, pad, today, currentPeriod, nowLocal, parseLocal, hasTime, dateOnly, isPast, normalizeName, validDate, STATUS_LABELS };
