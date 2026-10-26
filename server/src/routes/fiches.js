const express = require('express');
const { col, insert, out, toId, nextSeq, rx, nowStamp } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, audit, roundMoney, pad, today, validDate } = require('../util');
const { refreshDraftInvoice } = require('./invoices');

const router = express.Router();

const priceCol = (tariff) => ({ A: 'price_a', B: 'price_b', C: 'price_c' }[tariff] || 'price_a');

// Builds clean lines with frozen prices; enforces price_override permission.
// Lines are embedded in the fiche; their id is their position (1, 2, 3…).
async function buildLines(lines, doctor, req, existing = []) {
  if (!Array.isArray(lines)) throw bad('Lignes de travaux invalides.');
  const canOverride = req.perms.has('price_override');
  const ids = [...new Set(lines.map((l) => toId(l.designation_id)).filter(Boolean))];
  const desById = new Map((await col('designations').find({ _id: { $in: ids } }).toArray()).map((d) => [d._id, d]));
  return lines.map((l, i) => {
    const qty = Number(l.quantity);
    if (!(qty > 0)) throw bad(`Ligne ${i + 1} : la quantité doit être supérieure à 0.`);
    let des = null;
    if (l.designation_id) {
      des = desById.get(toId(l.designation_id));
      if (!des) throw bad(`Ligne ${i + 1} : désignation introuvable.`);
    }
    const label = des ? des.name : (l.designation_label || '').trim();
    if (!label) throw bad(`Ligne ${i + 1} : choisissez une désignation.`);
    const listPrice = des ? des[priceCol(doctor.tariff)] : null;
    const unit = l.unit_price === '' || l.unit_price == null ? listPrice : Number(l.unit_price);
    if (unit == null || isNaN(unit) || unit < 0) throw bad(`Ligne ${i + 1} : prix unitaire invalide.`);
    const prev = existing.find((e) => e.id === l.id);
    const allowed = [listPrice];
    if (prev && prev.designation_id === (des?._id ?? null)) allowed.push(prev.unit_price);
    if (!canOverride && listPrice != null && !allowed.some((a) => roundMoney(a) === roundMoney(unit))) throw bad("Vous n'avez pas le droit de modifier les prix appliqués.");
    return { id: i + 1, position: i, designation_id: des?._id ?? null, designation_label: label, quantity: qty, list_price: listPrice, unit_price: roundMoney(unit), total: roundMoney(qty * unit) };
  });
}

const totals = (lines) => { const s = roundMoney(lines.reduce((a, l) => a + l.total, 0)); return { subtotal: s, total: s }; };

async function loadFiche(id) {
  const f = out(await col('fiches').findOne({ _id: toId(id) }));
  if (!f) throw notFound('Fiche introuvable.');
  const [doctor, carnet, invoice, request] = await Promise.all([
    col('doctors').findOne({ _id: f.doctor_id }),
    col('carnets').findOne({ _id: f.carnet_id }),
    f.invoice_id ? col('invoices').findOne({ _id: f.invoice_id }, { projection: { numero: 1, status: 1 } }) : null,
    f.request_id ? col('requests').findOne({ _id: f.request_id }, { projection: { numero: 1 } }) : null,
  ]);
  return {
    ...f, lines: (f.lines || []).sort((a, b) => a.position - b.position),
    last_name: doctor?.last_name, first_name: doctor?.first_name, tariff: doctor?.tariff,
    carnet_numero: carnet?.numero, invoice_numero: invoice?.numero || null, invoice_status: invoice?.status || null, request_numero: request?.numero || null,
  };
}

