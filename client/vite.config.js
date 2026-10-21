import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';

// GET url -> { status, body, server } or { error }
function probe(url, timeout = 3000) {
  return new Promise((resolve) => {
    const get = url.startsWith('https') ? https.get : http.get;
    const req = get(url, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 2000) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, server: res.headers.server || res.headers['x-powered-by'] || '' }));
    });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
  });
}

const isOurs = (r) => r.status === 200 && r.body.includes('"app":"labo-dentaire"');
// Our server before /api/health existed: answers with its own JSON errors
const isOldOurs = (r) => /Authentification requise|Route inconnue|Session expirée/.test(r.body || '');
const describe = (r) => (r.error ? `pas de réponse (${r.error})`
  : `HTTP ${r.status}${r.server ? `, ${r.server}` : ''} : ${r.body.replace(/\s+/g, ' ').trim().slice(0, 120) || '(réponse vide)'}`);

async function checkApi(target) {
  const r = await probe(`${target}/api/health`);
  if (isOurs(r)) { console.log(`  ➜  API:     ${target} (connectée)`); return; }

  let msg;
  if (r.error) msg = `Le serveur API ne répond pas sur ${target} (${r.error}).\n  Lancez-le avec « npm run dev:server » (dossier racine), ou corrigez APP_URL dans server/.env.`;
  else if (isOldOurs(r)) msg = `${target} est bien le serveur du laboratoire, mais une ANCIENNE version est en cours d'exécution.\n  Arrêtez-le (Ctrl+C dans son terminal) puis relancez « npm run dev:server » pour prendre en compte les fichiers mis à jour.`;
  else msg = `Un autre programme répond sur ${target} :\n    ${describe(r)}\n  Arrêtez-le, ou changez PORT et APP_URL dans server/.env.`;

  // "localhost" can point to two different programs (IPv4 127.0.0.1 vs IPv6 ::1), common on Windows
  const u = new URL(target);
  if (u.hostname === 'localhost') {
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const [v4, v6] = await Promise.all([
      probe(`${u.protocol}//127.0.0.1:${port}/api/health`),
      probe(`${u.protocol}//[::1]:${port}/api/health`),
    ]);
    const noV6 = /EAFNOSUPPORT|EADDRNOTAVAIL/.test(v6.error || '');   // machine without IPv6
    msg += `\n  Détail : 127.0.0.1:${port} → ${isOurs(v4) ? 'serveur du laboratoire' : describe(v4)}`;
    if (!noV6) msg += `\n           [::1]:${port}     → ${isOurs(v6) ? 'serveur du laboratoire' : describe(v6)}`;
    if (!noV6 && isOurs(v4) !== isOurs(v6)) {
      const good = isOurs(v4) ? `127.0.0.1:${port}` : `[::1]:${port}`;
      msg += `\n  Deux programmes différents écoutent sur le port ${port}. Solution rapide : APP_URL=${u.protocol}//${good} dans server/.env,`
        + `\n  ou arrêtez l'autre programme (Windows : netstat -ano | findstr :${port}  puis  taskkill /PID <pid> /F).`;
    }
  }
  console.warn(`\n[api] ${msg}\n`);
}

export default defineConfig(({ mode }) => {
  // Configuration partagée avec le serveur : server/.env (les variables système ont priorité)
  const serverEnv = loadEnv(mode, '../server', '');
  const APP_URL = (process.env.APP_URL ?? serverEnv.APP_URL ?? '').trim().replace(/\/+$/, '');
  const apiPort = process.env.PORT || serverEnv.PORT || '4000';
  // Serveur API : APP_URL si défini, sinon le port local du serveur
  const target = APP_URL || `http://127.0.0.1:${apiPort}`;

  return {
    // Variable globale disponible dans le code client : import.meta.env.APP_URL.
    // Seule APP_URL est exposée ; les autres variables de server/.env (secrets) restent côté serveur.
    define: {
      'import.meta.env.APP_URL': JSON.stringify(APP_URL),
    },
    plugins: [
      react(),
      { name: 'api-check', configureServer() { setTimeout(() => checkApi(target), 500); } },
    ],
    server: {
      port: 5173,
      // Utilisé seulement si APP_URL est vide (requêtes relatives /api)
      proxy: { '/api': { target, changeOrigin: false } },
    },
  };
});
