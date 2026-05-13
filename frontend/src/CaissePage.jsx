import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Printer } from "lucide-react";
import { useReactToPrint } from "react-to-print";

import { useAuth } from "./AuthContext.jsx";
import { isAdminUser, isComptable } from "./authRoles.js";
import JournalFinancier from "./JournalFinancier.jsx";
import BilanClotureSessionPrint from "./components/BilanClotureSessionPrint.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { useSettings } from "./context/SettingsContext.jsx";
import BanqueTransfertModal from "./components/BanqueTransfertModal.jsx";
import {
  API_BANQUE_SOLDE,
  API_CAISSE_JOURNAL,
  API_SESSIONS_CAISSE,
  EVENT_CAISSE_SESSION_CHANGED,
  apiFetch,
} from "./config.js";
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

function parseListPayload(data) {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

/**
 * Gestion de caisse journalière : ouverture, tableau de bord, clôture, historique.
 */
export default function CaissePage() {
  const { user } = useAuth();
  const { itemsPerPage } = useSettings();
  /** onglet principal : session journalière ou journal financier (mouvements agrégés). */
  const [caisseTab, setCaisseTab] = useState("session");
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sessionsPage, setSessionsPage] = useState(1);
  const [bankSolde, setBankSolde] = useState(null);
  const [banqueModal, setBanqueModal] = useState(null);

  /** Réimpression bilan (même flux que la clôture automatique). */
  const [bilanPrintPayload, setBilanPrintPayload] = useState(null);
  const [bilanPrintedAtLabel, setBilanPrintedAtLabel] = useState("");
  const bilanPrintRef = useRef(null);
  const handlePrintBilanCloture = useReactToPrint({
    contentRef: bilanPrintRef,
    documentTitle: "Bilan-cloture-caisse",
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

  const printBilanForSession = useCallback(
    async (sessionId) => {
      try {
        const jr = await apiFetch(`${API_CAISSE_JOURNAL}?session_caisse=${sessionId}`, {
          cache: "no-store",
        });
        if (!jr.ok) return;
        const journalData = await jr.json();
        if (!journalData?.bilan || !journalData?.session_caisse) return;
        const label = new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
        }).format(new Date());
        flushSync(() => {
          setBilanPrintedAtLabel(label);
          setBilanPrintPayload(journalData);
        });
        setTimeout(() => {
          handlePrintBilanCloture();
        }, 0);
      } catch {
        /* impression facultative */
      }
    },
    [handlePrintBilanCloture],
  );

  const loadBank = useCallback(async () => {
    try {
      const res = await apiFetch(API_BANQUE_SOLDE, { cache: "no-store" });
      if (!res.ok) throw new Error("bank");
      const d = await res.json();
      if (d.masque) {
        setBankSolde("****");
      } else {
        setBankSolde(d.solde_actuel ?? null);
      }
    } catch {
      setBankSolde(null);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch(API_SESSIONS_CAISSE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = parseListPayload(data);
      setSessions(list);
      const ouverte = list.find((s) => s.statut === "ouvert") ?? null;
      setActiveSession(ouverte);
    } catch {
      setSessions([]);
      setActiveSession(null);
      setError("Impossible de charger les sessions de caisse.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void loadBank();
  }, [loadBank]);

  useEffect(() => {
    const onCaisseChanged = () => {
      void loadSessions();
      void loadBank();
    };
    window.addEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisseChanged);
    return () => window.removeEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisseChanged);
  }, [loadSessions, loadBank]);

  useEffect(() => {
    if (user && isComptable(user) && !isAdminUser(user)) {
      setCaisseTab("journal");
    }
  }, [user]);

  const sessionsFermees = useMemo(() => {
    return sessions
      .filter((s) => s.statut === "ferme")
      .slice()
      .sort((a, b) => {
        const ta = new Date(b.date_fermeture || b.date_ouverture).getTime();
        const tb = new Date(a.date_fermeture || a.date_ouverture).getTime();
        return ta - tb;
      });
  }, [sessions]);

  /** Total alimentations banque→caisse pour la session ouverte (API : total_alimentations_banque). */
  const sessionAlimentationBanque = useMemo(() => {
    const v = Number(activeSession?.total_alimentations_banque ?? 0);
    return Number.isFinite(v) ? v : 0;
  }, [activeSession]);

  const showAlimentationBanqueCard = sessionAlimentationBanque > 0;

  const sessIdxLast = sessionsPage * itemsPerPage;
  const sessIdxFirst = sessIdxLast - itemsPerPage;
  const sessionsFermeesPage = useMemo(
    () => sessionsFermees.slice(sessIdxFirst, sessIdxLast),
    [sessionsFermees, sessIdxFirst, sessIdxLast],
  );

  useEffect(() => {
    const total = sessionsFermees.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (sessionsPage > lastPage) setSessionsPage(lastPage);
  }, [sessionsFermees.length, sessionsPage, itemsPerPage]);

  const caisseHeader = (
    <header className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Caisse</h1>
        <p className="mt-1 text-sm text-slate-600">
          Session quotidienne, clôture et journal détaillé des entrées / sorties. La session est gérée depuis la barre
          fixe sous l’en-tête (toutes les pages).
        </p>
      </div>

      <div
        className="flex flex-wrap gap-2 border-b border-slate-200 pb-px"
        role="tablist"
        aria-label="Sections caisse"
      >
        <button
          type="button"
          role="tab"
          aria-selected={caisseTab === "session"}
          disabled={loading}
          className={
            caisseTab === "session"
              ? "-mb-px border-b-2 border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900"
              : "border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
          }
          onClick={() => setCaisseTab("session")}
        >
          Session &amp; clôture
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={caisseTab === "journal"}
          disabled={loading}
          className={
            caisseTab === "journal"
              ? "-mb-px border-b-2 border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900"
              : "border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
          }
          onClick={() => setCaisseTab("journal")}
        >
          Journal financier
        </button>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="w-full min-w-0 space-y-10">
        {caisseHeader}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Loading message="Chargement de la caisse…" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-10">
      {caisseHeader}

      {caisseTab === "journal" ? <JournalFinancier /> : null}

      {caisseTab === "session" && error && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="alert"
        >
          {error}
        </div>
      )}

      {caisseTab === "session" && !activeSession ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-700">
          <p>
            Aucune session ouverte. Utilisez la barre de caisse sous l’en-tête pour ouvrir la caisse. Le solde initial
            est repris du montant réel de la dernière clôture (ou 0&nbsp;DT si c&apos;est la première
            session).
          </p>
        </section>
      ) : caisseTab === "session" ? (
        <section className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Session ouverte</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ouverte le {formatDateTime(activeSession.date_ouverture)}
              {(activeSession.ouvert_par_nom || activeSession.ouvert_par_username) && (
                <>
                  {" "}
                  ·{" "}
                  {activeSession.ouvert_par_nom?.trim() || activeSession.ouvert_par_username}
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Clôture via la barre sous l’en-tête. Les montants ci-dessous se synchronisent avec les encaissements et
              dépenses.
            </p>
          </div>

          <div
            className={`grid gap-4 sm:grid-cols-2 ${showAlimentationBanqueCard ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Solde initial
              </p>
              <p className="mt-2 text-xl font-semibold text-slate-900">
                {formatTnd(activeSession.solde_initial)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Entrées (paiements)
              </p>
              <p className="mt-2 text-xl font-semibold text-emerald-700">
                {formatTnd(activeSession.total_entrees)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Sorties (dépenses)
              </p>
              <p className="mt-2 text-xl font-semibold text-amber-800">
                {formatTnd(activeSession.total_sorties)}
              </p>
            </div>
            {showAlimentationBanqueCard ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Alimentation (banque)
                </p>
                <p className="mt-2 text-xl font-semibold text-blue-600">
                  {formatTnd(activeSession.total_alimentations_banque)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Renflouement depuis le compte interne
                </p>
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-white shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Solde actuel (caisse)
              </p>
              <p className="mt-2 text-xl font-semibold">{formatTnd(activeSession.solde_actuel)}</p>
              <p className="mt-2 text-xs text-slate-400">Initial + entrées − sorties (± banque)</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-4">
            <div className="min-w-0 flex-1 rounded-xl border border-indigo-200/80 bg-indigo-50/60 p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-800/90">
                Solde banque
              </p>
              <p className="mt-2 text-2xl font-semibold text-indigo-950">
                {bankSolde != null
                  ? bankSolde === "****"
                    ? "**** DT"
                    : formatTnd(bankSolde)
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-indigo-800/80">Compte interne (hors tiroir caisse)</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:justify-center sm:py-0">
              <button
                type="button"
                className="rounded-lg border border-indigo-300 bg-white px-4 py-2.5 text-sm font-medium text-indigo-900 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!activeSession}
                onClick={() => setBanqueModal("verser")}
              >
                Verser vers Banque
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!activeSession}
                onClick={() => setBanqueModal("retrait")}
              >
                Retrait banque (alimentation)
              </button>
            </div>
          </div>

          <BanqueTransfertModal
            open={banqueModal != null}
            mode={banqueModal === "retrait" ? "retrait" : "verser"}
            onClose={() => setBanqueModal(null)}
            onSuccess={() => {
              setBanqueModal(null);
              void loadBank();
              void loadSessions();
            }}
          />
        </section>
      ) : null}

      {caisseTab === "session" ? (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Historique des sessions fermées</h2>
          <p className="mt-1 text-sm text-slate-600">
            Comparaison du solde théorique (après clôture) et du montant réellement compté.
          </p>
          <div className="mt-4 w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Ouverture / fermeture</th>
                    <th className="px-4 py-3 font-semibold">Solde initial</th>
                    <th className="px-4 py-3 font-semibold">Entrées</th>
                    <th className="px-4 py-3 font-semibold">Sorties</th>
                    <th className="px-4 py-3 font-semibold">Alimentation</th>
                    <th className="px-4 py-3 font-semibold">Versement banque</th>
                    <th className="px-4 py-3 font-semibold">Solde théorique</th>
                    <th className="px-4 py-3 font-semibold">Réel (tiroir)</th>
                    <th className="px-4 py-3 font-semibold">Écart</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessionsFermees.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        Aucune session fermée pour le moment.
                      </td>
                    </tr>
                  ) : (
                    sessionsFermeesPage.map((s) => {
                      const initial = Number(s.solde_initial || 0);
                      const ent = Number(s.total_entrees || 0);
                      const sor = Number(s.total_sorties || 0);
                      const ali = Number(s.total_alimentations_banque || 0);
                      const vbn = Number(s.total_versements_banque || 0);
                      const theorique = initial + ent - sor + ali - vbn;
                      const reel = s.solde_final != null ? Number(s.solde_final) : null;
                      const ecart =
                        reel != null && !Number.isNaN(reel) ? reel - theorique : null;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50/80">
                          <td className="max-w-[12rem] px-4 py-3 align-top leading-snug text-slate-800">
                            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              Ouverture
                            </span>
                            <span className="block">{formatDateTime(s.date_ouverture)}</span>
                            <span className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              Fermeture
                            </span>
                            <span className="block">
                              {formatDateTime(s.date_fermeture || s.date_ouverture)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle">{formatTnd(initial)}</td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-emerald-800">
                            {formatTnd(ent)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-amber-900">
                            {formatTnd(sor)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-sky-900">
                            {formatTnd(ali)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-indigo-900">
                            {formatTnd(vbn)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle font-medium">
                            {formatTnd(theorique)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle">
                            {reel != null ? formatTnd(reel) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle">
                            {ecart == null || Number.isNaN(ecart) ? (
                              "—"
                            ) : (
                              <span
                                className={
                                  Math.abs(ecart) < 0.005
                                    ? "text-slate-700"
                                    : ecart > 0
                                      ? "font-medium text-emerald-700"
                                      : "font-medium text-red-700"
                                }
                              >
                                {ecart > 0 ? "+" : ""}
                                {formatTnd(ecart)}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-middle text-right">
                            <button
                              type="button"
                              aria-label={`Imprimer le bilan de la session du ${formatDateTime(s.date_ouverture)}`}
                              title="Imprimer le bilan"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                              onClick={() => void printBilanForSession(s.id)}
                            >
                              <Printer className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {sessionsFermees.length > 0 ? (
              <Pagination
                totalItems={sessionsFermees.length}
                itemsPerPage={itemsPerPage}
                currentPage={sessionsPage}
                paginate={setSessionsPage}
                itemLabel="sessions"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="pointer-events-none fixed left-[-10000px] top-0 w-[210mm]" aria-hidden>
        <BilanClotureSessionPrint
          ref={bilanPrintRef}
          payload={bilanPrintPayload}
          printedAtLabel={bilanPrintedAtLabel}
        />
      </div>
    </div>
  );
}
