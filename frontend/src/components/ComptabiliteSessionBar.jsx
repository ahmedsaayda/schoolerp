import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { Landmark } from "lucide-react";
import { useReactToPrint } from "react-to-print";

import { useAuth } from "../AuthContext.jsx";
import { isAdminOrComptable } from "../authRoles.js";
import {
  API_BANQUE_SOLDE,
  API_CAISSE_JOURNAL,
  API_SESSION_CAISSE_COURANTE,
  API_SESSIONS_CAISSE,
  EVENT_CAISSE_SESSION_CHANGED,
  apiFetch,
  dispatchCaisseSessionChanged,
} from "../config.js";
import { formatTnd } from "../utils/tunisianMoney.js";
import BilanClotureSessionPrint from "./BilanClotureSessionPrint.jsx";

const POLL_MS = 30_000;

const MSG_OUVERTURE_BLOQUEE_JUSTIFICATIF =
  "Impossible d'ouvrir une nouvelle session. Un justificatif de versement bancaire est manquant pour la session précédente.";

function sessionSnapshotChanged(prev, next) {
  return (
    (prev?.id ?? null) !== (next?.id ?? null) ||
    String(prev?.solde_actuel ?? "") !== String(next?.solde_actuel ?? "")
  );
}

/**
 * Barre compacte session de caisse (layout global : admin / comptable uniquement).
 * Rafraîchissement : polling, focus, et événement {@link EVENT_CAISSE_SESSION_CHANGED}.
 */
