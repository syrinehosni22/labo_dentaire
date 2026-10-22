import { useEffect, useRef, useState } from 'react';
import { api, openFile } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useUi } from '../components/ui';
import { ROLE_LABELS, fmtDate } from '../format';
import { TYPE_LABELS } from './Account';

/* ------------------------- Users ------------------------- */
function UserModal({ initial, meta, onClose, onSaved }) {
  const [f, setF] = useState(initial ? { ...initial, password: '', must_change_password: true } : { name: '', email: '', role: 'production', phone: '', password: '', active: true, permission_overrides: {} });
  const [error, setError] = useState(null);
  const defaults = new Set(meta.role_defaults[f.role] || []);
  const effective = (p) => (f.role === 'admin' ? true : f.permission_overrides[p] ?? defaults.has(p));
  const toggle = (p, v) => setF((x) => {
    const o = { ...x.permission_overrides };
    if (v === defaults.has(p)) delete o[p]; else o[p] = v;
    return { ...x, permission_overrides: o };
  });
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const body = { ...f }; if (!body.password) delete body.password;
      onSaved(initial ? await api.put(`/users/${initial.id}`, body) : await api.post('/users', body));
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={initial ? `Modifier ${initial.name}` : 'Nouvel utilisateur'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Nom complet"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail (identifiant)"><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Téléphone"><input type="tel" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={initial ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe provisoire'} hint="8 caractères minimum, avec au moins une lettre et un chiffre">
            <input type="password" autoComplete="new-password" minLength={8} required={!initial} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          {(!initial || f.password) && (
            <label className="check span-all"><input type="checkbox" checked={f.must_change_password !== false} onChange={(e) => setF({ ...f, must_change_password: e.target.checked })} /> Demander à l'utilisateur de choisir son propre mot de passe à la prochaine connexion</label>
          )}
          <Field label="Profil">
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, permission_overrides: {} })}>
              {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {initial && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Compte actif</label>}
        </div>
        <h3 className="sub-h">Droits</h3>
        {f.role === 'admin' ? <p className="muted">L'administrateur dispose de tous les droits.</p> : (
          <div className="perm-grid">
            {Object.entries(meta.permissions).map(([p, l]) => (
              <label key={p} className="check"><input type="checkbox" checked={effective(p)} onChange={(e) => toggle(p, e.target.checked)} /> {l}
                {f.permission_overrides[p] !== undefined && <span className="tag tag-soft">personnalisé</span>}</label>
            ))}
          </div>
        )}
        {initial && <ResetTools user={initial} />}
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary">Enregistrer</button></div>
      </form>
    </Modal>
  );
}

