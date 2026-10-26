const express = require('express');
const { col, insert, out, toId, nextSeq, getSetting, nowStamp } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, audit, roundMoney, pad, today, validDate, parseLocal, isPast, dateOnly, STATUS_LABELS, cleanTeeth } = require('../util');
const { priceCol, createFiche } = require('./fiches');

const router = express.Router();
const STATUSES = Object.keys(STATUS_LABELS);
const ACTIVE = ['en_cours', 'attente_essayage'];

let onChange = () => {};
function setOnChange(fn) { onChange = fn; }

async function trackingSettings() {
  return { near_days: 2, try_horizon_days: 7, ...((await getSetting('tracking')) || {}) };
}

// ---- derived scheduling info shared by dashboard, notifications and detail views
function derive(r, now, cfg) {
  const active = ACTIVE.includes(r.status);
  const tries = [];
  if (active && r.try1_date && !r.try1_done) tries.push({ which: 1, date: r.try1_date });
  if (active && r.try2_date && !r.try2_done) tries.push({ which: 2, date: r.try2_date });
  tries.sort((a, b) => parseLocal(a.date) - parseLocal(b.date));
  const nextTry = tries[0] || null;
  const deliveryOpen = r.status !== 'livree' && r.delivery_planned;
  const tryOverdue = tries.some((t) => isPast(t.date, now));
  const deliveryOverdue = !!(deliveryOpen && isPast(r.delivery_planned, now));
  const candidates = [nextTry?.date, deliveryOpen ? r.delivery_planned : null].filter(Boolean).sort((a, b) => parseLocal(a) - parseLocal(b));
  const nextDeadline = candidates[0] || null;
  const dayMs = 86400000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysTo = (s) => Math.floor((parseLocal(dateOnly(s)) - startToday) / dayMs);
  const near = !!nextDeadline && !isPast(nextDeadline, now) && daysTo(nextDeadline) <= cfg.near_days;
  let group;
  if (active && nextTry && (tryOverdue || daysTo(nextTry.date) <= cfg.try_horizon_days)) group = 1;
  else if (active) group = 2;
  else if (r.status === 'a_livrer') group = 3;
  else group = 4;
  return { next_try: nextTry, try_overdue: tryOverdue, delivery_overdue: deliveryOverdue, overdue: tryOverdue || deliveryOverdue, next_deadline: nextDeadline, near, priority_group: group };
}

async function doctorNames(ids) {
  const docs = await col('doctors').find({ _id: { $in: [...new Set(ids)] } }, { projection: { last_name: 1, first_name: 1, tariff: 1, archived: 1 } }).toArray();
  return new Map(docs.map((d) => [d._id, d]));
}

async function loadAllForList() {
  const rows = await col('requests').find({ deleted_at: null }, { projection: { history: 0 } }).toArray();
  const docs = await doctorNames(rows.map((r) => r.doctor_id));
  const now = new Date(); const cfg = await trackingSettings();
  return rows.map((raw) => {
    const { works = [], ...r } = out(raw);
    const d = docs.get(r.doctor_id) || {};
    const row = {
      ...r, doctor_name: `${d.last_name || ''} ${d.first_name || ''}`.trim(), tariff: d.tariff,
      works_summary: [...new Set(works.map((w) => w.designation_label))].join(',') || null,
      designation_ids: [...new Set(works.map((w) => w.designation_id))].join(','),
      works_count: works.length,
    };
    return { ...row, ...derive(row, now, cfg) };
  });
}

const inRange = (v, from, to) => {
  if (!from && !to) return true;
  if (!v) return false;
  const d = dateOnly(v);
  return (!from || d >= from) && (!to || d <= to);
};
const ts = (s) => (s ? parseLocal(s).getTime() : null);
const cmpNullsLast = (a, b, dir = 1) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir);

