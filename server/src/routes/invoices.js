const express = require('express');
const { col, insert, out, toId, nextSeq, getSetting, nowStamp, rx } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, audit, roundMoney, pad, today, currentPeriod } = require('../util');
const { invoicePdf } = require('../services/pdf');

const router = express.Router();

const labInfo = async () => ({ name: 'Laboratoire dentaire', address: '', phone: '', email: '', tax_id: '', currency: 'TND', decimals: 3, footer: '', ...((await getSetting('lab')) || {}) });

function periodBounds(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw bad('Période invalide (format AAAA-MM).');
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${pad(last)}` };
}

function billableFiches(doctorId, period) {
  const { from, to } = periodBounds(period);
  return col('fiches').find({ doctor_id: doctorId, status: 'validee', invoice_id: null, date: { $gte: from, $lte: to } }).sort({ date: 1, _id: 1 }).toArray();
}

// fiches are raw Mongo documents (lines embedded)
function linesFromFiches(fiches, grouping) {
  const all = [];
  for (const f of fiches) {
    for (const l of [...(f.lines || [])].sort((a, b) => a.position - b.position)) {
      all.push({ fiche_id: f._id, fiche_numero: f.numero, fiche_date: f.date, patient_name: f.patient_name, designation_label: l.designation_label, quantity: l.quantity, unit_price: l.unit_price, total: l.total });
    }
  }
  if (grouping !== 'designation') return all;
  const map = new Map();
  for (const l of all) {
    const k = `${l.designation_label}|${l.unit_price}`;
    const g = map.get(k) || { fiche_id: null, fiche_numero: null, fiche_date: null, patient_name: null, designation_label: l.designation_label, quantity: 0, unit_price: l.unit_price, total: 0, _f: new Set() };
    g.quantity += l.quantity; g.total = roundMoney(g.total + l.total); g._f.add(l.fiche_numero); map.set(k, g);
  }
  return [...map.values()].map(({ _f, ...g }) => ({ ...g, fiche_numero: [..._f].join(', ') }));
}

// Normalised lines + total, ready to be stored in the invoice document
function linesDoc(lines) {
  const clean = lines.map((l, i) => ({
    id: i + 1, position: i, fiche_id: l.fiche_id ?? null, fiche_numero: l.fiche_numero ?? null, fiche_date: l.fiche_date ?? null, patient_name: l.patient_name ?? null,
    designation_label: l.designation_label, quantity: Number(l.quantity), unit_price: roundMoney(l.unit_price), total: roundMoney(Number(l.quantity) * Number(l.unit_price)),
  }));
  return { lines: clean, total: roundMoney(clean.reduce((s, l) => s + l.total, 0)), updated_at: nowStamp() };
}

// Reserve fiches for an invoice. A fiche already taken by another invoice is never overwritten
// (invoice_id: null in the filter): this is what makes double billing impossible.
async function reserveFiches(invoiceId, fiches) {
  const taken = [];
  for (const f of fiches) {
    const r = await col('fiches').updateOne({ _id: f._id, invoice_id: null, status: 'validee' }, { $set: { invoice_id: invoiceId } });
    if (r.modifiedCount) taken.push(f);
  }
  return taken;
}

async function loadInvoice(id) {
  const i = out(await col('invoices').findOne({ _id: toId(id) }));
  if (!i) throw notFound('Facture introuvable.');
  const [doctor, validator, original, rectifier] = await Promise.all([
    col('doctors').findOne({ _id: i.doctor_id }),
    i.validated_by ? col('users').findOne({ _id: i.validated_by }, { projection: { name: 1 } }) : null,
    i.corrects_invoice_id ? col('invoices').findOne({ _id: i.corrects_invoice_id }, { projection: { numero: 1 } }) : null,
    col('invoices').findOne({ corrects_invoice_id: i.id, status: 'validee' }, { projection: { numero: 1 } }),
  ]);
  const fichesOf = i.corrects_invoice_id && i.status !== 'validee' ? i.corrects_invoice_id : i.id;
  const fiches = await col('fiches').find({ invoice_id: fichesOf }, { projection: { numero: 1, date: 1, patient_name: 1, total: 1 } }).sort({ date: 1 }).toArray();
  return {
    ...i,
    lab_info: typeof i.lab_info === 'string' ? JSON.parse(i.lab_info) : (i.lab_info || {}),
    doctor_info: typeof i.doctor_info === 'string' ? JSON.parse(i.doctor_info) : (i.doctor_info || {}),
    numero: i.numero || null,
    lines: [...(i.lines || [])].sort((a, b) => a.position - b.position),
    doctor_name: `${doctor?.last_name || ''} ${doctor?.first_name || ''}`.trim(),
    validated_by_name: validator?.name || null,
    corrects_numero: original?.numero || null,
    rectified_by_numero: rectifier?.numero || null,
    fiches: fiches.map(out),
  };
}

const doctorSnapshot = (d) => ({ name: `Dr ${d.last_name} ${d.first_name}`, address: d.address || '', city: d.city || '', phone: d.phone || '', email: d.email || '', tariff: d.tariff });

router.get('/invoices', requirePerm('invoices_manage', 'invoices_validate'), async (req, res) => {
  const { doctor_id, period, status, q, from, to } = req.query;
  const filter = {};
  if (doctor_id) filter.doctor_id = toId(doctor_id);
  if (period) filter.period = period;
  if (from || to) filter.period = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (status) filter.status = status;
  if (q) {
    const docIds = (await col('doctors').find({ name_key: rx(q.toLowerCase()) }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    filter.$or = [{ numero: rx(q) }, { doctor_id: { $in: docIds } }];
  }
  const list = await col('invoices').find(filter).sort({ period: -1, _id: -1 }).limit(500).toArray();
  const docs = new Map((await col('doctors').find({ _id: { $in: [...new Set(list.map((i) => i.doctor_id))] } }).toArray()).map((d) => [d._id, d]));
  res.json(list.map((i) => ({
    id: i._id, numero: i.numero || null, period: i.period, status: i.status, total: i.total, validated_at: i.validated_at || null, created_at: i.created_at,
    corrects_invoice_id: i.corrects_invoice_id || null, doctor_id: i.doctor_id,
    doctor_name: `${docs.get(i.doctor_id)?.last_name || ''} ${docs.get(i.doctor_id)?.first_name || ''}`.trim(),
    fiches_count: new Set((i.lines || []).map((l) => l.fiche_id).filter(Boolean)).size,
  })));
});

// What would be billed for a doctor/month
router.get('/invoices/preview', requirePerm('invoices_manage'), async (req, res) => {
  const period = req.query.period || currentPeriod();
  const { from, to } = periodBounds(period);
  const doctors = req.query.doctor_id
    ? (await col('doctors').find({ _id: toId(req.query.doctor_id) }).toArray())
    : await col('doctors').find().sort({ last_name: 1 }).collation({ locale: 'fr' }).toArray();
  const rows = await Promise.all(doctors.map(async (d) => {
    const [fiches, drafts, invoices] = await Promise.all([
      billableFiches(d._id, period),
      col('fiches').countDocuments({ doctor_id: d._id, status: 'brouillon', date: { $gte: from, $lte: to } }),
      col('invoices').find({ doctor_id: d._id, period }, { projection: { numero: 1, status: 1, total: 1 } }).toArray(),
    ]);
    return {
      doctor_id: d._id, doctor_name: `${d.last_name} ${d.first_name}`, archived: !!d.archived,
      billable: fiches.map((f) => ({ id: f._id, numero: f.numero, date: f.date, patient_name: f.patient_name, total: f.total })),
      billable_total: roundMoney(fiches.reduce((s, f) => s + f.total, 0)),
      draft_fiches: drafts,
      invoices: invoices.map((i) => ({ ...out(i), numero: i.numero || null })),
    };
  }));
  res.json(rows.filter((x) => req.query.doctor_id || x.billable.length || x.invoices.length || x.draft_fiches));
});

router.post('/invoices', requirePerm('invoices_manage'), async (req, res) => {
  const { doctor_id, period = currentPeriod(), grouping = 'fiche', fiche_ids } = req.body;
  const doctor = await col('doctors').findOne({ _id: toId(doctor_id) });
  if (!doctor) throw bad('Sélectionnez un médecin.');
  let fiches = await billableFiches(doctor._id, period);
  if (Array.isArray(fiche_ids)) fiches = fiches.filter((f) => fiche_ids.map(Number).includes(f._id));
  if (!fiches.length) throw bad('Aucune fiche validée et non facturée pour ce médecin sur cette période.');
  const inv = await insert('invoices', {
    doctor_id: doctor._id, period, status: 'brouillon', grouping: grouping === 'designation' ? 'designation' : 'fiche',
    lab_info: await labInfo(), doctor_info: doctorSnapshot(doctor), notes: null, lines: [], total: 0,
    corrects_invoice_id: null, correction_reason: null, issue_date: today(), validated_at: null, validated_by: null, created_by: req.user.id, updated_at: null,
  });
  const taken = await reserveFiches(inv.id, fiches);
  if (!taken.length) {
    await col('invoices').deleteOne({ _id: inv.id });
    throw bad('Ces fiches viennent d\'être facturées par ailleurs.');
  }
  await col('invoices').updateOne({ _id: inv.id }, { $set: linesDoc(linesFromFiches(taken, inv.grouping)) });
  audit(req, 'création facture (brouillon)', 'invoice', inv.id, { medecin: doctor._id, periode: period, fiches: taken.length });
  res.status(201).json(await loadInvoice(inv.id));
});

router.get('/invoices/:id', requirePerm('invoices_manage', 'invoices_validate'), async (req, res) => res.json(await loadInvoice(req.params.id)));

function draftOnly(inv) {
  if (inv.status !== 'brouillon') throw bad('Cette facture est validée : elle ne peut plus être modifiée directement. Utilisez « Rectifier ».');
}
const stillDraft = (r) => { if (!r.matchedCount) throw bad('Cette facture vient d\'être validée : elle ne peut plus être modifiée directement.'); };

router.put('/invoices/:id', requirePerm('invoices_manage'), async (req, res) => {
  const inv = await loadInvoice(req.params.id); draftOnly(inv);
  const b = req.body;
  if (b.lines) {
    if (!Array.isArray(b.lines) || !b.lines.length) throw bad('La facture doit contenir au moins une ligne.');
    const canPrice = req.perms.has('price_override');
    b.lines.forEach((l, i) => {
      if (!String(l.designation_label || '').trim()) throw bad(`Ligne ${i + 1} : désignation obligatoire.`);
      if (!(Number(l.quantity) > 0)) throw bad(`Ligne ${i + 1} : quantité invalide.`);
      if (isNaN(Number(l.unit_price)) || Number(l.unit_price) < 0) throw bad(`Ligne ${i + 1} : prix invalide.`);
      const prev = inv.lines.find((x) => x.id === l.id);
      if (!canPrice && (!prev || roundMoney(prev.unit_price) !== roundMoney(l.unit_price))) throw bad("Vous n'avez pas le droit de modifier les prix.");
    });
  }
  const set = { notes: b.notes ?? inv.notes, issue_date: b.issue_date || inv.issue_date, doctor_info: b.doctor_info || inv.doctor_info, lab_info: b.lab_info || inv.lab_info, updated_at: nowStamp() };
  if (b.lines) Object.assign(set, linesDoc(b.lines));
  stillDraft(await col('invoices').updateOne({ _id: inv.id, status: 'brouillon', validating: { $ne: true } }, { $set: set }));
  audit(req, 'modification facture (brouillon)', 'invoice', inv.id);
  res.json(await loadInvoice(inv.id));
});

// Rebuild lines from the fiches (also picks up fiches validated since the draft was created)
router.post('/invoices/:id/rebuild', requirePerm('invoices_manage'), async (req, res) => {
  const inv = await loadInvoice(req.params.id); draftOnly(inv);
  const grouping = req.body.grouping === 'designation' ? 'designation' : req.body.grouping === 'fiche' ? 'fiche' : inv.grouping;
  if (!inv.corrects_invoice_id) await reserveFiches(inv.id, await billableFiches(inv.doctor_id, inv.period));
  const src = inv.corrects_invoice_id || inv.id;
  const fiches = await col('fiches').find({ invoice_id: src }).sort({ date: 1, _id: 1 }).toArray();
  stillDraft(await col('invoices').updateOne({ _id: inv.id, status: 'brouillon' }, { $set: { grouping, ...linesDoc(linesFromFiches(fiches, grouping)) } }));
  audit(req, 'recalcul facture depuis les fiches', 'invoice', inv.id, { grouping });
  res.json(await loadInvoice(inv.id));
});

router.post('/invoices/:id/validate', requirePerm('invoices_validate'), async (req, res) => {
  const inv = await loadInvoice(req.params.id); draftOnly(inv);
  if (!inv.lines.length) throw bad('Une facture vide ne peut pas être validée.');
  // 1. lock the draft (only one validation can win), 2. only then take the next number:
  // invoice numbers stay continuous, without gaps, even if several people click at the same time
  const lock = await col('invoices').updateOne({ _id: inv.id, status: 'brouillon', validating: { $ne: true } }, { $set: { validating: true } });
  if (!lock.matchedCount) throw bad('Cette facture est déjà en cours de validation ou validée.');
  const year = (inv.issue_date || today()).slice(0, 4);
  const numero = `FAC-${year}-${pad(await nextSeq(`invoice-${year}`), 4)}`;
  await col('invoices').updateOne({ _id: inv.id }, { $set: { status: 'validee', numero, validated_at: nowStamp(), validated_by: req.user.id }, $unset: { validating: '' } });
  if (inv.corrects_invoice_id) {
    await col('invoices').updateOne({ _id: inv.corrects_invoice_id }, { $set: { status: 'rectifiee' } });
    await col('fiches').updateMany({ invoice_id: inv.corrects_invoice_id }, { $set: { invoice_id: inv.id } });
  }
  audit(req, 'validation facture', 'invoice', inv.id, { total: inv.total, rectifie: inv.corrects_numero || undefined });
  res.json(await loadInvoice(inv.id));
});

router.post('/invoices/:id/rectify', requirePerm('invoices_validate'), async (req, res) => {
  const inv = await loadInvoice(req.params.id);
  if (inv.status !== 'validee') throw bad('Seule une facture validée peut être rectifiée.');
  const reason = (req.body.reason || '').trim();
  if (reason.length < 5) throw bad('Indiquez le motif de la rectification.');
  const pending = await col('invoices').findOne({ corrects_invoice_id: inv.id, status: 'brouillon' });
  if (pending) return res.json(await loadInvoice(pending._id));
  const r = await insert('invoices', {
    doctor_id: inv.doctor_id, period: inv.period, status: 'brouillon', grouping: inv.grouping, lab_info: inv.lab_info, doctor_info: inv.doctor_info,
    notes: inv.notes, ...linesDoc(inv.lines), corrects_invoice_id: inv.id, correction_reason: reason, issue_date: today(),
    validated_at: null, validated_by: null, created_by: req.user.id,
  });
  audit(req, 'rectification facture ouverte', 'invoice', inv.id, { motif: reason, brouillon: r.id });
  res.status(201).json(await loadInvoice(r.id));
});

router.delete('/invoices/:id', requirePerm('invoices_manage'), async (req, res) => {
  const inv = await loadInvoice(req.params.id); draftOnly(inv);
  const r = await col('invoices').deleteOne({ _id: inv.id, status: 'brouillon', validating: { $ne: true } });
  if (!r.deletedCount) throw bad('Cette facture vient d\'être validée : elle ne peut plus être supprimée.');
  if (!inv.corrects_invoice_id) await col('fiches').updateMany({ invoice_id: inv.id }, { $set: { invoice_id: null } });   // fiches available again
  audit(req, 'suppression brouillon de facture', 'invoice', inv.id);
  res.json({ ok: true });
});

router.get('/invoices/:id/pdf', requirePerm('invoices_manage', 'invoices_validate'), async (req, res) => {
  const inv = await loadInvoice(req.params.id);
  const name = (inv.numero || `brouillon-${inv.id}`).replace(/[^\w-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="facture-${name}.pdf"`);
  invoicePdf(inv, res);
});

// A validation interrupted by a server stop leaves the lock: release it at startup
async function releaseStaleLocks() {
  await col('invoices').updateMany({ status: 'brouillon', validating: true }, { $unset: { validating: '' } });
}

module.exports = { router, labInfo, releaseStaleLocks };
