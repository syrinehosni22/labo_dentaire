const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { col, out, getSetting, setSetting } = require('./db');

// Permission catalogue — keys are used both server- and client-side.
const PERMISSIONS = {
  requests_view: 'Consulter les demandes',
  requests_edit: 'Créer / modifier les demandes',
  status_update: 'Mettre à jour les statuts',
  doctors_manage: 'Gérer les médecins et les carnets',
  fiches_manage: 'Gérer les fiches de travaux',
  prices_edit: 'Modifier les listes de prix A, B, C',
  price_override: 'Modifier les prix appliqués',
  invoices_manage: 'Préparer les factures',
  invoices_validate: 'Valider / rectifier les factures',
  delete_archive: 'Supprimer et archiver des données',
  stats_view: 'Consulter les statistiques',
  users_manage: 'Gérer les utilisateurs',
  settings_manage: 'Gérer les paramètres, notifications et sauvegardes',
};

const ROLE_DEFAULTS = {
  admin: Object.keys(PERMISSIONS),
  production: ['requests_view', 'requests_edit', 'status_update'],
  administratif: ['requests_view', 'requests_edit', 'status_update', 'doctors_manage', 'fiches_manage',
    'price_override', 'invoices_manage', 'invoices_validate', 'stats_view'],
};

const ROLE_LABELS = { admin: 'Administrateur', production: 'Personnel de production', administratif: 'Personnel administratif' };

// Stored as objects in MongoDB; tolerate JSON strings (data imported from the old SQLite database)
const obj = (v, fallback) => (v == null ? fallback : typeof v === 'string' ? JSON.parse(v) : v);

function effectivePermissions(user) {
  if (user.role === 'admin') return Object.keys(PERMISSIONS);
  const base = new Set(ROLE_DEFAULTS[user.role] || []);
  for (const [k, v] of Object.entries(obj(user.permissions, {}))) {
    if (!PERMISSIONS[k]) continue;
    if (v) base.add(k); else base.delete(k);
  }
  return [...base];
}

// Signing key: JWT_SECRET from .env, otherwise generated once and kept in the database.
let cachedSecret = null;
async function initSecret() {
  if (process.env.JWT_SECRET) { cachedSecret = process.env.JWT_SECRET; return; }
  let s = await getSetting('jwt_secret');
  if (!s) { s = crypto.randomBytes(48).toString('hex'); await setSetting('jwt_secret', s); }
  cachedSecret = s;
}
function secret() {
  if (!cachedSecret) throw new Error('Clé de session non initialisée (initSecret).');
  return cachedSecret;
}

// tv = token_version: bumped on password change/reset so older sessions stop working
function sign(user) {
  return jwt.sign({ uid: user.id, tv: user.token_version || 0 }, secret(), { expiresIn: '12h' });
}

// Shared password policy (login reset, profile, admin)
function passwordProblem(pw, user) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (pw.length > 128) return 'Le mot de passe est trop long (128 caractères maximum).';
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  if (user && pw.toLowerCase() === String(user.email || '').toLowerCase()) return "Le mot de passe ne peut pas être votre adresse e-mail.";
  if (['password1', 'motdepasse1', 'azerty123', 'admin1234', '12345678a', 'qwerty123'].includes(pw.toLowerCase())) return 'Ce mot de passe est trop courant, choisissez-en un autre.';
  return null;
}

function defaultPrefs() {
  return { push: true, sms: false, email: false, whatsapp: false, types: ['try1', 'try2', 'delivery', 'try_overdue', 'delivery_overdue', 'daily_summary'] };
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, role_label: ROLE_LABELS[u.role],
    phone: u.phone || null, active: !!u.active, must_change_password: !!u.must_change_password, password_changed_at: u.password_changed_at || null,
    permissions: effectivePermissions(u),
    permission_overrides: obj(u.permissions, {}),
    notif_prefs: { ...defaultPrefs(), ...obj(u.notif_prefs, {}) },
    created_at: u.created_at,
  };
}

async function findUser(id) {
  return out(await col('users').findOne({ _id: Number(id) }));
}

async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentification requise.' });
  let payload;
  try { payload = jwt.verify(token, secret()); } catch { return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' }); }
  const u = await findUser(payload.uid);
  if (!u || !u.active) return res.status(401).json({ error: 'Compte inactif ou introuvable.' });
  if ((payload.tv || 0) !== (u.token_version || 0)) return res.status(401).json({ error: 'Votre mot de passe a été modifié, reconnectez-vous.' });
  req.user = u;
  req.perms = new Set(effectivePermissions(u));
  return next();
}

function requirePerm(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => req.perms.has(p))) return next();
    return res.status(403).json({ error: "Vous n'avez pas les droits nécessaires pour cette action." });
  };
}

module.exports = { passwordProblem, PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, effectivePermissions, initSecret, secret, sign, authenticate, requirePerm, publicUser, defaultPrefs, findUser, obj };