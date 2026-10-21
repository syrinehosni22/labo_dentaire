export const STATUS = {
  en_cours: { label: 'En cours', short: 'En cours' },
  attente_essayage: { label: "En attente d'essayage", short: 'Essayage' },
  a_livrer: { label: 'À livrer', short: 'À livrer' },
  livree: { label: 'Livrée', short: 'Livrée' },
};
export const STATUS_KEYS = Object.keys(STATUS);

const pad = (n) => String(n).padStart(2, '0');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const currentPeriod = () => todayISO().slice(0, 7);

export function parseLocal(s) {
  if (!s) return null;
  const [d, t] = String(s).split(/[T ]/);
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0);
}
export const hasTime = (s) => !!s && /[T ]\d{2}:\d{2}/.test(s);

export function fmtDate(s, { withTime = true } = {}) {
  if (!s) return '';
  const d = parseLocal(s);
  const out = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime && hasTime(s) ? `${out} ${pad(d.getHours())}h${pad(d.getMinutes())}` : out;
}

export function relDay(s) {
  if (!s) return '';
  const d = parseLocal(s); const t = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const n = Math.round((a - b) / 86400000);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `dans ${n} j` : `il y a ${-n} j`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const periodLabel = (p) => { if (!p) return ''; const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
export const shortPeriod = (p) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1].slice(0, 4).replace(/\.$/, '')}. ${y.slice(2)}`; };

let money = { currency: 'TND', decimals: 3 };
export const setMoneyFormat = (lab) => { money = { currency: lab.currency || 'TND', decimals: lab.decimals ?? 3 }; };
export const fmtMoney = (n, { bare } = {}) => {
  const s = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: money.decimals, maximumFractionDigits: money.decimals }).format(Number(n || 0));
  return bare ? s : `${s} ${money.currency}`;
};
export const moneyStep = () => (money.decimals ? `0.${'0'.repeat(money.decimals - 1)}1` : '1');
export const roundMoney = (n) => { const f = 10 ** money.decimals; return Math.round((Number(n) || 0) * f) / f; };

export const ROLE_LABELS = { admin: 'Administrateur', production: 'Personnel de production', administratif: 'Personnel administratif' };
