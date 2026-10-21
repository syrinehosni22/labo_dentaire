const express = require('express');
const { col, insert, out, toId, nextSeq, rx } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, conflict, audit, normalizeName, pad } = require('../util');

const router = express.Router();

// One carnet per doctor: guaranteed by the unique index on carnets.doctor_id
async function createCarnet(doctorId) {
  const existing = await col('carnets').findOne({ doctor_id: doctorId });
  if (existing) return out(existing);
  const numero = `C-${pad(await nextSeq('carnet'), 4)}`;
  try {
    return await insert('carnets', { numero, doctor_id: doctorId, archived: false });
  } catch (e) {
    if (e.code === 11000) return out(await col('carnets').findOne({ doctor_id: doctorId }));   // created concurrently
    throw e;
  }
}

function validate(b) {
  if (!b.last_name?.trim() || !b.first_name?.trim()) throw bad('Le nom et le prénom du médecin sont obligatoires.');
  if (!['A', 'B', 'C'].includes(b.tariff)) throw bad('Le tarif doit être A, B ou C.');
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw bad('Adresse e-mail invalide.');
}

const doctorFields = (b, key) => ({
  last_name: b.last_name.trim(), first_name: b.first_name.trim(), name_key: key,
  phone: b.phone || null, email: b.email || null, address: b.address || null, city: b.city || null, notes: b.notes || null, tariff: b.tariff,
});

router.get('/doctors', async (req, res) => {
  const { q, archived } = req.query;
  const filter = {};
  if (archived !== 'all') filter.archived = archived === '1';
  if (q) {
    const key = normalizeName(q, '').trim();
    filter.$or = [{ name_key: rx(key) }, { phone: rx(q) }, { city: rx(q) }, { email: rx(q) }];
  }
  const doctors = await col('doctors').find(filter).sort({ last_name: 1, first_name: 1 }).collation({ locale: 'fr' }).toArray();
  const ids = doctors.map((d) => d._id);
  const [carnets, reqCounts, ficheCounts] = await Promise.all([
    col('carnets').find({ doctor_id: { $in: ids } }).toArray(),
    col('requests').aggregate([{ $match: { doctor_id: { $in: ids }, deleted_at: null } }, { $group: { _id: '$doctor_id', n: { $sum: 1 } } }]).toArray(),
    col('fiches').aggregate([{ $match: { doctor_id: { $in: ids } } }, { $group: { _id: '$doctor_id', n: { $sum: 1 } } }]).toArray(),
  ]);
  const cBy = new Map(carnets.map((c) => [c.doctor_id, c]));
  const rBy = new Map(reqCounts.map((r) => [r._id, r.n]));
  const fBy = new Map(ficheCounts.map((r) => [r._id, r.n]));
  res.json(doctors.map((d) => ({
    ...out(d), carnet_id: cBy.get(d._id)?._id ?? null, carnet_numero: cBy.get(d._id)?.numero ?? null,
    requests_count: rBy.get(d._id) || 0, fiches_count: fBy.get(d._id) || 0,
  })));
});

