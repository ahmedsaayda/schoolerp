import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, format, startOfDay } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "./AuthContext.jsx";
import { isAdminUser, isComptable } from "./authRoles.js";
import { API_DASHBOARD_ANALYTICS, apiFetch } from "./config.js";
import DateRangeFilter from "./components/DateRangeFilter.jsx";
import Loading from "./components/ui/Loading.jsx";
import { formatTnd, formatTnNumber } from "./utils/tunisianMoney.js";

/** Montants en TND (fr-TN + ISO 4217, ex. 1 250,50 DT). */
export function formatCurrency(value) {
  return formatTnd(value);
}

function parseNum(s) {
  if (s == null || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const CH_TIP = "rounded-lg border border-slate-700/95 bg-slate-900 px-3 py-2.5 text-xs text-white shadow-xl";

function RevenuDepensesBarTooltip({ active, label, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={CH_TIP}>
      <p className="text-[11px] font-semibold text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="mt-1.5 flex justify-between gap-6 tabular-nums">
          <span className="text-slate-400">{p.name}</span>
          <span className="font-semibold text-white">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function ChargesBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const label = row?.payload?.name ?? row?.name;
  return (
    <div className={CH_TIP}>
      <p className="text-[11px] font-semibold text-amber-200/90">Catégorie de charge</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{label}</p>
      <p className="mt-1.5 tabular-nums text-sm font-semibold text-slate-100">{formatCurrency(row.value)}</p>
    </div>
  );
}

/** Profs, Personnel, Autres — aligné sur le bar chart charges */
const CHARGES_BAR_COLORS = ["#ea580c", "#2563eb", "#64748b"];

const kpiCardClass =
  "flex min-h-[260px] flex-col rounded-2xl border p-6 shadow-sm";
const kpiLabelClass = "text-xs font-semibold uppercase tracking-wide";
const kpiValueClass =
  "mt-3 text-[28px] font-semibold leading-none tabular-nums tracking-tight";
const kpiFootClass = "mt-auto pt-4 text-xs leading-relaxed";

/**
 * Tableau de bord financier (Directrice) : /api/dashboard-analytics/
 */
export default function DashboardHome() {
  const { user: authUser } = useAuth();
  const canSeeFinancialStats = isAdminUser(authUser) || isComptable(authUser);

  const [period, setPeriod] = useState(() => ({
    startDate: startOfDay(new Date()),
    endDate: endOfDay(new Date()),
  }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!canSeeFinancialStats) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        start_date: format(period.startDate, "yyyy-MM-dd"),
        end_date: format(period.endDate, "yyyy-MM-dd"),
      });
      const res = await apiFetch(`${API_DASHBOARD_ANALYTICS}?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
      setError("Impossible de charger les indicateurs (vérifiez la session et le serveur).");
    } finally {
      setLoading(false);
    }
  }, [canSeeFinancialStats, period.startDate, period.endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const barData = useMemo(() => {
    if (!data?.chart_data?.length) return [];
    return data.chart_data.map((row) => ({
      name: row.name,
      revenus: parseNum(row.revenu),
      depenses: parseNum(row.depenses),
    }));
  }, [data]);

  const chargesBarData = useMemo(() => {
    if (!data?.pie_costs) return [];
    const p = data.pie_costs;
    return [
      { name: "Profs", montant: parseNum(p.salaires_prof_edt) },
      { name: "Personnel", montant: parseNum(p.salaires_staff) },
      { name: "Autres", montant: parseNum(p.autres_depenses) },
    ];
  }, [data]);

  function handleRefresh() {
    load();
  }

  const periodHint = useMemo(() => {
    if (!data?.start_date || !data?.end_date) return "";
    try {
      const a = new Date(data.start_date);
      const b = new Date(data.end_date);
      const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
      let hint = `Période sélectionnée : ${fmt.format(a)} — ${fmt.format(b)}`;
      if (data.annee_scolaire_debut) {
        const ay = new Date(data.annee_scolaire_debut);
        const ayFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
        hint += ` · Année scolaire depuis le ${ayFmt.format(ay)}`;
      }
      return hint;
    } catch {
      return "";
    }
  }, [data]);

  const tauxRecouvrementLabel = useMemo(() => {
    const t = data?.taux_recouvrement;
    if (t == null || Number.isNaN(Number(t))) return null;
    return `${Number(t).toLocaleString("fr-TN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} %`;
  }, [data]);

  if (!canSeeFinancialStats) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Ce tableau de bord financier est réservé aux administrateurs et comptables.
      </div>
    );
  }

  return (
    <>
      <header className="relative z-[100] mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Tableau de bord financier</h1>
            <p className="mt-1.5 max-w-[900px] text-sm leading-relaxed text-[#64748b]">
              Vue directe pour la direction : encaissements, charges à payer et solde net du mois.
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-start sm:justify-end">
            <DateRangeFilter
              value={period}
              disabled={loading}
              onApply={(next) => setPeriod(next)}
              className="w-full sm:w-auto"
            />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#475569] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[34px]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              Actualiser
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="mb-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">Entrées &amp; résultat</h2>
        {periodHint ? <p className="mt-1 text-xs text-[#94a3b8]">{periodHint}</p> : null}
      </section>

      <section
        className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:items-stretch"
        aria-label="Encaissements et bénéfice"
      >
        <article
          className={`${kpiCardClass} relative overflow-hidden border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30`}
        >
          <p className={`${kpiLabelClass} text-emerald-900/80`}>Recettes (période)</p>
          <p className={`${kpiValueClass} text-emerald-950`}>
            {loading ? "…" : formatCurrency(data?.recettes_periode)}
          </p>
          <p className="mt-2 text-xs font-medium text-emerald-900/85">
            Taux de recouvrement (période) :{" "}
            {loading ? "…" : tauxRecouvrementLabel ?? "—"}
          </p>
          <p className={`${kpiFootClass} text-emerald-900/75`}>
            Somme des encaissements sur la plage choisie (au prorata si la fin est aujourd&apos;hui).
          </p>
        </article>

        <article
          className={`${kpiCardClass} border-amber-200/90 bg-gradient-to-br from-amber-50 to-white`}
        >
          <p className={`${kpiLabelClass} text-amber-900/85`}>Reste à recouvrer (ce mois)</p>
          <p className={`${kpiValueClass} text-amber-950`}>
            {loading ? "…" : formatCurrency(data?.reste_a_recouvrer_mois)}
          </p>
          <p className="mt-2 text-xs font-medium text-amber-800/90">Ce qu&apos;il reste à collecter ce mois</p>
          <p className={`${kpiFootClass} text-amber-900/70`}>
            Frais mensuels théoriques (somme des tarifs) moins les montants déjà affectés au mois calendaire en cours.
          </p>
        </article>

        <article className={`${kpiCardClass} border-sky-200/90 bg-gradient-to-br from-sky-50 to-white`}>
          <p className={`${kpiLabelClass} text-sky-900/85`}>Objectif journalier</p>
          <p className={`${kpiValueClass} text-sky-950`}>
            {loading ? "…" : formatCurrency(data?.objectif_journalier)}
          </p>
          <p className="mt-2 text-xs font-medium text-sky-800/90">Estimation de collecte requise par jour</p>
          <p className={`${kpiFootClass} text-sky-900/70`}>
            Reste à recouvrer du mois, réparti sur les jours restants jusqu&apos;à la fin du mois (dernier jour : égal au
            reste).
          </p>
        </article>

        <article
          className={`${kpiCardClass} border-2 border-indigo-300/80 bg-gradient-to-br from-indigo-50 via-violet-50/40 to-white shadow-md ring-1 ring-indigo-100`}
        >
          <p className={`${kpiLabelClass} text-indigo-900/85`}>Bénéfice net (période)</p>
          <p className={`${kpiValueClass} text-indigo-950`}>
            {loading ? "…" : formatCurrency(data?.benefice_net)}
          </p>
          <p className={`${kpiFootClass} text-indigo-900/75`}>
            Encaissements de la période − dépenses enregistrées sur la même plage (hors masse salariale mensuelle
            affichée en dessous).
          </p>
        </article>
      </section>

      <section className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">Charges du mois</h2>
      </section>

      <section
        className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-3 xl:items-stretch"
        aria-label="Dépenses du mois calendaire"
      >
        <article
          className={`${kpiCardClass} border-rose-200/90 bg-gradient-to-br from-rose-50 to-white`}
        >
          <p className={`${kpiLabelClass} text-rose-900/85`}>Salaires professeurs</p>
          <p className={`${kpiValueClass} text-rose-950`}>
            {loading ? "…" : formatCurrency(data?.salaires_profs_mois)}
          </p>
          <p className="mt-2 text-xs font-medium text-rose-800/90">À payer ce mois</p>
          <p className={`${kpiFootClass} text-rose-900/70`}>
            Basé sur l&apos;emploi du temps (heures × tarif horaire × 4 semaines).
          </p>
        </article>

        <article className={`${kpiCardClass} border-blue-200/90 bg-gradient-to-br from-blue-50 to-white`}>
          <p className={`${kpiLabelClass} text-blue-900/85`}>Salaires personnel (RH)</p>
          <p className={`${kpiValueClass} text-blue-950`}>
            {loading ? "…" : formatCurrency(data?.salaires_personnel_mois)}
          </p>
          <p className="mt-2 text-xs font-medium text-blue-800/90">À payer ce mois</p>
          <p className={`${kpiFootClass} text-blue-900/70`}>
            Somme des salaires mensuels du personnel administratif.
          </p>
        </article>

        <article
          className={`${kpiCardClass} border-slate-200/90 bg-gradient-to-br from-slate-50 to-white`}
        >
          <p className={`${kpiLabelClass} text-slate-800/90`}>Factures &amp; autres</p>
          <p className={`${kpiValueClass} text-slate-950`}>
            {loading ? "…" : formatCurrency(data?.autres_depenses_mois)}
          </p>
          <p className="mt-2 text-xs font-medium text-slate-700/90">
            STEG, SONEDE, loyer, etc. — dépenses enregistrées ce mois
          </p>
          <p className={`${kpiFootClass} text-slate-700/75`}>
            Somme des lignes « Dépenses » sur le mois calendaire en cours (factures, charges diverses).
          </p>
        </article>
      </section>

      <section className="mb-3 mt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">Tendances &amp; répartition</h2>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#0f172a]">Revenus vs dépenses (6 derniers mois)</h3>
          <p className="mt-1 text-xs text-[#64748b]">
            Revenus = paiements par mois d&apos;encaissement. Dépenses = masse salariale mensuelle + dépenses enregistrées
            (loyer, factures, etc.) sur le mois.
          </p>
          <div className="mt-5 h-[320px] w-full min-w-0">
            {loading ? (
              <Loading
                message="Chargement des données…"
                className="h-full min-h-0 w-full"
              />
            ) : barData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-[#64748b]">Aucune donnée.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#64748b" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#64748b"
                    tickFormatter={(v) =>
                      formatTnNumber(v, { maximumFractionDigits: 0 })
                    }
                  />
                  <Tooltip content={<RevenuDepensesBarTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.1)" }} />
                  <Legend />
                  <Bar dataKey="revenus" name="Revenus" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="depenses" name="Dépenses" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#0f172a]">Répartition des charges</h3>
          <p className="mt-1 text-xs text-[#64748b]">
            Comparaison des masses : professeurs, personnel RH et autres charges (même base que les cartes ci-dessus).
          </p>
          <div className="mt-5 h-[320px] w-full min-w-0">
            {loading ? (
              <Loading
                message="Chargement des données…"
                className="h-full min-h-0 w-full"
              />
            ) : chargesBarData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-[#64748b]">Aucune donnée.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chargesBarData}
                  margin={{ top: 8, right: 8, left: 8, bottom: 28 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#64748b" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#64748b"
                    tickFormatter={(v) =>
                      formatTnNumber(v, { maximumFractionDigits: 0 })
                    }
                  />
                  <Tooltip content={<ChargesBarTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                  <Bar dataKey="montant" name="Montant" radius={[4, 4, 0, 0]} maxBarSize={72}>
                    {chargesBarData.map((entry, i) => (
                      <Cell key={entry.name} fill={CHARGES_BAR_COLORS[i % CHARGES_BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
