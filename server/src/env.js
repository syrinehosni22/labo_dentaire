// Loads server/.env (if present) before anything reads process.env.
// Real environment variables always take precedence over the file.
const path = require('path');
const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
try {
  require('dotenv').config({ path: envFile });
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.warn("[configuration] Le paquet « dotenv » n'est pas installé : server/.env n'est pas lu. Exécutez « npm install » dans le dossier server.");
}

const warn = (m) => console.warn(`[configuration] ${m}`);
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) warn('JWT_SECRET absent ou trop court (32 caractères minimum recommandés).');
  if (!process.env.APP_URL) warn("APP_URL absent : renseignez l'adresse publique (liens de réinitialisation du mot de passe).");
}
if (process.env.APP_URL && !/^https?:\/\/[^\s/]+/.test(process.env.APP_URL)) warn('APP_URL doit commencer par http:// ou https://');

module.exports = {};
