const PDFDocument = require('pdfkit');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const fmtDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const periodLabel = (p) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

function money(n, lab) {
  const dec = lab.decimals ?? 3;
  const s = Number(n || 0).toFixed(dec).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${s} ${lab.currency || 'TND'}`;
}

function invoicePdf(inv, stream) {
  const lab = inv.lab_info || {};
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Facture ${inv.numero || 'brouillon'}` } });
  doc.pipe(stream);
  const ink = '#1E2A2F'; const muted = '#5E6B70'; const accent = '#A8344F';
  const W = doc.page.width - 96;

  // Header
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(lab.name || 'Laboratoire dentaire', 48, 48);
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  [lab.address, lab.phone && `Tél. ${lab.phone}`, lab.email, lab.tax_id && `Matricule fiscal : ${lab.tax_id}`].filter(Boolean).forEach((l) => doc.text(l));

  doc.font('Helvetica-Bold').fontSize(20).fillColor(accent).text(inv.status === 'brouillon' ? 'FACTURE — BROUILLON' : 'FACTURE', 48, 48, { align: 'right', width: W });
  doc.font('Helvetica').fontSize(10).fillColor(ink)
    .text(`N° ${inv.numero || `brouillon #${inv.id}`}`, { align: 'right', width: W })
    .text(`Date : ${fmtDate(inv.issue_date)}`, { align: 'right', width: W })
    .text(`Période : ${periodLabel(inv.period)}`, { align: 'right', width: W });
  if (inv.corrects_numero) doc.fillColor(accent).text(`Rectifie la facture ${inv.corrects_numero}`, { align: 'right', width: W });
  if (inv.status === 'rectifiee') doc.fillColor(accent).text(`Rectifiée par ${inv.rectified_by_numero || 'une autre facture'}`, { align: 'right', width: W });

  // Doctor block
  const y0 = Math.max(doc.y, 140) + 16;
  doc.roundedRect(W / 2 + 48, y0, W / 2, 74, 4).strokeColor('#D5DCDD').stroke();
  const di = inv.doctor_info || {};
  doc.fillColor(muted).fontSize(8).text('Facturé à', W / 2 + 60, y0 + 10);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(di.name || inv.doctor_name, W / 2 + 60, y0 + 22, { width: W / 2 - 24 });
  doc.font('Helvetica').fontSize(9).fillColor(muted).text([di.address, di.city].filter(Boolean).join(', ') || ' ', { width: W / 2 - 24 }).text([di.phone, di.email].filter(Boolean).join(' – '), { width: W / 2 - 24 });

  // Table
  let y = y0 + 98;
  const byFiche = inv.grouping === 'fiche';
  const cols = byFiche
    ? [{ k: 'fiche', t: 'Fiche', w: 0.17 }, { k: 'designation_label', t: 'Désignation', w: 0.37 }, { k: 'quantity', t: 'Qté', w: 0.08, a: 'right' }, { k: 'unit_price', t: 'Prix unitaire', w: 0.18, a: 'right' }, { k: 'total', t: 'Montant', w: 0.2, a: 'right' }]
    : [{ k: 'designation_label', t: 'Désignation', w: 0.46 }, { k: 'fiche_numero', t: 'Fiches', w: 0.12 }, { k: 'quantity', t: 'Qté', w: 0.08, a: 'right' }, { k: 'unit_price', t: 'Prix unitaire', w: 0.16, a: 'right' }, { k: 'total', t: 'Montant', w: 0.18, a: 'right' }];
  const header = () => {
    doc.rect(48, y, W, 20).fill('#EEF2F2');
    let x = 48;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8.5);
    for (const c of cols) { doc.text(c.t, x + 6, y + 6, { width: c.w * W - 12, align: c.a || 'left' }); x += c.w * W; }
    y += 24;
  };
  header();
  doc.font('Helvetica').fontSize(9);
  let lastFiche = null;
  for (const l of inv.lines) {
    const cell = {
      fiche: l.fiche_numero !== lastFiche ? `${l.fiche_numero || ''}\n${fmtDate(l.fiche_date)}${l.patient_name ? `\n${l.patient_name}` : ''}` : '',
      designation_label: l.designation_label, fiche_numero: l.fiche_numero || '',
      quantity: String(l.quantity).replace('.', ','), unit_price: money(l.unit_price, lab), total: money(l.total, lab),
    };
    const h = Math.max(...cols.map((c) => doc.heightOfString(cell[c.k], { width: c.w * W - 12 }))) + 8;
    if (y + h > doc.page.height - 120) { doc.addPage(); y = 48; header(); doc.font('Helvetica').fontSize(9); }
    if (byFiche && l.fiche_numero !== lastFiche && lastFiche !== null) doc.moveTo(48, y - 2).lineTo(48 + W, y - 2).strokeColor('#D5DCDD').stroke();
    let x = 48;
    for (const c of cols) { doc.fillColor(c.k === 'fiche' ? muted : ink).text(cell[c.k], x + 6, y, { width: c.w * W - 12, align: c.a || 'left' }); x += c.w * W; }
    y += h; lastFiche = l.fiche_numero;
  }
  doc.moveTo(48, y).lineTo(48 + W, y).strokeColor(ink).stroke();
  y += 10;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text('Total', 48 + W * 0.5, y, { width: W * 0.25 });
  doc.text(money(inv.total, lab), 48 + W * 0.6, y, { width: W * 0.4, align: 'right' });
  y += 28;
  if (inv.notes) { doc.font('Helvetica').fontSize(9).fillColor(muted).text(inv.notes, 48, y, { width: W }); y = doc.y + 8; }
  if (inv.correction_reason) { doc.font('Helvetica-Oblique').fontSize(9).fillColor(muted).text(`Motif de rectification : ${inv.correction_reason}`, 48, y, { width: W }); }
  if (lab.footer) doc.font('Helvetica').fontSize(8).fillColor(muted).text(lab.footer, 48, doc.page.height - 70, { width: W, align: 'center' });
  doc.end();
}

module.exports = { invoicePdf };
