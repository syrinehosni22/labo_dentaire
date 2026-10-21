// Demo data: npm run seed  (only on an empty database unless --force)
require('./env');
const bcrypt = require('bcryptjs');
const { connect, close, col, insert, nextSeq, setSetting, safeUri, MONGODB_URI } = require('./db');
const { createCarnet } = require('./routes/doctors');
const { normalizeName, pad, roundMoney, keyOf } = require('./util');
const { defaultPrefs } = require('./auth');
const { ensureAdmin } = require('./index');
const { labInfo } = require('./routes/invoices');

const day = (offset, time) => {
  const x = new Date(); x.setDate(x.getDate() + offset);
  const s = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return time ? `${s}T${time}` : s;
};
const monthDay = (monthsBack, dd) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - monthsBack); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(Math.min(dd, 28))}`; };
const stamp = (dateStr, time = '10:00:00') => `${dateStr} ${time}`;

async function main() {
  await connect();
  if (await col('doctors').countDocuments() && !process.argv.includes('--force')) {
    console.log('La base contient déjà des données : rien à faire (utilisez --force pour ajouter quand même).');
    return;
  }
  await ensureAdmin();
  const admin = await col('users').findOne({ role: 'admin' });

  await setSetting('lab', { name: 'Laboratoire Dentaire Carthage', address: '12 rue de Marseille, 1000 Tunis', phone: '+216 71 000 000', email: 'contact@labo-carthage.tn', tax_id: '1234567/A/M/000', currency: 'TND', decimals: 3, footer: 'Paiement à 30 jours fin de mois. Merci de votre confiance.' });

  for (const [email, name, role, phone] of [['production@labo.local', 'Sami Trabelsi', 'production', '+216 20 000 001'], ['admin2@labo.local', 'Leila Ben Ali', 'administratif', '+216 20 000 002']]) {
    if (await col('users').findOne({ email_key: keyOf(email) })) continue;
    await insert('users', { email, email_key: keyOf(email), password_hash: bcrypt.hashSync('demo12345', 10), name, role, permissions: {}, phone, notif_prefs: defaultPrefs(), active: true, token_version: 0, must_change_password: false, password_changed_at: null });
  }

  const shade = { key: 'teinte', label: 'Teinte', type: 'select', options: ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'C1', 'C2', 'D2', 'D3'] };
  const designations = [
    ['Couronne céramo-métallique', 'Prothèse fixe', 95, 85, 75, [shade, { key: 'alliage', label: 'Alliage', type: 'select', options: ['Ni-Cr', 'Co-Cr', 'Précieux'] }]],
    ['Couronne zircone', 'Prothèse fixe', 180, 160, 140, [shade, { key: 'type_zircone', label: 'Zircone', type: 'select', options: ['Monolithique', 'Stratifiée', 'Multicouche'] }]],
    ['Couronne e.max', 'Prothèse fixe', 210, 190, 170, [shade]],
    ['Inlay-core', 'Prothèse fixe', 45, 40, 35, [{ key: 'alliage', label: 'Alliage', type: 'select', options: ['Ni-Cr', 'Co-Cr'] }]],
    ['Facette céramique', 'Esthétique', 230, 210, 190, [shade, { key: 'epaisseur', label: 'Épaisseur (mm)', type: 'number' }]],
    ['Couronne provisoire', 'Prothèse fixe', 25, 22, 18, [shade]],
    ['Dent sur stellite', 'Prothèse amovible', 20, 18, 15, [shade]],
    ['Châssis stellite', 'Prothèse amovible', 260, 240, 220, [], false],
    ['Prothèse complète résine', 'Prothèse amovible', 320, 290, 260, [shade, { key: 'arcade', label: 'Arcade', type: 'select', options: ['Maxillaire', 'Mandibulaire'] }], false],
    ['Couronne sur implant', 'Implantologie', 290, 270, 250, [shade, { key: 'systeme', label: "Système d'implant", type: 'text' }, { key: 'pilier', label: 'Pilier', type: 'select', options: ['Titane', 'Zircone', 'Personnalisé'] }]],
    ['Gouttière de contention', 'Orthodontie', 60, 55, 50, [], false],
    ['Réparation prothèse', 'Prothèse amovible', 40, 35, 30, [], false],
  ];
  const des = {};
  for (const [name, category, a, b, c, params, perTooth = true] of designations) {
    const existing = await col('designations').findOne({ name_key: keyOf(name) });
    des[name] = existing ? { ...existing, id: existing._id } : await insert('designations', { name, name_key: keyOf(name), category, price_a: a, price_b: b, price_c: c, params, per_tooth: perTooth, active: true });
  }

  const docs = [];
  for (const [ln, fn, t, city, phone] of [['Ben Salah', 'Mehdi', 'A', 'Tunis', '+216 98 111 222'], ['Gharbi', 'Ines', 'B', 'La Marsa', '+216 98 333 444'], ['Jaziri', 'Karim', 'C', 'Ariana', '+216 98 555 666'], ['Mansouri', 'Olfa', 'A', 'Sousse', '+216 98 777 888'], ['Haddad', 'Youssef', 'B', 'Sfax', '+216 98 999 000']]) {
    const d = await insert('doctors', { last_name: ln, first_name: fn, name_key: normalizeName(ln, fn), tariff: t, city, phone, email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/\s/g, '')}@cabinet.tn`, address: null, notes: null, archived: false });
    await createCarnet(d.id);
    docs.push(d);
  }
  const price = (doc, name) => des[name][`price_${doc.tariff.toLowerCase()}`];
  const hist = (to, note) => ({ from_status: null, to_status: to, note, user_id: admin._id, user_name: admin.name, at: stamp(day(0), '08:00:00') });

  async function addRequest(doc, patient, created, t1, t2, dp, da, status, works, obs, done = {}) {
    const year = created.slice(0, 4);
    const numero = `D-${year}-${pad(await nextSeq(`request-${year}`), 5)}`;
    const w = works.map(([tooth, name, params], i) => { const p = price(doc, name); return { id: i + 1, tooth, designation_id: des[name].id, designation_label: name, params: params || {}, quantity: 1, list_price: p, unit_price: p, total: p, observations: null }; });
    await insert('requests', {
      numero, patient_name: patient, doctor_id: doc.id, created_date: created, try1_date: t1, try1_done: !!done.t1, try2_date: t2, try2_done: !!done.t2,
      delivery_planned: dp, delivery_actual: da, observations: obs || null, status, works: w, total: roundMoney(w.reduce((s, x) => s + x.total, 0)),
      history: [hist(status, 'Création de la demande')], deleted_at: null, created_by: admin._id, updated_at: null, created_at: stamp(created),
    });
  }

  const [b1, g, j, m, h] = docs;
  await addRequest(b1, 'Amine Khelifi', day(-6), day(0, '10:30'), day(5, '11:00'), day(9), null, 'attente_essayage', [[11, 'Couronne zircone', { teinte: 'A2', type_zircone: 'Stratifiée' }], [21, 'Couronne zircone', { teinte: 'A2', type_zircone: 'Stratifiée' }]], 'Patient sensible, prévoir un essayage biscuit.');
  await addRequest(g, 'Sarra Bouazizi', day(-10), day(-1, '15:00'), null, day(4), null, 'attente_essayage', [[36, 'Couronne céramo-métallique', { teinte: 'A3', alliage: 'Ni-Cr' }]]);
  await addRequest(j, 'Hichem Riahi', day(-3), day(1, '09:00'), null, day(7), null, 'en_cours', [[46, 'Couronne sur implant', { teinte: 'A3', systeme: 'Straumann BL', pilier: 'Titane' }], [47, 'Couronne sur implant', { teinte: 'A3', systeme: 'Straumann BL', pilier: 'Titane' }]]);
  await addRequest(m, 'Nadia Chaabane', day(-12), day(-5), day(2, '14:00'), day(6), null, 'en_cours', [[12, 'Facette céramique', { teinte: 'B1', epaisseur: 0.5 }], [11, 'Facette céramique', { teinte: 'B1', epaisseur: 0.5 }], [21, 'Facette céramique', { teinte: 'B1', epaisseur: 0.5 }], [22, 'Facette céramique', { teinte: 'B1', epaisseur: 0.5 }]], null, { t1: true });
  await addRequest(h, 'Walid Mejri', day(-15), day(-8), null, day(1), null, 'a_livrer', [[null, 'Prothèse complète résine', { teinte: 'A3', arcade: 'Maxillaire' }]], null, { t1: true });
  await addRequest(b1, 'Rim Zouari', day(-20), day(-12), null, day(-2), null, 'a_livrer', [[24, 'Inlay-core', { alliage: 'Ni-Cr' }], [24, 'Couronne céramo-métallique', { teinte: 'A3.5', alliage: 'Ni-Cr' }]], null, { t1: true });
  await addRequest(g, 'Mourad Hamdi', day(-2), null, null, day(12), null, 'en_cours', [[null, 'Châssis stellite', {}], [35, 'Dent sur stellite', { teinte: 'A3' }], [36, 'Dent sur stellite', { teinte: 'A3' }]], 'Empreinte reçue le matin, attendre le RVB.');
  await addRequest(j, 'Fatma Karoui', day(-25), day(-18), day(-11), day(-6), day(-5), 'livree', [[14, 'Couronne e.max', { teinte: 'A1' }]], null, { t1: true, t2: true });
  await addRequest(m, 'Slim Ayari', day(-30), day(-22), null, day(-15), day(-15), 'livree', [[26, 'Couronne zircone', { teinte: 'A3', type_zircone: 'Monolithique' }]], null, { t1: true });
  await addRequest(h, 'Asma Dridi', day(-4), day(3, '16:00'), null, day(10), null, 'en_cours', [[13, 'Couronne provisoire', { teinte: 'A2' }], [23, 'Couronne provisoire', { teinte: 'A2' }]]);
  for (let i = 0; i < 14; i++) {
    const doc = docs[i % docs.length];
    await addRequest(doc, ['Ali Ferchichi', 'Hana Sassi', 'Omar Baccouche', 'Ines Kallel', 'Bilel Mrad', 'Sonia Toumi', 'Rami Jelassi'][i % 7], day(-40 - i * 3), day(-34 - i * 3), null, day(-28 - i * 3), day(-28 - i * 3), 'livree', [[16 + (i % 2), 'Couronne céramo-métallique', { teinte: 'A3', alliage: 'Co-Cr' }]], null, { t1: true });
  }

  async function addFiche(doc, date, patient, lines, status = 'validee') {
    const carnet = await col('carnets').findOne({ doctor_id: doc.id });
    const year = date.slice(0, 4);
    const numero = `F-${year}-${pad(await nextSeq(`fiche-${year}`), 5)}`;
    const l = lines.map(([name, qty], i) => { const p = price(doc, name); return { id: i + 1, position: i, designation_id: des[name].id, designation_label: name, quantity: qty, list_price: p, unit_price: p, total: roundMoney(p * qty) }; });
    const total = roundMoney(l.reduce((s, x) => s + x.total, 0));
    await insert('fiches', { numero, carnet_id: carnet._id, doctor_id: doc.id, request_id: null, lieu: doc.city, date, patient_name: patient, status, lines: l, subtotal: total, total, invoice_id: null, created_by: admin._id, updated_at: null, created_at: stamp(date) });
  }
  const todayNum = new Date().getDate();
  for (let mb = 0; mb < 6; mb++) {
    for (const [k, doc] of docs.entries()) {
      const n = 1 + ((mb + k) % 3);
      for (let i = 0; i < n; i++) {
        const dd = mb === 0 ? Math.max(1, Math.min(todayNum, 3 + i * 6 + k)) : 3 + i * 8 + k;
        await addFiche(doc, monthDay(mb, dd), ['Ali Ferchichi', 'Hana Sassi', 'Omar Baccouche', 'Ines Kallel'][(i + k) % 4],
          [[['Couronne céramo-métallique', 'Couronne zircone', 'Inlay-core', 'Couronne e.max'][(i + mb) % 4], 1 + ((i + k) % 3)], ['Couronne provisoire', 1]]);
      }
    }
  }
  await addFiche(g, monthDay(0, Math.max(1, todayNum - 1)), 'Mourad Hamdi', [['Châssis stellite', 1]], 'brouillon');

  // Validated invoices for the previous months, so history and statistics have content
  const lab = await labInfo();
  for (let mb = 5; mb >= 1; mb--) {
    const period = monthDay(mb, 1).slice(0, 7);
    for (const doc of docs) {
      const fiches = await col('fiches').find({ doctor_id: doc.id, status: 'validee', invoice_id: null, date: { $gte: `${period}-01`, $lte: `${period}-31` } }).sort({ date: 1 }).toArray();
      if (!fiches.length) continue;
      const lines = []; let total = 0;
      for (const f of fiches) for (const l of f.lines) { lines.push({ id: lines.length + 1, position: lines.length, fiche_id: f._id, fiche_numero: f.numero, fiche_date: f.date, patient_name: f.patient_name, designation_label: l.designation_label, quantity: l.quantity, unit_price: l.unit_price, total: l.total }); total += l.total; }
      const issue = monthDay(mb - 1, 2);
      const y = issue.slice(0, 4);
      const inv = await insert('invoices', {
        numero: `FAC-${y}-${pad(await nextSeq(`invoice-${y}`), 4)}`, doctor_id: doc.id, period, status: 'validee', grouping: 'fiche', lab_info: lab,
        doctor_info: { name: `Dr ${doc.last_name} ${doc.first_name}`, address: '', city: doc.city, phone: doc.phone, email: doc.email, tariff: doc.tariff },
        notes: null, lines, total: roundMoney(total), corrects_invoice_id: null, correction_reason: null, issue_date: issue,
        validated_at: stamp(issue), validated_by: admin._id, created_by: admin._id, created_at: stamp(issue), updated_at: null,
      });
      await col('fiches').updateMany({ _id: { $in: fiches.map((f) => f._id) } }, { $set: { invoice_id: inv.id } });
    }
  }

  console.log(`Données de démonstration créées dans ${safeUri(MONGODB_URI)}.`);
  console.log('Comptes : admin@labo.local / admin1234 (à changer à la première connexion), production@labo.local / demo12345, admin2@labo.local / demo12345');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => close());
