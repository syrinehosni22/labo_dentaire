import { fmtMoney, moneyStep, roundMoney } from '../format';

const PALETTE = ['#E9B8C4', '#B9D3E6', '#BFE0CC', '#EFD8A4', '#D5C8EC', '#F2C6A8', '#C4D9D6'];
export function makeCategoryColor(designations) {
  const cats = [...new Set(designations.map((d) => d.category || 'Autre'))];
  const byId = new Map(designations.map((d) => [d.id, d]));
  const colorOfCat = (c) => PALETTE[cats.indexOf(c || 'Autre') % PALETTE.length] || PALETTE[0];
  return { cats, colorOfCat, colorOfWork: (w) => colorOfCat(byId.get(w.designation_id)?.category) };
}

export function DesignationSelect({ designations, value, onChange, disabled, filter, required = true }) {
  const groups = {};
  for (const d of designations) {
    if (filter && !filter(d) && d.id !== value) continue;
    (groups[d.category || 'Autre'] ||= []).push(d);
  }
  return (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value) || null)} disabled={disabled} required={required}>
      <option value="">Choisir une désignation…</option>
      {Object.entries(groups).map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((d) => <option key={d.id} value={d.id} disabled={!d.active}>{d.name}{d.active ? '' : ' (désactivée)'}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export const listPrice = (des, tariff) => (des ? des[`price_${(tariff || 'A').toLowerCase()}`] : 0);

// One editable work (used for tooth works and general works)
export function WorkCard({ work, designations, tariff, canPrice, readOnly, onChange, onRemove, color, showNumbers = false, required = true }) {
  const des = designations.find((d) => d.id === work.designation_id);
  const set = (patch) => {
    const next = { ...work, ...patch };
    next.total = roundMoney((Number(next.quantity) || 0) * (Number(next.unit_price) || 0));
    onChange(next);
  };
  const changeDesignation = (id) => {
    const d = designations.find((x) => x.id === id);
    const keep = {};
    for (const p of d?.params || []) if (work.params?.[p.key] != null) keep[p.key] = work.params[p.key];
    set({ designation_id: id, designation_label: d?.name || '', unit_price: listPrice(d, tariff), params: keep });
  };
  const overridden = des && Number(work.unit_price) !== listPrice(des, tariff);
  return (
    <div className="work-card" style={{ '--work': color }}>
      <div className="work-row">
        <label className="field grow"><span className="field-label">Désignation</span>
          <DesignationSelect designations={designations} value={work.designation_id} onChange={changeDesignation} disabled={readOnly} required={required} />
        </label>
        {!readOnly && onRemove && <button type="button" className="icon-btn" onClick={onRemove} aria-label="Supprimer ce travail" title="Supprimer ce travail">×</button>}
      </div>
      {des?.params?.length > 0 && (
        <div className="work-params">
          {des.params.map((p) => (
            <label key={p.key} className="field"><span className="field-label">{p.label}</span>
              {p.type === 'select' ? (
                <select value={work.params?.[p.key] || ''} disabled={readOnly} onChange={(e) => set({ params: { ...work.params, [p.key]: e.target.value } })}>
                  <option value="">—</option>
                  {p.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input type={p.type === 'number' ? 'number' : 'text'} step="any" value={work.params?.[p.key] ?? ''} disabled={readOnly}
                  onChange={(e) => set({ params: { ...work.params, [p.key]: e.target.value } })} />
              )}
            </label>
          ))}
        </div>
      )}
      {showNumbers && <div className="work-numbers">
        <label className="field"><span className="field-label">Quantité</span>
          <input type="number" min="1" step="1" value={work.quantity} disabled={readOnly} onChange={(e) => set({ quantity: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">Prix unitaire{overridden && <em className="override-flag"> modifié</em>}</span>
          <input type="number" min="0" step={moneyStep()} value={work.unit_price} disabled={readOnly || !canPrice}
            title={canPrice ? '' : 'Prix du tarif du médecin (modification réservée)'} onChange={(e) => set({ unit_price: e.target.value })} />
        </label>
        <div className="field"><span className="field-label">Montant</span><output className="work-total">{fmtMoney(work.total)}</output></div>
      </div>}
      <label className="field"><span className="field-label">Observations</span>
        <input value={work.observations || ''} disabled={readOnly} placeholder="Précisions pour ce travail" onChange={(e) => set({ observations: e.target.value })} />
      </label>
    </div>
  );
}