// npm run check:db  ->  tells whether MongoDB is reachable with the address in server/.env
require('./env');
const { connect, close, col, safeUri, MONGODB_URI, DB_NAME } = require('./db');

(async () => {
  try {
    await connect();
    const [users, doctors, requests] = await Promise.all(['users', 'doctors', 'requests'].map((c) => col(c).estimatedDocumentCount()));
    console.log(`MongoDB OK : ${safeUri(MONGODB_URI)} (base « ${DB_NAME} ») ; ${users} utilisateur(s), ${doctors} médecin(s), ${requests} demande(s).`);
  } catch (e) {
    console.error(`MongoDB injoignable : ${e.message}`);
    console.error('  Mac : brew services start mongodb-community   (installation : voir README, « Base de données MongoDB »)');
    console.error('  Ou corrigez MONGODB_URI dans server/.env (adresse MongoDB Atlas).');
    process.exitCode = 1;
  } finally { await close(); }
})();
