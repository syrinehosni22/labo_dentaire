import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Field, PageHeader, Pagination, useLoad, useUi } from '../components/ui';
import { fmtDate } from '../format';
import { ChangePasswordForm } from './Auth';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../push';

export const TYPE_LABELS = {
  try1: 'Premier essayage', try2: 'Deuxième essayage', delivery: 'Livraison prévue',
  try_overdue: 'Essayage en retard', delivery_overdue: 'Livraison en retard', daily_summary: 'Récapitulatif quotidien',
};
const HISTORY_LABELS = { ...TYPE_LABELS, password_reset: 'Mot de passe oublié' };

export function NotificationHistory() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const [type, setType] = useState('');
  const size = 25;
  const { data, error, reload } = useLoad(() => api.get(`/notifications?limit=${size}&offset=${(page - 1) * size}${unread ? '&unread=1' : ''}${type ? `&type=${type}` : ''}`), [page, unread, type]);
  const mark = async (ids) => { await api.post('/notifications/read', ids ? { ids } : { all: true }); reload(); };
  return (
    <div>
      <PageHeader title="Notifications" sub="Rappels d'essayage et de livraison, du plus récent au plus ancien.">
        {data?.unread > 0 && <button className="btn" onClick={() => mark()}>Tout marquer comme lu</button>}
      </PageHeader>
      <section className="card list-card">
        <div className="toolbar">
          <label className="check"><input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1); }} /> Non lues uniquement</label>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type"><option value="">Tous les types</option>{Object.entries(HISTORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <ErrorBox error={error} />
        {data?.items.length === 0 && <Empty title="Aucune notification." />}
        <ul className="notif-history">
          {data?.items.map((n) => (
            <li key={n.id} className={`${n.read_at ? '' : 'is-unread'} ${n.overdue ? 'is-overdue' : ''}`}>
              <div className="nh-main" role="button" tabIndex={0} onClick={() => { if (!n.read_at) mark([n.id]); if (n.request_id) navigate(`/demandes/${n.request_id}`); else if (n.type === 'password_reset') navigate('/utilisateurs'); }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}>
                <span className="nh-type">{HISTORY_LABELS[n.type]}</span>
                <strong>{n.title}</strong>
                <span>{n.message}</span>
              </div>
              <div className="nh-side">
                <span className="muted small">{fmtDate(n.created_at.replace(' ', 'T').slice(0, 16))}</span>
                {!n.read_at && <button className="link-btn" onClick={() => mark([n.id])}>Marquer comme lue</button>}
              </div>
            </li>
          ))}
        </ul>
        {data?.total > size && <Pagination page={page} pages={Math.ceil(data.total / size)} total={data.total} onPage={setPage} noun="notification" />}
      </section>
    </div>
  );
}

