import { useCallback, useEffect, useState } from "react";

import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Menu } from "lucide-react";



import { useAuth } from "./AuthContext.jsx";

import ComptabiliteSessionBar from "./components/ComptabiliteSessionBar.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { SessionRequirementProvider } from "./components/SessionRequirementModal.jsx";

import {

  canAccessPath,

  defaultHomePath,

  displayUserName,

  isAdminUser,

  isComptable,

  isPasswordOpsOnlyUser,

  isPointageAgent,

} from "./authRoles.js";

import { API_AUTH_LOGOUT, STORAGE_AUTH_KEY, apiFetch } from "./config.js";
import { SCHOOL_NAME, SCHOOL_TAGLINE, logoSchoolPublicUrl } from "./branding.js";



function userInitials(sessionLabel) {

  if (!sessionLabel || typeof sessionLabel !== "string") {

    return "?";

  }

  const parts = sessionLabel.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {

    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase() || "?";

  }

  return sessionLabel.slice(0, 2).toUpperCase() || "?";

}



function getInitialDrawerOpen() {

  if (typeof window === "undefined") {

    return true;

  }

  return window.matchMedia("(min-width: 768px)").matches;

}



export default function DashboardAdmin() {

  const navigate = useNavigate();

  const location = useLocation();

  const { user, refreshUser, setUser } = useAuth();

  const [isOpen, setIsOpen] = useState(getInitialDrawerOpen);

  const closeDrawerIfMobile = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(max-width: 767px)").matches) {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {

    refreshUser();

  }, [refreshUser]);

  useEffect(() => {
    function syncBodyScrollLock() {
      const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
      if (mobile && isOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    }

    syncBodyScrollLock();
    window.addEventListener("resize", syncBodyScrollLock);
    return () => {
      window.removeEventListener("resize", syncBodyScrollLock);
      document.body.style.overflow = "";
    };
  }, [isOpen]);



  useEffect(() => {

    if (user && !canAccessPath(location.pathname, user)) {

      navigate(defaultHomePath(user), { replace: true });

    }

  }, [user, location.pathname, navigate]);



  useEffect(() => {

    if (typeof window === "undefined") {

      return;

    }

    if (!window.matchMedia("(max-width: 767px)").matches) {

      return;

    }

    const id = window.setTimeout(() => setIsOpen(false), 0);

    return () => clearTimeout(id);

  }, [location.pathname]);



  async function handleLogout() {

    try {

      await apiFetch(API_AUTH_LOGOUT, {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: "{}",

      });

    } catch {

      /* session peut être invalide : on déconnecte quand même côté client */

    }

    localStorage.removeItem(STORAGE_AUTH_KEY);

    setUser(null);

    navigate("/login", { replace: true });

  }



  const admin = isAdminUser(user);

  const passwordOpsOnly = isPasswordOpsOnlyUser(user);

  const pointageAgent = isPointageAgent(user);

  const comptable = isComptable(user);

  const elevesAgentOnly = !passwordOpsOnly && pointageAgent && !admin;

  const layoutHomeTo = user ? defaultHomePath(user) : "/dashboard";



  const showFinance = !passwordOpsOnly && (admin || comptable);

  const showDepenses = !passwordOpsOnly && (admin || comptable);

  const showScolarite = !passwordOpsOnly && admin;

  /** Direction + RH complets (emploi, pointage, pointage personnel, etc.) : admin uniquement. */
  const showFullRh = !passwordOpsOnly && admin;
  /** Professeurs + Personnel (paiement salaires) : comptable sans droits RH complets. */
  const showRhPayrollOnly = !passwordOpsOnly && comptable && !admin;

  const showAudit = !passwordOpsOnly && admin;

  const showSettings = !passwordOpsOnly && admin;



  const sessionLabel = displayUserName(user);

  const roleLabel = user?.role_label || user?.role || "—";



  return (

    <div
      id="app-dashboard-layout"
      className="flex h-screen overflow-hidden bg-slate-50 font-sans antialiased dark:bg-slate-950"
    >

      <Sidebar

        isOpen={isOpen}

        onClose={() => setIsOpen(false)}

        onNavigate={closeDrawerIfMobile}

        layoutHomeTo={layoutHomeTo}

        onLogout={handleLogout}

        elevesAgentOnly={elevesAgentOnly}

        showScolarite={showScolarite}

        showFinance={showFinance}

        showDepenses={showDepenses}

        showFullRh={showFullRh}

        showRhPayrollOnly={showRhPayrollOnly}

        showAudit={showAudit}

        showSettings={showSettings}

        passwordOpsOnly={passwordOpsOnly}

      />



      <div
        id="app-main-column"
        className="flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out"
      >

        <header
          id="app-top-navbar"
          className="print:hidden sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:gap-3 sm:px-4"
        >

          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">

            <button

              type="button"

              onClick={() => setIsOpen((open) => !open)}

              aria-controls="app-sidebar"

              aria-expanded={isOpen}

              aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}

              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"

            >

              <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />

            </button>

            <Link
              to={layoutHomeTo}
              className="dashboard-print-hide flex min-w-0 max-w-[min(100%,220px)] items-center gap-2 rounded-lg no-underline text-inherit hover:bg-slate-50 dark:hover:bg-slate-800 sm:max-w-xs"
              title={SCHOOL_NAME}
            >
              <img
                src={logoSchoolPublicUrl()}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 object-contain"
              />
              <div className="min-w-0 leading-tight">
                <p className="truncate font-semibold tracking-tight text-slate-900 dark:text-slate-100">{SCHOOL_NAME}</p>
                <p className="truncate text-[11px] text-slate-500 sm:text-xs dark:text-slate-400">{SCHOOL_TAGLINE}</p>
              </div>
            </Link>

          </div>

          <div className="flex min-w-0 shrink-0 items-center justify-end gap-3">

            <div className="hidden min-w-0 text-right sm:block">

              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{sessionLabel || "—"}</p>

              <p className="truncate text-xs text-slate-500 dark:text-slate-400">

                {roleLabel}

                {user?.role ? <span className="text-slate-400 dark:text-slate-500"> · {user.role}</span> : null}

              </p>

            </div>

            <div

              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-xs font-bold text-slate-800 shadow-sm ring-2 ring-white dark:from-slate-600 dark:to-slate-700 dark:text-slate-100 dark:ring-slate-900"

              aria-hidden

            >

              {userInitials(sessionLabel || user?.username || "")}

            </div>

          </div>

        </header>



        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-slate-50 print:min-h-0 print:overflow-visible dark:bg-slate-950">

          <div
            id="app-main-content"
            className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-6 md:py-8 lg:px-8"
          >

            {showFinance ? (
              <div className="print:hidden sticky top-0 z-10 mb-5 w-full shrink-0 bg-slate-50 dark:bg-slate-950">
                <ComptabiliteSessionBar />
              </div>
            ) : null}

            <div className="min-h-0 flex-1">
              <SessionRequirementProvider>
                <Outlet />
              </SessionRequirementProvider>
            </div>

          </div>

        </main>

      </div>

    </div>

  );

}