export default function ComptabiliteSessionBar() {
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bannerErr, setBannerErr] = useState("");
  const [opening, setOpening] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeVal, setCloseVal] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState("");
  const [bankLine, setBankLine] = useState(null);
  const [verserBanque, setVerserBanque] = useState(false);
  const [montantVers, setMontantVers] = useState("");
  /** null = pas encore répondu, après saisie du montant vers banque */
  const [justifDepotReponse, setJustifDepotReponse] = useState(null);
  const [closJustifFile, setClosJustifFile] = useState(null);
  const [ouvertureSessionBloquee, setOuvertureSessionBloquee] = useState(false);
  const lastSnapRef = useRef(null);

  /** Données GET /api/caisse/journal/?session_caisse= — impression bilan après clôture. */
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

  const printBilanAfterSessionClose = useCallback(
    async (closedSessionId) => {
      try {
        const jr = await apiFetch(
          `${API_CAISSE_JOURNAL}?session_caisse=${closedSessionId}`,
          { cache: "no-store" },
        );
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

  const load = useCallback(async () => {
    setBannerErr("");
    try {
      const res = await apiFetch(API_SESSION_CAISSE_COURANTE, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const next = data.session ?? null;
      setOuvertureSessionBloquee(Boolean(data.ouverture_session_bloquee));
      const prev = lastSnapRef.current;
      if (sessionSnapshotChanged(prev, next)) {
        dispatchCaisseSessionChanged();
      }
      lastSnapRef.current = next;
      setSession(next);
    } catch {
      const next = null;
      setOuvertureSessionBloquee(false);
      if (sessionSnapshotChanged(lastSnapRef.current, next)) {
        dispatchCaisseSessionChanged();
      }
      lastSnapRef.current = next;
      setSession(null);
    }
    try {
      const rb = await apiFetch(API_BANQUE_SOLDE, { cache: "no-store" });
      if (rb.ok) {
        const bd = await rb.json();
        if (bd.masque) {
          setBankLine("**** DT");
        } else {
          setBankLine(bd.solde_actuel != null ? formatTnd(bd.solde_actuel) : "—");
        }
      } else {
        setBankLine(null);
      }
    } catch {
      setBankLine(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !isAdminOrComptable(user)) {
      return undefined;
    }
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    const onCaisseEvent = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisseEvent);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisseEvent);
    };
  }, [user, load]);

  async function handleOpen() {
    if (!session && ouvertureSessionBloquee) {
      setBannerErr(MSG_OUVERTURE_BLOQUEE_JUSTIFICATIF);
      return;
    }
    setOpening(true);
    setBannerErr("");
    try {
      const res = await apiFetch(API_SESSIONS_CAISSE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg =
          j?.non_field_errors?.[0] ||
          (typeof j?.detail === "string" ? j.detail : null) ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await load();
    } catch (e) {
      setBannerErr(e instanceof Error ? e.message : "Ouverture impossible.");
    } finally {
      setOpening(false);
    }
  }

  async function handleCloseSubmit(e) {
    e.preventDefault();
    if (!session) return;
    setCloseErr("");
    const raw = closeVal.trim().replace(",", ".");
    if (raw === "" || Number.isNaN(Number(raw))) {
      setCloseErr("Indiquez le montant réellement compté.");
      return;
    }
    if (verserBanque) {
      const mv = Number(String(montantVers).replace(",", ".").trim());
      if (!Number.isFinite(mv) || mv <= 0) {
        setCloseErr("Indiquez le montant à verser vers la banque (positif).");
        return;
      }
      if (justifDepotReponse == null) {
        setCloseErr("Indiquez si vous avez le justificatif (Oui / Non).");
        return;
      }
      if (justifDepotReponse === "oui" && !closJustifFile) {
        setCloseErr("Joignez le justificatif pour valider le versement en banque.");
        return;
      }
    }
    setClosing(true);
    const sessionIdClosed = session.id;
    try {
      if (verserBanque && justifDepotReponse === "oui") {
        const mvFixed = Number(String(montantVers).replace(",", ".").trim()).toFixed(2);
        const fd = new FormData();
        fd.append("solde_final", raw);
        fd.append("verser_vers_banque", "true");
        fd.append("justificatif_fourni", "true");
        fd.append("montant_vers_banque", mvFixed);
        fd.append("justificatif_file", closJustifFile, closJustifFile.name);
        const res = await apiFetch(`${API_SESSIONS_CAISSE}${session.id}/fermer_caisse/`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          const msg = typeof j.detail === "string" ? j.detail : j.detail?.[0] || `HTTP ${res.status}`;
          throw new Error(msg);
        }
      } else if (verserBanque && justifDepotReponse === "non") {
        const mvFixed = Number(String(montantVers).replace(",", ".").trim()).toFixed(2);
        const res = await apiFetch(`${API_SESSIONS_CAISSE}${session.id}/fermer_caisse/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            solde_final: raw,
            verser_vers_banque: true,
            montant_vers_banque: mvFixed,
            justificatif_fourni: false,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          const msg = typeof j.detail === "string" ? j.detail : j.detail?.[0] || `HTTP ${res.status}`;
          throw new Error(msg || `HTTP ${res.status}`);
        }
      } else {
        const res = await apiFetch(`${API_SESSIONS_CAISSE}${session.id}/fermer_caisse/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ solde_final: raw }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.detail || `HTTP ${res.status}`);
        }
      }
      setCloseOpen(false);
      setCloseVal("");
      setVerserBanque(false);
      setMontantVers("");
      setJustifDepotReponse(null);
      setClosJustifFile(null);
      await load();
      await printBilanAfterSessionClose(sessionIdClosed);
    } catch (e) {
      setCloseErr(e instanceof Error ? e.message : "Fermeture impossible.");
    } finally {
      setClosing(false);
    }
  }

  if (!user || !isAdminOrComptable(user)) {
    return null;
  }

  if (loading) {
    return (
      <div
        className="flex h-9 items-center gap-2 py-1 print:hidden"
        aria-busy="true"
        aria-label="Chargement session caisse"
      >
        <div className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-slate-200" />
        <div className="h-3 w-40 max-w-[50%] animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  const ouvert = Boolean(session);
  const soldeLabel = ouvert ? formatTnd(session.solde_actuel) : "—";

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 print:hidden"
        role="region"
        aria-label="Session de caisse"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-white"
            aria-hidden
          >
            <Landmark className="h-3.5 w-3.5" strokeWidth={2} />
          </div>
          <span
            className={
              ouvert
                ? "inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900"
                : "inline-flex shrink-0 items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
            }
          >
            {ouvert ? "Ouvert" : "Fermé"}
          </span>
          <div className="min-w-0 text-xs leading-tight text-slate-700 sm:text-[13px]">
            <span className="text-slate-500">Solde actuel</span>{" "}
            <span className="font-semibold tabular-nums text-slate-900">{soldeLabel}</span>
            {ouvert && bankLine != null ? (
              <span className="text-slate-500 sm:inline">
                {" "}
                · Banque <span className="font-semibold tabular-nums text-slate-800">{bankLine}</span>
              </span>
            ) : null}
            {ouvert ? (
              <span className="hidden text-slate-400 sm:inline">
                {" "}
                ·{" "}
                <span className="text-slate-600">
                  {session.ouvert_par_nom?.trim() || session.ouvert_par_username || "—"}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!ouvert ? (
            <button
              type="button"
              onClick={handleOpen}
              disabled={opening || ouvertureSessionBloquee}
              title={
                ouvertureSessionBloquee ? MSG_OUVERTURE_BLOQUEE_JUSTIFICATIF : undefined
              }
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 sm:px-3"
            >
              {opening ? "Ouverture…" : "Ouvrir"}
            </button>
          ) : (
            <button
              type="button"
                onClick={() => {
                setCloseErr("");
                setCloseVal("");
                setVerserBanque(false);
                setMontantVers("");
                setClosJustifFile(null);
                setJustifDepotReponse(null);
                setCloseOpen(true);
              }}
              className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 shadow-sm transition hover:bg-red-100 sm:px-3"
            >
              Clôturer
            </button>
          )}
        </div>
        {bannerErr ? (
          <p className="w-full text-[11px] text-red-600 sm:text-xs" role="alert">
            {bannerErr}
          </p>
        ) : null}
        {!ouvert && ouvertureSessionBloquee ? (
          <p className="w-full text-[11px] text-amber-900 sm:text-xs">
            Ouverture bloquée : promesse de justificatif en attente.{" "}
            <Link to="/caisse-justificatifs" className="font-semibold underline">
              Historique et Justificatifs Banque
            </Link>
          </p>
        ) : null}
      </div>

      {closeOpen && session ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="caisse-bar-close-title"
        >
          <form
            onSubmit={handleCloseSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3 id="caisse-bar-close-title" className="text-lg font-semibold text-slate-900">
              Clôturer la session
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Montant réellement compté en caisse (hors somme prévue pour la banque si vous cochez un versement) :
            </p>
            <input
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              value={closeVal}
              onChange={(ev) => setCloseVal(ev.target.value)}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
            />
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/90 p-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={verserBanque}
                  onChange={(ev) => {
                    setVerserBanque(ev.target.checked);
                    if (!ev.target.checked) {
                      setMontantVers("");
                      setClosJustifFile(null);
                      setJustifDepotReponse(null);
                    }
                  }}
                />
                <span>
                  <span className="font-medium">Verser vers la banque</span> à la clôture (montant à déduire de la
                  caisse et créditer en banque).
                </span>
              </label>
              {verserBanque ? (
                <div className="mt-3 space-y-3 pl-0 sm:pl-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-600" htmlFor="cb-mont-vers">
                      Montant à verser vers la banque (DT)
                    </label>
                    <input
                      id="cb-mont-vers"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm"
                      value={montantVers}
                      onChange={(ev) => {
                        setMontantVers(ev.target.value);
                        setJustifDepotReponse(null);
                        setClosJustifFile(null);
                      }}
                      inputMode="decimal"
                    />
                  </div>
                  {(() => {
                    const mv = Number(String(montantVers).replace(",", ".").trim());
                    const montantOk = Number.isFinite(mv) && mv > 0;
                    if (!montantOk) return null;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-700">Avez-vous le justificatif ?</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setJustifDepotReponse("oui");
                              setClosJustifFile(null);
                            }}
                            className={
                              justifDepotReponse === "oui"
                                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                                : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            }
                          >
                            Oui
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setJustifDepotReponse("non");
                              setClosJustifFile(null);
                            }}
                            className={
                              justifDepotReponse === "non"
                                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                                : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            }
                          >
                            Non
                          </button>
                        </div>
                        {justifDepotReponse === "oui" ? (
                          <div>
                            <label className="text-xs text-slate-600" htmlFor="cb-justif-file">
                              Justificatif (PDF ou image) — obligatoire pour créditer la banque
                            </label>
                            <input
                              id="cb-justif-file"
                              type="file"
                              accept="application/pdf,image/*"
                              className="mt-1 block w-full text-xs text-slate-700"
                              onChange={(ev) => setClosJustifFile(ev.target.files?.[0] ?? null)}
                            />
                          </div>
                        ) : null}
                        {justifDepotReponse === "non" ? (
                          <p className="text-xs font-medium text-amber-900" role="status">
                            Attention : Vous pourrez clôturer, mais vous ne pourrez pas ouvrir la session de demain sans
                            avoir régularisé ce versement.
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>
            {closeErr ? (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {closeErr}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCloseOpen(false);
                  setCloseErr("");
                  setVerserBanque(false);
                  setMontantVers("");
                  setClosJustifFile(null);
                  setJustifDepotReponse(null);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={closing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {closing ? "Fermeture…" : "Confirmer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="pointer-events-none fixed left-[-10000px] top-0 w-[210mm]" aria-hidden>
        <BilanClotureSessionPrint
          ref={bilanPrintRef}
          payload={bilanPrintPayload}
          printedAtLabel={bilanPrintedAtLabel}
        />
      </div>
    </>
  );
}
