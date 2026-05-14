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
  X,
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

function NavItem({ to, end, icon, label, collapsed, onNavigate }) {
  const IconGlyph = icon;
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={collapsed ? label : undefined}
      className={(state) => navLinkClass(state, collapsed)}
      onClick={() => onNavigate?.()}
    >
      <IconGlyph className="h-5 w-5 shrink-0 opacity-95" aria-hidden />
      <span className={collapsed ? "hidden" : ""}>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({
  isOpen,
  onClose,
  onNavigate,
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
  const collapsed = !isOpen;

  const sidebarBody = (
    <>
      <div
        className={[
          "border-b border-slate-800/90 py-4 transition-all duration-300 ease-in-out",
          collapsed ? "px-0 md:flex md:justify-center md:px-0" : "px-4",
          "pt-2 md:pt-[max(1rem,env(safe-area-inset-top))]",
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
          onClick={() => onNavigate?.()}
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
              onNavigate={onNavigate}
            />
          </NavSection>
        ) : elevesAgentOnly ? (
          <NavSection title="Navigation" collapsed={collapsed}>
            <NavItem to="/eleves" icon={Users} label="Élèves" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem
              to="/pointage-quotidien"
              icon={ClipboardCheck}
              label="Pointage Quotidien"
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
            <NavItem
              to="/pointage-personnel"
              icon={UserCheck}
              label="Pointage Personnel"
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </NavSection>
        ) : (
          <>
            {showScolarite ? (
              <NavSection title="Scolarité" collapsed={collapsed}>
                <NavItem
                  to="/dashboard"
                  end
                  icon={LayoutDashboard}
                  label="Tableau de bord"
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
                <NavItem to="/eleves" icon={Users} label="Élèves" collapsed={collapsed} onNavigate={onNavigate} />
                <NavItem to="/gestion-classes" icon={School} label="Classes" collapsed={collapsed} onNavigate={onNavigate} />
              </NavSection>
            ) : null}

            {showFinance ? (
              <NavSection title="Finance" collapsed={collapsed}>
                <NavItem to="/paiements" icon={CreditCard} label="Paiements" collapsed={collapsed} onNavigate={onNavigate} />
                {showDepenses ? (
                  <NavItem to="/depenses" icon={Receipt} label="Dépenses" collapsed={collapsed} onNavigate={onNavigate} />
                ) : null}
                <NavItem to="/caisse" icon={Landmark} label="Caisse & historique" collapsed={collapsed} onNavigate={onNavigate} />
                <NavItem
                  to="/caisse-justificatifs"
                  icon={FileText}
                  label="Historique et Justificatifs Banque"
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              </NavSection>
            ) : null}

            {showRhPayrollOnly ? (
              <NavSection title="Ressources humaines" collapsed={collapsed}>
                <NavItem to="/professeurs" icon={Presentation} label="Professeurs" collapsed={collapsed} onNavigate={onNavigate} />
                <NavItem to="/personnel" icon={Briefcase} label="Personnel" collapsed={collapsed} onNavigate={onNavigate} />
              </NavSection>
            ) : null}

            {showFullRh ? (
              <NavSection title="Direction" collapsed={collapsed}>
                <NavItem
                  to="/pointage-personnel"
                  icon={UserCheck}
                  label="Pointage Personnel"
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
                <NavItem to="/personnel" icon={Briefcase} label="Personnel" collapsed={collapsed} onNavigate={onNavigate} />
              </NavSection>
            ) : null}

            {showFullRh ? (
              <NavSection title="Ressources humaines" collapsed={collapsed}>
                <NavItem to="/professeurs" icon={Presentation} label="Professeurs" collapsed={collapsed} onNavigate={onNavigate} />
                <NavItem
                  to="/pointage-quotidien"
                  icon={ClipboardCheck}
                  label="Pointage"
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
                <NavItem to="/emploi-du-temps" icon={Calendar} label="Emploi du temps" collapsed={collapsed} onNavigate={onNavigate} />
                <NavItem to="/historique-emploi" icon={History} label="Imprimer Emploi" collapsed={collapsed} onNavigate={onNavigate} />
              </NavSection>
            ) : null}

            {showAudit ? (
              <NavSection title="Système" collapsed={collapsed}>
                <NavItem to="/audit-logs" icon={ScrollText} label="Journaux d'audit" collapsed={collapsed} onNavigate={onNavigate} />
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
          <NavItem to="/settings" icon={Settings} label="Paramètres" collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      ) : null}

      <div
        className={[
          "border-t border-slate-800/90 p-3 transition-all duration-300 ease-in-out",
          collapsed ? "px-0 md:px-1" : "",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            onLogout();
          }}
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
    </>
  );

  return (
    <>
      {/* Mobile : tiroir uniquement si isOpen — entièrement retiré du flux quand fermé */}
      <div
        className={[
          "print:hidden md:hidden fixed inset-0 z-50",
          isOpen ? "" : "hidden",
        ].join(" ")}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          aria-label="Fermer le menu"
          className="absolute inset-0 z-0 bg-slate-950/65 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <aside
          id="app-sidebar"
          className="relative z-10 flex h-full min-h-0 w-[min(85vw,16rem)] max-w-[280px] shrink-0 flex-col overflow-hidden border-r border-slate-800/80 bg-slate-950 text-white shadow-2xl"
        >
          <div
            className={[
              "flex shrink-0 items-center justify-end border-b border-slate-800/90 bg-slate-950",
              "px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <X className="h-6 w-6" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{sidebarBody}</div>
        </aside>
      </div>

      {/* Desktop : rail latéral */}
      <aside
        className={[
          "print:hidden hidden h-full min-h-0 shrink-0 flex-col overflow-y-auto border-r border-slate-800/80 bg-slate-950 text-white transition-all duration-300 ease-in-out md:flex",
          isOpen ? "md:w-64" : "md:w-20",
        ].join(" ")}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
