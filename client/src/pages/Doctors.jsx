import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useLoad, useUi } from '../components/ui';
import { fmtDate, fmtMoney, periodLabel } from '../format';

const EMPTY = { last_name: '', first_name: '', phone: '', email: '', address: '', city: '', notes: '', tariff: 'A' };

export function DoctorFormModal({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || EMPTY);
  const [error, setError] = useState(null);
  const [dup, setDup] = useState({ exact: null, similar: [] });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (f.last_name.trim().length < 2) { setDup({ exact: null, similar: [] }); return undefined; }
    const t = setTimeout(() => api.get(`/doctors/check-duplicate${qs({ last_name: f.last_name, first_name: f.first_name, exclude: initial?.id })}`).then(setDup).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [f.last_name, f.first_name, initial?.id]);

  const submit = async (e) => {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      const r = initial?.id ? await api.put(`/doctors/${initial.id}`, f) : await api.post('/doctors', f);
      onSaved(r);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <Modal title={initial?.id ? 'Modifier le médecin' : 'Nouveau médecin'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorBox error={error} />
        <Field label="Nom"><input required value={f.last_name} onChange={set('last_name')} /></Field>
        <Field label="Prénom"><input required value={f.first_name} onChange={set('first_name')} /></Field>
        {dup.exact && <div className="error-box span-all">Ce médecin existe déjà{dup.exact.archived ? ' dans les archives' : ''} : <Link to={`/medecins/${dup.exact.id}`} onClick={onClose}>ouvrir sa fiche</Link>.</div>}
        {!dup.exact && dup.similar.length > 0 && (
          <div className="info-box span-all">Noms proches déjà enregistrés : {dup.similar.map((d, i) => <span key={d.id}>{i > 0 && ', '}<Link to={`/medecins/${d.id}`} onClick={onClose}>Dr {d.last_name} {d.first_name}</Link>{d.city && ` (${d.city})`}</span>)}</div>
        )}
        <Field label="Tarif par défaut" hint="Appliqué automatiquement aux fiches et demandes">
          <div className="segmented" role="radiogroup">
            {['A', 'B', 'C'].map((t) => <button type="button" key={t} role="radio" aria-checked={f.tariff === t} className={f.tariff === t ? 'is-on' : ''} onClick={() => setF((x) => ({ ...x, tariff: t }))}>Tarif {t}</button>)}
          </div>
        </Field>
        <Field label="Téléphone"><input type="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="E-mail"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Ville"><input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="Adresse du cabinet" className="span-all"><input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="Informations complémentaires" className="span-all"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        <div className="modal-actions span-all">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={saving || !!dup.exact}>{initial?.id ? 'Enregistrer' : 'Créer le médecin et son carnet'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function DoctorList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState('0');
  const [creating, setCreating] = useState(false);
  const { data, error } = useLoad(() => api.get(`/doctors${qs({ q, archived })}`), [q, archived]);

  return (
    <div>
      <PageHeader title="Médecins" sub="Chaque médecin dispose d'un carnet unique, créé avec sa fiche.">
        {can('doctors_manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau médecin</button>}
      </PageHeader>
      <section className="card list-card">
        <div className="toolbar">
          <input className="search" type="search" placeholder="Rechercher par nom, ville, téléphone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="segmented">
            {[['0', 'Actifs'], ['1', 'Archivés'], ['all', 'Tous']].map(([v, l]) => <button key={v} className={archived === v ? 'is-on' : ''} onClick={() => setArchived(v)}>{l}</button>)}
          </div>
        </div>
        <ErrorBox error={error} />
        {data?.length === 0 && <Empty title={q ? 'Aucun médecin ne correspond à cette recherche.' : 'Aucun médecin enregistré.'} />}
        {data?.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Médecin</th><th>Ville</th><th>Téléphone</th><th>Tarif</th><th>Carnet</th><th className="num">Demandes</th><th className="num">Fiches</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => navigate(`/medecins/${d.id}`)}>
                  <td><Link to={`/medecins/${d.id}`}><strong>Dr {d.last_name} {d.first_name}</strong></Link>{d.archived ? <span className="tag">archivé</span> : null}</td>
                  <td>{d.city}</td><td>{d.phone}</td><td><span className={`tariff tariff-${d.tariff}`}>{d.tariff}</span></td>
                  <td className="mono-num">{d.carnet_numero}</td><td className="num">{d.requests_count}</td><td className="num">{d.fiches_count}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
      {creating && <DoctorFormModal onClose={() => setCreating(false)} onSaved={(d) => { setCreating(false); navigate(`/medecins/${d.id}`); }} />}
    </div>
  );
}

export function DoctorDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('requests');
  const { data: d, error, reload } = useLoad(() => api.get(`/doctors/${id}`), [id]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const archive = async () => {
    const to = !d.archived;
    if (!(await confirm({ title: to ? 'Archiver le médecin' : 'Réactiver le médecin', message: to ? 'Le médecin et son carnet seront archivés. Tout son historique est conservé et il pourra être réactivé.' : 'Le médecin et son carnet redeviendront actifs.', confirmLabel: to ? 'Archiver' : 'Réactiver', danger: to }))) return;
    try { await api.post(`/doctors/${id}/archive`, { archived: to }); toast(to ? 'Médecin archivé.' : 'Médecin réactivé.'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  const tabs = [['requests', `Demandes (${d.requests.length})`], ['fiches', `Fiches (${d.fiches.length})`], ...(can('invoices_manage', 'invoices_validate') ? [['invoices', `Factures (${d.invoices.length})`]] : [])];

  return (
    <div>
      <PageHeader title={`Dr ${d.last_name} ${d.first_name}`} sub={d.archived ? 'Médecin archivé, historique conservé' : `Tarif ${d.tariff}${d.city ? `, ${d.city}` : ''}`}>
        {can('doctors_manage') && <button className="btn" onClick={() => setEditing(true)}>Modifier</button>}
        {can('delete_archive') && <button className="btn" onClick={archive}>{d.archived ? 'Réactiver' : 'Archiver'}</button>}
        {can('requests_edit') && !d.archived && <Link className="btn btn-primary" to={`/demandes/nouvelle?doctor=${d.id}`}>Nouvelle demande</Link>}
      </PageHeader>
      <div className="detail-grid">
        <section className="card">
          <h2>Coordonnées</h2>
          <dl className="dl">
            <dt>Téléphone</dt><dd>{d.phone || '—'}</dd>
            <dt>E-mail</dt><dd>{d.email || '—'}</dd>
            <dt>Adresse</dt><dd>{[d.address, d.city].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Tarif par défaut</dt><dd><span className={`tariff tariff-${d.tariff}`}>{d.tariff}</span></dd>
            {d.notes && <><dt>Notes</dt><dd>{d.notes}</dd></>}
          </dl>
        </section>
        <section className="card carnet-card">
          <h2>Carnet</h2>
          {d.carnet ? (
            <>
              <p className="carnet-num">{d.carnet.numero}</p>
              <p className="muted">{d.fiches.length} fiche{d.fiches.length > 1 ? 's' : ''}{d.carnet.archived ? ', archivé' : ''}</p>
              {can('fiches_manage') && <div className="row-actions">
                <Link className="btn" to={`/carnets/${d.carnet.id}`}>Ouvrir le carnet</Link>
                {!d.carnet.archived && <Link className="btn btn-primary" to={`/fiches/nouvelle?doctor=${d.id}`}>Nouvelle fiche</Link>}
              </div>}
            </>
          ) : <p className="muted">Aucun carnet.</p>}
          {can('invoices_manage', 'invoices_validate') && <p className="muted small">Total facturé (factures validées) : <strong>{fmtMoney(d.total_invoiced)}</strong></p>}
        </section>
      </div>
      <section className="card">
        <div className="tabs" role="tablist">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === 'requests' && (d.requests.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Patient</th><th>Créée le</th><th>Livraison prévue</th><th>Livrée le</th><th>Statut</th><th className="num">Montant</th></tr></thead>
            <tbody>{d.requests.map((r) => (
              <tr key={r.id}><td><Link to={`/demandes/${r.id}`} className="mono-num">{r.numero}</Link></td><td>{r.patient_name}</td><td>{fmtDate(r.created_date)}</td>
                <td>{fmtDate(r.delivery_planned)}</td><td>{fmtDate(r.delivery_actual)}</td><td><StatusBadge status={r.status} /></td><td className="num">{fmtMoney(r.total)}</td></tr>
            ))}</tbody>
          </table></div>) : <p className="muted">Aucune demande.</p>)}
        {tab === 'fiches' && (d.fiches.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Date</th><th>Patient</th><th>Désignation</th><th>État</th><th>Facture</th><th className="num">Montant</th></tr></thead>
            <tbody>{d.fiches.map((f) => (
              <tr key={f.id}><td><Link to={`/fiches/${f.id}`} className="mono-num">{f.numero}</Link></td><td>{fmtDate(f.date)}</td><td>{f.patient_name}</td><td>{f.designations || '—'}</td>
                <td>{f.status === 'validee' ? 'Validée' : <span className="tag">brouillon</span>}</td><td>{f.invoice_id ? <Link to={`/factures/${f.invoice_id}`}>{f.invoice_numero || 'brouillon'}</Link> : '—'}</td><td className="num">{fmtMoney(f.total)}</td></tr>
            ))}</tbody>
          </table></div>) : <p className="muted">Aucune fiche.</p>)}
        {tab === 'invoices' && (d.invoices.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>N°</th><th>Période</th><th>État</th><th className="num">Montant</th></tr></thead>
            <tbody>{d.invoices.map((i) => (
              <tr key={i.id}><td><Link to={`/factures/${i.id}`} className="mono-num">{i.numero || `Brouillon #${i.id}`}</Link></td><td>{periodLabel(i.period)}</td><td><InvoiceState status={i.status} /></td><td className="num">{fmtMoney(i.total)}</td></tr>
            ))}</tbody>
          </table></div>) : <p className="muted">Aucune facture.</p>)}
      </section>
      {editing && <DoctorFormModal initial={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Médecin enregistré.'); reload(); }} />}
    </div>
  );
}

export function InvoiceState({ status }) {
  const l = { brouillon: 'Brouillon', validee: 'Validée', rectifiee: 'Rectifiée' }[status];
  return <span className={`inv-state inv-${status}`}>{l}</span>;
}