async function createFiche(req, { doctor_id, lieu, date, patient_name, lines, request_id, status }) {
  const doctor = await col('doctors').findOne({ _id: toId(doctor_id) });
  if (!doctor) throw bad('Sélectionnez un médecin existant.');
  if (doctor.archived) throw bad('Ce médecin est archivé : réactivez-le avant de créer une fiche.');
  const carnet = await col('carnets').findOne({ doctor_id: doctor._id });
  if (!carnet) throw bad("Le carnet de ce médecin n'existe pas.");
  if (carnet.archived) throw bad('Le carnet de ce médecin est archivé.');
  const d = validDate(date || today(), 'La date de la fiche', true).slice(0, 10);
  const built = await buildLines(lines || [], doctor, req);
  if (status === 'validee' && built.length === 0) throw bad('Ajoutez au moins une ligne de travaux avant de valider la fiche.');
  const year = d.slice(0, 4);
  const numero = `F-${year}-${pad(await nextSeq(`fiche-${year}`), 5)}`;
  const f = await insert('fiches', {
    numero, carnet_id: carnet._id, doctor_id: doctor._id, request_id: toId(request_id), lieu: lieu || null, date: d,
    patient_name: patient_name || null, status: status === 'validee' ? 'validee' : 'brouillon', lines: built, ...totals(built),
    invoice_id: null, created_by: req.user.id, updated_at: null,
  });
  audit(req, 'création fiche', 'fiche', f.id, { status });
  return loadFiche(f.id);
}

router.get('/carnets', async (req, res) => {
  const filter = req.query.archived === 'all' ? {} : { archived: false };
  const carnets = await col('carnets').find(filter).toArray();
  const ids = carnets.map((c) => c._id);
  const [doctors, stats] = await Promise.all([
    col('doctors').find({ _id: { $in: carnets.map((c) => c.doctor_id) } }).toArray(),
    col('fiches').aggregate([{ $match: { carnet_id: { $in: ids } } }, { $group: { _id: '$carnet_id', n: { $sum: 1 }, last: { $max: '$date' } } }]).toArray(),
  ]);
  const dBy = new Map(doctors.map((d) => [d._id, d]));
  const sBy = new Map(stats.map((s) => [s._id, s]));
  const list = carnets.map((c) => {
    const d = dBy.get(c.doctor_id) || {};
    return { ...out(c), last_name: d.last_name, first_name: d.first_name, tariff: d.tariff, fiches_count: sBy.get(c._id)?.n || 0, last_fiche: sBy.get(c._id)?.last || null };
  });
  list.sort((a, b) => String(a.last_name).localeCompare(String(b.last_name), 'fr', { sensitivity: 'base' }));
  res.json(list);
});

router.get('/carnets/:id', async (req, res) => {
  const c = out(await col('carnets').findOne({ _id: toId(req.params.id) }));
  if (!c) throw notFound('Carnet introuvable.');
  const d = await col('doctors').findOne({ _id: c.doctor_id });
  const { q, from, to } = req.query;
  const filter = { carnet_id: c.id };
  if (q) filter.$or = [{ numero: rx(q) }, { patient_name: rx(q) }, { lieu: rx(q) }, { 'lines.designation_label': rx(q) }];
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const fiches = await col('fiches').find(filter).sort({ date: -1, _id: -1 }).toArray();
  const invNum = new Map((await col('invoices').find({ _id: { $in: fiches.map((f) => f.invoice_id).filter(Boolean) } }, { projection: { numero: 1 } }).toArray()).map((i) => [i._id, i.numero]));
  res.json({
    ...c, last_name: d?.last_name, first_name: d?.first_name, tariff: d?.tariff, doctor_archived: !!d?.archived,
    fiches: fiches.map(({ lines, ...f }) => ({ ...out(f), lines_count: (lines || []).length, designations: [...new Set((lines || []).map((l) => l.designation_label).filter(Boolean))].join(', '), invoice_numero: f.invoice_id ? invNum.get(f.invoice_id) || null : null })),
  });
});

