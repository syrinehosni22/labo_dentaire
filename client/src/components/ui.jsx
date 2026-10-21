import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STATUS } from '../format';

/* ---------- Toasts + confirm dialogs (app-wide) ---------- */
const UiCtx = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);

  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  // confirm({ title, message, confirmLabel, danger, input }) -> Promise<false | true | string>
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const close = (v) => { dialog?.resolve(v); setDialog(null); };

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>)}
      </div>
      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
    </UiCtx.Provider>
  );
}
export const useUi = () => useContext(UiCtx);

function ConfirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger, input, actions, onClose }) {
  const [value, setValue] = useState('');
  return (
    <Modal title={title} onClose={() => onClose(false)} small>
      {message && <p className="dialog-message">{message}</p>}
      {input && <Field label={input.label}><textarea autoFocus rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder} /></Field>}
      <div className="modal-actions">
        <button className="btn" onClick={() => onClose(false)}>{cancelLabel}</button>
        {actions ? actions.map((a) => (
          <button key={a.value} className={`btn ${a.danger ? 'btn-danger' : a.primary ? 'btn-primary' : ''}`} onClick={() => onClose(a.value)}>{a.label}</button>
        )) : (
          <button autoFocus={!input} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={input && value.trim().length < (input.min || 1)}
            onClick={() => onClose(input ? value.trim() : true)}>{confirmLabel}</button>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, children, onClose, small, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector('input,select,textarea,button:not(.modal-close)')?.focus();
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${small ? 'modal-small' : ''} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Form bits ---------- */
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function StatusBadge({ status, overdue }) {
  return <span className={`status status-${status}`}>{STATUS[status]?.label || status}{overdue && <span className="status-late" title="Échéance dépassée">retard</span>}</span>;
}

export function Empty({ title, children }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children}</div>;
}

export function Loading() { return <div className="loading" aria-busy="true">Chargement…</div>; }

export function ErrorBox({ error }) { return error ? <div className="error-box" role="alert">{error}</div> : null; }

/* ---------- Pagination ---------- */
export function Pagination({ page, pages, total, pageSize, onPage, onPageSize, noun = 'résultat' }) {
  const nums = useMemo(() => {
    const out = new Set([1, pages, page, page - 1, page + 1]);
    return [...out].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  }, [page, pages]);
  return (
    <div className="pagination">
      <span className="pagination-total">{total} {noun}{total > 1 ? 's' : ''}</span>
      <div className="pagination-pages">
        <button className="btn btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédente</button>
        {nums.map((n, i) => (
          <span key={n} className="pagination-num">
            {i > 0 && n - nums[i - 1] > 1 && <span className="pagination-gap">…</span>}
            <button className={`btn btn-small ${n === page ? 'is-current' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
          </span>
        ))}
        <button className="btn btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivante</button>
      </div>
      {onPageSize && (
        <label className="pagination-size">Par page
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/* ---------- Searchable doctor picker (prevents free-typed names) ---------- */
export function DoctorSelect({ doctors, value, onChange, disabled, required, includeArchived = false, placeholder = 'Rechercher un médecin…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const selected = doctors.find((d) => String(d.id) === String(value));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = doctors.filter((d) => (includeArchived || !d.archived) && norm(`${d.last_name} ${d.first_name} ${d.city || ''}`).includes(norm(q))).slice(0, 30);
  const pick = (d) => { onChange(d ? d.id : ''); setOpen(false); setQ(''); };
  return (
    <div className="combo">
      <input
        value={open ? q : selected ? `Dr ${selected.last_name} ${selected.first_name}` : ''}
        placeholder={placeholder} disabled={disabled} required={required && !value}
        onFocus={() => { setOpen(true); setHi(0); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
        }}
        role="combobox" aria-expanded={open} aria-autocomplete="list"
      />
      {open && (
        <ul className="combo-list" role="listbox">
          {list.length === 0 && <li className="combo-empty">Aucun médecin trouvé</li>}
          {list.map((d, i) => (
            <li key={d.id} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''} onMouseDown={() => pick(d)}>
              <span>Dr {d.last_name} {d.first_name}</span>
              <span className="combo-meta">{d.city ? `${d.city}, ` : ''}tarif {d.tariff}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Data hook ---------- */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await fn(), error: null, loading: false }); } catch (e) { setState({ data: null, error: e.message, loading: false }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
