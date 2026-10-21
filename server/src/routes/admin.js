const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const multer = require('multer');
const { col, COLLECTIONS, ensureIndexes, getSetting, setSetting, out, rx, DATA_DIR, DB_NAME } = require('../db');
const { requirePerm } = require('../auth');
const { bad, audit, today, currentPeriod, pad } = require('../util');
const { labInfo } = require('./invoices');
const { trackingSettings } = require('./requests');

const router = express.Router();
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---- General statistics
router.get('/stats', requirePerm('stats_view'), async (req, res) => {
  const to = req.query.to || currentPeriod();
  const from = req.query.from || (() => { const [y, m] = to.split('-').map(Number); const d = new Date(y, m - 12, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  const months = [];
  for (let [y, m] = from.split('-').map(Number); `${y}-${pad(m)}` <= to; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${pad(m)}`);
  const inPeriod = { $gte: `${from}-01`, $lte: `${to}-31` };   // ISO dates compare as strings

  const [invoiced, fichesBy, deliveredBy, doctors, doctorsArchived, carnetsActive, inProgress, curInvoices, byDoctor] = await Promise.all([
    col('invoices').aggregate([{ $match: { status: 'validee', period: { $gte: from, $lte: to } } }, { $group: { _id: '$period', total: { $sum: '$total' }, n: { $sum: 1 } } }]).toArray(),
    col('fiches').aggregate([{ $match: { date: inPeriod } }, { $group: { _id: { $substrBytes: ['$date', 0, 7] }, n: { $sum: 1 }, total: { $sum: '$total' } } }]).toArray(),
    col('requests').aggregate([{ $match: { deleted_at: null, status: 'livree', delivery_actual: inPeriod } }, { $group: { _id: { $substrBytes: ['$delivery_actual', 0, 7] }, n: { $sum: 1 } } }]).toArray(),
    col('doctors').countDocuments({ archived: false }),
    col('doctors').countDocuments({ archived: true }),
    col('carnets').countDocuments({ archived: false }),
    col('requests').countDocuments({ deleted_at: null, status: { $in: ['en_cours', 'attente_essayage'] } }),
    col('invoices').find({ period: currentPeriod() }, { projection: { numero: 1, status: 1, total: 1, doctor_id: 1 } }).toArray(),
    col('invoices').aggregate([{ $match: { status: 'validee', period: { $gte: from, $lte: to } } }, { $group: { _id: '$doctor_id', total: { $sum: '$total' }, invoices: { $sum: 1 } } }, { $sort: { total: -1 } }]).toArray(),
  ]);
  const names = new Map((await col('doctors').find({ _id: { $in: [...curInvoices.map((i) => i.doctor_id), ...byDoctor.map((b) => b._id)] } }).toArray())
    .map((d) => [d._id, `${d.last_name} ${d.first_name}`]));
  const byPeriod = (rows, k) => Object.fromEntries(rows.map((r) => [r._id, r[k]]));
  const inv = byPeriod(invoiced, 'total'); const fn = byPeriod(fichesBy, 'n'); const ft = byPeriod(fichesBy, 'total'); const dl = byPeriod(deliveredBy, 'n');
  res.json({
    from, to,
    doctors, doctors_archived: doctorsArchived, carnets_active: carnetsActive,
    fiches_period: fichesBy.reduce((s, r) => s + r.n, 0),
    requests_in_progress: inProgress,
    delivered_period: deliveredBy.reduce((s, r) => s + r.n, 0),
    current_month: {
      period: currentPeriod(),
      invoices: curInvoices.map((i) => ({ id: i._id, numero: i.numero || null, status: i.status, total: i.total, doctor_name: names.get(i.doctor_id) || '' }))
        .sort((a, b) => a.status.localeCompare(b.status) || a.doctor_name.localeCompare(b.doctor_name, 'fr')),
    },
    by_doctor: byDoctor.map((b) => ({ id: b._id, doctor_name: names.get(b._id) || '', total: b.total, invoices: b.invoices }))
      .sort((x, y) => y.total - x.total || x.doctor_name.localeCompare(y.doctor_name, 'fr')),
    series: months.map((p) => ({ period: p, invoiced: inv[p] || 0, fiches: fn[p] || 0, fiches_total: ft[p] || 0, delivered: dl[p] || 0 })),
  });
});

// ---- Settings: laboratory info + tracking thresholds
router.get('/settings', async (req, res) => res.json({
  lab: await labInfo(), tracking: await trackingSettings(), backup: { keep: 30, hour: 2, ...((await getSetting('backup')) || {}) },
}));

router.put('/settings', requirePerm('settings_manage'), async (req, res) => {
  const { lab, tracking, backup } = req.body || {};
  if (lab) {
    if (!lab.name?.trim()) throw bad('Le nom du laboratoire est obligatoire.');
    const dec = Number(lab.decimals);
    if (![0, 2, 3].includes(dec)) throw bad('Nombre de décimales invalide (0, 2 ou 3).');
    if (lab.app_url && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(lab.app_url)) throw bad("Adresse de l'application invalide (ex. https://labo.exemple.tn).");
    await setSetting('lab', { ...(await labInfo()), ...lab, decimals: dec, app_url: (lab.app_url || '').replace(/\/$/, '') });
  }
  if (tracking) {
    const n = Number(tracking.near_days); const h = Number(tracking.try_horizon_days);
    if (!(n >= 0 && n <= 30) || !(h >= 0 && h <= 60)) throw bad('Seuils de suivi invalides.');
    await setSetting('tracking', { near_days: n, try_horizon_days: h });
  }
  if (backup) {
    const keep = Number(backup.keep); const hour = Number(backup.hour);
    if (!(keep >= 1 && keep <= 365) || !(hour >= 0 && hour <= 23)) throw bad('Paramètres de sauvegarde invalides.');
    await setSetting('backup', { keep, hour });
  }
  audit(req, 'modification paramètres', 'settings', null, { sections: Object.keys(req.body || {}) });
  res.json({ ok: true });
});

// ---- Audit log
router.get('/audit', requirePerm('settings_manage'), async (req, res) => {
  const { q, entity } = req.query;
  const filter = {};
  if (entity) filter.entity = entity;
  if (q) filter.$or = [{ action: rx(q) }, { user_name: rx(q) }, { details: rx(q) }];
  res.json((await col('audit_log').find(filter).sort({ _id: -1 }).limit(500).toArray()).map(out));
});

// ---- Backups: full export of every collection as gzipped JSON (no MongoDB tools needed)
const BACKUP_EXT = '.json.gz';

async function exportAll() {
  const collections = {};
  for (const name of COLLECTIONS) collections[name] = await col(name).find().toArray();
  return { app: 'labo-dentaire', format: 1, database: DB_NAME, created_at: new Date().toISOString(), collections };
}

async function makeBackup(label = 'auto') {
  const d = new Date();
  const name = `labo-${today()}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${label}${BACKUP_EXT}`;
  const data = zlib.gzipSync(Buffer.from(JSON.stringify(await exportAll())));
  const tmp = path.join(BACKUP_DIR, `${name}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(BACKUP_DIR, name));      // never leave a half-written backup
  const keep = ((await getSetting('backup')) || {}).keep || 30;
  for (const f of listBackups().slice(keep)) fs.unlinkSync(path.join(BACKUP_DIR, f.name));
  return name;
}
function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(BACKUP_EXT)).map((f) => {
    const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, created_at: st.mtime };
  }).sort((a, b) => b.created_at - a.created_at);
}
const safeName = (n) => { if (!/^[\w.-]+\.json\.gz$/.test(n || '')) throw bad('Nom de sauvegarde invalide.'); return n; };

function readBackupFile(file) {
  let data;
  try {
    const buf = fs.readFileSync(file);
    data = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8'));
  } catch { throw bad("Ce fichier n'est pas une sauvegarde valide de l'application (.json.gz attendu)."); }
  const c = data?.collections;
  if (data?.app !== 'labo-dentaire' || !c || !['users', 'doctors', 'requests', 'invoices'].every((k) => Array.isArray(c[k]))) {
    throw bad("Ce fichier n'est pas une sauvegarde valide de l'application.");
  }
  if (!c.users.some((u) => u.role === 'admin' && u.active)) throw bad('Cette sauvegarde ne contient aucun administrateur actif : restauration refusée.');
  return data;
}

async function restoreFrom(file, req) {
  const data = readBackupFile(file);
  const safety = await makeBackup('avant-restauration');
  try {
    for (const name of COLLECTIONS) {
      await col(name).deleteMany({});
      const docs = data.collections[name] || [];
      for (let i = 0; i < docs.length; i += 1000) await col(name).insertMany(docs.slice(i, i + 1000), { ordered: false });
    }
    await ensureIndexes();
  } catch (e) {
    throw new Error(`La restauration a échoué (${e.message}). L'état précédent est disponible dans la sauvegarde « ${safety} ».`);
  }
  audit(req, 'restauration sauvegarde', 'backup', null, { fichier: path.basename(file), sauvegarde_precedente: safety });
}

router.get('/backups', requirePerm('settings_manage'), (req, res) => res.json(listBackups()));
router.post('/backups', requirePerm('settings_manage'), async (req, res) => { const name = await makeBackup('manuel'); audit(req, 'sauvegarde manuelle', 'backup', null, { name }); res.json({ name }); });
router.get('/backups/:name/download', requirePerm('settings_manage'), (req, res) => res.download(path.join(BACKUP_DIR, safeName(req.params.name))));
router.post('/backups/:name/restore', requirePerm('settings_manage'), async (req, res) => {
  const file = path.join(BACKUP_DIR, safeName(req.params.name));
  if (!fs.existsSync(file)) throw bad('Sauvegarde introuvable.');
  await restoreFrom(file, req); res.json({ ok: true });
});
const upload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 500 * 1024 * 1024 } });
router.post('/backups/upload-restore', requirePerm('settings_manage'), upload.single('file'), async (req, res) => {
  if (!req.file) throw bad('Choisissez un fichier de sauvegarde.');
  try { await restoreFrom(req.file.path, req); } finally { fs.rmSync(req.file.path, { force: true }); }
  res.json({ ok: true });
});

let lastAuto = null;
function scheduleBackups() {
  setInterval(async () => {
    try {
      const cfg = { hour: 2, ...((await getSetting('backup')) || {}) };
      const now = new Date();
      if (now.getHours() === cfg.hour && lastAuto !== today()) {
        lastAuto = today();
        await makeBackup('auto');
      }
    } catch (e) { console.error('[sauvegarde]', e.message); }
  }, 5 * 60 * 1000);
}

module.exports = { router, scheduleBackups, makeBackup, exportAll };