function prioritySort(a, b) {
  if (a.priority_group !== b.priority_group) return a.priority_group - b.priority_group;
  switch (a.priority_group) {
    case 1: return cmpNullsLast(ts(a.next_try.date), ts(b.next_try.date));
    case 2: return cmpNullsLast(ts(a.next_deadline), ts(b.next_deadline)) || b.id - a.id;
    case 3: return cmpNullsLast(ts(a.delivery_planned), ts(b.delivery_planned));
    default: return cmpNullsLast(ts(a.delivery_actual), ts(b.delivery_actual), -1) || b.id - a.id;
  }
}

const SORTS = {
  created_date: (r) => r.created_date, try1_date: (r) => ts(r.try1_date), try2_date: (r) => ts(r.try2_date),
  delivery_planned: (r) => ts(r.delivery_planned), delivery_actual: (r) => ts(r.delivery_actual),
  patient: (r) => r.patient_name.toLowerCase(), doctor: (r) => r.doctor_name.toLowerCase(), status: (r) => STATUSES.indexOf(r.status), numero: (r) => r.numero,
};

function filterRows(rows, q) {
  const statuses = q.status ? String(q.status).split(',').filter(Boolean) : [];
  const text = (q.q || '').toLowerCase().trim();
  return rows.filter((r) =>
    (!statuses.length || statuses.includes(r.status)) &&
    (!q.doctor_id || String(r.doctor_id) === String(q.doctor_id)) &&
    (!q.patient || r.patient_name.toLowerCase().includes(String(q.patient).toLowerCase())) &&
    (!q.numero || r.numero.toLowerCase().includes(String(q.numero).toLowerCase())) &&
    (!q.designation_id || (r.designation_ids || '').split(',').includes(String(q.designation_id))) &&
    inRange(r.created_date, q.created_from, q.created_to) &&
    inRange(r.try1_date, q.try1_from, q.try1_to) &&
    inRange(r.try2_date, q.try2_from, q.try2_to) &&
    ((!q.try_from && !q.try_to) || inRange(r.try1_date, q.try_from, q.try_to) || inRange(r.try2_date, q.try_from, q.try_to)) &&
    inRange(r.delivery_planned, q.delivery_planned_from, q.delivery_planned_to) &&
    inRange(r.delivery_actual, q.delivery_actual_from, q.delivery_actual_to) &&
    (q.overdue !== '1' || r.overdue) &&
    (q.near !== '1' || r.near) &&
    (!text || [r.numero, r.patient_name, r.doctor_name, r.works_summary, r.observations].some((v) => (v || '').toLowerCase().includes(text))));
}

// Dashboard list: filters + sort over the full set, then pagination.
router.get('/requests', requirePerm('requests_view'), async (req, res) => {
  const q = req.query;
  let rows = filterRows(await loadAllForList(), q);
  const sort = q.sort || 'priority';
  const dir = q.dir === 'desc' ? -1 : 1;
  if (sort === 'priority' || !SORTS[sort]) rows.sort(prioritySort);
  else rows.sort((a, b) => cmpNullsLast(SORTS[sort](a), SORTS[sort](b), dir) || b.id - a.id);
  const pageSize = [10, 25, 50].includes(Number(q.page_size)) ? Number(q.page_size) : 10;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(q.page) || 1), pages);   // coherent page after data changes
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map(({ designation_ids, ...r }) => r);
  res.json({ items, total, page, pages, page_size: pageSize });
});

router.get('/requests/kpis', requirePerm('requests_view'), async (req, res) => {
  const rows = await loadAllForList();
  const t = today();
  const from = req.query.from || `${t.slice(0, 7)}-01`;
  const to = req.query.to || t;
  const openTries = (r) => [r.try1_done ? null : r.try1_date, r.try2_done ? null : r.try2_date].filter(Boolean);
  const active = rows.filter((r) => ACTIVE.includes(r.status));
  res.json({
    in_progress: active.length,
    tries_today: active.reduce((n, r) => n + openTries(r).filter((d) => dateOnly(d) === t).length, 0),
    tries_upcoming: active.reduce((n, r) => n + openTries(r).filter((d) => dateOnly(d) > t).length, 0),
    tries_overdue: active.filter((r) => r.try_overdue).length,
    ready_to_deliver: rows.filter((r) => r.status === 'a_livrer').length,
    delivered_period: rows.filter((r) => r.status === 'livree' && inRange(r.delivery_actual, from, to)).length,
    delivery_overdue: rows.filter((r) => r.delivery_overdue).length,
    period: { from, to },
  });
});

