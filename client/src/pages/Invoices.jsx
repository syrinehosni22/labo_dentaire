import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, openFile, qs } from '../api';
import { useAuth } from '../auth';
import { DoctorSelect, Empty, ErrorBox, Field, Loading, PageHeader, useLoad, useUi } from '../components/ui';
import { currentPeriod, fmtDate, fmtMoney, moneyStep, periodLabel, roundMoney } from '../format';
import { InvoiceState } from './Doctors';

export function InvoiceList() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('vue') || (can('invoices_manage') ? 'preparer' : 'historique');
  return (
    <div>
      <PageHeader title="Factures" sub="Une facture par médecin et par mois, à partir des fiches validées." />
      <div className="tabs tabs-page" role="tablist">
        {can('invoices_manage') && <button role="tab" aria-selected={tab === 'preparer'} className={tab === 'preparer' ? 'is-on' : ''} onClick={() => setSp({ vue: 'preparer' })}>Préparer les factures du mois</button>}
        <button role="tab" aria-selected={tab === 'historique'} className={tab === 'historique' ? 'is-on' : ''} onClick={() => setSp({ vue: 'historique' })}>Historique</button>
      </div>
      {tab === 'preparer' ? <Prepare /> : <History />}
    </div>
  );
}

function Prepare() {
  const navigate = useNavigate();
  const { toast } = useUi();
  const [period, setPeriod] = useState(currentPeriod());
  const [grouping, setGrouping] = useState('fiche');
  const [busy, setBusy] = useState(null);
  const { data, error, reload } = useLoad(() => api.get(`/invoices/preview?period=${period}`), [period]);

  const generate = async (row) => {
    setBusy(row.doctor_id);
    try {
      const inv = await api.post('/invoices', { doctor_id: row.doctor_id, period, grouping });
      toast(`Brouillon de facture créé pour le Dr ${row.doctor_name}.`);
      navigate(`/factures/${inv.id}`);
    } catch (e) { toast(e.message, 'error'); reload(); } finally { setBusy(null); }
  };

  return (
    <section className="card list-card">
      <div className="toolbar">
        <label className="inline-field">Mois facturé <input type="month" value={period} max={currentPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></label>
        <label className="inline-field">Regrouper par
          <select value={grouping} onChange={(e) => setGrouping(e.target.value)}><option value="fiche">fiche</option><option value="designation">désignation</option></select>
        </label>
      </div>
      <ErrorBox error={error} />
      {data?.length === 0 && <Empty title={`Aucune fiche à facturer pour ${periodLabel(period)}.`}>Validez des fiches de travaux datées de ce mois pour pouvoir les facturer.</Empty>}
      {data?.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Médecin</th><th className="num">Fiches à facturer</th><th className="num">Montant</th><th>Factures du mois</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.doctor_id}>
              <td><Link to={`/medecins/${r.doctor_id}`}><strong>Dr {r.doctor_name}</strong></Link>
                {r.draft_fiches > 0 && <div className="warn small">{r.draft_fiches} fiche{r.draft_fiches > 1 ? 's' : ''} en brouillon non incluse{r.draft_fiches > 1 ? 's' : ''}</div>}</td>
              <td className="num">{r.billable.length}</td>
              <td className="num">{r.billable.length ? fmtMoney(r.billable_total) : '—'}</td>
              <td>{r.invoices.length ? r.invoices.map((i) => <Link key={i.id} to={`/factures/${i.id}`} className="inv-link"><InvoiceState status={i.status} /> {i.numero || `#${i.id}`} {fmtMoney(i.total)}</Link>) : <span className="muted">—</span>}</td>
              <td className="num">{r.billable.length > 0 && <button className="btn btn-small btn-primary" disabled={busy === r.doctor_id} onClick={() => generate(r)}>Générer la facture</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function History() {
  const navigate = useNavigate();
  const [f, setF] = useState({ q: '', doctor_id: '', from: '', to: '', status: '' });
  const [doctors, setDoctors] = useState([]);
  useEffect(() => { api.get('/doctors?archived=all').then(setDoctors); }, []);
  const { data, error } = useLoad(() => api.get(`/invoices${qs(f)}`), [f.q, f.doctor_id, f.from, f.to, f.status]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <section className="card list-card">
      <div className="toolbar wrap">
        <input className="search" type="search" placeholder="N° de facture ou médecin…" value={f.q} onChange={set('q')} />
        <div className="combo-clear inline-combo"><DoctorSelect doctors={doctors} includeArchived value={f.doctor_id} onChange={(v) => setF((x) => ({ ...x, doctor_id: v }))} placeholder="Tous les médecins" />
          {f.doctor_id && <button className="icon-btn" onClick={() => setF((x) => ({ ...x, doctor_id: '' }))} aria-label="Retirer le filtre">×</button>}</div>
        <label className="inline-field">De <input type="month" value={f.from} onChange={set('from')} /></label>
        <label className="inline-field">à <input type="month" value={f.to} onChange={set('to')} /></label>
        <select value={f.status} onChange={set('status')} aria-label="État"><option value="">Tous les états</option><option value="brouillon">Brouillons</option><option value="validee">Validées</option><option value="rectifiee">Rectifiées</option></select>
      </div>
      <ErrorBox error={error} />
      {data?.length === 0 && <Empty title="Aucune facture trouvée." />}
      {data?.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>N°</th><th>Médecin</th><th>Période</th><th>État</th><th className="num">Fiches</th><th className="num">Montant</th><th /></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} className="clickable" onClick={(e) => !e.target.closest('button,a') && navigate(`/factures/${i.id}`)}>
              <td><Link to={`/factures/${i.id}`} className="mono-num">{i.numero || `Brouillon #${i.id}`}</Link></td><td>Dr {i.doctor_name}</td><td>{periodLabel(i.period)}</td>
              <td><InvoiceState status={i.status} /></td><td className="num">{i.fiches_count}</td><td className="num">{fmtMoney(i.total)}</td>
              <td className="num"><button className="btn btn-small" onClick={() => openFile(`/invoices/${i.id}/pdf`)}>PDF</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

let lk = 1;
export function InvoiceEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const [inv, setInv] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  const apply = (i) => { setInv(i); setForm({ ...i, lines: i.lines.map((l) => ({ ...l, _k: lk++ })) }); setDirty(false); };
  useEffect(() => { api.get(`/invoices/${id}`).then(apply).catch((e) => setError(e.message)); }, [id]);
  if (!form) return error ? <ErrorBox error={error} /> : <Loading />;

  const draft = inv.status === 'brouillon';
  const editable = draft && can('invoices_manage');
  const canPrice = can('price_override');
  const total = roundMoney(form.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0));
  const upd = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setLine = (k, patch) => upd({ lines: form.lines.map((l) => (l._k === k ? { ...l, ...patch } : l)) });
  const setDoc = (k) => (e) => upd({ doctor_info: { ...form.doctor_info, [k]: e.target.value } });

  const save = async (quiet) => {
    setError(null);
    try {
      const r = await api.put(`/invoices/${id}`, { notes: form.notes, issue_date: form.issue_date, doctor_info: form.doctor_info, lines: form.lines.map(({ _k, ...l }) => l) });
      apply(r); if (!quiet) toast('Brouillon enregistré.');
      return true;
    } catch (e) { setError(e.message); return false; }
  };
  const validate = async () => {
    if (!(await confirm({ title: 'Valider la facture', message: `Un numéro définitif sera attribué et la facture (${fmtMoney(total)}) ne pourra plus être modifiée directement. Toute correction passera par une rectification tracée.`, confirmLabel: 'Valider la facture' }))) return;
    if (dirty && !(await save(true))) return;
    try { apply(await api.post(`/invoices/${id}/validate`)); toast('Facture validée.'); } catch (e) { setError(e.message); }
  };
  const rebuild = async (grouping) => {
    if (!(await confirm({ title: 'Recalculer depuis les fiches', message: 'Les lignes seront reconstruites à partir des fiches (y compris les fiches validées depuis) ; vos modifications manuelles des lignes seront perdues.', confirmLabel: 'Recalculer', danger: true }))) return;
    try { apply(await api.post(`/invoices/${id}/rebuild`, { grouping })); toast('Lignes recalculées.'); } catch (e) { setError(e.message); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer le brouillon', message: 'Les fiches redeviendront disponibles pour une autre facture.', confirmLabel: 'Supprimer le brouillon', danger: true }))) return;
    try { await api.del(`/invoices/${id}`); toast('Brouillon supprimé.'); navigate('/factures'); } catch (e) { setError(e.message); }
  };
  const rectify = async () => {
    const reason = await confirm({ title: 'Rectifier la facture', message: 'Un brouillon de facture rectificative est créé à partir de celle-ci. À sa validation, il remplacera cette facture, qui restera consultable avec la mention « rectifiée ».', input: { label: 'Motif de la rectification', min: 5 }, confirmLabel: 'Créer la rectification' });
    if (!reason) return;
    try { const r = await api.post(`/invoices/${id}/rectify`, { reason }); toast('Rectification créée.'); navigate(`/factures/${r.id}`); } catch (e) { setError(e.message); }
  };

  const lab = form.lab_info; const di = form.doctor_info;
  return (
    <div>
      <div className="no-print">
        <PageHeader title={inv.numero ? `Facture ${inv.numero}` : `Brouillon de facture #${inv.id}`} sub={<>Dr <Link to={`/medecins/${inv.doctor_id}`}>{inv.doctor_name}</Link>, {periodLabel(inv.period)}</>}>
          <InvoiceState status={inv.status} />
          <button className="btn" onClick={() => openFile(`/invoices/${id}/pdf`)}>Voir le PDF</button>
          <button className="btn" onClick={() => openFile(`/invoices/${id}/pdf?download=1`, `facture-${inv.numero || `brouillon-${inv.id}`}.pdf`)}>Télécharger</button>
          <button className="btn" onClick={() => window.print()}>Imprimer</button>
          {inv.status === 'validee' && can('invoices_validate') && <button className="btn" onClick={rectify}>Rectifier</button>}
        </PageHeader>
        <ErrorBox error={error} />
        {inv.corrects_numero && <div className="info-box">Facture rectificative de <Link to={`/factures/${inv.corrects_invoice_id}`}>{inv.corrects_numero}</Link>. Motif : {inv.correction_reason}</div>}
        {inv.status === 'rectifiee' && <div className="info-box">Cette facture a été rectifiée{inv.rectified_by_numero ? ` par ${inv.rectified_by_numero}` : ''}. Elle reste consultable mais n'est plus en vigueur.</div>}
        {inv.status === 'validee' && <div className="info-box">Validée le {fmtDate(inv.validated_at.replace(' ', 'T').slice(0, 16))} par {inv.validated_by_name}. Les montants facturés sont figés.</div>}
        {editable && (
          <div className="card draft-tools">
            <span>Regroupement :</span>
            <div className="segmented">
              {[['fiche', 'Par fiche'], ['designation', 'Par désignation']].map(([g, l]) => <button key={g} className={inv.grouping === g ? 'is-on' : ''} onClick={() => inv.grouping !== g && rebuild(g)}>{l}</button>)}
            </div>
            <button className="btn btn-small" onClick={() => rebuild(inv.grouping)}>Recalculer depuis les fiches</button>
            <span className="grow" />
            {dirty && <span className="dirty-dot">Modifications non enregistrées</span>}
          </div>
        )}
      </div>

      <article className="invoice-doc">
        <header className="inv-head">
          <div>
            <h2 className="inv-lab">{lab.name}</h2>
            <p className="muted">{[lab.address, lab.phone && `Tél. ${lab.phone}`, lab.email, lab.tax_id && `MF ${lab.tax_id}`].filter(Boolean).join('\n')}</p>
          </div>
          <div className="inv-meta">
            <p className="inv-title">Facture{draft ? ' (brouillon)' : ''}</p>
            <p>N° {inv.numero || 'attribué à la validation'}</p>
            <p>Date : {editable ? <input type="date" value={form.issue_date || ''} onChange={(e) => upd({ issue_date: e.target.value })} /> : fmtDate(inv.issue_date)}</p>
            <p>Période : {periodLabel(inv.period)}</p>
          </div>
        </header>
        <div className="inv-to">
          <span className="muted small">Facturé à</span>
          {editable ? (
            <div className="form-grid compact">
              <Field label="Nom"><input value={di.name || ''} onChange={setDoc('name')} /></Field>
              <Field label="Adresse"><input value={di.address || ''} onChange={setDoc('address')} /></Field>
              <Field label="Ville"><input value={di.city || ''} onChange={setDoc('city')} /></Field>
              <Field label="Téléphone"><input value={di.phone || ''} onChange={setDoc('phone')} /></Field>
            </div>
          ) : (
            <><strong>{di.name}</strong><p className="muted">{[di.address, di.city].filter(Boolean).join(', ')}{di.phone && <><br />{di.phone}</>}</p></>
          )}
        </div>
        <div className="table-wrap"><table className="table inv-table">
          <thead><tr>{inv.grouping === 'fiche' ? <th>Fiche</th> : <th>Fiches</th>}<th>Désignation</th><th className="num col-qty">Qté</th><th className="num col-price">Prix unitaire</th><th className="num">Montant</th>{editable && <th className="no-print" />}</tr></thead>
          <tbody>
            {form.lines.map((l, i) => {
              const showFiche = inv.grouping !== 'fiche' || i === 0 || form.lines[i - 1].fiche_numero !== l.fiche_numero;
              return (
                <tr key={l._k} className={showFiche && i > 0 && inv.grouping === 'fiche' ? 'fiche-start' : ''}>
                  <td className="small">{showFiche && <>{l.fiche_numero}{l.fiche_date && <><br /><span className="muted">{fmtDate(l.fiche_date)}{l.patient_name && `, ${l.patient_name}`}</span></>}</>}</td>
                  <td>{editable ? <input value={l.designation_label} onChange={(e) => setLine(l._k, { designation_label: e.target.value })} aria-label="Désignation" /> : l.designation_label}</td>
                  <td className="num">{editable ? <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l._k, { quantity: e.target.value })} aria-label="Quantité" /> : l.quantity}</td>
                  <td className="num">{editable && canPrice ? <input type="number" min="0" step={moneyStep()} value={l.unit_price} onChange={(e) => setLine(l._k, { unit_price: e.target.value })} aria-label="Prix unitaire" /> : fmtMoney(l.unit_price)}</td>
                  <td className="num">{fmtMoney(roundMoney((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)))}</td>
                  {editable && <td className="no-print"><button className="icon-btn" onClick={() => upd({ lines: form.lines.filter((x) => x._k !== l._k) })} aria-label="Retirer la ligne">×</button></td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="grand"><td colSpan={4} className="num">Total</td><td className="num"><strong>{fmtMoney(total)}</strong></td>{editable && <td className="no-print" />}</tr></tfoot>
        </table></div>
        {editable && <button className="btn btn-dashed btn-small no-print" onClick={() => upd({ lines: [...form.lines, { _k: lk++, designation_label: '', quantity: 1, unit_price: 0, fiche_id: null, fiche_numero: null }] })}>Ajouter une ligne</button>}
        {editable ? <Field label="Notes sur la facture"><textarea rows={2} value={form.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></Field>
          : inv.notes && <p className="inv-notes">{inv.notes}</p>}
        {lab.footer && <p className="inv-footer">{lab.footer}</p>}
      </article>

      {editable && (
        <div className="form-actions no-print">
          <button className="btn btn-danger-ghost" onClick={remove}>Supprimer le brouillon</button>
          <span className="grow" />
          <button className="btn" onClick={() => save()} disabled={!dirty}>Enregistrer le brouillon</button>
          {can('invoices_validate') && <button className="btn btn-primary" onClick={validate}>Valider la facture</button>}
        </div>
      )}
    </div>
  );
}
