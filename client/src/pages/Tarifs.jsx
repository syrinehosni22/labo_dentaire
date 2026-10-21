import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Field, Modal, PageHeader, useLoad, useUi } from '../components/ui';
import { fmtDate, fmtMoney, moneyStep } from '../format';

const EMPTY = { name: '', category: '', price_a: '', price_b: '', price_c: '', params: [], per_tooth: true, active: true };

function DesignationModal({ initial, categories, onClose, onSaved }) {
  const [f, setF] = useState(initial ? { ...initial, params: initial.params.map((p) => ({ ...p, options: (p.options || []).join(', ') })) } : EMPTY);
  const [error, setError] = useState(null);
  const { data: history } = useLoad(() => (initial ? api.get(`/designations/${initial.id}/history`) : Promise.resolve([])), [initial?.id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setParam = (i, patch) => setF((x) => ({ ...x, params: x.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const body = { ...f, params: f.params.map((p) => ({ ...p, options: p.type === 'select' ? p.options : undefined })) };
      const r = initial ? await api.put(`/designations/${initial.id}`, body) : await api.post('/designations', body);
      onSaved(r);
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={initial ? 'Modifier la désignation' : 'Nouvelle désignation'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Désignation"><input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Catégorie"><input list="cats" value={f.category || ''} onChange={set('category')} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          {['a', 'b', 'c'].map((l) => (
            <Field key={l} label={`Prix tarif ${l.toUpperCase()}`}><input type="number" required min="0" step={moneyStep()} value={f[`price_${l}`]} onChange={set(`price_${l}`)} /></Field>
          ))}
          <label className="check span-all"><input type="checkbox" checked={f.per_tooth} onChange={set('per_tooth')} /> Travail associé à une dent (sinon : travail général, ex. prothèse complète)</label>
          {initial && <label className="check span-all"><input type="checkbox" checked={f.active} onChange={set('active')} /> Désignation active (décochez pour ne plus la proposer ; l'historique est conservé)</label>}
        </div>
        <h3 className="sub-h">Paramètres techniques</h3>
        <p className="muted small">Informations demandées lors de la saisie de ce travail (teinte, matériau…). Pour une liste, séparez les choix par des virgules.</p>
        {f.params.map((p, i) => (
          <div className="param-row" key={i}>
            <input placeholder="Libellé" value={p.label} onChange={(e) => setParam(i, { label: e.target.value })} aria-label="Libellé du paramètre" required />
            <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value })} aria-label="Type">
              <option value="select">Liste de choix</option><option value="text">Texte libre</option><option value="number">Nombre</option>
            </select>
            {p.type === 'select' ? <input className="grow" placeholder="A1, A2, A3…" value={p.options || ''} onChange={(e) => setParam(i, { options: e.target.value })} aria-label="Choix" /> : <span className="grow" />}
            <button type="button" className="icon-btn" onClick={() => setF((x) => ({ ...x, params: x.params.filter((_, j) => j !== i) }))} aria-label="Retirer ce paramètre">×</button>
          </div>
        ))}
        <button type="button" className="btn btn-dashed btn-small" onClick={() => setF((x) => ({ ...x, params: [...x.params, { label: '', type: 'select', options: '' }] }))}>Ajouter un paramètre</button>
        {history?.length > 0 && (
          <>
            <h3 className="sub-h">Historique des prix</h3>
            <ul className="history-list">
              {history.map((h) => <li key={h.id}><span className="muted">{fmtDate(h.at.slice(0, 10))}</span> Tarif {h.list} : {fmtMoney(h.old_price)} → <strong>{fmtMoney(h.new_price)}</strong> <span className="muted">({h.user_name})</span></li>)}
            </ul>
          </>
        )}
        <p className="muted small">Les nouveaux prix s'appliquent aux prochaines saisies ; les fiches et factures existantes gardent leurs montants.</p>
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

export default function Tarifs() {
  const { can } = useAuth();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const { data, error, reload } = useLoad(() => api.get('/designations?all=1'), []);
  const canEdit = can('prices_edit');
  const categories = [...new Set((data || []).map((d) => d.category).filter(Boolean))];
  const list = (data || []).filter((d) => (showInactive || d.active) && `${d.name} ${d.category}`.toLowerCase().includes(q.toLowerCase()));
  const grouped = list.reduce((acc, d) => { (acc[d.category || 'Autre'] ||= []).push(d); return acc; }, {});

  return (
    <div>
      <PageHeader title="Listes de prix A, B et C" sub="Chaque médecin est rattaché à l'une des trois listes.">
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing('new')}>Nouvelle désignation</button>}
      </PageHeader>
      <section className="card list-card">
        <div className="toolbar">
          <input className="search" type="search" placeholder="Rechercher une désignation…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Afficher les désignations désactivées</label>
        </div>
        <ErrorBox error={error} />
        {data && list.length === 0 && <Empty title="Aucune désignation." />}
        {list.length > 0 && (
          <div className="table-wrap"><table className="table tarif-table">
            <thead><tr><th>Désignation</th><th className="num">Tarif A</th><th className="num">Tarif B</th><th className="num">Tarif C</th><th>Paramètres techniques</th>{canEdit && <th />}</tr></thead>
            {Object.entries(grouped).map(([cat, ds]) => (
              <tbody key={cat}>
                <tr className="group-row"><th colSpan={canEdit ? 6 : 5}>{cat}</th></tr>
                {ds.map((d) => (
                  <tr key={d.id} className={d.active ? '' : 'is-inactive'}>
                    <td><strong>{d.name}</strong>{!d.active && <span className="tag">désactivée</span>}{!d.per_tooth && <span className="tag tag-soft">général</span>}</td>
                    <td className="num">{fmtMoney(d.price_a)}</td><td className="num">{fmtMoney(d.price_b)}</td><td className="num">{fmtMoney(d.price_c)}</td>
                    <td className="small muted">{d.params.map((p) => p.label).join(', ') || '—'}</td>
                    {canEdit && <td><button className="btn btn-small" onClick={() => setEditing(d)}>Modifier</button></td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table></div>
        )}
      </section>
      {editing && <DesignationModal initial={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); toast('Désignation enregistrée.'); reload(); }} />}
    </div>
  );
}
