import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import DentalChart from '../components/DentalChart';
import { ErrorBox, Field } from '../components/ui';

/* ---------- shared pieces ---------- */
function AuthLayout({ children, highlight = [11, 21, 36] }) {
  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <DentalChart mode="permanent" worksByTooth={new Map()} categoryColor={() => ''} selected={highlight} onToothClick={() => {}} readOnly />
      </div>
      <main className="login-card">
        <div className="login-inner">
          <img src="/icon.svg" alt="" width="44" height="44" />
          {children}
        </div>
      </main>
    </div>
  );
}

export function PasswordField({ label = 'Mot de passe', value, onChange, autoComplete = 'current-password', autoFocus, id }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'));
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} required value={value} autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} onKeyUp={onKey} onBlur={() => setCaps(false)} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
          {show ? 'Masquer' : 'Afficher'}
        </button>
      </div>
      {caps && <span className="field-hint warn">La touche Verr. Maj est activée.</span>}
    </div>
  );
}

// Mirrors the server policy (passwordProblem) so people see what is missing while typing
const RULES = [
  ['8 caractères minimum', (p) => p.length >= 8],
  ['au moins une lettre', (p) => /[A-Za-zÀ-ÿ]/.test(p)],
  ['au moins un chiffre', (p) => /\d/.test(p)],
];
export const passwordOk = (p) => RULES.every(([, t]) => t(p));

function NewPasswordFields({ pw, setPw, confirm, setConfirm }) {
  const mismatch = confirm.length > 0 && confirm !== pw;
  return (
    <>
      <PasswordField id="new-pw" label="Nouveau mot de passe" value={pw} onChange={setPw} autoComplete="new-password" autoFocus />
      <ul className="pw-rules" aria-label="Règles du mot de passe">
        {RULES.map(([l, t]) => <li key={l} className={t(pw) ? 'is-ok' : ''}><span aria-hidden="true">{t(pw) ? '✓' : '•'}</span> {l}</li>)}
      </ul>
      <PasswordField id="confirm-pw" label="Confirmer le mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {mismatch && <span className="field-error">Les deux mots de passe ne correspondent pas.</span>}
    </>
  );
}