export function Profile() {
  const { user, setUser } = useAuth();
  const { toast } = useUi();
  const [phone, setPhone] = useState(user.phone || '');
  const [prefs, setPrefs] = useState(user.notif_prefs);
  const [error, setError] = useState(null);
  const [push, setPush] = useState({ supported: pushSupported(), subscribed: false, busy: false });
  const [adminTypes, setAdminTypes] = useState(null);

  useEffect(() => { currentSubscription().then((s) => setPush((p) => ({ ...p, subscribed: !!s }))).catch(() => {}); }, []);
  useEffect(() => { if (user.permissions.includes('settings_manage')) api.get('/notification-settings').then((s) => setAdminTypes(s.types)).catch(() => {}); }, [user]);

  const save = async (body, msg) => {
    setError(null);
    try { setUser(await api.put('/auth/me', body)); toast(msg); return true; } catch (e) { setError(e.message); return false; }
  };
  const togglePush = async () => {
    setPush((p) => ({ ...p, busy: true }));
    try {
      if (push.subscribed) { await disablePush(); toast('Notifications désactivées sur cet appareil.'); setPush((p) => ({ ...p, subscribed: false })); }
      else { await enablePush(); toast('Notifications activées sur cet appareil.'); setPush((p) => ({ ...p, subscribed: true })); }
    } catch (e) { setError(e.message); } finally { setPush((p) => ({ ...p, busy: false })); }
  };
  const test = async () => {
    try {
      const r = await api.post('/push/test');
      const ok = r.deliveries.some((d) => d.status === 'envoye');
      toast(ok ? 'Notification de test envoyée.' : `Échec : ${r.deliveries[0]?.error || 'aucun appareil abonné'}`, ok ? 'ok' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <PageHeader title="Mon compte" sub={`${user.email}, ${user.role_label}`} />
      <ErrorBox error={error} />
      <div className="detail-grid">
        <section className="card">
          <h2>Notifications sur ce téléphone ou cet ordinateur</h2>
          <p className="muted small">Les rappels s'affichent même lorsque l'application est fermée. Sur iPhone, ajoutez d'abord l'application à l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »).</p>
          {push.supported ? (
            <div className="row-actions">
              <button className={`btn ${push.subscribed ? '' : 'btn-primary'}`} onClick={togglePush} disabled={push.busy}>{push.subscribed ? 'Désactiver sur cet appareil' : 'Activer sur cet appareil'}</button>
              {push.subscribed && <button className="btn" onClick={test}>Envoyer un test</button>}
            </div>
          ) : <p className="warn">Ce navigateur ne prend pas en charge les notifications push.</p>}
          <h3 className="sub-h">Canaux</h3>
          {[['push', 'Notifications push (navigateur / application installée)'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail']].map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={!!prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))} /> {l}</label>
          ))}
          <Field label="Numéro de téléphone (SMS, WhatsApp)" hint="Format international, ex. +216 20 123 456"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <h3 className="sub-h">Rappels que je souhaite recevoir</h3>
          {Object.entries(TYPE_LABELS).map(([k, l]) => {
            const disabled = adminTypes && (!adminTypes[k]?.enabled || !adminTypes[k]?.roles.includes(user.role));
            return <label key={k} className={`check ${disabled ? 'is-disabled' : ''}`}><input type="checkbox" disabled={disabled} checked={prefs.types.includes(k)} onChange={(e) => setPrefs((p) => ({ ...p, types: e.target.checked ? [...p.types, k] : p.types.filter((t) => t !== k) }))} /> {l}{disabled && <span className="muted small"> (non prévu pour votre profil)</span>}</label>;
          })}
          <button className="btn btn-primary" onClick={() => save({ phone, notif_prefs: prefs }, 'Préférences enregistrées.')}>Enregistrer mes préférences</button>
        </section>
        <GoogleCalendarCard />
        <section className="card">
          <h2>Mot de passe</h2>
          {user.password_changed_at && <p className="muted small">Dernière modification le {fmtDate(user.password_changed_at.replace(' ', 'T').slice(0, 16))}.</p>}
          <ChangePasswordForm onDone={() => toast('Mot de passe modifié.')} />
        </section>
      </div>
    </div>
  );
}

/* ---------- Google Agenda ---------- */
const GCAL_STATUS = { ok: 'Synchronisé', error: 'Erreur de synchronisation', revoked: 'Accès à reconnecter' };

function GoogleCalendarCard() {
  const { user, settings } = useAuth();
  const labName = settings?.lab?.name || 'Laboratoire dentaire';
  const { toast, confirm } = useUi();
  const [params, setParams] = useSearchParams();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = () => api.get('/google/status').then(setSt).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // return from Google (/profil?google=ok|erreur&message=…)
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    if (g === 'ok') toast('Google Agenda connecté. Vos essayages et livraisons y apparaissent dans quelques instants.');
    else setError(params.get('message') || 'La connexion à Google Agenda a échoué.');
    params.delete('google'); params.delete('message');
    setParams(params, { replace: true });
    if (g === 'ok') setTimeout(load, 4000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const connect = () => run(async () => { const { url } = await api.post('/google/connect'); window.location.assign(url); });
  const sync = () => run(async () => {
    const r = await api.post('/google/sync');
    setSt((x) => ({ ...x, account: r.account }));
    if (r.account?.status === 'ok') toast('Google Agenda synchronisé.'); else setError(r.account?.last_error || 'Synchronisation impossible.');
  });
  const setKind = (k, on) => run(async () => {
    const kinds = on ? [...st.account.kinds, k] : st.account.kinds.filter((x) => x !== k);
    const r = await api.put('/google/prefs', { kinds });
    setSt((x) => ({ ...x, account: { ...x.account, kinds: r.kinds } }));
    toast('Préférence enregistrée. Votre agenda est mis à jour.');
  });
  const disconnect = async () => {
    const choice = await confirm({
      title: 'Déconnecter Google Agenda',
      message: "L'application n'aura plus accès à votre compte Google. Voulez-vous aussi supprimer l'agenda « demandes » qu'elle avait créé, avec tous ses événements ?",
      actions: [{ label: "Garder l'agenda", value: 'keep', primary: true }, { label: "Supprimer l'agenda", value: 'delete', danger: true }],
    });
    if (!choice) return;
    run(async () => {
      const r = await api.post('/google/disconnect', { delete_calendar: choice === 'delete' });
      toast(r.calendar_deleted ? 'Compte Google déconnecté et agenda supprimé.' : 'Compte Google déconnecté. L\'agenda reste dans Google, sans mise à jour.');
      load();
    });
  };

  const a = st?.account;
  return (
    <section className="card">
      <h2>Google Agenda</h2>
      <ErrorBox error={error} />
      {!st ? (!error && <p className="muted small">Chargement…</p>) : !st.configured ? (
        <p className="muted small">La connexion à Google Agenda n'est pas encore disponible : l'application du laboratoire doit d'abord être déclarée auprès de Google.{user.permissions.includes('settings_manage') ? ' Suivez les étapes de Paramètres → Google Agenda, puis revenez ici pour connecter votre compte.' : " Demandez à l'administrateur de l'activer ; vous pourrez ensuite connecter votre compte ici."}</p>
      ) : !a ? (<>
        <p className="muted small">Retrouvez les essayages et les livraisons dans votre Google Agenda, sur votre téléphone et votre ordinateur. L'application crée un agenda dédié, tenu à jour automatiquement, et n'a accès à aucun de vos autres agendas.</p>
        <h3 className="sub-h">Comment connecter votre agenda</h3>
        <ol className="small steps-list">
          <li>Cliquez sur <strong>Connecter mon Google Agenda</strong> : la page de connexion de Google s'ouvre.</li>
          <li>Choisissez le compte Google sur lequel vous voulez voir les rendez-vous (celui de votre téléphone, en général).</li>
          <li>Si Google affiche « <em>Google n'a pas validé cette application</em> », cliquez sur <strong>Paramètres avancés</strong>, puis sur <strong>Accéder à …</strong>. C'est normal pour une application interne au laboratoire.</li>
          <li>Sur l'écran des autorisations, <strong>cochez la case</strong> qui permet à l'application de gérer ses agendas, puis cliquez sur <strong>Continuer</strong>.</li>
          <li>Vous revenez ici automatiquement. Après quelques secondes, un agenda « {labName} — demandes » apparaît dans Google Agenda.</li>
        </ol>
        <button className="btn btn-primary" onClick={connect} disabled={busy}>Connecter mon Google Agenda</button>
        <p className="muted small" style={{ marginTop: 10 }}>Vous pourrez vous déconnecter à tout moment depuis cette page.</p>
      </>) : (<>
        <p>Connecté à <strong>{a.google_email || 'votre compte Google'}</strong></p>
        <p className={`small ${a.status === 'ok' ? 'muted' : 'warn'}`}>
          {GCAL_STATUS[a.status] || a.status}
          {a.last_sync_at && ` · dernière synchronisation le ${fmtDate(a.last_sync_at.replace(' ', 'T').slice(0, 16))}`}
          {a.status === 'ok' && ` · ${a.events} événement${a.events > 1 ? 's' : ''}`}
        </p>
        {a.status !== 'ok' && a.last_error && <p className="warn small">{a.last_error}</p>}
        <details className="small help-details">
          <summary>Je ne vois pas les rendez-vous dans Google Agenda</summary>
          <ul className="steps-list">
            <li><strong>Sur ordinateur</strong> (calendar.google.com) : dans la colonne de gauche, sous « Mes agendas », cochez « {labName} — demandes ».</li>
            <li><strong>Sur Android</strong> : application Google Agenda → menu ☰ → cochez l'agenda « {labName} — demandes » sous votre compte.</li>
            <li><strong>Sur iPhone</strong> : application Google Agenda → menu ☰ → cochez l'agenda. Dans l'application Calendrier d'Apple, allez sur calendar.google.com/calendar/syncselect depuis un navigateur et cochez l'agenda.</li>
            <li>Seules les échéances à partir des 30 derniers jours sont ajoutées. Si rien n'apparaît, cliquez sur <strong>Synchroniser maintenant</strong>.</li>
          </ul>
        </details>
        <h3 className="sub-h">À afficher dans l'agenda</h3>
        {Object.entries(st.kinds).map(([k, l]) => (
          <label key={k} className="check"><input type="checkbox" disabled={busy} checked={a.kinds.includes(k)} onChange={(e) => setKind(k, e.target.checked)} /> {l}</label>
        ))}
        <div className="row-actions" style={{ marginTop: 12 }}>
          {a.status === 'revoked'
            ? <button className="btn btn-primary" onClick={connect} disabled={busy}>Reconnecter Google</button>
            : <button className="btn" onClick={sync} disabled={busy}>{busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>}
          <button className="btn" onClick={disconnect} disabled={busy}>Déconnecter</button>
        </div>
      </>)}
    </section>
  );
}