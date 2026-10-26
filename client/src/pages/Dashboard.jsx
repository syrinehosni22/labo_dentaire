import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DoctorSelect, Empty, ErrorBox, PageHeader, Pagination, useUi } from '../components/ui';
import { STATUS, STATUS_KEYS, fmtDate, hasTime, parseLocal, relDay, todayISO } from '../format';

const SORTS = [
  ['priority', 'Priorité (urgences en premier)'], ['created_date', 'Date de création'], ['try1_date', 'Premier essayage'], ['try2_date', 'Deuxième essayage'],
  ['delivery_planned', 'Livraison prévue'], ['delivery_actual', 'Livraison effective'], ['patient', 'Nom du patient'], ['doctor', 'Nom du médecin'], ['status', 'Statut'],
];
const DATE_FIELDS = [['created', 'Création'], ['try', 'Essayage (1 ou 2)'], ['try1', 'Premier essayage'], ['try2', 'Deuxième essayage'], ['delivery_planned', 'Livraison prévue'], ['delivery_actual', 'Livraison effective']];
const FILTER_KEYS = ['q', 'status', 'doctor_id', 'patient', 'numero', 'overdue', 'near', 'designation_id', ...DATE_FIELDS.flatMap(([k]) => [`${k}_from`, `${k}_to`])];

function monthBounds(p) {
  const [y, m] = p.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const to = `${p}-${String(last).padStart(2, '0')}`;
  return { from: `${p}-01`, to: to > todayISO() && p === todayISO().slice(0, 7) ? todayISO() : to };
}

