// Copies the data of the former SQLite database (server/data/labo.db) into MongoDB.
//   npm run migrate:sqlite                 -> uses server/data/labo.db
//   npm run migrate:sqlite -- chemin/labo.db
//   add --force to replace data already present in MongoDB
// Ids, numbers (requests, fiches, invoices…), histories and settings are kept as they are.
require('./env');
const fs = require('fs');
const path = require('path');
const { connect, close, col, COLLECTIONS, ensureIndexes, safeUri, MONGODB_URI, DB_NAME, DATA_DIR } = require('./db');
const { keyOf } = require('./util');

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(DATA_DIR, 'labo.db'));

let Database;
try { Database = require('better-sqlite3'); } catch {
  console.error("Le module « better-sqlite3 » est nécessaire pour lire l'ancienne base. Installez-le : npm install better-sqlite3 (dans le dossier server).");
  process.exit(1);
}

const bool = (v) => v === 1 || v === true || v === '1';
const json = (v, fallback) => { if (v == null || v === '') return fallback; try { return JSON.parse(v); } catch { return fallback; } };

async function main() {
  if (!fs.existsSync(file)) throw new Error(`Base SQLite introuvable : ${file}`);
  const sq = new Database(file, { readonly: true, fileMustExist: true });
  const tables = new Set(sq.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name));
  const all = (t, order = 'id') => (tables.has(t) ? sq.prepare(`SELECT * FROM ${t}${order ? ` ORDER BY ${order}` : ''}`).all() : []);
  const groupBy = (rows, k) => rows.reduce((m, r) => (m.get(r[k]) || m.set(r[k], []).get(r[k])).push(r) && m, new Map());

  await connect();
  console.log(`Source : ${file}\nDestination : ${safeUri(MONGODB_URI)} (base « ${DB_NAME} »)`);
  const existing = await col('users').countDocuments() + await col('doctors').countDocuments();
  if (existing && !force) {
    throw new Error('La base MongoDB contient déjà des données. Relancez avec --force pour les remplacer par celles de SQLite.');
  }
  if (force) for (const c of COLLECTIONS) await col(c).deleteMany({});

  const userName = new Map(all('users').map((u) => [u.id, u.name]));
  const docs = {};

  docs.users = all('users').map((u) => ({
    _id: u.id, email: u.email, email_key: keyOf(u.email), password_hash: u.password_hash, name: u.name, role: u.role,
    permissions: json(u.permissions, {}), phone: u.phone || null, notif_prefs: json(u.notif_prefs, undefined), active: bool(u.active),
    token_version: u.token_version || 0, must_change_password: bool(u.must_change_password), password_changed_at: u.password_changed_at || null, created_at: u.created_at,
  }));
  docs.doctors = all('doctors').map((d) => ({
    _id: d.id, last_name: d.last_name, first_name: d.first_name, name_key: d.name_key, phone: d.phone, email: d.email, address: d.address,
    city: d.city, notes: d.notes, tariff: d.tariff, archived: bool(d.archived), created_at: d.created_at,
  }));
  docs.carnets = all('carnets').map((c) => ({ _id: c.id, numero: c.numero, doctor_id: c.doctor_id, archived: bool(c.archived), created_at: c.created_at }));
  docs.designations = all('designations').map((d) => ({
    _id: d.id, name: d.name, name_key: keyOf(d.name), category: d.category, price_a: d.price_a, price_b: d.price_b, price_c: d.price_c,
    params: json(d.params, []), per_tooth: bool(d.per_tooth), active: bool(d.active), created_at: d.created_at,
  }));
  docs.price_history = all('price_history').map((h) => ({ _id: h.id, designation_id: h.designation_id, list: h.list, old_price: h.old_price, new_price: h.new_price, user_id: h.user_id, at: h.at, created_at: h.at }));

  const ficheLines = groupBy(all('fiche_lines', 'fiche_id, position, id'), 'fiche_id');
  docs.fiches = all('fiches').map((f) => ({
    _id: f.id, numero: f.numero, carnet_id: f.carnet_id, doctor_id: f.doctor_id, request_id: f.request_id || null, lieu: f.lieu, date: f.date,
    patient_name: f.patient_name, status: f.status, subtotal: f.subtotal, total: f.total, invoice_id: f.invoice_id || null,
    lines: (ficheLines.get(f.id) || []).map((l, i) => ({ id: i + 1, position: i, designation_id: l.designation_id, designation_label: l.designation_label, quantity: l.quantity, list_price: l.list_price, unit_price: l.unit_price, total: l.total })),
    created_by: f.created_by, created_at: f.created_at, updated_at: f.updated_at || null,
  }));

  const works = groupBy(all('request_works'), 'request_id');
  const history = groupBy(all('status_history'), 'request_id');
  docs.requests = all('requests').map((r) => ({
    _id: r.id, numero: r.numero, patient_name: r.patient_name, doctor_id: r.doctor_id, created_date: r.created_date,
    try1_date: r.try1_date, try1_done: bool(r.try1_done), try2_date: r.try2_date, try2_done: bool(r.try2_done),
    delivery_planned: r.delivery_planned, delivery_actual: r.delivery_actual, observations: r.observations, status: r.status, total: r.total,
    works: (works.get(r.id) || []).map((w, i) => ({ id: i + 1, tooth: w.tooth, designation_id: w.designation_id, designation_label: w.designation_label, params: json(w.params, {}), quantity: w.quantity, list_price: w.list_price, unit_price: w.unit_price, total: w.total, observations: w.observations })),
    history: (history.get(r.id) || []).map((h) => ({ from_status: h.from_status, to_status: h.to_status, note: h.note, user_id: h.user_id, user_name: userName.get(h.user_id) || null, at: h.at })),
    deleted_at: r.deleted_at || null, created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at || null,
  }));

  const invLines = groupBy(all('invoice_lines', 'invoice_id, position, id'), 'invoice_id');
  docs.invoices = all('invoices').map((i) => {
    const d = {
      _id: i.id, doctor_id: i.doctor_id, period: i.period, status: i.status, grouping: i.grouping, lab_info: json(i.lab_info, {}), doctor_info: json(i.doctor_info, {}),
      notes: i.notes, total: i.total, corrects_invoice_id: i.corrects_invoice_id || null, correction_reason: i.correction_reason, issue_date: i.issue_date,
      validated_at: i.validated_at, validated_by: i.validated_by, created_by: i.created_by, created_at: i.created_at, updated_at: i.updated_at || null,
      lines: (invLines.get(i.id) || []).map((l, k) => ({ id: k + 1, position: k, fiche_id: l.fiche_id, fiche_numero: l.fiche_numero, fiche_date: l.fiche_date, patient_name: l.patient_name, designation_label: l.designation_label, quantity: l.quantity, unit_price: l.unit_price, total: l.total })),
    };
    if (i.numero) d.numero = i.numero;          // drafts have no number yet
    return d;
  });

  docs.notifications = all('notifications').map((n) => ({ _id: n.id, user_id: n.user_id, request_id: n.request_id || null, type: n.type, due_at: n.due_at, title: n.title, message: n.message, overdue: bool(n.overdue), read_at: n.read_at || null, dedup_key: n.dedup_key, created_at: n.created_at }));
  docs.notification_deliveries = all('notification_deliveries').map((d) => ({ _id: d.id, notification_id: d.notification_id, user_id: d.user_id, channel: d.channel, recipient: d.recipient, status: d.status, error: d.error, at: d.at, created_at: d.at }));
  docs.push_subscriptions = all('push_subscriptions').map((s) => ({ _id: s.id, user_id: s.user_id, endpoint: s.endpoint, keys: json(s.keys, {}), created_at: s.created_at }));
  docs.password_resets = all('password_resets').map((p) => ({ _id: p.id, user_id: p.user_id, token_hash: p.token_hash, expires_at: p.expires_at, used_at: p.used_at || null, origin: p.origin, created_by: p.created_by, created_at: p.created_at }));
  docs.audit_log = all('audit_log').map((a) => ({ _id: a.id, user_id: a.user_id, user_name: a.user_name, action: a.action, entity: a.entity, entity_id: a.entity_id, details: a.details, at: a.at, created_at: a.at }));
  docs.settings = all('settings', null).map((s) => ({ _id: s.key, value: json(s.value, s.value) }));

  // Counters: numbering sequences continue where SQLite stopped, and new ids follow the highest existing one
  const counters = all('counters', null).map((c) => ({ _id: c.key, value: c.value }));
  for (const [name, list] of Object.entries(docs)) {
    if (name === 'settings' || !list.length) continue;
    counters.push({ _id: `id:${name}`, value: Math.max(...list.map((d) => d._id)) });
  }
  docs.counters = counters;

  for (const [name, list] of Object.entries(docs)) {
    for (let i = 0; i < list.length; i += 1000) await col(name).insertMany(list.slice(i, i + 1000), { ordered: true });
    console.log(`  ${name.padEnd(24)} ${list.length}`);
  }
  await ensureIndexes();
  sq.close();
  console.log('\nMigration terminée. Les identifiants et numéros sont conservés ; vous pouvez démarrer le serveur.');
}

main().catch((e) => { console.error(`\n[migration] ${e.message}`); process.exitCode = 1; }).finally(() => close());