router.get('/fiches', async (req, res) => {
  const { q, doctor_id, from, to, status, invoiced } = req.query;
  const filter = {};
  if (doctor_id) filter.doctor_id = toId(doctor_id);
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (status) filter.status = status;
  if (invoiced === '0') filter.invoice_id = null;
  if (invoiced === '1') filter.invoice_id = { $ne: null };
  if (q) {
    const docIds = (await col('doctors').find({ name_key: rx(q.toLowerCase()) }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    filter.$or = [{ numero: rx(q) }, { patient_name: rx(q) }, { doctor_id: { $in: docIds } }];
  }
  const fiches = await col('fiches').find(filter, { projection: { lines: 0 } }).sort({ date: -1, _id: -1 }).limit(500).toArray();
  const [doctors, carnets, invoices] = await Promise.all([
    col('doctors').find({ _id: { $in: [...new Set(fiches.map((f) => f.doctor_id))] } }).toArray(),
    col('carnets').find({ _id: { $in: [...new Set(fiches.map((f) => f.carnet_id))] } }).toArray(),
    col('invoices').find({ _id: { $in: fiches.map((f) => f.invoice_id).filter(Boolean) } }, { projection: { numero: 1 } }).toArray(),
  ]);
  const dBy = new Map(doctors.map((d) => [d._id, d])); const cBy = new Map(carnets.map((c) => [c._id, c])); const iBy = new Map(invoices.map((i) => [i._id, i]));
  res.json(fiches.map((f) => ({ ...out(f), last_name: dBy.get(f.doctor_id)?.last_name, first_name: dBy.get(f.doctor_id)?.first_name, carnet_numero: cBy.get(f.carnet_id)?.numero, invoice_numero: iBy.get(f.invoice_id)?.numero || null })));
});

router.get('/fiches/:id', async (req, res) => res.json(await loadFiche(req.params.id)));

router.post('/fiches', requirePerm('fiches_manage'), async (req, res) => {
  res.status(201).json(await createFiche(req, req.body));
});

// A fiche on a validated invoice is frozen (the invoice must be rectified); on a draft invoice it can still change
function frozenByInvoice(f, action) {
  if (f.invoice_id && f.invoice_status !== 'brouillon') throw bad(`Cette fiche est facturée (${f.invoice_numero || 'facture validée'}) : elle ne peut plus être ${action}. Rectifiez d'abord la facture.`);
}

router.put('/fiches/:id', requirePerm('fiches_manage'), requirePerm('fiches_edit'), async (req, res) => {
  const f = await loadFiche(req.params.id);
  frozenByInvoice(f, 'modifiée');
  const b = req.body;
  const doctor = await col('doctors').findOne({ _id: f.doctor_id });
  const lines = b.lines ? await buildLines(b.lines, doctor, req, f.lines) : null;
  const status = b.status || f.status;
  if (!['brouillon', 'validee'].includes(status)) throw bad('État de fiche invalide.');
  if (status === 'validee' && (lines ? lines.length : f.lines.length) === 0) throw bad('Ajoutez au moins une ligne de travaux avant de valider la fiche.');
  if (f.invoice_id && status !== 'validee') throw bad('Cette fiche est dans un brouillon de facture : elle doit rester validée. Supprimez-la de la facture (ou supprimez le brouillon) pour la repasser en brouillon.');
  const d = b.date ? validDate(b.date, 'La date de la fiche', true).slice(0, 10) : f.date;
  const set = { lieu: b.lieu ?? f.lieu, date: d, patient_name: b.patient_name ?? f.patient_name, status, updated_at: nowStamp() };
  if (lines) Object.assign(set, { lines }, totals(lines));
  // invoice_id in the filter = nothing is overwritten if the fiche was attached to another invoice meanwhile
  const r = await col('fiches').updateOne({ _id: f.id, invoice_id: f.invoice_id ?? null }, { $set: set });
  if (!r.matchedCount) throw bad('Cette fiche vient d\'être rattachée à une facture : rechargez la page.');
  await refreshDraftInvoice(f.invoice_id);
  audit(req, f.status !== status ? `fiche ${status === 'validee' ? 'validée' : 'repassée en brouillon'}` : 'modification fiche', 'fiche', f.id);
  res.json(await loadFiche(f.id));
});

router.delete('/fiches/:id', requirePerm('fiches_manage'), requirePerm('fiches_delete'), async (req, res) => {
  const f = await loadFiche(req.params.id);
  frozenByInvoice(f, 'supprimée');
  const r = await col('fiches').deleteOne({ _id: f.id, invoice_id: f.invoice_id ?? null });
  if (!r.deletedCount) throw bad('Cette fiche a changé entre-temps : rechargez la page.');
  await refreshDraftInvoice(f.invoice_id);
  audit(req, 'suppression fiche', 'fiche', f.id, { numero: f.numero, statut: f.status, facture_brouillon: f.invoice_id || undefined });
  res.json({ ok: true });
});

module.exports = { router, createFiche, buildLines, priceCol };