// Reset link for a user: copy it and pass it on (works without e-mail), or send it if SMTP is configured
function ResetTools({ user }) {
  const { toast, confirm } = useUi();
  const { user: me } = useAuth();
  const [result, setResult] = useState(null);
  const [sendEmail, setSendEmail] = useState(false);
  const [mailOk, setMailOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/auth/options').then((o) => { setMailOk(o.email_reset); setSendEmail(o.email_reset); }).catch(() => {}); }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/users/${user.id}/reset-link`, { send_email: sendEmail });
      setResult(r);
      if (sendEmail) toast(r.emailed ? `Lien envoyé à ${user.email}.` : `E-mail non envoyé : ${r.email_error}`, r.emailed ? 'ok' : 'error');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.link); toast('Lien copié.'); } catch { toast('Copie impossible : sélectionnez le lien et copiez-le manuellement.', 'error'); }
  };
  const revoke = async () => {
    if (!(await confirm({ title: 'Déconnecter partout', message: `${user.name} sera déconnecté(e) de tous ses appareils et les liens de réinitialisation en attente seront annulés.`, confirmLabel: 'Déconnecter', danger: true }))) return;
    try { await api.post(`/users/${user.id}/revoke-sessions`); setResult(null); toast('Sessions fermées.'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <section className="reset-tools">
      <h3 className="sub-h">Réinitialisation du mot de passe</h3>
      <p className="muted small">Générez un lien personnel, valable 24 heures et utilisable une seule fois, qui permet à {user.name.split(' ')[0]} de choisir un nouveau mot de passe. Vous ne voyez jamais son mot de passe.</p>
      {user.reset_pending && !result && <p className="warn small">Un lien de réinitialisation est déjà en attente ; en générer un nouveau annule le précédent.</p>}
      <div className="row-actions">
        {mailOk && <label className="check"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> L'envoyer aussi par e-mail à {user.email}</label>}
        <button type="button" className="btn" onClick={generate} disabled={busy}>{result ? 'Générer un nouveau lien' : 'Générer un lien de réinitialisation'}</button>
        {user.id !== me.id && <button type="button" className="btn btn-danger-ghost" onClick={revoke}>Déconnecter de tous les appareils</button>}
      </div>
      {!mailOk && <p className="muted small">L'envoi par e-mail n'est pas configuré (Paramètres, Notifications) : transmettez le lien vous-même, par exemple par SMS ou WhatsApp.</p>}
      {result && (
        <div className="reset-link">
          <input readOnly value={result.link} onFocus={(e) => e.target.select()} aria-label="Lien de réinitialisation" />
          <button type="button" className="btn btn-primary" onClick={copy}>Copier</button>
          <span className="muted small">Expire le {new Date(result.expires_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
      )}
    </section>
  );
}

export function Users() {
  const { toast } = useUi();
  const { data, error, reload } = useLoad(() => Promise.all([api.get('/users'), api.get('/meta/permissions')]), []);
  const [editing, setEditing] = useState(null);
  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const [users, meta] = data;
  return (
    <div>
      <PageHeader title="Utilisateurs" sub="Profils et droits d'accès aux fonctions sensibles."><button className="btn btn-primary" onClick={() => setEditing('new')}>Nouvel utilisateur</button></PageHeader>
      <section className="card list-card">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Nom</th><th>E-mail</th><th>Profil</th><th>Téléphone</th><th>État</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'is-inactive'}>
              <td><strong>{u.name}</strong></td><td>{u.email}</td><td>{u.role_label}{Object.keys(u.permission_overrides).length > 0 && <span className="tag tag-soft">droits personnalisés</span>}</td>
              <td>{u.phone}</td>
              <td>{u.active ? 'Actif' : <span className="tag">désactivé</span>}
                {u.must_change_password && u.active && <span className="tag tag-soft">mot de passe provisoire</span>}
                {u.reset_pending && <span className="tag tag-warn">lien en attente</span>}</td>
              <td className="num"><button className="btn btn-small" onClick={() => setEditing(u)}>Modifier</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      {editing && <UserModal initial={editing === 'new' ? null : editing} meta={meta} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Utilisateur enregistré.'); reload(); }} />}
    </div>
  );
}

/* ------------------------- Settings ------------------------- */
const TABS = [['lab', 'Laboratoire'], ['notifs', 'Notifications'], ['deliveries', 'Journal des envois'], ['google', 'Google Agenda'], ['backups', 'Sauvegardes'], ['audit', "Journal d'activité"]];

export function Settings() {
  const [tab, setTab] = useState('lab');
  return (
    <div>
      <PageHeader title="Paramètres" />
      <div className="tabs tabs-page" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'lab' && <LabSettings />}
      {tab === 'notifs' && <NotifSettings />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'google' && <GoogleSettings />}
      {tab === 'backups' && <Backups />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function LabSettings() {
  const { settings, loadSettings } = useAuth();
  const { toast } = useUi();
  const [lab, setLab] = useState(settings.lab);
  const [tracking, setTracking] = useState(settings.tracking);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setLab((l) => ({ ...l, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setError(null);
    try { await api.put('/settings', { lab, tracking }); await loadSettings(); toast('Paramètres enregistrés.'); } catch (err) { setError(err.message); }
  };
  return (
    <form onSubmit={save}>
      <ErrorBox error={error} />
      <section className="card">
        <h2>Informations du laboratoire</h2>
        <p className="muted small">Reprises sur les nouvelles factures. Les factures existantes conservent les informations du moment de leur création.</p>
        <div className="form-grid">
          <Field label="Nom du laboratoire"><input required value={lab.name} onChange={set('name')} /></Field>
          <Field label="Matricule fiscal"><input value={lab.tax_id} onChange={set('tax_id')} /></Field>
          <Field label="Adresse" className="span-all"><input value={lab.address} onChange={set('address')} /></Field>
          <Field label="Téléphone"><input value={lab.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input type="email" value={lab.email} onChange={set('email')} /></Field>
          <Field label="Devise"><input value={lab.currency} onChange={set('currency')} /></Field>
          <Field label="Décimales"><select value={lab.decimals} onChange={set('decimals')}><option value={3}>3 (millimes)</option><option value={2}>2 (centimes)</option><option value={0}>0</option></select></Field>
          <Field label="Pied de facture" className="span-all"><textarea rows={2} value={lab.footer} onChange={set('footer')} /></Field>
          <Field label="Adresse publique de l'application" className="span-all" hint="Utilisée dans les liens envoyés par e-mail (réinitialisation du mot de passe), ex. https://labo.exemple.tn">
            <input type="url" placeholder="https://" value={lab.app_url || ''} onChange={set('app_url')} />
          </Field>
        </div>
      </section>
      <section className="card">
        <h2>Tableau de suivi</h2>
        <div className="form-grid">
          <Field label="Échéance « proche » (jours)" hint="Signale les demandes dont l'échéance arrive dans ce délai"><input type="number" min="0" max="30" value={tracking.near_days} onChange={(e) => setTracking((t) => ({ ...t, near_days: e.target.value }))} /></Field>
          <Field label="Essayages prioritaires (jours)" hint="Les essayages dans ce délai remontent en tête de liste"><input type="number" min="0" max="60" value={tracking.try_horizon_days} onChange={(e) => setTracking((t) => ({ ...t, try_horizon_days: e.target.value }))} /></Field>
        </div>
      </section>
      <div className="form-actions"><span className="grow" /><button className="btn btn-primary">Enregistrer</button></div>
    </form>
  );
}

const CHANNELS = [['platform', 'Plateforme'], ['push', 'Push'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail']];

function NotifSettings() {
  const { toast } = useUi();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/notification-settings').then(setS).catch((e) => setError(e.message)); }, []);
  if (!s) return error ? <ErrorBox error={error} /> : <Loading />;
  const setType = (t, patch) => setS((x) => ({ ...x, types: { ...x.types, [t]: { ...x.types[t], ...patch } } }));
  const toggleIn = (arr, v, on) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));
  const setRem = (i, patch) => setS((x) => ({ ...x, reminders: x.reminders.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setCh = (c, patch) => setS((x) => ({ ...x, channels: { ...x.channels, [c]: { ...x.channels[c], ...patch } } }));

  const save = async () => {
    setError(null);
    try { await api.put('/notification-settings', s); toast('Paramètres de notification enregistrés. Les rappels sont recalculés.'); } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <ErrorBox error={error} />
      <section className="card">
        <h2>Types de notification</h2>
        <div className="table-wrap"><table className="table matrix">
          <thead><tr><th>Type</th><th>Actif</th>{CHANNELS.map(([, l]) => <th key={l}>{l}</th>)}<th>Destinataires</th></tr></thead>
          <tbody>{Object.entries(TYPE_LABELS).map(([t, l]) => (
            <tr key={t} className={s.types[t].enabled ? '' : 'is-inactive'}>
              <td><strong>{l}</strong>{t === 'daily_summary' && <div className="small">à <input className="hour-input" type="number" min="0" max="23" value={s.types[t].hour} onChange={(e) => setType(t, { hour: Number(e.target.value) })} aria-label="Heure du récapitulatif" /> h</div>}</td>
              <td><input type="checkbox" checked={s.types[t].enabled} onChange={(e) => setType(t, { enabled: e.target.checked })} aria-label={`Activer ${l}`} /></td>
              {CHANNELS.map(([c, cl]) => (
                <td key={c}><input type="checkbox" disabled={c === 'platform'} checked={c === 'platform' || s.types[t].channels.includes(c)} onChange={(e) => setType(t, { channels: toggleIn(s.types[t].channels, c, e.target.checked) })} aria-label={`${l} par ${cl}`} /></td>
              ))}
              <td className="roles-cell">{Object.entries(ROLE_LABELS).map(([r, rl]) => (
                <label key={r} className="check small"><input type="checkbox" checked={s.types[t].roles.includes(r)} onChange={(e) => setType(t, { roles: toggleIn(s.types[t].roles, r, e.target.checked) })} /> {rl}</label>
              ))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="card">
        <h2>Délais de rappel</h2>
        <p className="muted small">Pour une même échéance, un seul rappel est envoyé à la fois et jamais deux fois. Les échéances dépassées déclenchent une alerte de retard.</p>
        {s.reminders.map((r, i) => (
          <div key={r.id} className="param-row">
            <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => setRem(i, { enabled: e.target.checked })} /></label>
            <select value={r.kind} onChange={(e) => setRem(i, { kind: e.target.value })} aria-label="Type de rappel">
              <option value="day_before">La veille</option><option value="same_day">Le jour même</option><option value="hours_before">Délai personnalisé</option>
            </select>
            {r.kind === 'hours_before'
              ? <label className="inline-field"><input type="number" min="1" value={r.hours} onChange={(e) => setRem(i, { hours: Number(e.target.value) })} /> heures avant</label>
              : <label className="inline-field">à <input type="number" min="0" max="23" value={r.hour} onChange={(e) => setRem(i, { hour: Number(e.target.value) })} /> h</label>}
            <span className="grow" />
            <button className="icon-btn" onClick={() => setS((x) => ({ ...x, reminders: x.reminders.filter((_, j) => j !== i) }))} aria-label="Retirer ce rappel">×</button>
          </div>
        ))}
        <button className="btn btn-dashed btn-small" onClick={() => setS((x) => ({ ...x, reminders: [...x.reminders, { id: `r${Date.now()}`, kind: 'hours_before', hours: 24, hour: 8, enabled: true }] }))}>Ajouter un rappel</button>
        <label className="check" style={{ marginTop: 16 }}><input type="checkbox" checked={s.phone_privacy} onChange={(e) => setS((x) => ({ ...x, phone_privacy: e.target.checked }))} /> Confidentialité sur téléphone : n'afficher que les initiales du patient dans les messages push, SMS et WhatsApp</label>
      </section>
      <section className="card">
        <h2>Canaux d'envoi vers le téléphone</h2>
        <p className="muted small">Les notifications push ne nécessitent aucun abonnement payant. SMS et WhatsApp passent par un fournisseur (Twilio) ou par votre propre passerelle (webhook) ; ces envois peuvent être facturés par le fournisseur.</p>
        <div className="channel-grid">
          {['sms', 'whatsapp'].map((c) => (
            <fieldset key={c} className="channel">
              <legend><label className="check"><input type="checkbox" checked={s.channels[c].enabled} onChange={(e) => setCh(c, { enabled: e.target.checked })} /> {c === 'sms' ? 'SMS' : 'WhatsApp'}</label></legend>
              <Field label="Fournisseur"><select value={s.channels[c].provider} onChange={(e) => setCh(c, { provider: e.target.value })}><option value="twilio">Twilio</option><option value="webhook">Passerelle (webhook HTTP)</option></select></Field>
              {s.channels[c].provider === 'webhook' ? (
                <Field label="URL du webhook" hint="Reçoit un POST JSON { channel, to, message }"><input value={s.channels[c].webhook_url || ''} onChange={(e) => setCh(c, { webhook_url: e.target.value })} /></Field>
              ) : (<>
                <Field label="Account SID"><input value={s.channels[c].account_sid} onChange={(e) => setCh(c, { account_sid: e.target.value })} /></Field>
                <Field label="Auth token"><input type="password" value={s.channels[c].auth_token} onChange={(e) => setCh(c, { auth_token: e.target.value })} /></Field>
                <Field label="Numéro expéditeur"><input value={s.channels[c].from} onChange={(e) => setCh(c, { from: e.target.value })} /></Field>
              </>)}
            </fieldset>
          ))}
          <fieldset className="channel">
            <legend><label className="check"><input type="checkbox" checked={s.channels.email.enabled} onChange={(e) => setCh('email', { enabled: e.target.checked })} /> E-mail (SMTP)</label></legend>
            <Field label="Serveur SMTP"><input value={s.channels.email.host} onChange={(e) => setCh('email', { host: e.target.value })} /></Field>
            <Field label="Port"><input type="number" value={s.channels.email.port} onChange={(e) => setCh('email', { port: Number(e.target.value) })} /></Field>
            <Field label="Utilisateur"><input value={s.channels.email.user} onChange={(e) => setCh('email', { user: e.target.value })} /></Field>
            <Field label="Mot de passe"><input type="password" value={s.channels.email.pass} onChange={(e) => setCh('email', { pass: e.target.value })} /></Field>
            <Field label="Expéditeur"><input value={s.channels.email.from} onChange={(e) => setCh('email', { from: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={s.channels.email.secure} onChange={(e) => setCh('email', { secure: e.target.checked })} /> Connexion SSL/TLS</label>
          </fieldset>
        </div>
      </section>
      <div className="form-actions"><span className="grow" /><button className="btn btn-primary" onClick={save}>Enregistrer</button></div>
    </div>
  );
}

const GCAL_STATUS = { ok: 'Synchronisé', error: 'Erreur', revoked: 'À reconnecter' };
function GoogleSettings() {
  const { toast } = useUi();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api.get('/google-settings').then(setS).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!s) return error ? <ErrorBox error={error} /> : <Loading />;
  const save = async (e) => {
    e.preventDefault(); setError(null);
    try { await api.put('/google-settings', { client_id: s.client_id, client_secret: s.client_secret, full_names: s.full_names }); toast('Paramètres Google Agenda enregistrés.'); load(); } catch (err) { setError(err.message); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(s.redirect_uri); toast('Adresse copiée.'); } catch { toast("Copie impossible : sélectionnez l'adresse à la main.", 'error'); } };
  const insecure = !/^https:\/\//.test(s.redirect_uri) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(s.redirect_uri);
  return (
    <form onSubmit={save}>
      <ErrorBox error={error} />
      <section className="card">
        <h2>Application Google</h2>
        <p className="muted small">Permet à chaque utilisateur de retrouver les essayages et les livraisons dans son Google Agenda (Mon compte → Google Agenda). Créez une fois pour toutes une application dans Google Cloud, en suivant le README (section « Google Agenda ») :</p>
        <ol className="small steps-list">
          <li>Activez <strong>Google Calendar API</strong> dans un projet <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Cloud</a>.</li>
          <li>Configurez l'écran de consentement (<em>Google Auth Platform</em>) et <strong>publiez</strong> l'application (sinon l'accès expire au bout de 7 jours).</li>
          <li>Créez un client OAuth de type <strong>Application Web</strong> avec cet URI de redirection autorisé :</li>
        </ol>
        <div className="row-actions" style={{ alignItems: 'center' }}>
          <code className="code-line">{s.redirect_uri}</code>
          <button type="button" className="btn btn-small" onClick={copy}>Copier</button>
        </div>
        {insecure && <p className="warn small">Google n'accepte cette adresse qu'en HTTPS (seul http://localhost est toléré). Renseignez l'adresse publique HTTPS de l'application (APP_URL, ou Paramètres → Laboratoire).</p>}
        {s.from_env && <p className="muted small">Identifiants actuellement lus dans server/.env (GOOGLE_CLIENT_ID). Ceux saisis ci-dessous les remplacent.</p>}
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="ID client" className="span-all"><input value={s.client_id} placeholder="…apps.googleusercontent.com" onChange={(e) => setS((x) => ({ ...x, client_id: e.target.value }))} /></Field>
          <Field label="Code secret du client" className="span-all"><input type="password" autoComplete="off" value={s.client_secret} onChange={(e) => setS((x) => ({ ...x, client_secret: e.target.value }))} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={s.full_names} onChange={(e) => setS((x) => ({ ...x, full_names: e.target.checked }))} /> Afficher le nom complet du patient dans Google Agenda (sinon : initiales uniquement)</label>
        <div className="form-actions"><span className="grow" /><button className="btn btn-primary">Enregistrer</button></div>
      </section>
      <section className="card list-card">
        <h2>Comptes connectés</h2>
        {s.accounts.length === 0 ? <p className="muted small">Aucun utilisateur n'a encore connecté son Google Agenda.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Utilisateur</th><th>Compte Google</th><th>État</th><th>Dernière synchronisation</th></tr></thead>
            <tbody>{s.accounts.map((a) => (
              <tr key={a.user_id}><td>{a.user_name}{!a.user_active && <span className="tag tag-soft">inactif</span>}</td><td>{a.google_email || '—'}</td>
                <td><span className={`delivery delivery-${a.status === 'ok' ? 'envoye' : 'echec'}`}>{GCAL_STATUS[a.status] || a.status}</span>{a.status !== 'ok' && a.last_error && <div className="muted small">{a.last_error}</div>}</td>
                <td className="date-cell">{a.last_sync_at ? fmtDate(a.last_sync_at.replace(' ', 'T').slice(0, 16)) : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </form>
  );
}

const DELIVERY_STATUS = { envoye: 'Envoyé', echec: 'Échec', non_configure: 'Non configuré' };
function Deliveries() {
  const { data, error, reload } = useLoad(() => api.get('/notification-deliveries'), []);
  const { toast } = useUi();
  const scan = async () => { await api.post('/notifications/scan'); toast('Vérification des échéances effectuée.'); reload(); };
  return (
    <section className="card list-card">
      <div className="toolbar"><p className="muted small grow">Traçabilité de chaque envoi : date, canal, destinataire et résultat.</p><button className="btn btn-small" onClick={scan}>Vérifier les échéances maintenant</button></div>
      <ErrorBox error={error} />
      {data && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Notification</th><th>Destinataire</th><th>Canal</th><th>Résultat</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.id}><td className="date-cell">{fmtDate(d.at.replace(' ', 'T').slice(0, 16))}</td><td>{d.title || <span className="muted">test</span>}</td><td>{d.user_name}<div className="muted small">{d.recipient}</div></td>
              <td>{CHANNELS.find(([c]) => c === d.channel)?.[1] || d.channel}</td><td><span className={`delivery delivery-${d.status}`}>{DELIVERY_STATUS[d.status]}</span>{d.error && <div className="muted small">{d.error}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Backups() {
  const { toast, confirm } = useUi();
  const { settings, loadSettings } = useAuth();
  const [cfg, setCfg] = useState(settings.backup);
  const { data, error, reload } = useLoad(() => api.get('/backups'), []);
  const fileRef = useRef(null);
  const make = async () => { const r = await api.post('/backups'); toast(`Sauvegarde ${r.name} créée.`); reload(); };
  const restore = async (name) => {
    if (!(await confirm({ title: 'Restaurer une sauvegarde', message: `Toutes les données actuelles seront remplacées par celles de « ${name} ». Une sauvegarde de l'état actuel est faite automatiquement avant la restauration.`, confirmLabel: 'Restaurer', danger: true }))) return;
    try { await api.post(`/backups/${encodeURIComponent(name)}/restore`); toast('Sauvegarde restaurée. Rechargement…'); setTimeout(() => window.location.reload(), 1200); } catch (e) { toast(e.message, 'error'); }
  };
  const upload = async (file) => {
    if (!file) return;
    if (!(await confirm({ title: 'Restaurer depuis un fichier', message: `Toutes les données actuelles seront remplacées par celles du fichier « ${file.name} ».`, confirmLabel: 'Restaurer', danger: true }))) { fileRef.current.value = ''; return; }
    const fd = new FormData(); fd.append('file', file);
    try { await api.post('/backups/upload-restore', fd); toast('Sauvegarde restaurée. Rechargement…'); setTimeout(() => window.location.reload(), 1200); } catch (e) { toast(e.message, 'error'); }
    fileRef.current.value = '';
  };
  const saveCfg = async () => { try { await api.put('/settings', { backup: cfg }); await loadSettings(); toast('Planification enregistrée.'); } catch (e) { toast(e.message, 'error'); } };
  const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.ceil(b / 1e3)} Ko`);
  return (
    <div>
      <section className="card">
        <h2>Sauvegarde automatique</h2>
        <p className="muted small">Chaque sauvegarde est une copie complète de la base MongoDB (fichier .json.gz), conservée sur le serveur et téléchargeable. Pensez à en copier régulièrement une hors du serveur.</p>
        <div className="toolbar">
          <label className="inline-field">Chaque jour à <input type="number" min="0" max="23" value={cfg.hour} onChange={(e) => setCfg((c) => ({ ...c, hour: e.target.value }))} /> h</label>
          <label className="inline-field">Conserver les <input type="number" min="1" max="365" value={cfg.keep} onChange={(e) => setCfg((c) => ({ ...c, keep: e.target.value }))} /> dernières</label>
          <button className="btn btn-small" onClick={saveCfg}>Enregistrer</button>
        </div>
      </section>
      <section className="card list-card">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={make}>Créer une sauvegarde maintenant</button>
          <label className="btn">Restaurer depuis un fichier…<input ref={fileRef} type="file" accept=".gz,.json,application/gzip,application/json" hidden onChange={(e) => upload(e.target.files[0])} /></label>
        </div>
        <ErrorBox error={error} />
        {data && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fichier</th><th>Date</th><th className="num">Taille</th><th /></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.name}><td className="mono-num">{b.name}</td><td>{new Date(b.created_at).toLocaleString('fr-FR')}</td><td className="num">{size(b.size)}</td>
                <td className="num row-actions"><button className="btn btn-small" onClick={() => openFile(`/backups/${encodeURIComponent(b.name)}/download`, b.name)}>Télécharger</button>
                  <button className="btn btn-small btn-danger-ghost" onClick={() => restore(b.name)}>Restaurer</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.get(`/audit?q=${encodeURIComponent(q)}`), [q]);
  return (
    <section className="card list-card">
      <div className="toolbar"><input className="search" type="search" placeholder="Rechercher une action, un utilisateur…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      {data && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Élément</th><th>Détails</th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}><td className="date-cell">{fmtDate(a.at.replace(' ', 'T').slice(0, 16))}</td><td>{a.user_name}</td><td>{a.action}</td><td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
              <td className="small muted details-cell">{a.details && Object.entries(JSON.parse(a.details)).map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ; ')}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}