export default function Dashboard() {
  const { can } = useAuth();
  const { toast } = useUi();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [error, setError] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => k !== 'q' && k !== 'status' && sp.get(k)));
  const [kpiPeriod, setKpiPeriod] = useState(todayISO().slice(0, 7));
  const [search, setSearch] = useState(sp.get('q') || '');
  const [dateField, setDateField] = useState(() => DATE_FIELDS.find(([k]) => sp.get(`${k}_from`) || sp.get(`${k}_to`))?.[0] || 'created');

  const params = Object.fromEntries(sp.entries());
  const page = Number(params.page) || 1;
  const pageSize = Number(params.page_size) || 10;
  const statuses = (params.status || '').split(',').filter(Boolean);
  const activeFilterCount = FILTER_KEYS.filter((k) => params[k]).length;

  const set = (patch, resetPage = true) => {
    const next = { ...params, ...patch, ...(resetPage ? { page: '' } : {}) };
    setSp(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v != null)), { replace: true });
  };

  const reload = () => {
    api.get(`/requests${qs(params)}`).then((d) => { setData(d); setError(null); if (d.page !== page && page > 1) set({ page: d.page }, false); }).catch((e) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [sp]);
  useEffect(() => { api.get(`/requests/kpis${qs(monthBounds(kpiPeriod))}`).then(setKpis).catch(() => {}); }, [kpiPeriod, data]);
  useEffect(() => { api.get('/doctors?archived=all').then(setDoctors); api.get('/designations?all=1').then(setDesignations); }, []);
  useEffect(() => { const t = setTimeout(() => { if ((sp.get('q') || '') !== search) set({ q: search }); }, 300); return () => clearTimeout(t); }, [search]); // eslint-disable-line

  const updateStatus = async (r, status) => {
    try {
      const res = await api.post(`/requests/${r.id}/status`, { status });
      toast(`${r.numero} : ${STATUS[status].label}.`);
      const df = res?.delivery_fiche;
      if (df?.error) toast(df.error, 'error');
      else if (df) toast(`Fiche ${df.numero} ${df.action === 'creee' ? 'créée et validée' : 'validée'} : prête à facturer.`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const kpiCards = useMemo(() => kpis && [
    { key: 'in_progress', label: 'Demandes en cours', value: kpis.in_progress, filter: { status: 'en_cours,attente_essayage' }, tone: 'en_cours' },
    { key: 'tries_today', label: "Essayages aujourd'hui", value: kpis.tries_today, filter: { try_from: todayISO(), try_to: todayISO(), status: 'en_cours,attente_essayage' }, tone: 'attente_essayage' },
    { key: 'tries_upcoming', label: 'Essayages à venir', value: kpis.tries_upcoming, filter: { try_from: todayISO(), status: 'en_cours,attente_essayage', sort: 'priority' }, tone: 'attente_essayage' },
    { key: 'tries_overdue', label: 'Essayages en retard', value: kpis.tries_overdue, filter: { overdue: '1', status: 'en_cours,attente_essayage' }, tone: 'late' },
    { key: 'ready', label: 'Prêts à livrer', value: kpis.ready_to_deliver, filter: { status: 'a_livrer' }, tone: 'a_livrer' },
    { key: 'delivered', label: 'Livrées', value: kpis.delivered_period, filter: { status: 'livree', delivery_actual_from: kpis.period.from, delivery_actual_to: kpis.period.to }, tone: 'livree', period: true },
  ], [kpis]);

  const applyKpi = (k) => {
    setSearch('');
    const clean = Object.fromEntries(FILTER_KEYS.map((f) => [f, '']));
    if (k.filter.try_from) setDateField('try');
    if (k.filter.delivery_actual_from) setDateField('delivery_actual');
    set({ ...clean, sort: '', ...k.filter });
  };

  const resetFilters = () => { setSearch(''); setSp(pageSize !== 10 ? { page_size: String(pageSize) } : {}, { replace: true }); };

  return (
    <div>
      <PageHeader title="Suivi des demandes" sub="Les essayages et livraisons les plus proches apparaissent en premier.">
        {can('requests_edit') && <Link to="/demandes/nouvelle" className="btn btn-primary">Nouvelle demande</Link>}
      </PageHeader>

      <section className="shade-guide" aria-label="Indicateurs">
        {kpiCards?.map((k) => (
          <div key={k.key} className={`shade tone-${k.tone}`}>
            <button className="shade-btn" onClick={() => applyKpi(k)} title="Afficher ces demandes">
              <span className="shade-cap" />
              <span className="shade-value">{k.value}</span>
              <span className="shade-label">{k.label}</span>
            </button>
            {k.period && (
              <input className="shade-period" type="month" value={kpiPeriod} max={todayISO().slice(0, 7)} onChange={(e) => e.target.value && setKpiPeriod(e.target.value)} aria-label="Période des livraisons" />
            )}
          </div>
        ))}
      </section>

      <section className="card list-card">
        <div className="toolbar">
          <input className="search" type="search" placeholder="Rechercher : n°, patient, médecin, travail…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Recherche" />
          <div className="chips" role="group" aria-label="Filtrer par statut">
            {STATUS_KEYS.map((s) => (
              <button key={s} className={`chip status-${s} ${statuses.includes(s) ? 'is-on' : ''}`} aria-pressed={statuses.includes(s)}
                onClick={() => set({ status: (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') })}>
                {STATUS[s].label}
              </button>
            ))}
            <button className={`chip chip-late ${params.overdue ? 'is-on' : ''}`} aria-pressed={!!params.overdue} onClick={() => set({ overdue: params.overdue ? '' : '1' })}>En retard</button>
            <button className={`chip ${params.near ? 'is-on' : ''}`} aria-pressed={!!params.near} onClick={() => set({ near: params.near ? '' : '1' })}>Échéance proche</button>
          </div>
          <div className="toolbar-right">
            <button className={`btn btn-small ${showFilters ? 'is-on' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>Plus de filtres</button>
            {activeFilterCount > 0 && <button className="btn btn-small btn-ghost" onClick={resetFilters}>Réinitialiser ({activeFilterCount})</button>}
          </div>
        </div>

        {showFilters && (
          <div className="filters">
            <div className="field"><span className="field-label">Médecin</span>
              <div className="combo-clear"><DoctorSelect doctors={doctors} includeArchived value={params.doctor_id || ''} onChange={(v) => set({ doctor_id: v })} placeholder="Tous les médecins" />
                {params.doctor_id && <button className="icon-btn" onClick={() => set({ doctor_id: '' })} aria-label="Retirer le filtre médecin">×</button>}</div>
            </div>
            <label className="field"><span className="field-label">Patient</span><input value={params.patient || ''} onChange={(e) => set({ patient: e.target.value })} /></label>
            <label className="field"><span className="field-label">N° de demande</span><input value={params.numero || ''} onChange={(e) => set({ numero: e.target.value })} /></label>
            <label className="field"><span className="field-label">Nature des travaux</span>
              <select value={params.designation_id || ''} onChange={(e) => set({ designation_id: e.target.value })}>
                <option value="">Toutes</option>
                {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <div className="field date-filter"><span className="field-label">Période sur la date de</span>
              <div className="date-filter-row">
                <select value={dateField} onChange={(e) => {
                  const nf = e.target.value; const f = params[`${dateField}_from`] || ''; const t = params[`${dateField}_to`] || '';
                  setDateField(nf); set({ [`${dateField}_from`]: '', [`${dateField}_to`]: '', [`${nf}_from`]: f, [`${nf}_to`]: t });
                }}>
                  {DATE_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input type="date" aria-label="Du" value={params[`${dateField}_from`] || ''} onChange={(e) => set({ [`${dateField}_from`]: e.target.value })} />
                <span>au</span>
                <input type="date" aria-label="Au" value={params[`${dateField}_to`] || ''} onChange={(e) => set({ [`${dateField}_to`]: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        <div className="sortbar">
          <label>Trier par
            <select value={params.sort || 'priority'} onChange={(e) => set({ sort: e.target.value === 'priority' ? '' : e.target.value })}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          {params.sort && (
            <button className="btn btn-small" onClick={() => set({ dir: params.dir === 'desc' ? '' : 'desc' })} aria-label="Inverser l'ordre">
              {params.dir === 'desc' ? 'Décroissant' : 'Croissant'}
            </button>
          )}
        </div>

        <ErrorBox error={error} />
        {data && data.items.length === 0 && (
          <Empty title={activeFilterCount ? 'Aucune demande ne correspond à ces critères.' : 'Aucune demande enregistrée.'}>
            {activeFilterCount ? <button className="btn" onClick={resetFilters}>Réinitialiser les filtres</button>
              : can('requests_edit') && <Link className="btn btn-primary" to="/demandes/nouvelle">Créer la première demande</Link>}
          </Empty>
        )}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table requests-table">
              <thead>
                <tr><th>N°</th><th>Patient</th><th>Médecin</th><th>Travaux</th><th>Essayage 1</th><th>Essayage 2</th><th>Livraison</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className={`clickable ${r.overdue ? 'is-overdue' : ''} ${r.near ? 'is-near' : ''}`} onClick={(e) => { if (!e.target.closest('select,a,button')) navigate(`/demandes/${r.id}`); }}>
                    <td><Link to={`/demandes/${r.id}`} className="mono-num">{r.numero}</Link></td>
                    <td className="nowrap"><strong>{r.patient_name}</strong></td>
                    <td className="nowrap">Dr {r.doctor_name}</td>
                    <td className="works-cell" title={r.works_summary}>{r.works_summary ? r.works_summary.split(',').join(', ') : <span className="muted">—</span>}</td>
                    <DateCell value={r.try1_date} done={r.try1_done} active={['en_cours', 'attente_essayage'].includes(r.status)} />
                    <DateCell value={r.try2_date} done={r.try2_done} active={['en_cours', 'attente_essayage'].includes(r.status)} />
                    {r.delivery_actual ? (
                      <td className="date-cell"><span>{fmtDate(r.delivery_actual)}</span><small>livrée{r.delivery_planned ? `, prévue le ${fmtDate(r.delivery_planned, { withTime: false })}` : ''}</small></td>
                    ) : <DateCell value={r.delivery_planned} active={r.status !== 'livree'} />}
                    <td>
                      {can('status_update') && r.status !== 'livree' ? (
                        <select className={`status-select status-${r.status}`} value={r.status} onChange={(e) => updateStatus(r, e.target.value)} aria-label={`Statut de ${r.numero}`}>
                          {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                        </select>
                      ) : <span className={`status status-${r.status}`}>{STATUS[r.status].label}</span>}
                    </td>
                    <td><Link to={`/demandes/${r.id}`} className="btn btn-small">Ouvrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size} noun="demande"
            onPage={(p) => set({ page: p }, false)} onPageSize={(n) => set({ page_size: n })} />
        )}
      </section>
    </div>
  );
}

function isPast(s) {
  const d = parseLocal(s);
  if (!hasTime(s)) d.setDate(d.getDate() + 1);
  return d <= new Date();
}

function DateCell({ value, done, active }) {
  if (!value) return <td className="date-cell"><span className="muted">—</span></td>;
  const lateNow = active && !done && isPast(value);
  return (
    <td className={`date-cell ${lateNow ? 'is-late' : ''} ${done ? 'is-done' : ''}`}>
      <span>{fmtDate(value)}</span>
      {done ? <small>effectué</small> : active && <small>{lateNow ? 'dépassé' : relDay(value)}</small>}
    </td>
  );
}