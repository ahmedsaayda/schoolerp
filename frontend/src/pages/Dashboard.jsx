import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calendar, CreditCard, Percent, Target, TrendingDown, Wallet } from "lucide-react";

import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { isAdminUser, isComptable, isPointageAgent } from "../authRoles.js";
import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "../branding.js";
import { ACADEMIC_MONTHS } from "../constants/academicMonths.js";
import { API_DASHBOARD_STATS, apiFetch } from "../config.js";
import { formatCurrency } from "../DashboardHome.jsx";
import { localISODate } from "../utils/dateLocal.js";
import { formatTnNumber } from "../utils/tunisianMoney.js";
import DateRangePickerCustom from "../components/common/DateRangePickerCustom.jsx";
import Loading from "../components/ui/Loading.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.jsx";

const PIE_COLORS = {
  "À jour": "#059669",
  "En retard": "#e11d48",
  Avance: "#2563eb",
};

const DEPENSE_PIE_COLORS = ["#ea580c", "#dc2626", "#f97316", "#c2410c", "#78716c"];

const CHART_TIP =
  "rounded-lg border border-slate-700/95 bg-slate-900 px-3 py-2.5 text-xs text-white shadow-xl";

/** Hauteur fixe du slot : parent en px obligatoire pour éviter width/height -1 et les warns Recharts avec width="100%" height="100%". */
const DASHBOARD_CHART_HEIGHT_PX = 300;

/**
 * Mesure la largeur du slot puis fournit des dimensions entières à ResponsiveContainer (évite SizeDetector / état -1).
 */
function DashboardChartSlot({ children }) {
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: DASHBOARD_CHART_HEIGHT_PX });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const read = () => {
      const r = el.getBoundingClientRect();
      const raw = r.width > 0 ? r.width : el.clientWidth;
      const w = Math.round(raw);
      if (w < 1) return;
      setDims((d) => {
        const next = { width: w, height: DASHBOARD_CHART_HEIGHT_PX };
        return d.width === next.width && d.height === next.height ? d : next;
      });
    };

    read();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="h-[300px] w-full min-w-0 shrink-0"
      style={{ height: DASHBOARD_CHART_HEIGHT_PX, width: "100%" }}
    >
      {dims.width > 0 ? (
        children(dims.width, dims.height)
      ) : (
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-slate-400">
          …
        </div>
      )}
    </div>
  );
}

function EncaissementsAreaTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className={CHART_TIP}>
      <p className="text-[11px] font-semibold text-slate-200">{label}</p>
      <p className="mt-1.5 tabular-nums text-sm font-semibold text-white">{formatCurrency(v)}</p>
      <p className="mt-0.5 text-[10px] text-slate-400">Mois d&apos;encaissement</p>
    </div>
  );
}

function RepartitionStatutsPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const name = row?.name ?? payload[0].name;
  const value = row?.value ?? payload[0].value;
  return (
    <div className={CHART_TIP}>
      <p className="text-[11px] font-semibold text-emerald-200/90">Statut de paiement</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{name}</p>
      <p className="mt-1.5 tabular-nums text-white">
        {value} élève{Number(value) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

function DepensesCategoriePieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const name = row?.name ?? payload[0].name;
  const value = row?.value ?? payload[0].value;
  return (
    <div className={CHART_TIP}>
      <p className="text-[11px] font-semibold text-amber-200/90">Dépense par catégorie</p>
      <p className="mt-0.5 text-sm font-medium text-white">{name}</p>
      <p className="mt-1.5 tabular-nums text-sm font-semibold text-white">{formatCurrency(value)}</p>
    </div>
  );
}

function parseNum(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatPercent(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toLocaleString("fr-TN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return String(iso);
  }
}

function KpiIconBox({ children, className = "" }) {
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${className}`}
      aria-hidden
    >
      {children}
    </div>
  );
}

function buildDashboardStatsUrl(startDate, endDate) {
  const u = new URL(API_DASHBOARD_STATS);
  const s = startDate?.trim() ?? "";
  const e = endDate?.trim() ?? "";
  if (s && e) {
    u.searchParams.set("start_date", s);
    u.searchParams.set("end_date", e);
  }
  return u.toString();
}

export default function Dashboard() {
  const { user: authUser } = useAuth();
  const canSee = isAdminUser(authUser) || isComptable(authUser);
  const elevesAgentDashboard = isPointageAgent(authUser) && !isAdminUser(authUser);

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      const hasStart = Boolean(startDate?.trim());
      const hasEnd = Boolean(endDate?.trim());
      if (hasStart !== hasEnd) {
        if (!cancelled) {
          setLoadError(
            "Indiquez une date de début et une date de fin, ou laissez les deux champs vides (toutes les périodes).",
          );
          setStats(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setLoadError("");
      }
      try {
        const url = buildDashboardStatsUrl(startDate, endDate);
        const res = await apiFetch(url);
        if (res.status === 403 || res.status === 401) {
          throw new Error("Accès refusé.");
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg =
            typeof err.detail === "string"
              ? err.detail
              : Array.isArray(err.detail)
                ? err.detail.map((x) => (typeof x === "string" ? x : x?.msg ?? "")).filter(Boolean).join(" ")
                : `Erreur ${res.status}`;
          throw new Error(msg || `Erreur ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) {
          setStats(null);
          setLoadError(e instanceof Error ? e.message : "Chargement impossible.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [canSee, startDate, endDate, refreshTick]);

  const k = stats?.kpis;
  const deficitMoisCourant = stats?.deficit_mois_courant ?? k?.deficit_mois_courant;

  const chartEncaissements = useMemo(
    () =>
      (stats?.encaissements_par_mois ?? []).map((row) => ({
        mois: row.label_court,
        encaisse: parseNum(row.montant),
      })),
    [stats],
  );

  const chartPie = useMemo(
    () =>
      (stats?.repartition_statuts ?? []).map((row) => ({
        name: row.name,
        value: row.value,
        eleves: row.eleves,
      })),
    [stats],
  );

  const chartDepensesParCategorie = useMemo(() => {
    const rows = stats?.depenses_par_categorie ?? [];
    return rows
      .map((row) => ({
        name: row.name,
        value: parseNum(row.montant),
      }))
      .filter((row) => row.value > 0);
  }, [stats]);

  const dashboardDatePicker = (
    <div
      className="flex w-full min-w-0 justify-center"
      role="search"
      aria-label="Filtrer par période"
    >
      <div className="w-full min-w-0 min-[500px]:max-w-sm min-[500px]:min-w-[240px]">
        <DateRangePickerCustom
          id="dashboard-periode"
          label="Période du rapport"
          startDate={startDate}
          endDate={endDate}
          onChange={({ startDate: s, endDate: e }) => {
            setStartDate(s);
            setEndDate(e);
          }}
          allowEmpty={false}
          popoverAlign="center"
          className="w-full"
        />
      </div>
    </div>
  );

  const dashboardHeaderActions = (
    <div className="dashboard-print-hide flex flex-wrap items-end justify-end gap-2 self-end print:hidden">
      <button
        type="button"
        onClick={() => setRefreshTick((t) => t + 1)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
      >
        Actualiser
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
      >
        <span aria-hidden>🖨️</span>
        Imprimer rapport
      </button>
    </div>
  );

  const dashboardPrintLetterhead = (
    <div className="mb-6 hidden items-center gap-4 border-b-2 border-[#0f172a] pb-4 print:mb-8 print:flex">
      <img
        src={schoolLogoPrintPublicUrl()}
        alt="SAMAH SCHOOL Logo"
        width={64}
        height={64}
        className="h-16 w-auto shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p className="text-lg font-semibold tracking-tight text-[#0f172a]">{SCHOOL_NAME}</p>
        <p className="mt-0.5 text-sm text-[#64748b]">{SCHOOL_TAGLINE}</p>
      </div>
    </div>
  );

  const pageHeader = (
    <header className="mb-8 grid grid-cols-1 items-end gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-6">
      <div className="min-w-0 lg:justify-self-start">
        <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Tableau de Bord</h1>
        <p className="mt-1.5 max-w-[720px] text-sm leading-relaxed text-[#64748b]">
          Aperçu financier et administratif de l&apos;année scolaire
        </p>
      </div>
      {dashboardDatePicker}
      {dashboardHeaderActions}
    </header>
  );

  if (elevesAgentDashboard) {
    return (
      <div className="w-full max-w-xl space-y-6 rounded-xl border border-[#e2e8f0] bg-white p-8 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <header>
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Tableau de bord</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#64748b]">
            Espace agent de saisie : inscrire et mettre à jour les dossiers élèves. Les modules finance et
            ressources humaines ne sont pas accessibles depuis ce compte.
          </p>
        </header>
        <Link
          to="/eleves"
          className="inline-flex items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
        >
          Ouvrir la page Élèves
        </Link>
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Ce tableau de bord est réservé aux administrateurs et comptables.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-print-root w-full min-w-0 print:w-full print:min-w-0 print:max-w-none">
        {dashboardPrintLetterhead}
        {pageHeader}
        <Loading message="Chargement du tableau de bord…" className="min-h-[280px] py-16" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="dashboard-print-root w-full min-w-0 print:w-full print:min-w-0 print:max-w-none">
        {dashboardPrintLetterhead}
        {pageHeader}
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {loadError}
        </div>
      </div>
    );
  }

  if (!k) {
    return (
      <div className="dashboard-print-root w-full min-w-0 print:w-full print:min-w-0 print:max-w-none">
        {dashboardPrintLetterhead}
        {pageHeader}
        <Loading message="Données indisponibles." className="min-h-[200px] py-12" />
      </div>
    );
  }

  const derniers = stats?.derniers_encaissements ?? [];
  const topImpayes = stats?.top_impayes ?? [];
  const periodeActive = Boolean(stats?.periode_stats?.active);
  const totalDepensesKpi = k.total_depenses ?? stats?.total_depenses ?? "0";
  const ratioDepensesRecettes =
    typeof k.ratio_depenses_recettes === "number"
      ? k.ratio_depenses_recettes
      : typeof stats?.ratio_depenses_recettes === "number"
        ? stats.ratio_depenses_recettes
        : 0;

  return (
    <div className="dashboard-print-root w-full min-w-0 print:w-full print:min-w-0 print:max-w-none">
      {dashboardPrintLetterhead}
      {pageHeader}

      {/* KPI — aligné ACADEMIC_MONTHS pour cohérence */}

      <section
        className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 lg:items-stretch"
        aria-label="Indicateurs clés"
      >
        <Card className="flex flex-col overflow-hidden border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-emerald-100 text-emerald-700">
              <Wallet className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                {periodeActive ? "Total encaissé (période)" : "Total encaissé (tout)"}
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-emerald-950">
                {formatCurrency(k.total_encaisse_annee)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-emerald-900/70">
                {periodeActive
                  ? `Somme des encaissements entre le ${stats.periode_stats.start_date} et le ${stats.periode_stats.end_date} (date d'encaissement).`
                  : "Somme des montants encaissés sur tous les enregistrements de paiement."}
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden border-orange-200/90 bg-gradient-to-br from-orange-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-orange-100 text-orange-700">
              <Wallet className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-950/85">
                {periodeActive ? "Total dépenses (période)" : "Total dépenses (tout)"}
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-orange-950">
                {formatCurrency(totalDepensesKpi)}
              </p>
              <p className="mt-1.5 text-sm font-medium tabular-nums text-orange-800/90">
                {formatPercent(ratioDepensesRecettes)} du total encaissé
              </p>
              <p className="mt-2 text-xs leading-relaxed text-orange-900/70">
                {periodeActive
                  ? `Somme des charges enregistrées (date de dépense) du ${stats.periode_stats.start_date} au ${stats.periode_stats.end_date}, rapportée aux encaissements de la même période.`
                  : "Somme des dépenses d'exploitation sur toutes les écritures. Le pourcentage compare aux encaissements (tout)."}
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden border-rose-200/90 bg-gradient-to-br from-rose-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-rose-100 text-rose-700">
              <TrendingDown className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-900/80">
                Reste à recouvrer (global)
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-rose-950">
                {formatCurrency(k.reste_a_recouvrer_global)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-rose-900/70">
                Somme des reliquats par ligne (échéance − payé) lorsque l’échéance dépasse le payé.
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden border-amber-200/95 bg-gradient-to-br from-amber-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-amber-100 text-amber-700">
              <Calendar className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">
                Déficit du mois ({k.mois_courant_label})
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-amber-950">
                {formatCurrency(deficitMoisCourant)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-amber-900/70">
                Écart entre la masse mensuelle théorique (somme des tarifs) et les encaissements affectés au mois
                calendaire courant ({k.mois_courant_code}).
              </p>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden border-sky-200/90 bg-gradient-to-br from-sky-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-sky-100 text-sky-700">
              <Percent className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-900/80">
                Taux de recouvrement
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-sky-950">
                {formatPercent(k.taux_recouvrement_pct)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-sky-900/70">
                Total encaissé par rapport à l&apos;attendu annuel (somme des tarifs mensuels × 10 mois).
              </p>
              {typeof k.pourcentage_soldes === "number" ? (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/85">
                    Année complètement soldée
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-900">
                    {formatPercent(k.pourcentage_soldes)} des élèves
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-emerald-800/90">
                    Ont réglé exactement leur annuité (tarif × 10) — solde annuel nul, sans avance.
                  </p>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-200/70"
                    role="progressbar"
                    aria-valuenow={Math.min(100, Math.max(0, k.pourcentage_soldes))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Part des élèves ayant soldé l'année complète"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{
                        width: `${Math.min(100, Math.max(0, k.pourcentage_soldes))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden border-violet-200/90 bg-gradient-to-br from-violet-50/90 via-white to-white p-6">
          <div className="flex items-start gap-4">
            <KpiIconBox className="bg-violet-100 text-violet-700">
              <Target className="h-5 w-5" strokeWidth={2} />
            </KpiIconBox>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-900/80">
                Objectif journalier
              </p>
              <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-violet-950">
                {formatCurrency(k.objectif_journalier ?? stats?.objectif_journalier)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-violet-900/70">
                Reliquat cible (max. déficit du mois et reliquat des frais rattachés au trimestre en cours) divisé
                par les jours d&apos;école restant jusqu&apos;à la fin du trimestre.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-0 pb-0">
            <CardTitle>Évolution des encaissements</CardTitle>
            <CardDescription>
              {periodeActive
                ? `Revenus par mois d'encaissement du ${stats.periode_stats.start_date} au ${stats.periode_stats.end_date} (mois concernés par la période).`
                : `Revenus enregistrés par mois d'encaissement (${ACADEMIC_MONTHS[0][1]} → ${ACADEMIC_MONTHS[9][1]}).`}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <DashboardChartSlot>
              {(w, h) =>
                chartEncaissements.length > 0 ? (
                  <ResponsiveContainer width={w} height={h}>
                    <AreaChart data={chartEncaissements} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fillEncaisse" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="mois" tick={{ fontSize: 11 }} stroke="#64748b" />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="#64748b"
                        tickFormatter={(v) => formatTnNumber(v, { maximumFractionDigits: 0 })}
                      />
                      <Tooltip content={<EncaissementsAreaTooltip />} cursor={{ stroke: "rgba(5, 150, 105, 0.25)" }} />
                      <Area
                        type="monotone"
                        dataKey="encaisse"
                        name="Encaissements"
                        stroke="#059669"
                        strokeWidth={2}
                        fill="url(#fillEncaisse)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-slate-500">
                    Aucune donnée d&apos;encaissement pour afficher le graphique.
                  </div>
                )
              }
            </DashboardChartSlot>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-0 pb-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Répartition des statuts de paiement</CardTitle>
                <CardDescription>
                  Élèves classés par situation : à jour (année soldée), en retard (solde annuel positif), avance (crédit).
                </CardDescription>
              </div>
              {typeof k.pourcentage_soldes === "number" ? (
                <div
                  className="shrink-0 rounded-lg border border-emerald-500 bg-emerald-600 px-2.5 py-1.5 text-center text-[11px] font-bold uppercase leading-tight text-white shadow-sm"
                  title="Part des élèves ayant soldé l'année (ni dette ni avance sur l'annuité théorique)"
                >
                  {formatPercent(k.pourcentage_soldes)}
                  <span className="mt-0.5 block font-sans text-[9px] font-semibold normal-case leading-tight text-emerald-50">
                    année soldée
                  </span>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <DashboardChartSlot>
              {(w, h) =>
                chartPie.length > 0 ? (
                  <ResponsiveContainer width={w} height={h}>
                    <PieChart>
                      <Pie
                        data={chartPie}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={88}
                        paddingAngle={2}
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                      >
                        {chartPie.map((entry) => (
                          <Cell key={entry.name} fill={PIE_COLORS[entry.name] ?? "#64748b"} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={<RepartitionStatutsPieTooltip />}
                        cursor={{ fill: "rgba(100, 116, 139, 0.08)" }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-slate-500">
                    Aucune répartition de statuts pour afficher le graphique.
                  </div>
                )
              }
            </DashboardChartSlot>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="border-0 pb-0">
            <CardTitle>Dépenses par catégorie</CardTitle>
            <CardDescription>
              {periodeActive
                ? `Montants enregistrés sur la période (${stats.periode_stats.start_date} → ${stats.periode_stats.end_date}), par type de charge.`
                : "Répartition de toutes les dépenses d'exploitation par catégorie (loyer, factures, fournitures, etc.)."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="mx-auto w-full max-w-lg min-w-0 sm:max-w-xl">
              <DashboardChartSlot>
                {(w, h) =>
                  chartDepensesParCategorie.length > 0 ? (
                    <div className="relative h-full w-full">
                      <ResponsiveContainer width={w} height={h}>
                        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                          <Pie
                            data={chartDepensesParCategorie}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={64}
                            outerRadius={100}
                            paddingAngle={2}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {chartDepensesParCategorie.map((entry, i) => (
                              <Cell
                                key={`${entry.name}-${i}`}
                                fill={DEPENSE_PIE_COLORS[i % DEPENSE_PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            content={<DepensesCategoriePieTooltip />}
                            cursor={{ fill: "rgba(234, 88, 12, 0.08)" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div
                        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                        aria-hidden
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Total
                        </span>
                        <span
                          className="mt-1 text-2xl font-bold tabular-nums leading-none tracking-tight text-slate-800"
                          title={
                            periodeActive
                              ? "Total des dépenses (période sélectionnée)"
                              : "Total de toutes les dépenses enregistrées"
                          }
                        >
                          {formatCurrency(totalDepensesKpi)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-slate-500">
                      Aucune dépense par catégorie pour cette période.
                    </div>
                  )
                }
              </DashboardChartSlot>
              {chartDepensesParCategorie.length > 0 ? (
                <ul
                  className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-sm"
                  aria-label="Légende des catégories de dépenses"
                >
                  {chartDepensesParCategorie.map((entry, i) => (
                    <li
                      key={`${entry.name}-${i}`}
                      className="flex min-w-0 max-w-full items-baseline gap-2"
                    >
                      <span
                        className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{
                          backgroundColor: DEPENSE_PIE_COLORS[i % DEPENSE_PIE_COLORS.length],
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0 font-medium text-slate-700">{entry.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {formatCurrency(entry.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
                  Aucune catégorie à afficher.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[#64748b]" aria-hidden />
              <CardTitle>Derniers encaissements</CardTitle>
            </div>
            <CardDescription>
              {periodeActive
                ? `Les 5 encaissements les plus récents sur la période (${stats.periode_stats.start_date} → ${stats.periode_stats.end_date}).`
                : "Les 5 paiements scolaires les plus récents."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto rounded-lg border border-[#f1f5f9]">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="px-4 py-3 text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {derniers.map((row) => (
                    <tr key={row.id} className="bg-white hover:bg-[#fafafa]">
                      <td className="px-4 py-3 font-medium text-[#0f172a]">
                        {row.eleve_prenom} {row.eleve_nom}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#0f172a]">
                        {formatCurrency(row.montant_paye)}
                      </td>
                      <td className="px-4 py-3 text-right text-[#64748b]">
                        {formatDateTime(row.date_encaissement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerte : top 5 impayés</CardTitle>
            <CardDescription>
              Élèves avec le plus fort reste à payer annuel (frais totaux tarif × 10 − somme des encaissements).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto rounded-lg border border-[#f1f5f9]">
              {/* Relancer / Action column removed from UI for now; backend relance endpoints stay for a later phase. */}
              <table className="w-full min-w-[360px] table-fixed text-left text-sm">
                <thead className="bg-[#fef2f2] text-xs font-semibold uppercase tracking-wide text-[#991b1b]">
                  <tr>
                    <th className="w-[42%] px-4 py-3">Élève</th>
                    <th className="w-[38%] px-4 py-3">Classe</th>
                    <th className="w-[20%] px-4 py-3 text-right">Reste à payer (annuel) (DT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {topImpayes.map((row) => (
                    <tr key={row.id} className="bg-white hover:bg-[#fafafa]">
                      <td className="px-4 py-3 font-medium text-[#0f172a]">{row.nom_prenom}</td>
                      <td className="truncate px-4 py-3 text-[#64748b]" title={row.classe}>
                        {row.classe}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-red-600">
                        {formatCurrency(
                          row.reste_a_payer_annuel ?? row.reste_a_payer ?? row.dette,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