async function loadRequest(id) {
  const r = out(await col('requests').findOne({ _id: toId(id), deleted_at: null }));
  if (!r) throw notFound('Demande introuvable.');
  const d = await col('doctors').findOne({ _id: r.doctor_id });
  r.doctor_name = `${d?.last_name || ''} ${d?.first_name || ''}`.trim();
  r.tariff = d?.tariff; r.doctor_archived = !!d?.archived;
  r.works = (r.works || []).slice().sort((a, b) => (a.tooth == null) - (b.tooth == null) || (a.tooth || 0) - (b.tooth || 0) || a.id - b.id);
  r.history = (r.history || []).map((h, i) => ({ id: i + 1, ...h })).reverse();      // most recent first
  r.fiches = (await col('fiches').find({ request_id: r.id }, { projection: { numero: 1, status: 1, total: 1 } }).toArray()).map(out);
  Object.assign(r, derive(r, new Date(), await trackingSettings()));
  return r;
}

// One status-history entry (embedded in the request)
const historyEntry = (req, from, to, note) => ({ from_status: from, to_status: to, note: note || null, user_id: req.user.id, user_name: req.user.name, at: nowStamp() });

const PERMANENT = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
const TEMPORARY = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85];
const VALID_TEETH = new Set([...PERMANENT, ...TEMPORARY]);

async function buildWorks(works, doctor, req, existing = []) {
  if (!Array.isArray(works)) throw bad('Travaux invalides.');
  const canOverride = req.perms.has('price_override');
  const ids = [...new Set(works.map((w) => toId(w.designation_id)).filter(Boolean))];
  const desById = new Map((await col('designations').find({ _id: { $in: ids } }).toArray()).map((d) => [d._id, d]));
  const built = works.map((w, i) => {
    const n = `Travail ${i + 1}${w.tooth ? ` (dent ${w.tooth})` : ''}`;
    const tooth = w.tooth == null || w.tooth === '' ? null : Number(w.tooth);
    if (tooth != null && !VALID_TEETH.has(tooth)) throw bad(`${n} : numéro de dent FDI invalide.`);
    const des = desById.get(toId(w.designation_id));
    if (!des) throw bad(`${n} : choisissez une désignation dans la liste.`);
    des.id = des._id;
    const qty = w.quantity == null || w.quantity === '' ? 1 : Number(w.quantity);
    if (!(qty > 0)) throw bad(`${n} : quantité invalide.`);
    const listPrice = des[priceCol(doctor.tariff)];
    const unit = w.unit_price == null || w.unit_price === '' ? listPrice : Number(w.unit_price);
    if (isNaN(unit) || unit < 0) throw bad(`${n} : prix invalide.`);
    const prev = existing.find((e) => e.id === w.id && e.designation_id === des.id);
    if (!canOverride && roundMoney(unit) !== roundMoney(listPrice) && !(prev && roundMoney(prev.unit_price) === roundMoney(unit))) {
      throw bad("Vous n'avez pas le droit de modifier les prix appliqués.");
    }
    // keep only params defined for this designation (compatible params)
    const defs = typeof des.params === 'string' ? JSON.parse(des.params) : (des.params || []);
    const params = {};
    for (const p of defs) if (w.params && w.params[p.key] != null && w.params[p.key] !== '') params[p.key] = w.params[p.key];
    const bridge = tooth != null && Number.isInteger(Number(w.bridge)) && Number(w.bridge) > 0 ? Number(w.bridge) : null;
    return { id: i + 1, tooth, bridge, designation_id: des.id, designation_label: des.name, params, quantity: qty, list_price: listPrice, unit_price: roundMoney(unit), total: roundMoney(qty * unit), observations: w.observations || null };
  });
  // a bridge needs at least two different teeth: otherwise it is an ordinary work
  for (const b of new Set(built.map((w) => w.bridge).filter(Boolean))) {
    if (!cleanTeeth(built.filter((w) => w.bridge === b).map((w) => w.tooth))) built.forEach((w) => { if (w.bridge === b) w.bridge = null; });
  }
  return built;
}

