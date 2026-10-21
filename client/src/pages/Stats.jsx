import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api';
import { ErrorBox, Loading, PageHeader, useLoad } from '../components/ui';
import { currentPeriod, fmtMoney, periodLabel, shortPeriod } from '../format';
import { InvoiceState } from './Doctors';

const back = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const PRESETS = [['Mois courant', 0], ['3 derniers mois', 2], ['6 derniers mois', 5], ['12 derniers mois', 11]];

export default function Stats() {
  const [range, setRange] = useState({ from: back(11), to: currentPeriod() });
  const { data: s, error } = useLoad(() => api.get(`/stats${qs(range)}`), [range.from, range.to]);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  return (
    <div>
      <PageHeader title="Statistiques" sub="Vue d'ensemble de l'activité du laboratoire." />
      <div className="card toolbar wrap">
        <div className="segmented">
          {PRESETS.map(([l, n]) => <button key={n} className={range.from === back(n) && range.to === currentPeriod() ? 'is-on' : ''} onClick={() => setRange({ from: back(n), to: currentPeriod() })}>{l}</button>)}
        </div>
        <label className="inline-field">De <input type="month" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label className="inline-field">à <input type="month" value={range.to} max={currentPeriod()} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} /></label>
      </div>
      <ErrorBox error={error} />
      {!s ? <Loading /> : (
        <>
          <div className="stat-row">
            {[['Médecins actifs', s.doctors], ['Carnets actifs', s.carnets_active], ['Fiches sur la période', s.fiches_period], ['Demandes en cours', s.requests_in_progress], ['Travaux livrés sur la période', s.delivered_period],
              ['Facturé sur la période', fmtMoney(s.series.reduce((a, x) => a + x.invoiced, 0))]].map(([l, v]) => (
              <div key={l} className="stat"><span className="stat-value">{v}</span><span className="stat-label">{l}</span></div>
            ))}
          </div>
          <div className="detail-grid">
            <section className="card chart-panel">
              <h2>Montants facturés par mois</h2>
              <p className="muted small">Factures validées ; la ligne indique le nombre de fiches créées.</p>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={s.series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={css('--line')} />
                  <XAxis dataKey="period" tickFormatter={shortPeriod} tick={{ fontSize: 12, fill: css('--muted') }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="m" tick={{ fontSize: 12, fill: css('--muted') }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
                  <YAxis yAxisId="n" orientation="right" hide />
                  <Tooltip formatter={(v, n) => (n === 'Facturé' ? fmtMoney(v) : v)} labelFormatter={periodLabel} />
                  <Bar yAxisId="m" dataKey="invoiced" name="Facturé" fill={css('--accent')} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Line yAxisId="n" dataKey="fiches" name="Fiches" stroke={css('--ink')} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </section>
            <section className="card chart-panel">
              <h2>Facturé par médecin</h2>
              {s.by_doctor.length === 0 ? <p className="muted">Aucune facture validée sur la période.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(160, s.by_doctor.length * 38)}>
                  <BarChart data={s.by_doctor} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="doctor_name" width={140} tick={{ fontSize: 12, fill: css('--ink') }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Bar dataKey="total" name="Facturé" fill={css('--ink-2')} radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>
          </div>
          <section className="card">
            <h2>Factures de {periodLabel(s.current_month.period)}</h2>
            {s.current_month.invoices.length === 0 ? <p className="muted">Aucune facture ce mois-ci. <Link to="/factures">Préparer les factures</Link></p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>N°</th><th>Médecin</th><th>État</th><th className="num">Montant</th></tr></thead>
                <tbody>{s.current_month.invoices.map((i) => <tr key={i.id}><td><Link to={`/factures/${i.id}`}>{i.numero || `Brouillon #${i.id}`}</Link></td><td>Dr {i.doctor_name}</td><td><InvoiceState status={i.status} /></td><td className="num">{fmtMoney(i.total)}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
