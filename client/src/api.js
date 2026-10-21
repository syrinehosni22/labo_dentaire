const TOKEN_KEY = 'labo_token';

// Adresse du serveur API, issue de APP_URL (server/.env), injectée par vite.config.js.
// Vide => chemins relatifs (/api), quand l'interface est servie par le même serveur.
export const API_URL = `${(import.meta.env.APP_URL || '').replace(/\/+$/, '')}/api`;

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
let onForbidden = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const setForbiddenHandler = (fn) => { onForbidden = fn; };
const PUBLIC = ['/auth/login', '/auth/forgot', '/auth/reset', '/auth/options'];

async function request(method, url, body, { raw } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`${API_URL}${url}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Le serveur est injoignable. Vérifiez votre connexion.');
  }
  if (raw) { if (!res.ok) throw new ApiError(res.status, 'Téléchargement impossible.'); return res; }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !PUBLIC.some((p) => url.startsWith(p))) onUnauthorized(data?.error);
  if (res.status === 403 && data?.code) onForbidden(data.code);
  if (!res.ok) { const e = new ApiError(res.status, data?.error || `Erreur ${res.status}`); e.code = data?.code; throw e; }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  raw: (u) => request('GET', u, undefined, { raw: true }),
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null && v !== false) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Open an authenticated file (PDF, backup) in a new tab or download it
export async function openFile(url, filename) {
  const win = filename ? null : window.open('', '_blank');
  const res = await api.raw(url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  if (filename) {
    const a = document.createElement('a'); a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  } else if (win) win.location.href = href;
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}
