import { Link, NavLink } from "react-router-dom";
import {
  Briefcase,
  Calendar,
  ClipboardCheck,
  CreditCard,
  FileText,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Presentation,
  Receipt,
  School,
  ScrollText,
  Settings,
  UserCheck,
  Users,
} from "lucide-react";

import { SCHOOL_NAME, SCHOOL_TAGLINE, logoSchoolPublicUrl } from "../branding.js";

function navLinkClass({ isActive }, collapsed) {
  return [
    "group flex items-center rounded-lg py-2.5 text-sm font-medium no-underline transition-colors border-l-4",
    collapsed ? "justify-center gap-0 px-0" : "gap-3 px-3",
    isActive
      ? "bg-slate-800 text-white border-blue-500 shadow-sm"
      : "border-transparent text-slate-300 hover:bg-slate-800/50 hover:text-white",
  ].join(" ");
}

function NavSection({ title, children, collapsed }) {
  return (
    <div>
      {collapsed ? null : (
        <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      )}
      <div className="flex flex-col space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({ to, end, icon, label, collapsed }) {
  const IconGlyph = icon;
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={collapsed ? label : undefined}
      className={(state) => navLinkClass(state, collapsed)}
    >
      <IconGlyph className="h-5 w-5 shrink-0 opacity-95" aria-hidden />
      <span className={collapsed ? "hidden" : ""}>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({
  isSidebarOpen,
  layoutHomeTo,
  onLogout,
  elevesAgentOnly,
  showScolarite,
  showFinance,
  showDepenses,
  showFullRh,
  showRhPayrollOnly,
  showAudit,
  showSettings,
  passwordOpsOnly = false,
}) {
  const collapsed = !isSidebarOpen;

  return (
    <aside
      id="app-sidebar"
      className={[
        "print:hidden flex h-full min-h-0 shrink-0 flex-col overflow-y-auto border-r border-slate-800/80 bg-slate-950 text-white transition-all duration-300 ease-in-out",
        "fixed inset-y-0 left-0 z-50 w-64 md:relative md:z-auto",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0",
        isSidebarOpen ? "md:w-64" : "md:w-20",
      ].join(" ")}
    >
      <div
        className={[
          "border-b border-slate-800/90 py-4 transition-all duration-300 ease-in-out",
          collapsed ? "px-0 md:flex md:justify-center md:px-0" : "px-4",
        ].join(" ")}
      >
        <Link
          to={layoutHomeTo}
          title={SCHOOL_NAME}
          aria-label={`${SCHOOL_NAME} — accueil`}
          className={[
            "flex items-center text-inherit no-underline hover:opacity-90",
            collapsed ? "justify-center gap-0 md:w-full" : "justify-center gap-2.5 md:justify-start",
          ].join(" ")}
        >
          <img
            src={logoSchoolPublicUrl()}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-lg bg-white/95 object-contain p-0.5 shadow-sm ring-1 ring-white/10"
          />
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight text-white">{SCHOOL_NAME}</p>
              <p className="mt-0.5 text-xs text-slate-400">{SCHOOL_TAGLINE}</p>
            </div>
          ) : null}
        </Link>
      </div>

      <nav
        className={[
          "flex flex-1 flex-col space-y-6 py-4 transition-all duration-300 ease-in-out",
          collapsed ? "px-0 md:px-1" : "px-2",
        ].join(" ")}
        aria-label="Navigation principale"
      >
        {passwordOpsOnly ? (
          <NavSection title="Technique" collapsed={collapsed}>
            <NavItem
              to="/outils-mot-de-passe"
              icon={KeyRound}
              label="Réinitialisation e-mail"
              collapsed={collapsed}
            />
          </NavSection>
        ) : elevesAgentOnly ? (
          <NavSection title="Navigation" collapsed={collapsed}>
            <NavItem to="/eleves" icon={Users} label="Élèves" collapsed={collapsed} />
            <NavItem to="/pointage-quotidien" icon={ClipboardCheck} label="Pointage Quotidien" collapsed={collapsed} />
            <NavItem to="/pointage-personnel" icon={UserCheck} label="Pointage Personnel" collapsed={collapsed} />
          </NavSection>
        ) : (
          <>
            {showScolarite ? (
              <NavSection title="Scolarité" collapsed={collapsed}>
                <NavItem to="/dashboard" end icon={LayoutDashboard} label="Tableau de bord" collapsed={collapsed} />
                <NavItem to="/eleves" icon={Users} label="Élèves" collapsed={collapsed} />
                <NavItem to="/gestion-classes" icon={School} label="Classes" collapsed={collapsed} />
              </NavSection>
            ) : null}

            {showFinance ? (
              <NavSection title="Finance" collapsed={collapsed}>
                <NavItem to="/paiements" icon={CreditCard} label="Paiements" collapsed={collapsed} />
                {showDepenses ? (
                  <NavItem to="/depenses" icon={Receipt} label="Dépenses" collapsed={collapsed} />
                ) : null}
                <NavItem to="/caisse" icon={Landmark} label="Caisse & historique" collapsed={collapsed} />
                <NavItem
                  to="/caisse-justificatifs"
                  icon={FileText}
                  label="Historique et Justificatifs Banque"
                  collapsed={collapsed}
                />
              </NavSection>
            ) : null}

            {showRhPayrollOnly ? (
              <NavSection title="Ressources humaines" collapsed={collapsed}>
                <NavItem to="/professeurs" icon={Presentation} label="Professeurs" collapsed={collapsed} />
                <NavItem to="/personnel" icon={Briefcase} label="Personnel" collapsed={collapsed} />
              </NavSection>
            ) : null}

            {showFullRh ? (
              <NavSection title="Direction" collapsed={collapsed}>
                <NavItem to="/pointage-personnel" icon={UserCheck} label="Pointage Personnel" collapsed={collapsed} />
                <NavItem to="/personnel" icon={Briefcase} label="Personnel" collapsed={collapsed} />
              </NavSection>
            ) : null}

            {showFullRh ? (
              <NavSection title="Ressources humaines" collapsed={collapsed}>
                <NavItem to="/professeurs" icon={Presentation} label="Professeurs" collapsed={collapsed} />
                <NavItem to="/pointage-quotidien" icon={ClipboardCheck} label="Pointage" collapsed={collapsed} />
                <NavItem to="/emploi-du-temps" icon={Calendar} label="Emploi du temps" collapsed={collapsed} />
                <NavItem to="/historique-emploi" icon={History} label="Imprimer Emploi" collapsed={collapsed} />
              </NavSection>
            ) : null}

            {showAudit ? (
              <NavSection title="Système" collapsed={collapsed}>
                <NavItem to="/audit-logs" icon={ScrollText} label="Journaux d'audit" collapsed={collapsed} />
              </NavSection>
            ) : null}
          </>
        )}
      </nav>

      {showSettings ? (
        <div
          className={[
            "border-t border-slate-800/90 pb-2 pt-2 transition-all duration-300 ease-in-out",
            collapsed ? "px-0 md:px-1" : "px-2",
          ].join(" ")}
        >
          <NavItem to="/settings" icon={Settings} label="Paramètres" collapsed={collapsed} />
        </div>
      ) : null}

      <div
        className={[
          "border-t border-slate-800/90 p-3 transition-all duration-300 ease-in-out",
          collapsed ? "px-0 md:px-1" : "",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onLogout}
          title="Déconnexion"
          aria-label="Déconnexion"
          className={[
            "flex w-full items-center rounded-lg border border-slate-700/90 bg-slate-900/80 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800",
            collapsed ? "justify-center gap-0 px-0" : "gap-3 px-3",
          ].join(" ")}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden />
          <span className={collapsed ? "hidden" : ""}>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