async function validateRequest(b) {
  if (!b.patient_name?.trim()) throw bad('Le nom du patient est obligatoire.');
  const doctor = out(await col('doctors').findOne({ _id: toId(b.doctor_id) }));
  if (!doctor) throw bad('Sélectionnez le médecin prescripteur dans la liste.');
  const v = {
    created_date: validDate(b.created_date || today(), 'La date de création', true).slice(0, 10),
    try1_date: validDate(b.try1_date, 'La date du premier essayage'),
    try2_date: validDate(b.try2_date, 'La date du deuxième essayage'),
    delivery_planned: validDate(b.delivery_planned, 'La date de livraison prévue'),
    delivery_actual: validDate(b.delivery_actual, 'La date de livraison effective'),
  };
  if (v.try1_date && v.try2_date && parseLocal(v.try2_date) < parseLocal(v.try1_date)) throw bad('Le deuxième essayage doit avoir lieu après le premier.');
  for (const [k, label] of [['try1_date', 'Le premier essayage'], ['try2_date', 'Le deuxième essayage'], ['delivery_planned', 'La livraison prévue']]) {
    if (v[k] && dateOnly(v[k]) < v.created_date) throw bad(`${label} ne peut pas être antérieur à la date de création.`);
  }
  if (b.status && !STATUSES.includes(b.status)) throw bad('Statut invalide.');
  return { doctor, v };
}

const worksTotal = (works) => roundMoney(works.reduce((s, w) => s + w.total, 0));

// Builds a fiche from a request's works (same designation + price grouped on one line).
// The teeth of a bridge stay together on their own line, named "Bridge 14-15-16".
async function ficheFromRequest(req, cur, { date, lieu, status }) {
  const grouped = new Map();
  for (const w of cur.works) {
    const k = `${w.bridge ? `b${w.bridge}` : ''}|${w.designation_id}|${w.unit_price}`;
    const g = grouped.get(k) || { designation_id: w.designation_id, designation_label: w.designation_label, quantity: 0, unit_price: w.unit_price, _bridge: w.bridge || null };
    g.quantity += w.quantity; grouped.set(k, g);
  }
  // every line of a bridge is named after all the teeth of that bridge
  const bridgeTeeth = (b) => cleanTeeth(cur.works.filter((w) => w.bridge === b).map((w) => w.tooth));
  const lines = [...grouped.values()].map(({ _bridge, ...g }) => ({ ...g, bridge_teeth: _bridge ? bridgeTeeth(_bridge) : null }));
  lines.sort((a, b) => (b.bridge_teeth ? 1 : 0) - (a.bridge_teeth ? 1 : 0));
  // prices were already authorised on the request, so bypass override check by granting it for this call
  const r2 = { ...req, perms: new Set([...req.perms, 'price_override']) };
  return createFiche(r2, { doctor_id: cur.doctor_id, date: date || today(), lieu, patient_name: cur.patient_name, request_id: cur.id, lines, status });
}

// On delivery, the request becomes a validated fiche, ready to be invoiced (dated on the delivery day,
// so it is billed with that month). An existing draft fiche of the request is validated instead.
// Never blocks the delivery: a problem is returned as a message.
async function billOnDelivery(req, id) {
  const cur = await loadRequest(id);
  if (cur.status !== 'livree' || !cur.works.length) return null;
  try {
    if (cur.fiches.length) {
      const drafts = await col('fiches').find({ request_id: cur.id, status: 'brouillon', invoice_id: null, 'lines.0': { $exists: true } }).toArray();
      for (const f of drafts) {
        await col('fiches').updateOne({ _id: f._id, status: 'brouillon', invoice_id: null }, { $set: { status: 'validee', updated_at: nowStamp() } });
        audit(req, 'fiche validée à la livraison', 'fiche', f._id);
      }
      return drafts.length ? { numero: drafts.map((f) => f.numero).join(', '), action: 'validee' } : null;
    }
    const f = await ficheFromRequest(req, cur, { date: dateOnly(cur.delivery_actual || today()), status: 'validee' });
    await col('requests').updateOne({ _id: cur.id }, { $push: { history: historyEntry(req, cur.status, cur.status, `Fiche ${f.numero} créée et validée à la livraison`) } });
    return { id: f.id, numero: f.numero, action: 'creee' };
  } catch (e) {
    return { error: `Livraison enregistrée, mais la fiche n'a pas pu être créée : ${e.message}` };
  }
}

