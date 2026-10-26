import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import DentalChart, { isTemporary } from '../components/DentalChart';
import { WorkCard, makeCategoryColor, listPrice } from '../components/WorkFields';
import { DoctorSelect, ErrorBox, Field, Loading, PageHeader, StatusBadge, useUi } from '../components/ui';
import { STATUS, STATUS_KEYS, fmtDate, relDay, roundMoney, todayISO } from '../format';

let keySeq = 1;
const withKey = (w) => ({ ...w, _k: keySeq++ });

// Date + optional time, stored as 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'
function DateTimeInput({ value, onChange, disabled, id }) {
  const [d, t] = (value || '').split('T');
  return (
    <div className="datetime">
      <input id={id} type="date" value={d || ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? (t ? `${e.target.value}T${t}` : e.target.value) : '')} />
      <input type="time" value={t || ''} disabled={disabled || !d} aria-label="Heure (facultative)" onChange={(e) => onChange(e.target.value ? `${d}T${e.target.value}` : d)} />
    </div>
  );
}

const EMPTY = { patient_name: '', doctor_id: '', created_date: todayISO(), try1_date: '', try2_date: '', delivery_planned: '', delivery_actual: '', observations: '', status: 'en_cours', works: [] };

export default function RequestForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { can, user } = useAuth();
  const { toast, confirm } = useUi();

  const [doctors, setDoctors] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [req, setReq] = useState(isNew ? EMPTY : null);
  const [form, setForm] = useState(isNew ? { ...EMPTY, created_date: todayISO(), doctor_id: Number(sp.get('doctor')) || '' } : null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState([]);
  const [clipboard, setClipboard] = useState(null);
  const [mode, setMode] = useState('permanent');
  const [multi, setMulti] = useState(false);
  const [groupWork, setGroupWork] = useState(null);

  const load = useCallback(async () => {
    const [docs, des] = await Promise.all([api.get('/doctors?archived=all'), api.get('/designations?all=1')]);
    setDoctors(docs); setDesignations(des);
    if (!isNew) {
      const r = await api.get(`/requests/${id}`);
      const f = { ...r, works: r.works.map(withKey) };
      setReq(r); setForm(f); setDirty(false);
      if (r.works.some((w) => w.tooth && isTemporary(w.tooth))) setMode(r.works.some((w) => w.tooth && !isTemporary(w.tooth)) ? 'mixed' : 'temporary');
    }
  }, [id, isNew]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const doctor = doctors.find((d) => String(d.id) === String(form?.doctor_id));
  const tariff = doctor?.tariff || 'A';
  const lockedDelivered = req?.status === 'livree' && user.role !== 'admin';
  const readOnly = !can('requests_edit') || lockedDelivered;
  const canPrice = can('price_override');
  const colors = useMemo(() => makeCategoryColor(designations), [designations]);

  const update = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setWorks = (fn) => { setForm((f) => ({ ...f, works: fn(f.works) })); setDirty(true); };

  // When the doctor changes, re-price works from the new tariff (unless manually overridden)
  const changeDoctor = (docId) => {
    const nd = doctors.find((d) => d.id === docId);
    setForm((f) => {
      const old = doctors.find((d) => String(d.id) === String(f.doctor_id));
      const works = f.works.map((w) => {
        const des = designations.find((d) => d.id === w.designation_id);
        if (!des || !nd || (old && Number(w.unit_price) !== listPrice(des, old.tariff))) return w;
        const unit = listPrice(des, nd.tariff);
        return { ...w, unit_price: unit, total: roundMoney(unit * w.quantity) };
      });
      return { ...f, doctor_id: docId, works };
    });
    setDirty(true);
  };

  const worksByTooth = useMemo(() => {
    const m = new Map();
    for (const w of form?.works || []) if (w.tooth) m.set(w.tooth, [...(m.get(w.tooth) || []), w]);
    return m;
  }, [form?.works]);

  const onToothClick = (n, e) => {
    if (multi || e.ctrlKey || e.metaKey || e.shiftKey) setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
    else setSelected((s) => (s.length === 1 && s[0] === n ? [] : [n]));
  };

  const newWork = (tooth, des) => withKey({
    tooth, designation_id: des?.id || null, designation_label: des?.name || '', params: {}, quantity: 1,
    unit_price: des ? listPrice(des, tariff) : 0, total: des ? listPrice(des, tariff) : 0, observations: '',
  });

  const addWorkToSelection = () => {
    if (!selected.length) return;
    setWorks((ws) => [...ws, ...selected.map((t) => newWork(t))]);
  };

  // Same designation (with its parameters) added in one go to every selected tooth
  const applyGroupWork = () => {
    const g = groupWork;
    if (!g?.designation_id) { toast('Choisissez la désignation à ajouter.', 'error'); return; }
    if (!form.doctor_id) { toast("Choisissez d'abord le médecin.", 'error'); return; }
    const des = designations.find((d) => d.id === g.designation_id);
    const unit = listPrice(des, tariff);
    const teeth = [...selected].sort((a, b) => a - b);
    setWorks((ws) => [...ws, ...teeth.map((t) => withKey({ tooth: t, designation_id: g.designation_id, designation_label: g.designation_label, params: { ...(g.params || {}) }, quantity: 1, unit_price: unit, total: unit, observations: g.observations || '' }))]);
    toast(`${g.designation_label} ajouté${teeth.length > 1 ? ` aux dents ${teeth.join(', ')}` : ` à la dent ${teeth[0]}`}.`);
    setGroupWork(null);
  };

  /* ---- copy / paste between teeth ---- */
  const copy = useCallback(() => {
    if (selected.length !== 1) { toast('Sélectionnez une seule dent à copier.', 'error'); return; }
    const src = selected[0];
    const ws = worksByTooth.get(src) || [];
    if (!ws.length) { toast(`La dent ${src} n'a aucun travail à copier.`, 'error'); return; }
    setClipboard({ from: src, works: ws.map(({ designation_id, designation_label, params, quantity, unit_price, total }) => ({ designation_id, designation_label, params: { ...params }, quantity, unit_price, total })) });
    toast(`${ws.length} travail${ws.length > 1 ? 'x' : ''} de la dent ${src} copié${ws.length > 1 ? 's' : ''}. Sélectionnez une autre dent puis collez.`);
  }, [selected, worksByTooth, toast]);

  const paste = useCallback(async () => {
    if (!clipboard) { toast("Rien à coller : copiez d'abord les travaux d'une dent.", 'error'); return; }
    const targets = selected.filter((t) => t !== clipboard.from);
    if (!targets.length) { toast('Sélectionnez la ou les dents de destination.', 'error'); return; }
    const occupied = targets.filter((t) => worksByTooth.get(t)?.length);
    let how = 'add';
    if (occupied.length) {
      how = await confirm({
        title: 'Coller les travaux',
        message: `${occupied.length > 1 ? `Les dents ${occupied.join(', ')} ont` : `La dent ${occupied[0]} a`} déjà des travaux. Voulez-vous ajouter les travaux copiés de la dent ${clipboard.from} ou remplacer les travaux existants ?`,
        actions: [{ value: 'add', label: 'Ajouter aux travaux existants', primary: true }, { value: 'replace', label: 'Remplacer les travaux', danger: true }],
      });
      if (!how) return;
    }
    setWorks((ws) => [
      ...ws.filter((w) => !(how === 'replace' && targets.includes(w.tooth))),
      ...targets.flatMap((t) => clipboard.works.map((w) => withKey({ ...w, tooth: t, observations: '' }))),
    ]);
    toast(`Travaux de la dent ${clipboard.from} ${how === 'replace' ? 'remplacés' : 'ajoutés'} sur ${targets.length > 1 ? `les dents ${targets.join(', ')}` : `la dent ${targets[0]}`}.`);
  }, [clipboard, selected, worksByTooth, confirm, toast, setWorks]);

  useEffect(() => {
    if (readOnly) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]') || window.getSelection()?.toString()) return;
      if (!(e.ctrlKey || e.metaKey)) { if (e.key === 'Escape') setSelected([]); return; }
      const k = e.key.toLowerCase();
      if (k === 'c') { e.preventDefault(); copy(); }
      if (k === 'v') { e.preventDefault(); paste(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [copy, paste, readOnly]);

  /* ---- save & actions ---- */
  const payload = () => ({
    ...form,
    works: form.works.map(({ _k, ...w }) => w),
  });

  const save = async (e) => {
    e?.preventDefault();
    setError(null);
    const bad = form.works.find((w) => !w.designation_id);
    if (bad) { setError(`Choisissez une désignation pour chaque travail${bad.tooth ? ` (dent ${bad.tooth})` : ''}.`); return; }
    setSaving(true);
    try {
      const r = isNew ? await api.post('/requests', payload()) : await api.put(`/requests/${id}`, payload());
      setDirty(false);
      toast(isNew ? `Demande ${r.numero} créée.` : 'Demande enregistrée.');
      deliveryToast(r.delivery_fiche);
      if (isNew) navigate(`/demandes/${r.id}`, { replace: true });
      else { setReq(r); setForm({ ...r, works: r.works.map(withKey) }); }
    } catch (err) { setError(err.message); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setSaving(false); }
  };

  const deliveryToast = (df) => {
    if (!df) return;
    if (df.error) toast(df.error, 'error');
    else toast(df.action === 'creee' ? `Fiche ${df.numero} créée et validée : prête à facturer.` : `Fiche ${df.numero} validée : prête à facturer.`);
  };

  const changeStatus = async (status) => {
    if (dirty && !(await confirm({ title: 'Modifications non enregistrées', message: 'Enregistrez d\'abord vos modifications, ou continuez pour les abandonner.', confirmLabel: 'Continuer sans enregistrer', danger: true }))) return;
    try {
      const r = await api.post(`/requests/${id}/status`, { status });
      setReq(r); setForm({ ...r, works: r.works.map(withKey) }); setDirty(false);
      toast(`Statut : ${STATUS[status].label}.`);
      deliveryToast(r.delivery_fiche);
    } catch (err) { toast(err.message, 'error'); }
  };

  const markTry = async (which, done) => {
    try {
      const r = await api.post(`/requests/${id}/try`, { which, done });
      setReq(r); setForm({ ...r, works: r.works.map(withKey) }); setDirty(false);
      toast(done ? `${which === 1 ? 'Premier' : 'Deuxième'} essayage marqué comme effectué.` : 'Essayage marqué non effectué.');
    } catch (err) { toast(err.message, 'error'); }
  };

  const makeFiche = async () => {
    if (!(await confirm({ title: 'Créer une fiche de travaux', message: `Les travaux de cette demande seront reportés sur une fiche en brouillon dans le carnet du Dr ${req.doctor_name}.`, confirmLabel: 'Créer la fiche' }))) return;
    try { const f = await api.post(`/requests/${id}/fiche`, {}); toast(`Fiche ${f.numero} créée.`); navigate(`/fiches/${f.id}`); } catch (err) { toast(err.message, 'error'); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer la demande', message: `La demande ${req.numero} sera retirée du suivi. Cette action est tracée dans l'historique.`, confirmLabel: 'Supprimer la demande', danger: true }))) return;
    try { await api.del(`/requests/${id}`); toast('Demande supprimée.'); navigate('/'); } catch (err) { toast(err.message, 'error'); }
  };

  if (!form) return error ? <ErrorBox error={error} /> : <Loading />;

  const selWorks = selected.length === 1 ? form.works.filter((w) => w.tooth === selected[0]) : [];
  const generalWorks = form.works.filter((w) => !w.tooth);
  const updateWork = (k, next) => setWorks((ws) => ws.map((w) => (w._k === k ? next : w)));
  const removeWork = (k) => setWorks((ws) => ws.filter((w) => w._k !== k));

  return (
    <form onSubmit={save} className="request-page">
      <PageHeader
        title={isNew ? 'Nouvelle demande' : `Demande ${req.numero}`}
        sub={isNew ? 'Patient, médecin, échéances et travaux dent par dent.' : <>Créée le {fmtDate(req.created_date)}{req.doctor_name && <> pour le Dr <Link to={`/medecins/${req.doctor_id}`}>{req.doctor_name}</Link></>}</>}
      >
        {!isNew && <StatusBadge status={req.status} overdue={req.overdue} />}
        {!readOnly && <button className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : isNew ? 'Créer la demande' : 'Enregistrer'}</button>}
      </PageHeader>
      <ErrorBox error={error} />
      {lockedDelivered && <div className="info-box">Cette demande est livrée : elle est en lecture seule. Un administrateur peut la modifier si nécessaire.</div>}
      {dirty && !readOnly && <div className="dirty-bar">Modifications non enregistrées</div>}

      {!isNew && can('status_update') && !lockedDelivered && (
        <section className="card status-strip" aria-label="Statut de la demande">
          <div className="status-steps">
            {STATUS_KEYS.map((s) => (
              <button type="button" key={s} className={`status-step status-${s} ${req.status === s ? 'is-current' : ''}`} onClick={() => changeStatus(s)} aria-pressed={req.status === s}>
                {STATUS[s].label}
              </button>
            ))}
          </div>
          <div className="status-extra">
            {[1, 2].map((n) => req[`try${n}_date`] && req.status !== 'livree' && (
              <label key={n} className="check">
                <input type="checkbox" checked={!!req[`try${n}_done`]} onChange={(e) => markTry(n, e.target.checked)} />
                Essayage {n} effectué ({fmtDate(req[`try${n}_date`])})
              </label>
            ))}
            {can('fiches_manage') && req.works.length > 0 && (
              req.fiches.length ? <span className="muted">Fiche : {req.fiches.map((f) => <Link key={f.id} to={`/fiches/${f.id}`}>{f.numero}</Link>)}</span>
                : <button type="button" className="btn btn-small" onClick={makeFiche}>Créer la fiche de travaux</button>
            )}
          </div>
        </section>
      )}

      <section className="card form-grid">
        <Field label="Nom du patient"><input required value={form.patient_name} disabled={readOnly} onChange={(e) => update({ patient_name: e.target.value })} autoFocus={isNew} /></Field>
        <div className="field"><span className="field-label">Médecin prescripteur</span>
          <DoctorSelect doctors={doctors} value={form.doctor_id} onChange={changeDoctor} disabled={readOnly} required />
          {doctor && <span className="field-hint">Tarif {doctor.tariff} appliqué aux nouveaux travaux</span>}
        </div>
        <Field label="Date de création"><input type="date" required value={form.created_date} disabled={readOnly} onChange={(e) => update({ created_date: e.target.value })} /></Field>
        <div className="field"><span className="field-label">Premier essayage (facultatif)</span><DateTimeInput value={form.try1_date} disabled={readOnly} onChange={(v) => update({ try1_date: v })} />
          {form.try1_date && <span className="field-hint">{relDay(form.try1_date)}</span>}</div>
        <div className="field"><span className="field-label">Deuxième essayage (facultatif)</span><DateTimeInput value={form.try2_date} disabled={readOnly} onChange={(v) => update({ try2_date: v })} />
          {form.try2_date && <span className="field-hint">{relDay(form.try2_date)}</span>}</div>
        <div className="field"><span className="field-label">Livraison prévue</span><DateTimeInput value={form.delivery_planned} disabled={readOnly} onChange={(v) => update({ delivery_planned: v })} />
          {form.delivery_planned && <span className="field-hint">{relDay(form.delivery_planned)}</span>}</div>
        {!isNew && <div className="field"><span className="field-label">Livraison effective</span><DateTimeInput value={form.delivery_actual} disabled={readOnly} onChange={(v) => update({ delivery_actual: v })} /></div>}
        <Field label="Observations et instructions" className="span-all"><textarea rows={2} value={form.observations || ''} disabled={readOnly} onChange={(e) => update({ observations: e.target.value })} /></Field>
      </section>

      <section className="card chart-card">
        <div className="chart-head">
          <h2>Travaux par dent</h2>
          <div className="segmented" role="radiogroup" aria-label="Dentition affichée">
            {[['permanent', 'Permanentes'], ['temporary', 'Temporaires'], ['mixed', 'Mixte']].map(([v, l]) => (
              <button type="button" key={v} role="radio" aria-checked={mode === v} className={mode === v ? 'is-on' : ''} onClick={() => setMode(v)}>{l}</button>
            ))}
          </div>
        </div>
        {!readOnly && (
          <div className="chart-toolbar">
            <button type="button" className={`btn btn-small ${multi ? 'btn-primary' : ''}`} aria-pressed={multi} onClick={() => setMulti((m) => !m)}>Sélection multiple{multi ? ' : activée' : ''}</button>
            <button type="button" className="btn btn-small" onClick={copy} disabled={selected.length !== 1}>Copier <kbd>Ctrl C</kbd></button>
            <button type="button" className="btn btn-small" onClick={paste} disabled={!clipboard}>Coller <kbd>Ctrl V</kbd></button>
            <button type="button" className="btn btn-small" onClick={() => setSelected([])} disabled={!selected.length}>Désélectionner</button>
            <span className="chart-hint">
              {clipboard ? `Presse-papiers : dent ${clipboard.from} (${clipboard.works.length} travail${clipboard.works.length > 1 ? 'x' : ''})` : multi ? 'Cliquez sur les dents pour les ajouter ou les retirer de la sélection' : 'Activez « Sélection multiple » (ou Ctrl + clic) pour choisir plusieurs dents'}
            </span>
          </div>
        )}
        <div className="chart-layout">
          <div className="chart-wrap">
            <DentalChart mode={mode} worksByTooth={worksByTooth} categoryColor={colors.colorOfWork} selected={selected} copiedFrom={clipboard?.from} onToothClick={onToothClick} readOnly={readOnly} />
            <ul className="chart-legend">
              {colors.cats.map((c) => <li key={c}><span style={{ background: colors.colorOfCat(c) }} />{c}</li>)}
            </ul>
          </div>
          <div className="tooth-panel">
            {selected.length === 0 && <div className="tooth-panel-empty"><p><strong>Sélectionnez une dent</strong> sur le schéma pour lui associer des travaux.</p><p className="muted">Pour un même travail sur plusieurs dents, activez « Sélection multiple ». Les dents colorées ont déjà des travaux ; le chiffre indique leur nombre.</p></div>}
            {selected.length > 1 && (
              <div className="tooth-panel-multi">
                <h3>{selected.length} dents sélectionnées</h3>
                <p className="muted">{[...selected].sort((a, b) => a - b).join(', ')}</p>
                {!readOnly && (
                  <>
                    <WorkCard work={groupWork || { designation_id: null, designation_label: '', params: {}, quantity: 1, unit_price: 0, total: 0, observations: '' }}
                      designations={designations} tariff={tariff} canPrice={false} readOnly={!form.doctor_id}
                      color={groupWork?.designation_id ? colors.colorOfWork(groupWork) : undefined} onChange={setGroupWork} required={false} />
                    <button type="button" className="btn btn-primary" onClick={applyGroupWork} disabled={!form.doctor_id || !groupWork?.designation_id} title={form.doctor_id ? '' : "Choisissez d'abord le médecin"}>
                      Ajouter à ces {selected.length} dents
                    </button>
                  </>
                )}
                {clipboard && !readOnly && <button type="button" className="btn" onClick={paste}>Coller les travaux de la dent {clipboard.from}</button>}
                {[...selected].sort((a, b) => a - b).some((t) => worksByTooth.get(t)?.length) && (
                  <ul className="group-works">
                    {[...selected].sort((a, b) => a - b).flatMap((t) => (worksByTooth.get(t) || []).map((w) => (
                      <li key={w._k}><strong>{t}</strong> {w.designation_label || <em className="muted">à choisir</em>}
                        {!readOnly && <button type="button" className="icon-btn" onClick={() => removeWork(w._k)} aria-label={`Retirer ${w.designation_label} de la dent ${t}`}>×</button>}</li>
                    )))}
                  </ul>
                )}
              </div>
            )}
            {selected.length === 1 && (
              <>
                <div className="tooth-panel-head"><h3>Dent {selected[0]}</h3><span className="muted">{selWorks.length ? `${selWorks.length} travail${selWorks.length > 1 ? 'x' : ''}` : 'aucun travail'}</span></div>
                {selWorks.map((w) => (
                  <WorkCard key={w._k} work={w} designations={designations} tariff={tariff} canPrice={canPrice} readOnly={readOnly} color={colors.colorOfWork(w)}
                    onChange={(n) => updateWork(w._k, n)} onRemove={() => removeWork(w._k)} />
                ))}
                {!readOnly && <button type="button" className="btn btn-dashed" onClick={addWorkToSelection} disabled={!form.doctor_id} title={form.doctor_id ? '' : "Choisissez d'abord le médecin"}>Ajouter un travail sur la dent {selected[0]}</button>}
              </>
            )}
          </div>
        </div>

        <div className="general-works">
          <div className="tooth-panel-head"><h3>Travaux sans dent précise</h3><span className="muted">prothèse complète, châssis, gouttière…</span></div>
          {generalWorks.map((w) => (
            <WorkCard key={w._k} work={w} designations={designations} tariff={tariff} canPrice={canPrice} readOnly={readOnly} color={colors.colorOfWork(w)}
              onChange={(n) => updateWork(w._k, n)} onRemove={() => removeWork(w._k)} />
          ))}
          {!readOnly && <button type="button" className="btn btn-dashed" disabled={!form.doctor_id} onClick={() => setWorks((ws) => [...ws, newWork(null)])}>Ajouter un travail général</button>}
        </div>
      </section>

      <section className="card">
        <h2>Récapitulatif des travaux</h2>
        {form.works.length === 0 ? <p className="muted">Aucun travail pour le moment.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Dent</th><th>Désignation</th><th>Paramètres</th></tr></thead>
            <tbody>
              {[...form.works].sort((a, b) => (a.tooth || 999) - (b.tooth || 999)).map((w) => {
                const des = designations.find((d) => d.id === w.designation_id);
                return (
                  <tr key={w._k} className="clickable" onClick={() => w.tooth && setSelected([w.tooth])}>
                    <td><strong>{w.tooth || '—'}</strong></td>
                    <td>{w.designation_label || <em className="muted">à choisir</em>}{w.observations && <div className="muted small">{w.observations}</div>}</td>
                    <td className="small">{(des?.params || []).filter((p) => w.params?.[p.key]).map((p) => `${p.label} ${w.params[p.key]}`).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>

      {!isNew && (
        <section className="card">
          <h2>Historique du suivi</h2>
          <ol className="timeline">
            {req.history.map((h) => (
              <li key={h.id}>
                <span className="timeline-date">{fmtDate(h.at.replace(' ', 'T').slice(0, 16))}</span>
                <span>{h.from_status && h.from_status !== h.to_status ? <>{STATUS[h.from_status]?.label} → <strong>{STATUS[h.to_status]?.label}</strong></> : h.note ? null : <strong>{STATUS[h.to_status]?.label}</strong>}
                  {h.note && <> {h.note}</>}</span>
                <span className="muted">{h.user_name}</span>
              </li>
            ))}
          </ol>
          {can('delete_archive') && <button type="button" className="btn btn-danger-ghost" onClick={remove}>Supprimer la demande</button>}
        </section>
      )}
      {!readOnly && <div className="sticky-save"><span>{form.works.length} travail{form.works.length > 1 ? 'x' : ''}</span><button className="btn btn-primary" disabled={saving}>{isNew ? 'Créer la demande' : 'Enregistrer'}</button></div>}
    </form>
  );
}