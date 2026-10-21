// Loads server/.env. Tolerates a missing env.js (partial update) instead of refusing to start.
try {
  require('./env');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND' || !/['"]\.\/env['"]/.test(e.message)) throw e;
  console.warn('[configuration] server/src/env.js est manquant : server/.env n\'est pas lu. Mettez à jour le dossier server/src (voir README).');
}
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { connect, col, insert, safeUri, MONGODB_URI, DB_NAME } = require('./db');
const { HttpError } = require('./util');
const notifier = require('./services/notifier');
const { defaultPrefs, initSecret } = require('./auth');
const { keyOf } = require('./util');

async function ensureAdmin() {
  if (await col('users').countDocuments({}, { limit: 1 })) return;
  const email = process.env.ADMIN_EMAIL || 'admin@labo.local';
  const pass = process.env.ADMIN_PASSWORD || 'admin1234';
  // the initial password is temporary: a new one is required at first login
  await insert('users', {
    email, email_key: keyOf(email), password_hash: bcrypt.hashSync(pass, 10), name: 'Administrateur', role: 'admin',
    permissions: {}, phone: null, notif_prefs: defaultPrefs(), active: true, token_version: 0, must_change_password: true, password_changed_at: null,
  });
  console.log(`Compte administrateur créé : ${email} / ${pass} — un nouveau mot de passe sera demandé à la première connexion.`);
}

// Origins allowed to call the API from a browser (the React app when it runs on another port/domain)
function allowedOrigins() {
  const list = [process.env.APP_URL, process.env.CLIENT_URL, ...(process.env.CORS_ORIGINS || '').split(',')];
  if (process.env.NODE_ENV !== 'production') list.push('http://localhost:5173', 'http://127.0.0.1:5173');
  const out = new Set();
  for (const u of list) { try { if (u && u.trim()) out.add(new URL(u.trim()).origin); } catch { console.warn(`[configuration] origine CORS invalide ignorée : ${u}`); } }
  return out;
}

function createApp() {
  const app = express();
  const origins = allowedOrigins();
  app.use('/api', cors({
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),   // no Origin = same-origin or server-to-server
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  }));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === '1' && req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });

  const api = express.Router();
  // public, used by the Vite proxy check and monitoring
  api.get('/health', async (req, res) => {
    let database = 'ok';
    try { await col('users').estimatedDocumentCount(); } catch { database = 'indisponible'; }
    res.status(database === 'ok' ? 200 : 503).json({ ok: database === 'ok', app: 'labo-dentaire', database, time: new Date().toISOString() });
  });
  api.use(require('./routes/auth'));
  api.use(require('./routes/doctors').router);
  api.use(require('./routes/designations'));
  api.use(require('./routes/fiches').router);
  const requests = require('./routes/requests');
  requests.setOnChange(() => setTimeout(() => notifier.scan(), 50));   // reminders recalculated after any change
  api.use(requests.router);
  api.use(require('./routes/notifications'));
  api.use(require('./routes/invoices').router);
  api.use(require('./routes/admin').router);
  api.use((req, res) => res.status(404).json({ error: 'Route inconnue.' }));
  app.use('/api', api);

  // Serve built React client
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
    if (err.code === 11000) return res.status(409).json({ error: 'Opération refusée : elle créerait un doublon ou une incohérence.' });
    if (/MongoNetworkError|MongoServerSelectionError|MongoNotConnectedError/.test(err.name || '')) {
      console.error('[base de données]', err.message);
      return res.status(503).json({ error: 'La base de données est momentanément injoignable. Réessayez dans quelques instants.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });
  return app;
}

if (require.main === module) {
  // Any crash is reported clearly instead of silently dropping in-flight requests
  process.on('unhandledRejection', (e) => console.error('[erreur non gérée]', e));
  process.on('uncaughtException', (e) => { console.error('[plantage du serveur]', e); process.exit(1); });

  start().catch((e) => {
    if (e.code === 'MONGO_CONNECT') {
      console.error(`\n[démarrage impossible] ${e.message}\n` +
        '  - Vérifiez que MongoDB est lancé (Mac : « brew services start mongodb-community »), ou\n' +
        '  - corrigez MONGODB_URI dans server/.env (ex. adresse MongoDB Atlas).\n');
    } else console.error('[démarrage impossible]', e);
    process.exit(1);
  });
}

async function start() {
  await connect();
  console.log(`Base MongoDB connectée : ${safeUri(MONGODB_URI)} (base « ${DB_NAME} »)`);
  await initSecret();
  await ensureAdmin();
  await require('./routes/invoices').releaseStaleLocks();
  const app = createApp();
  const port = Number(process.env.PORT) || 4000;
  // Express 5 passes listen errors to this callback: only announce success when there is none
  const server = app.listen(port, (err) => {
    if (err) return;   // reported by the 'error' handler below
    console.log(`Laboratoire dentaire — API sur http://localhost:${port}`);
    notifier.start();
    require('./routes/admin').scheduleBackups();
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n[démarrage impossible] Le port ${port} est déjà utilisé par un autre programme.\n` +
        `  - Arrêtez l'autre programme (ou une ancienne instance du serveur), ou\n` +
        `  - changez PORT dans server/.env (le proxy Vite suit automatiquement ce port).\n`);
    } else console.error('[démarrage impossible]', e);
    process.exit(1);
  });
}

module.exports = { createApp, ensureAdmin, start };