router.get('/requests/:id', requirePerm('requests_view'), async (req, res) => res.json(await loadRequest(req.params.id)));

router.post('/requests', requirePerm('requests_edit'), async (req, res) => {
  const b = req.body;
  const { doctor, v } = await validateRequest(b);
  if (doctor.archived) throw bad('Ce médecin est archivé.');
  const works = await buildWorks(b.works || [], doctor, req);
  const status = b.status || 'en_cours';
  const year = v.created_date.slice(0, 4);
  const numero = `D-${year}-${pad(await nextSeq(`request-${year}`), 5)}`;
  const r = await insert('requests', {
    numero, patient_name: b.patient_name.trim(), doctor_id: doctor.id, created_date: v.created_date,
    try1_date: v.try1_date, try1_done: false, try2_date: v.try2_date, try2_done: false,
    delivery_planned: v.delivery_planned, delivery_actual: v.delivery_actual, observations: b.observations || null,
    status, works, total: worksTotal(works), history: [historyEntry(req, null, status, 'Création de la demande')],
    deleted_at: null, created_by: req.user.id, updated_at: null,
  });
  audit(req, 'création demande', 'request', r.id);
  const deliveryFiche = status === 'livree' ? await billOnDelivery(req, r.id) : null;
  onChange();
  res.status(201).json({ ...(await loadRequest(r.id)), delivery_fiche: deliveryFiche });
});

router.put('/requests/:id', requirePerm('requests_edit'), async (req, res) => {
  const cur = await loadRequest(req.params.id);
  if (cur.status === 'livree' && req.user.role !== 'admin') throw bad('Cette demande est livrée : seule un administrateur peut la modifier.');
  const b = { ...cur, ...req.body };
  const { doctor, v } = await validateRequest(b);
  const works = req.body.works ? await buildWorks(req.body.works, doctor, req, cur.works) : null;
  const set = {
    patient_name: b.patient_name.trim(), doctor_id: doctor.id, created_date: v.created_date,
    try1_date: v.try1_date, try2_date: v.try2_date, delivery_planned: v.delivery_planned, delivery_actual: v.delivery_actual,
    observations: b.observations || null, updated_at: nowStamp(),
    // a fitting whose date changes is no longer "done"
    try1_done: (cur.try1_date || null) === (v.try1_date || null) ? !!cur.try1_done : false,
    try2_done: (cur.try2_date || null) === (v.try2_date || null) ? !!cur.try2_done : false,
  };
  if (works) Object.assign(set, { works, total: worksTotal(works) });
  const update = { $set: set };
  if (req.body.status && req.body.status !== cur.status) mergeStatus(update, req, { ...cur, delivery_actual: v.delivery_actual }, req.body.status);
  await col('requests').updateOne({ _id: cur.id }, update);
  const changed = ['try1_date', 'try2_date', 'delivery_planned'].filter((k) => (cur[k] || null) !== (v[k] || null));
  audit(req, 'modification demande', 'request', cur.id, changed.length ? { dates_modifiees: changed } : null);
  const deliveryFiche = req.body.status === 'livree' && cur.status !== 'livree' ? await billOnDelivery(req, cur.id) : null;
  onChange();
  res.json({ ...(await loadRequest(cur.id)), delivery_fiche: deliveryFiche });
});

