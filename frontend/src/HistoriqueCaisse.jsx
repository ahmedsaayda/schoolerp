import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReactToPrint } from "react-to-print";

import { ArrowDownLeft, ArrowUpRight, Landmark, Wallet } from "lucide-react";

import BilanClotureSessionPrint from "./components/BilanClotureSessionPrint.jsx";
import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import Loading from "./components/ui/Loading.jsx";
import { API_CAISSE_JOURNAL, API_SESSION_CAISSE_COURANTE, apiFetch } from "./config.js";
import { localISODate } from "./utils/dateLocal.js";
import { formatTnd } from "./utils/tunisianMoney.js";

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

/**
 * Journal détaillé des entrées (encaissements élèves) et sorties (dépenses).
 * Impression : même modèle officiel que le bilan de clôture (session courante).
 */
export default function HistoriqueCaisse() {
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());
  const [entries, setEntries] = useState([]);
  const [totalEntrees, setTotalEntrees] = useState("0");
  const [totalSorties, setTotalSorties] = useState("0");
  const [soldeFinal, setSoldeFinal] = useState("0");
  const [appliedRange, setAppliedRange] = useState(() => {
    const d = localISODate();
    return { start: d, end: d };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printErr, setPrintErr] = useState("");

  const bilanPrintRef = useRef(null);
  const [bilanPrintPayload, setBilanPrintPayload] = useState(null);
  const [bilanPrintedAtLabel, setBilanPrintedAtLabel] = useState("");

  const handlePrintBilan = useReactToPrint({
    contentRef: bilanPrintRef,
    documentTitle: "Bilan-caisse-officiel",
    ignoreGlobalStyles: true,
    onAfterPrint: () => setBilanPrintPayload(null),
    fonts: [
      {
        family: "Inter",
        source: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
      },
    ],
    pageStyle: `
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        html, body {
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

  const fetchJournal = useCallback(
    async (options = { withSpinner: false }) => {
      const { withSpinner } = options;
      if (withSpinner) setLoading(true);
      setError("");
      const params = new URLSearchParams({
        date_debut: appliedRange.start,
        date_fin: appliedRange.end,
        start_date: appliedRange.start,
        end_date: appliedRange.end,
      });
      try {
        const res = await apiFetch(`${API_CAISSE_JOURNAL}?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        const te = data.total_entrees ?? data.total_entrees_str;
        const ts = data.total_sorties ?? data.total_sorties_str;
        const sf = data.solde_final ?? data.solde_final_str;
        setTotalEntrees(te != null ? String(te) : "0");
        setTotalSorties(ts != null ? String(ts) : "0");
        setSoldeFinal(sf != null ? String(sf) : "0");
      } catch (e) {
        setEntries([]);
        setError(e.message || "Impossible de charger le journal.");
      } finally {
        if (withSpinner) setLoading(false);
      }
    },
    [appliedRange.start, appliedRange.end],
  );

  useEffect(() => {
    fetchJournal({ withSpinner: true });
  }, [fetchJournal]);

  useEffect(() => {
    const refreshQuiet = () => fetchJournal({ withSpinner: false });
    const id = setInterval(refreshQuiet, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshQuiet();
    };
    window.addEventListener("focus", refreshQuiet);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refreshQuiet);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchJournal]);

  function applyFilters(e) {
    e?.preventDefault?.();
    if (startDate && endDate && startDate > endDate) {
      setError("La date de début doit précéder ou égaler la date de fin.");
      return;
    }
    setAppliedRange({ start: startDate, end: endDate });
  }

  async function handlePrintRapport() {
    setPrintErr("");
    try {
      const cour = await apiFetch(API_SESSION_CAISSE_COURANTE, { cache: "no-store" });
      if (!cour.ok) {
        setPrintErr("Impossible de vérifier la session de caisse.");
        return;
      }
      const cd = await cour.json();
      const sessionId = cd.session?.id;
      if (!sessionId) {
        setPrintErr(
          "Aucune session ouverte — ouvrez une session depuis la barre de caisse pour générer le bilan officiel.",
        );
        return;
      }
      const jr = await apiFetch(`${API_CAISSE_JOURNAL}?session_caisse=${sessionId}`, {
        cache: "no-store",
      });
      if (!jr.ok) {
        const err = await jr.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${jr.status}`);
      }
      const journalData = await jr.json();
      if (!journalData?.bilan || !journalData?.session_caisse) {
        setPrintErr("Données de bilan indisponibles pour cette session.");
        return;
      }
      const label = new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date());
      flushSync(() => {
        setBilanPrintedAtLabel(label);
        setBilanPrintPayload(journalData);
      });
      setTimeout(() => handlePrintBilan(), 0);
    } catch (e) {
      setPrintErr(e instanceof Error ? e.message : "Impression impossible.");
    }
  }

  const empty = !loading && entries.length === 0 && !error;

  const soldeColor = useMemo(() => {
    const n = Number(soldeFinal);
    if (Number.isNaN(n)) return "text-slate-900";
    if (n > 0) return "text-emerald-700";
    if (n < 0) return "text-red-700";
    return "text-slate-900";
  }, [soldeFinal]);

  return (
    <div className="space-y-6 pb-28">
      <div className="pointer-events-none fixed left-[-10000px] top-0 w-[210mm]" aria-hidden>
        <BilanClotureSessionPrint
          ref={bilanPrintRef}
          payload={bilanPrintPayload}
          printedAtLabel={bilanPrintedAtLabel}
        />
      </div>

      <div className="no-print">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">Journal financier</h2>
          <p className="mt-1 text-sm text-slate-600">
            Tous les encaissements élèves et les dépenses enregistrés — mis à jour automatiquement.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            « Imprimer le rapport » : même document officiel que le bilan de clôture (session ouverte ou en cours).
          </p>
        </header>

        <form
          className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={applyFilters}
        >
          <div className="min-w-0 w-full min-[480px]:w-auto min-[480px]:max-w-md min-[480px]:flex-1">
            <DateRangePickerCustom
              id="caisse-journal-periode"
              label="Période du journal"
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: s, endDate: e }) => {
                setStartDate(s);
                setEndDate(e);
              }}
              allowEmpty={false}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
            >
              Filtrer
            </button>
            <button
              type="button"
              onClick={() => void handlePrintRapport()}
              disabled={loading || Boolean(error)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden>🖨️</span>
              Imprimer le rapport
            </button>
          </div>
        </form>

        {printErr ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="status"
          >
            {printErr}
          </div>
        ) : null}

        {!loading && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-sky-800/80">Total entrées</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-700">
                {formatTnd(totalEntrees)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Encaissements sur la période</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-sky-800/80">Total sorties</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-red-700">
                {formatTnd(totalSorties)}
              </p>
              <p className="mt-1 text-xs text-slate-600">Dépenses sur la période</p>
            </div>
            <div className="rounded-xl border border-sky-300 bg-gradient-to-br from-sky-100 to-sky-50 p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-sky-900/80">Solde de la période</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${soldeColor}`}>
                {formatTnd(soldeFinal)}
              </p>
              <p className="mt-1 text-xs text-slate-700">Entrées − sorties (caisse théorique)</p>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="alert"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <Loading message="Chargement du journal…" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Heure / date</th>
                    <th className="px-4 py-3 font-semibold">Description détaillée</th>
                    <th className="px-4 py-3 text-right font-semibold">Entrée (+)</th>
                    <th className="px-4 py-3 text-right font-semibold">Sortie (−)</th>
                    <th className="px-4 py-3 font-semibold">Auteur</th>
                    <th className="px-4 py-3 text-right font-semibold">Solde progressif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empty ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        Aucun mouvement sur cette période.
                      </td>
                    </tr>
                  ) : (
                    entries.map((row) => {
                      const isEntree =
                        row.type === "ENTRÉE" ||
                        (row.entree != null && Number(row.entree) > 0);
                      const auteurRole =
                        row.cree_par_role != null && String(row.cree_par_role).trim() !== ""
                          ? String(row.cree_par_role).trim()
                          : null;
                      const auteurNom =
                        row.cree_par_nom != null && String(row.cree_par_nom).trim() !== ""
                          ? String(row.cree_par_nom).trim()
                          : null;
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                            <div className="flex items-center gap-2">
                              {isEntree ? (
                                <span
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
                                  title="Encaissement élève"
                                >
                                  <ArrowDownLeft className="h-4 w-4" aria-hidden />
                                </span>
                              ) : (
                                <span
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700"
                                  title="Dépense"
                                >
                                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                                </span>
                              )}
                              {formatDateTime(row.date_time)}
                            </div>
                          </td>
                          <td className="max-w-md px-4 py-3 text-slate-800">
                            <p className="font-medium leading-snug">
                              {row.libelle ?? "—"}
                              {auteurRole ? (
                                <span className="font-semibold text-slate-600"> ({auteurRole})</span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">{row.source}</p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-emerald-700">
                            {row.entree != null && Number(row.entree) > 0
                              ? formatTnd(row.entree)
                              : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-red-700">
                            {row.sortie != null && Number(row.sortie) > 0
                              ? formatTnd(row.sortie)
                              : "—"}
                          </td>
                          <td className="max-w-[12rem] px-4 py-3 text-slate-800">
                            {auteurNom || auteurRole ? (
                              <>
                                {auteurNom ? (
                                  <p className="text-sm font-medium leading-snug">{auteurNom}</p>
                                ) : null}
                                {auteurRole ? (
                                  <p className="text-xs text-slate-500">{auteurRole}</p>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                            {formatTnd(
                              row.solde_progressif != null ? row.solde_progressif : row.solde,
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 shadow-[0_-4px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Wallet className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                <span className="text-slate-500">Total entrées</span>
                <span className="font-semibold text-emerald-700">{formatTnd(totalEntrees)}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Landmark className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                <span className="text-slate-500">Total sorties</span>
                <span className="font-semibold text-red-700">{formatTnd(totalSorties)}</span>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
              <span className="text-slate-600">Solde final (période)</span>
              <span className={`ml-2 text-base font-bold tabular-nums ${soldeColor}`}>
                {formatTnd(soldeFinal)}
              </span>
              <span className="ml-2 text-xs text-slate-500">Entrées − sorties</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
