import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setForbiddenHandler, setToken, setUnauthorizedHandler } from './api';
import { setMoneyFormat } from './format';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [sessionMessage, setSessionMessage] = useState(null);

  const logout = useCallback((message) => {
    setToken(null); setUser(null);
    setSessionMessage(typeof message === 'string' ? message : null);
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await api.get('/settings');
    setMoneyFormat(s.lab); setSettings(s);
    return s;
  }, []);

  const refresh = useCallback(async () => {
    const [u] = await Promise.all([api.get('/auth/me'), loadSettings()]);
    setUser(u);
    return u;
  }, [loadSettings]);

  useEffect(() => {
    // expired or revoked session (e.g. password changed elsewhere)
    setUnauthorizedHandler((msg) => { if (getToken()) logout(msg || 'Votre session a expiré, reconnectez-vous.'); });
    setForbiddenHandler((code) => { if (code === 'password_change_required') setUser((u) => (u ? { ...u, must_change_password: true } : u)); });
    if (getToken()) refresh().catch(() => logout()).finally(() => setLoading(false));
  }, [logout, refresh]);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token);
    setSessionMessage(null);
    await loadSettings();
    setUser(r.user);
    return r.user;
  };

  // Server answers with a fresh token: other sessions of this account are signed out
  const changePassword = async (current_password, new_password) => {
    const r = await api.post('/auth/change-password', { current_password, new_password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };

  const can = useCallback((...perms) => !!user && perms.some((p) => user.permissions.includes(p)), [user]);

  return (
    <AuthCtx.Provider value={{ user, setUser, settings, loadSettings, loading, login, logout, refresh, changePassword, can, sessionMessage, setSessionMessage }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
