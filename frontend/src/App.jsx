import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./AuthContext.jsx";
import AuditLogsPage from "./AuditLogsPage.jsx";
import CaissePage from "./CaissePage.jsx";
import CaisseJustificatifsPage from "./CaisseJustificatifsPage.jsx";
import DepensesPage from "./DepensesPage.jsx";
import DashboardAdmin from "./DashboardAdmin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ElevesPage from "./ElevesPage.jsx";
import GestionClasses from "./GestionClasses.jsx";
import EmploiDuTempsPage from "./EmploiDuTempsPage.jsx";
import HistoriqueEmploiPage from "./HistoriqueEmploiPage.jsx";
import PaiementsPage from "./PaiementsPage.jsx";
import PersonnelPage from "./PersonnelPage.jsx";
import PointageQuotidien from "./PointageQuotidien.jsx";
import ProfesseursPage from "./ProfesseursPage.jsx";
import ParametresPage from "./pages/ParametresPage.jsx";
import PointagePersonnelPage from "./pages/PointagePersonnelPage.jsx";
import Login from "./components/Login.jsx";
import ForgotPasswordPage from "./components/ForgotPasswordPage.jsx";
import PasswordOpsPage from "./components/PasswordOpsPage.jsx";
import PremiereConnexionPage from "./components/PremiereConnexionPage.jsx";
import ResetPasswordPage from "./components/ResetPasswordPage.jsx";
import { canAccessPath, defaultHomePath, readStoredUserRaw } from "./authRoles.js";

function RootRedirect() {
  const { user } = useAuth();
  const stored = user ?? readStoredUserRaw();
  if (!stored) {
    return <Navigate to="/login" replace />;
  }
  if (stored.must_change_password) {
    return <Navigate to="/premiere-connexion" replace />;
  }
  return <Navigate to={defaultHomePath(stored)} replace />;
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.must_change_password) {
    return <Navigate to="/premiere-connexion" replace />;
  }
  return children;
}

/** Redirige vers defaultHomePath si le rôle n’a pas le droit d’accès (ex. /dashboard réservé aux admins, COMPTABLE → /caisse). */
function RoleProtectedRoute({ children }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!canAccessPath(pathname, user)) {
    return <Navigate to={defaultHomePath(user)} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
      <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
      <Route path="/premiere-connexion" element={<PremiereConnexionPage />} />

      <Route element={<ProtectedRoute><DashboardAdmin /></ProtectedRoute>}>
        <Route
          path="/outils-mot-de-passe"
          element={
            <RoleProtectedRoute>
              <PasswordOpsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RoleProtectedRoute>
              <Dashboard />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/eleves"
          element={
            <RoleProtectedRoute>
              <ElevesPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/gestion-classes"
          element={
            <RoleProtectedRoute>
              <GestionClasses />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/paiements"
          element={
            <RoleProtectedRoute>
              <PaiementsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/depenses"
          element={
            <RoleProtectedRoute>
              <DepensesPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/caisse"
          element={
            <RoleProtectedRoute>
              <CaissePage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/caisse-justificatifs"
          element={
            <RoleProtectedRoute>
              <CaisseJustificatifsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/pointage-quotidien"
          element={
            <RoleProtectedRoute>
              <PointageQuotidien />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/pointage"
          element={
            <RoleProtectedRoute>
              <PointageQuotidien />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/professeurs"
          element={
            <RoleProtectedRoute>
              <ProfesseursPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/personnel"
          element={
            <RoleProtectedRoute>
              <PersonnelPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/pointage-personnel"
          element={
            <RoleProtectedRoute>
              <PointagePersonnelPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/emploi-du-temps"
          element={
            <RoleProtectedRoute>
              <EmploiDuTempsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/historique-emploi"
          element={
            <RoleProtectedRoute>
              <HistoriqueEmploiPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <RoleProtectedRoute>
              <AuditLogsPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <RoleProtectedRoute>
              <ParametresPage />
            </RoleProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