// Possible duplicates while typing
router.get('/doctors/check-duplicate', async (req, res) => {
  const { last_name = '', first_name = '', exclude } = req.query;
  const key = normalizeName(last_name, first_name);
  const ex = toId(exclude);
  const notSelf = ex ? { _id: { $ne: ex } } : {};
  const exact = await col('doctors').findOne({ name_key: key, ...notSelf }, { projection: { last_name: 1, first_name: 1, archived: 1 } });
  const similar = last_name.length >= 2
    ? await col('doctors').find({ name_key: new RegExp(`^${normalizeName(last_name, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ...notSelf },
      { projection: { last_name: 1, first_name: 1, city: 1, archived: 1 } }).limit(5).toArray()
    : [];
  res.json({ exact: exact ? out(exact) : null, similar: similar.map(out) });
});

router.get('/doctors/:id', async (req, res) => {
  const id = toId(req.params.id);
  const d = out(await col('doctors').findOne({ _id: id }));
  if (!d) throw notFound('Médecin introuvable.');
  const [carnet, requests, fiches, invoices] = await Promise.all([
    col('carnets').findOne({ doctor_id: id }),
    col('requests').find({ doctor_id: id, deleted_at: null }, { projection: { numero: 1, patient_name: 1, created_date: 1, status: 1, delivery_planned: 1, delivery_actual: 1, total: 1 } })
      .sort({ created_date: -1, _id: -1 }).toArray(),
    col('fiches').find({ doctor_id: id }, { projection: { lines: 0 } }).sort({ date: -1, _id: -1 }).toArray(),
    col('invoices').find({ doctor_id: id }, { projection: { numero: 1, period: 1, status: 1, total: 1, validated_at: 1 } }).sort({ period: -1, _id: -1 }).toArray(),
  ]);
  const invNum = new Map(invoices.map((i) => [i._id, i.numero]));
  d.carnet = out(carnet);
  d.requests = requests.map(out);
  d.fiches = fiches.map((f) => ({ ...out(f), invoice_numero: f.invoice_id ? invNum.get(f.invoice_id) || null : null }));
  d.invoices = invoices.map(out);
  d.total_invoiced = invoices.filter((i) => i.status === 'validee').reduce((s, i) => s + (i.total || 0), 0);
  res.json(d);
});

router.post('/doctors', requirePerm('doctors_manage'), async (req, res) => {
  const b = req.body; validate(b);
  const key = normalizeName(b.last_name, b.first_name);
  const dup = await col('doctors').findOne({ name_key: key });
  if (dup) throw conflict(dup.archived ? 'Ce médecin existe déjà dans les archives. Réactivez sa fiche plutôt que d\'en créer une nouvelle.' : 'Un médecin portant ce nom existe déjà.');
  let doctor;
  try {
    doctor = await insert('doctors', { ...doctorFields(b, key), archived: false });
  } catch (e) {
    if (e.code === 11000) throw conflict('Un médecin portant ce nom existe déjà.');
    throw e;
  }
  try {
    await createCarnet(doctor.id);
  } catch (e) {
    await col('doctors').deleteOne({ _id: doctor.id });   // never leave a doctor without its carnet
    throw e;
  }
  audit(req, 'création médecin', 'doctor', doctor.id, { nom: `${b.last_name} ${b.first_name}`, tarif: b.tariff });
  res.status(201).json(doctor);
});

router.put('/doctors/:id', requirePerm('doctors_manage'), async (req, res) => {
  const d = out(await col('doctors').findOne({ _id: toId(req.params.id) }));
  if (!d) throw notFound('Médecin introuvable.');
  const b = { ...d, ...req.body }; validate(b);
  const key = normalizeName(b.last_name, b.first_name);
  if (await col('doctors').findOne({ name_key: key, _id: { $ne: d.id } })) throw conflict('Un autre médecin porte déjà ce nom.');
  await col('doctors').updateOne({ _id: d.id }, { $set: doctorFields(b, key) });
  audit(req, 'modification médecin', 'doctor', d.id, d.tariff !== b.tariff ? { tarif: `${d.tariff} → ${b.tariff}` } : null);
  res.json(out(await col('doctors').findOne({ _id: d.id })));
});

// Archive / reactivate doctor and their carnet — history is kept
router.post('/doctors/:id/archive', requirePerm('delete_archive'), async (req, res) => {
  const d = await col('doctors').findOne({ _id: toId(req.params.id) });
  if (!d) throw notFound('Médecin introuvable.');
  const archived = req.body.archived !== false;
  await col('doctors').updateOne({ _id: d._id }, { $set: { archived } });
  await col('carnets').updateOne({ doctor_id: d._id }, { $set: { archived } });
  audit(req, archived ? 'archivage médecin' : 'réactivation médecin', 'doctor', d._id);
  res.json({ ok: true });
});

module.exports = { router, createCarnet };
