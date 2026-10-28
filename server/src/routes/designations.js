const express = require('express');
const { col, insert, out, toId } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, conflict, audit, roundMoney, keyOf } = require('../util');

const router = express.Router();
// params: array of {key,label,type,options}; tolerate a JSON string (imported data)
const parse = (d) => ({ ...out(d), params: typeof d.params === 'string' ? JSON.parse(d.params) : (d.params || []), active: !!d.active, per_tooth: !!d.per_tooth });

router.get('/designations', async (req, res) => {
  const filter = req.query.all === '1' ? {} : { active: true };
  const rows = await col('designations').find(filter).sort({ category: 1, name: 1 }).collation({ locale: 'fr' }).toArray();
  res.json(rows.map(parse));
});

router.get('/designations/:id/history', async (req, res) => {
  const rows = await col('price_history').find({ designation_id: toId(req.params.id) }).sort({ _id: -1 }).toArray();
  const users = new Map((await col('users').find({ _id: { $in: [...new Set(rows.map((r) => r.user_id))] } }, { projection: { name: 1 } }).toArray()).map((u) => [u._id, u.name]));
  res.json(rows.map((h) => ({ ...out(h), user_name: users.get(h.user_id) || null })));
});

const isEmpty = (v) => v === '' || v == null;
const priceC = (v) => (isEmpty(v) ? null : roundMoney(v));

function validate(b) {
  if (!b.name?.trim()) throw bad('Le libellé de la désignation est obligatoire.');
  for (const k of ['price_a', 'price_b']) {
    if (b[k] === '' || b[k] == null || isNaN(Number(b[k])) || Number(b[k]) < 0) throw bad('Les prix doivent être des nombres positifs.');
  }
  // tarif C facultatif : vide = on applique le tarif A
  if (!isEmpty(b.price_c) && (isNaN(Number(b.price_c)) || Number(b.price_c) < 0)) throw bad('Les prix doivent être des nombres positifs.');
  if (b.params && !Array.isArray(b.params)) throw bad('Paramètres techniques invalides.');
  for (const p of b.params || []) {
    if (!p.label?.trim()) throw bad('Chaque paramètre technique doit avoir un libellé.');
    if (!['text', 'select', 'number'].includes(p.type)) throw bad('Type de paramètre invalide.');
  }
}
const cleanParams = (params = []) => params.map((p) => ({
  key: p.key || p.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  label: p.label.trim(), type: p.type,
  ...(p.type === 'select' ? { options: (Array.isArray(p.options) ? p.options : String(p.options || '').split(',')).map((o) => o.trim()).filter(Boolean) } : {}),
}));

router.post('/designations', requirePerm('prices_edit'), async (req, res) => {
  const b = req.body; validate(b);
  if (await col('designations').findOne({ name_key: keyOf(b.name) })) throw conflict('Cette désignation existe déjà.');
  const d = await insert('designations', {
    name: b.name.trim(), name_key: keyOf(b.name), category: b.category || null,
    price_a: roundMoney(b.price_a), price_b: roundMoney(b.price_b), price_c: priceC(b.price_c),
    params: cleanParams(b.params), per_tooth: b.per_tooth !== false, active: true,
  });
  audit(req, 'création désignation', 'designation', d.id, { name: b.name, A: b.price_a, B: b.price_b, C: b.price_c });
  res.status(201).json(parse({ _id: d.id, ...d }));
});

router.put('/designations/:id', requirePerm('prices_edit'), async (req, res) => {
  const raw = await col('designations').findOne({ _id: toId(req.params.id) });
  if (!raw) throw notFound();
  const d = parse(raw);
  const b = { ...d, ...req.body }; validate(b);
  if (await col('designations').findOne({ name_key: keyOf(b.name), _id: { $ne: d.id } })) throw conflict('Cette désignation existe déjà.');
  // price history: one entry per list whose price changes
  for (const [field, list] of [['price_a', 'A'], ['price_b', 'B'], ['price_c', 'C']]) {
    const next = field === 'price_c' ? priceC(b[field]) : roundMoney(b[field]);
    const prev = d[field] ?? null;
    if (next !== prev) await insert('price_history', { designation_id: d.id, list, old_price: prev, new_price: next, user_id: req.user.id });
  }
  await col('designations').updateOne({ _id: d.id }, { $set: {
    name: b.name.trim(), name_key: keyOf(b.name), category: b.category || null,
    price_a: roundMoney(b.price_a), price_b: roundMoney(b.price_b), price_c: priceC(b.price_c),
    params: cleanParams(b.params), per_tooth: !!b.per_tooth, active: !!b.active,
  } });
  audit(req, 'modification désignation', 'designation', d.id, { name: b.name, A: b.price_a, B: b.price_b, C: b.price_c, active: b.active });
  res.json(parse(await col('designations').findOne({ _id: d.id })));
});

module.exports = router;