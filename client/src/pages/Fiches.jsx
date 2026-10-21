import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DesignationSelect, listPrice } from '../components/WorkFields';
import { DoctorSelect, Empty, ErrorBox, Field, Loading, PageHeader, useLoad, useUi } from '../components/ui';
import { fmtDate, fmtMoney, moneyStep, roundMoney, todayISO } from '../format';

export function CarnetList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const { data, error } = useLoad(() => api.get(`/carnets${all ? '?archived=all' : ''}`), [all]);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = (data || []).filter((c) => norm(`${c.numero} ${c.last_name} ${c.first_name}`).includes(norm(q)));
  return (
    <div>
      <PageHeader title="Carnets et fiches" sub="Un carnet par médecin ; chaque carnet regroupe ses fiches de travaux.">
        <Link className="btn btn-primary" to="/fiches/nouvelle">Nouvelle fiche</Link>
      </PageHeader>
      <section className="card list-card">
        <div className="toolbar">
          <input className="search" type="search" placeholder="Rechercher un carnet ou un médecin…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Inclure les carnets archivés</label>
        </div>
        <ErrorBox error={error} />
        {data && list.length === 0 && <Empty title="Aucun carnet trouvé." />}
        {list.length > 0 && (
          <div className="carnet-grid">
            {list.map((c) => (
              <button key={c.id} className={`carnet-tile ${c.archived ? 'is-archived' : ''}`} onClick={() => navigate(`/carnets/${c.id}`)}>
                <span className="carnet-tile-num">{c.numero}</span>
                <strong>Dr {c.last_name} {c.first_name}</strong>
                <span className="muted">{c.fiches_count} fiche{c.fiches_count > 1 ? 's' : ''}{c.last_fiche ? `, dernière le ${fmtDate(c.last_fiche)}` : ''}</span>
                <span className={`tariff tariff-${c.tariff}`}>{c.tariff}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function CarnetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [f, setF] = useState({ q: '', from: '', to: '' });
  const { data: c, error } = useLoad(() => api.get(`/carnets/${id}${qs(f)}`), [id, f.q, f.from, f.to]);
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;
  const idx = c.fiches.length;
  return (
    <div>
      <PageHeader title={`Carnet ${c.numero}`} sub={<>Dr <Link to={`/medecins/${c.doctor_id}`}>{c.last_name} {c.first_name}</Link>, tarif {c.tariff}{c.archived ? ', carnet archivé' : ''}</>}>
        {!c.archived && <Link className="btn btn-primary" to={`/fiches/nouvelle?doctor=${c.doctor_id}`}>Nouvelle fiche</Link>}
      </PageHeader>
      <section className="card list-card">
        <div className="toolbar">
          <input className="search" type="search" placeholder="N° de fiche, patient, lieu, désignation…" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
          <label className="inline-field">Du <input type="date" value={f.from} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} /></label>
          <label className="inline-field">au <input type="date" value={f.to} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} /></label>
        </div>
        {idx === 0 ? <Empty title="Aucune fiche dans ce carnet." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Date</th><th>Patient</th><th>Lieu</th><th className="num">Lignes</th><th>État</th><th>Facture</th><th className="num">Montant</th></tr></thead>
            <tbody>{c.fiches.map((x) => (
              <tr key={x.id} className="clickable" onClick={() => navigate(`/fiches/${x.id}`)}>
                <td><Link to={`/fiches/${x.id}`} className="mono-num">{x.numero}</Link></td><td>{fmtDate(x.date)}</td><td>{x.patient_name}</td><td>{x.lieu}</td><td className="num">{x.lines_count}</td>
                <td>{x.status === 'validee' ? 'Validée' : <span className="tag">brouillon</span>}</td><td>{x.invoice_id ? (x.invoice_numero || 'en préparation') : '—'}</td><td className="num">{fmtMoney(x.total)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

let k = 1;
const blankLine = () => ({ _k: k++, designation_id: null, designation_label: '', quantity: 1, unit_price: 0, total: 0 });

export function FicheForm() {
  const { id } = useParams();
  const isNew = !id;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const [doctors, setDoctors] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [fiche, setFiche] = useState(null);
  const [form, setForm] = useState(isNew ? { doctor_id: Number(sp.get('doctor')) || '', date: todayISO(), lieu: '', patient_name: '', lines: [blankLine()] } : null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/doctors?archived=all'), api.get('/designations?all=1')]).then(([d, des]) => { setDoctors(d); setDesignations(des); });
    if (!isNew) api.get(`/fiches/${id}`).then((f) => { setFiche(f); setForm({ ...f, lines: f.lines.map((l) => ({ ...l, _k: k++ })) }); }).catch((e) => setError(e.message));
  }, [id, isNew]);

  if (!form) return error ? <ErrorBox error={error} /> : <Loading />;
  const doctor = doctors.find((d) => String(d.id) === String(form.doctor_id));
  const locked = !!fiche?.invoice_id;
  const readOnly = locked || !can('fiches_manage');
  const canPrice = can('price_override');
  const subtotal = roundMoney(form.lines.reduce((s, l) => s + (Number(l.total) || 0), 0));

  const setLine = (key, patch) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l) => {
      if (l._k !== key) return l;
      const n = { ...l, ...patch };
      n.total = roundMoney((Number(n.quantity) || 0) * (Number(n.unit_price) || 0));
      return n;
    }),
  }));
  const pickDesignation = (key, desId) => {
    const des = designations.find((d) => d.id === desId);
    setLine(key, { designation_id: desId, designation_label: des?.name || '', unit_price: listPrice(des, doctor?.tariff) });
  };
  const changeDoctor = (docId) => {
    const nd = doctors.find((d) => d.id === docId);
    setForm((f) => ({ ...f, doctor_id: docId, lines: f.lines.map((l) => { const des = designations.find((d) => d.id === l.designation_id); if (!des) return l; const u = listPrice(des, nd?.tariff); return { ...l, unit_price: u, total: roundMoney(u * l.quantity) }; }) }));
  };

  const save = async (status) => {
    setError(null);
    const lines = form.lines.filter((l) => l.designation_id).map(({ _k, ...l }) => l);
    // lines without a designation are treated as empty and ignored
    if (status === 'validee' && !(await confirm({ title: 'Valider la fiche', message: 'Une fiche validée pourra être facturée. Vous pourrez encore la modifier tant qu\'elle n\'est pas rattachée à une facture.', confirmLabel: 'Valider la fiche' }))) return;
    setSaving(true);
    try {
      const body = { ...form, lines, status };
      const r = isNew ? await api.post('/fiches', body) : await api.put(`/fiches/${id}`, body);
      toast(status === 'validee' ? `Fiche ${r.numero} validée.` : `Fiche ${r.numero} enregistrée en brouillon.`);
      if (isNew) navigate(`/fiches/${r.id}`, { replace: true });
      else { setFiche(r); setForm({ ...r, lines: r.lines.map((l) => ({ ...l, _k: k++ })) }); }
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer la fiche', message: `La fiche ${fiche.numero} sera définitivement supprimée.`, confirmLabel: 'Supprimer', danger: true }))) return;
    try { await api.del(`/fiches/${id}`); toast('Fiche supprimée.'); navigate(`/carnets/${fiche.carnet_id}`); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <PageHeader title={isNew ? 'Nouvelle fiche de travaux' : `Fiche ${fiche.numero}`}
        sub={!isNew && <>Carnet <Link to={`/carnets/${fiche.carnet_id}`}>{fiche.carnet_numero}</Link>, Dr {fiche.last_name} {fiche.first_name}{fiche.request_numero && <>, issue de la demande <Link to={`/demandes/${fiche.request_id}`}>{fiche.request_numero}</Link></>}</>}>
        {!isNew && <span className={`inv-state inv-${fiche.status === 'validee' ? 'validee' : 'brouillon'}`}>{fiche.status === 'validee' ? 'Validée' : 'Brouillon'}</span>}
      </PageHeader>
      <ErrorBox error={error} />
      {locked && <div className="info-box">Cette fiche est rattachée à la facture <Link to={`/factures/${fiche.invoice_id}`}>{fiche.invoice_numero || 'en préparation'}</Link> : elle n'est plus modifiable.</div>}
      <section className="card form-grid">
        <div className="field"><span className="field-label">Médecin</span>
          <DoctorSelect doctors={doctors} value={form.doctor_id} onChange={changeDoctor} disabled={!isNew} required />
          {doctor && <span className="field-hint">Carnet du médecin, tarif {doctor.tariff}</span>}
        </div>
        <Field label="Date"><input type="date" required value={form.date} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
        <Field label="Lieu"><input value={form.lieu || ''} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, lieu: e.target.value }))} /></Field>
        <Field label="Patient (facultatif)"><input value={form.patient_name || ''} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))} /></Field>
      </section>
      <section className="card">
        <h2>Travaux</h2>
        <div className="table-wrap"><table className="table lines-table">
          <thead><tr><th className="num col-qty">Quantité</th><th>Désignation</th><th className="num col-price">Prix unitaire</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {form.lines.map((l) => {
              const des = designations.find((d) => d.id === l.designation_id);
              const changed = des && doctor && Number(l.unit_price) !== listPrice(des, doctor.tariff);
              return (
                <tr key={l._k}>
                  <td className="num"><input type="number" min="1" step="any" value={l.quantity} disabled={readOnly} onChange={(e) => setLine(l._k, { quantity: e.target.value })} aria-label="Quantité" /></td>
                  <td><DesignationSelect designations={designations} value={l.designation_id} disabled={readOnly || !doctor} onChange={(v) => pickDesignation(l._k, v)} filter={(d) => d.active} /></td>
                  <td className="num"><input type="number" min="0" step={moneyStep()} value={l.unit_price} disabled={readOnly || !canPrice} onChange={(e) => setLine(l._k, { unit_price: e.target.value })} aria-label="Prix unitaire" />
                    {changed && <small className="override-flag">tarif : {fmtMoney(listPrice(des, doctor.tariff))}</small>}</td>
                  <td className="num"><strong>{fmtMoney(l.total)}</strong></td>
                  <td>{!readOnly && <button className="icon-btn" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((x) => x._k !== l._k) }))} aria-label="Supprimer la ligne">×</button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="num">Sous-total</td><td className="num">{fmtMoney(subtotal)}</td><td /></tr>
            <tr className="grand"><td colSpan={3} className="num">Montant total de la fiche</td><td className="num"><strong>{fmtMoney(subtotal)}</strong></td><td /></tr>
          </tfoot>
        </table></div>
        {!readOnly && <button className="btn btn-dashed" disabled={!doctor} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>Ajouter une ligne</button>}
      </section>
      {!readOnly && (
        <div className="form-actions">
          {!isNew && can('delete_archive') && fiche.status !== 'validee' && <button className="btn btn-danger-ghost" onClick={remove}>Supprimer la fiche</button>}
          <span className="grow" />
          {(isNew || fiche.status !== 'validee') && <button className="btn" disabled={saving} onClick={() => save('brouillon')}>Enregistrer le brouillon</button>}
          {!isNew && fiche.status === 'validee' && <button className="btn" disabled={saving} onClick={() => save('brouillon')}>Repasser en brouillon</button>}
          <button className="btn btn-primary" disabled={saving} onClick={() => save('validee')}>{fiche?.status === 'validee' ? 'Enregistrer' : 'Valider la fiche'}</button>
        </div>
      )}
    </div>
  );
}
