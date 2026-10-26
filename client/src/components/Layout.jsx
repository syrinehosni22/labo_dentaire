import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../format';

const NAV = [
  { to: '/', label: 'Suivi des demandes', perm: 'requests_view', end: true, icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/demandes/nouvelle', label: 'Nouvelle demande', perm: 'requests_edit', icon: 'M12 5v14M5 12h14' },
  { to: '/medecins', label: 'Médecins', perm: null, icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { to: '/carnets', label: 'Carnets et fiches', perm: 'fiches_manage', icon: 'M6 3h11a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h7M8 12h7' },
  { to: '/tarifs', label: 'Tarifs A, B, C', perm: null, icon: 'M4 7h16M4 12h16M4 17h16M9 4v16' },
  { to: '/factures', label: 'Factures', perm: ['invoices_manage', 'invoices_validate'], icon: 'M7 3h10v18l-3-2-2 2-2-2-3 2zM10 8h4M10 12h4' },
  { to: '/statistiques', label: 'Statistiques', perm: 'stats_view', icon: 'M5 20V10M12 20V4M19 20v-7' },
];
const ADMIN_NAV = [
  { to: '/utilisateurs', label: 'Utilisateurs', perm: 'users_manage', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 8h4M19 6v4' },
  { to: '/parametres', label: 'Paramètres', perm: 'settings_manage', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6 7.3 4 7 3 10l2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z' },
];

const Icon = ({ d }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

export default function Layout() {
  const { user, can, logout, settings } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  const allowed = (n) => !n.perm || (Array.isArray(n.perm) ? can(...n.perm) : can(n.perm));
  const admin = ADMIN_NAV.filter(allowed);

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <img src="/logo.png" alt="" className="brand-logo" width="44" height="44" />
          <span><strong>{settings?.lab?.name || 'Laboratoire dentaire'}</strong></span>
        </Link>
        <nav className="nav" aria-label="Navigation principale">
          {NAV.filter(allowed).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link"><Icon d={n.icon} />{n.label}</NavLink>
          ))}
          {admin.length > 0 && <div className="nav-sep" />}
          {admin.map((n) => <NavLink key={n.to} to={n.to} className="nav-link"><Icon d={n.icon} />{n.label}</NavLink>)}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/profil" className="me">
            <span className="avatar" aria-hidden="true">{user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <span><strong>{user.name}</strong><small>{user.role_label}</small></span>
          </NavLink>
          <button className="btn btn-ghost-dark btn-small" onClick={() => { navigate('/connexion', { replace: true }); logout(); }}>Se déconnecter</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu"><Icon d="M4 7h16M4 12h16M4 17h16" /></button>
          <div className="topbar-spacer" />
          <NotificationBell />
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const navigate = useNavigate();
  const ref = useRef(null);

  const load = useCallback(() => api.get('/notifications?limit=12').then(setData).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markAll = async () => { await api.post('/notifications/read', { all: true }); load(); };
  const openOne = async (n) => {
    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] });
    setOpen(false); load();
    navigate(n.request_id ? `/demandes/${n.request_id}` : n.type === 'password_reset' ? '/utilisateurs' : '/notifications');
  };

  return (
    <div className="bell" ref={ref}>
      <button className="bell-btn" onClick={() => { setOpen((o) => !o); if (!open) load(); }} aria-label={`Notifications, ${data.unread} non lues`} aria-expanded={open}>
        <Icon d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
        {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && <button className="link-btn" onClick={markAll}>Tout marquer comme lu</button>}
          </div>
          <ul className="bell-list">
            {data.items.length === 0 && <li className="bell-empty">Aucune notification pour le moment.</li>}
            {data.items.map((n) => (
              <li key={n.id}>
                <button className={`notif ${n.read_at ? '' : 'is-unread'} ${n.overdue ? 'is-overdue' : ''}`} onClick={() => openOne(n)}>
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-msg">{n.message}</span>
                  <span className="notif-time">{fmtDate(n.created_at.replace(' ', 'T').slice(0, 16))}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" className="bell-foot" onClick={() => setOpen(false)}>Voir l'historique</Link>
        </div>
      )}
    </div>
  );
}