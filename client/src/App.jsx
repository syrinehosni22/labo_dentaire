import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { ErrorBox, Loading } from './components/ui';
import { ForceChangePage, ForgotPage, LoginPage, ResetPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import RequestForm from './pages/RequestForm';
import { DoctorDetail, DoctorList } from './pages/Doctors';
import { CarnetDetail, CarnetList, FicheForm } from './pages/Fiches';
import Tarifs from './pages/Tarifs';
import { InvoiceEdit, InvoiceList } from './pages/Invoices';
import Stats from './pages/Stats';
import { NotificationHistory, Profile } from './pages/Account';
import { Settings, Users } from './pages/Admin';

function Guard({ perm, children }) {
  const { can } = useAuth();
  const ok = !perm || (Array.isArray(perm) ? can(...perm) : can(perm));
  return ok ? children : <ErrorBox error="Vous n'avez pas accès à cette page. Demandez à un administrateur de vous attribuer ce droit." />;
}

// Remember where the person wanted to go, then send them to the login page
function ToLogin() {
  const loc = useLocation();
  const target = loc.pathname + loc.search;
  return <Navigate to={target === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(target)}`} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <Routes>
        <Route path="connexion" element={<LoginPage />} />
        <Route path="mot-de-passe-oublie" element={<ForgotPage />} />
        <Route path="reinitialiser/:token" element={<ResetPage />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    );
  }
  if (user.must_change_password) {
    return (
      <Routes>
        <Route path="reinitialiser/:token" element={<ResetPage />} />
        <Route path="*" element={<ForceChangePage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="connexion" element={<Navigate to="/" replace />} />
      <Route path="mot-de-passe-oublie" element={<Navigate to="/profil" replace />} />
      <Route path="reinitialiser/:token" element={<ResetPage />} />
      <Route element={<Layout />}>
        <Route index element={<Guard perm="requests_view"><Dashboard /></Guard>} />
        <Route path="demandes/nouvelle" element={<Guard perm="requests_edit"><RequestForm key="new" /></Guard>} />
        <Route path="demandes/:id" element={<Guard perm="requests_view"><RequestForm /></Guard>} />
        <Route path="medecins" element={<DoctorList />} />
        <Route path="medecins/:id" element={<DoctorDetail />} />
        <Route path="carnets" element={<Guard perm="fiches_manage"><CarnetList /></Guard>} />
        <Route path="carnets/:id" element={<Guard perm="fiches_manage"><CarnetDetail /></Guard>} />
        <Route path="fiches/nouvelle" element={<Guard perm="fiches_manage"><FicheForm key="new" /></Guard>} />
        <Route path="fiches/:id" element={<Guard perm="fiches_manage"><FicheForm /></Guard>} />
        <Route path="tarifs" element={<Tarifs />} />
        <Route path="factures" element={<Guard perm={['invoices_manage', 'invoices_validate']}><InvoiceList /></Guard>} />
        <Route path="factures/:id" element={<Guard perm={['invoices_manage', 'invoices_validate']}><InvoiceEdit /></Guard>} />
        <Route path="statistiques" element={<Guard perm="stats_view"><Stats /></Guard>} />
        <Route path="notifications" element={<NotificationHistory />} />
        <Route path="profil" element={<Profile />} />
        <Route path="utilisateurs" element={<Guard perm="users_manage"><Users /></Guard>} />
        <Route path="parametres" element={<Guard perm="settings_manage"><Settings /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