// Adds a status change (and its history entry) to an update document
function mergeStatus(update, req, cur, status, note) {
  if (!STATUSES.includes(status)) throw bad('Statut invalide.');
  update.$set = update.$set || {};
  if (status === 'livree' && !cur.delivery_actual) update.$set.delivery_actual = today();
  if (cur.status === 'livree' && status !== 'livree') update.$set.delivery_actual = null;
  update.$set.status = status;
  update.$set.updated_at = nowStamp();
  update.$push = { history: { $each: [...(update.$push?.history?.$each || []), historyEntry(req, cur.status, status, note)] } };
  return update;
}

router.post('/requests/:id/status', requirePerm('status_update'), async (req, res) => {
  const cur = await loadRequest(req.params.id);
  const { status, note, delivery_actual } = req.body;
  if (status === cur.status) return res.json(cur);
  if (cur.status === 'livree' && req.user.role !== 'admin') throw bad('Seul un administrateur peut modifier le statut d\'une demande livrée.');
  const update = { $set: {} };
  if (status === 'livree' && delivery_actual) update.$set.delivery_actual = validDate(delivery_actual, 'La date de livraison effective');
  mergeStatus(update, req, { ...cur, delivery_actual: delivery_actual || cur.delivery_actual }, status, note);
  // status in the filter: if someone changed it in the meantime, nothing is overwritten
  const r = await col('requests').updateOne({ _id: cur.id, status: cur.status }, update);
  if (!r.matchedCount) throw bad('Le statut de cette demande vient d\'être modifié par quelqu\'un d\'autre : rechargez la page.');
  audit(req, 'changement statut', 'request', cur.id, { de: cur.status, vers: status });
  const deliveryFiche = status === 'livree' ? await billOnDelivery(req, cur.id) : null;
  onChange();
  res.json({ ...(await loadRequest(cur.id)), delivery_fiche: deliveryFiche });
});

// Mark a fitting (essayage) as done / not done
router.post('/requests/:id/try', requirePerm('status_update'), async (req, res) => {
  const cur = await loadRequest(req.params.id);
  const which = Number(req.body.which);
  if (![1, 2].includes(which)) throw bad('Essayage invalide.');
  if (!cur[`try${which}_date`]) throw bad("Aucune date n'est renseignée pour cet essayage.");
  const done = req.body.done !== false;
  const update = {
    $set: { [`try${which}_done`]: done, updated_at: nowStamp() },
    $push: { history: { $each: [historyEntry(req, cur.status, cur.status, `${which === 1 ? 'Premier' : 'Deuxième'} essayage ${done ? 'effectué' : 'marqué non effectué'}`)] } },
  };
  // After a fitting, work goes back to production unless told otherwise
  if (done && cur.status === 'attente_essayage' && req.body.next_status !== false) mergeStatus(update, req, cur, req.body.next_status || 'en_cours', 'Retour en production après essayage');
  await col('requests').updateOne({ _id: cur.id }, update);
  audit(req, `essayage ${which} ${done ? 'effectué' : 'annulé'}`, 'request', cur.id);
  onChange();
  res.json(await loadRequest(cur.id));
});

router.delete('/requests/:id', requirePerm('delete_archive'), async (req, res) => {
  const cur = await loadRequest(req.params.id);
  await col('requests').updateOne({ _id: cur.id }, { $set: { deleted_at: nowStamp() } });
  audit(req, 'suppression demande', 'request', cur.id, { numero: cur.numero, patient: cur.patient_name });
  onChange();
  res.json({ ok: true });
});

// Turn a request's works into a work sheet (fiche) in the doctor's carnet
router.post('/requests/:id/fiche', requirePerm('fiches_manage'), async (req, res) => {
  const cur = await loadRequest(req.params.id);
  if (!cur.works.length) throw bad("Cette demande n'a aucun travail à reporter sur une fiche.");
  if (cur.fiches.length && !req.body.force) throw bad(`Une fiche existe déjà pour cette demande (${cur.fiches.map((f) => f.numero).join(', ')}).`);
  const fiche = await ficheFromRequest(req, cur, { date: req.body.date, lieu: req.body.lieu });
  res.status(201).json(fiche);
});

module.exports = { router, derive, setOnChange, trackingSettings, PERMANENT, TEMPORARY, ACTIVE };