/* ---------- /connexion ---------- */
export function LoginPage() {
  const { login, sessionMessage, setSessionMessage } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const notice = loc.state?.notice;

  const submit = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      await login(email.trim(), password);
      const next = params.get('suite');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) { setError(err.message); setPassword(''); } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <h1>Connexion</h1>
      <p className="muted">Suivi des demandes, essayages et facturation du laboratoire.</p>
      {notice && <div className="ok-box" role="status">{notice}</div>}
      {sessionMessage && !notice && <div className="info-box" role="status">{sessionMessage}</div>}
      <form onSubmit={submit} className="auth-form" onChange={() => sessionMessage && setSessionMessage(null)}>
        <ErrorBox error={error} />
        <Field label="Adresse e-mail"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} /></Field>
        <PasswordField id="login-pw" value={password} onChange={setPassword} autoFocus={!!email} />
        <div className="auth-row">
          <Link to={`/mot-de-passe-oublie${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Mot de passe oublié ?</Link>
        </div>
        <button className="btn btn-primary btn-block btn-large" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
      <p className="muted small auth-foot">Pas encore de compte ? Les comptes sont créés par l'administrateur du laboratoire.</p>
    </AuthLayout>
  );
}

/* ---------- /mot-de-passe-oublie ---------- */
export function ForgotPage() {
  const loc = useLocation();
  const [email, setEmail] = useState(new URLSearchParams(loc.search).get('email') || '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { await api.post('/auth/forgot', { email: email.trim() }); setSent(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout highlight={[16]}>
      <h1>Mot de passe oublié</h1>
      {sent ? (
        <>
          <div className="ok-box" role="status">Si un compte actif correspond à <strong>{email}</strong>, un e-mail contenant un lien de réinitialisation vient d'être envoyé. Le lien est valable 1 heure.</div>
          <p className="muted">Rien reçu après quelques minutes ? Vérifiez vos courriers indésirables, ou demandez à l'administrateur du laboratoire de vous générer un lien depuis la gestion des utilisateurs : il a été prévenu de votre demande.</p>
          <div className="auth-actions">
            <button className="btn" onClick={() => setSent(false)}>Renvoyer un e-mail</button>
            <Link className="btn btn-primary" to={`/connexion?email=${encodeURIComponent(email)}`}>Retour à la connexion</Link>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <p className="muted">Saisissez l'adresse e-mail de votre compte. Vous recevrez un lien pour choisir un nouveau mot de passe.</p>
          <ErrorBox error={error} />
          <Field label="Adresse e-mail"><input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button className="btn btn-primary btn-block btn-large" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le lien'}</button>
          <Link to="/connexion" className="auth-back">Retour à la connexion</Link>
        </form>
      )}
    </AuthLayout>
  );
}

/* ---------- /reinitialiser/:token ---------- */
export function ResetPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [info, setInfo] = useState(null);
  const [invalid, setInvalid] = useState(null);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/auth/reset/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setInvalid(e.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault(); setError(null);
    if (!passwordOk(pw)) { setError('Le mot de passe ne respecte pas les règles indiquées.'); return; }
    if (pw !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/auth/reset', { token, password: pw });
      if (user) logout();
      navigate(`/connexion?email=${encodeURIComponent(r.email)}`, { replace: true, state: { notice: 'Votre mot de passe a été modifié. Connectez-vous avec le nouveau mot de passe.' } });
    } catch (err) {
      if (err.code === 'invalid_token') setInvalid(err.message); else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout highlight={[26]}>
      <h1>Nouveau mot de passe</h1>
      {invalid ? (
        <>
          <ErrorBox error={invalid} />
          <p className="muted">Les liens de réinitialisation ne fonctionnent qu'une fois et expirent rapidement. Demandez-en un nouveau.</p>
          <div className="auth-actions">
            <Link className="btn btn-primary" to="/mot-de-passe-oublie">Demander un nouveau lien</Link>
            <Link className="btn" to="/connexion">Retour à la connexion</Link>
          </div>
        </>
      ) : !info ? <p className="muted">Vérification du lien…</p> : (
        <form onSubmit={submit} className="auth-form">
          <p className="muted">Bonjour {info.name}, choisissez le nouveau mot de passe du compte <strong>{info.email}</strong>. Vos autres sessions ouvertes seront déconnectées.</p>
          <ErrorBox error={error} />
          <NewPasswordFields pw={pw} setPw={setPw} confirm={confirm} setConfirm={setConfirm} />
          <button className="btn btn-primary btn-block btn-large" disabled={busy || !passwordOk(pw) || pw !== confirm}>{busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

/* ---------- forced change (first login / password set by an admin) ---------- */
export function ForceChangePage() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(null);
    if (pw !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try { await changePassword(current, pw); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout highlight={[11]}>
      <h1>Choisissez votre mot de passe</h1>
      <p className="muted">Bonjour {user.name.split(' ')[0]}, le mot de passe actuel de votre compte est provisoire. Remplacez-le par un mot de passe personnel pour accéder à l'application.</p>
      <form onSubmit={submit} className="auth-form">
        <ErrorBox error={error} />
        <PasswordField id="cur-pw" label="Mot de passe provisoire" value={current} onChange={setCurrent} />
        <NewPasswordFields pw={pw} setPw={setPw} confirm={confirm} setConfirm={setConfirm} />
        <button className="btn btn-primary btn-block btn-large" disabled={busy || !current || !passwordOk(pw) || pw !== confirm}>{busy ? 'Enregistrement…' : 'Enregistrer et continuer'}</button>
        <button type="button" className="link-btn auth-back" onClick={() => logout()}>Se déconnecter</button>
      </form>
    </AuthLayout>
  );
}

/* ---------- password section of "Mon compte" ---------- */
export function ChangePasswordForm({ onDone }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    if (pw !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    try { await changePassword(current, pw); setCurrent(''); setPw(''); setConfirm(''); onDone?.(); } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={submit} className="auth-form">
      <ErrorBox error={error} />
      <PasswordField id="me-cur" label="Mot de passe actuel" value={current} onChange={setCurrent} />
      <PasswordField id="me-new" label="Nouveau mot de passe" value={pw} onChange={setPw} autoComplete="new-password" />
      <ul className="pw-rules">{RULES.map(([l, t]) => <li key={l} className={t(pw) ? 'is-ok' : ''}><span aria-hidden="true">{t(pw) ? '✓' : '•'}</span> {l}</li>)}</ul>
      <PasswordField id="me-confirm" label="Confirmer le nouveau mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <p className="muted small">Vos autres sessions (autres appareils) seront déconnectées.</p>
      <div><button className="btn" disabled={!current || !passwordOk(pw) || pw !== confirm}>Changer le mot de passe</button></div>
    </form>
  );
}
