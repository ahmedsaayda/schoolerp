import { useEffect, useId, useRef, useState } from "react";

import { API_PROFESSEURS, apiFetch } from "../config.js";
import { mapFichePaieApiToSalaryReceiptProps } from "./SalaryDoubleReceiptShared.jsx";
import { formatTnd, formatTnNumber } from "../utils/tunisianMoney.js";

function formatHeures(v) {
  return formatTnNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Dernier jour à prendre en compte selon si c'est le mois en cours ou un mois passé. */
function getLastDayOfPeriod(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  if (yearMonth === currentYearMonth()) {
    return String(new Date().getDate()).padStart(2, "0");
  }
  return String(new Date(y, m, 0).getDate()).padStart(2, "0");
}

function buildPeriodeLabel(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const lastDay = getLastDayOfPeriod(yearMonth);
  return `Du 01/${mm}/${y} au ${lastDay}/${mm}/${y}`;
}

function moisLongLabel(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return "—";
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function parsePrimeAmount(s) {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function roundMoney2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** @returns {number | null} */
function parsePositiveDecimalInput(s) {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Enregistrement de la fiche de paie (POST /api/professeurs/:id/executer_paiement/).
 * Contient un sélecteur de mois dynamique — recalcul en temps réel via resume_paie.
 */
export default function PaymentModal({
  open,
  onClose,
  professeur,
  resume,
  onSuccess,
  onToast,
  /** Après paiement + fetch fiche : props pour SalaryReceiptPrintHost (affichage parent). */
  onSalaryReceiptPrint,
}) {
  const titleId = useId();
  const [datePaiement, setDatePaiement] = useState(todayISODate);
  const [montant, setMontant] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [localResume, setLocalResume] = useState(null);
  const [loadingResume, setLoadingResume] = useState(false);
  const [primeMontant, setPrimeMontant] = useState("");
  const [primeRemarque, setPrimeRemarque] = useState("");
  const [primeParHeures, setPrimeParHeures] = useState(false);
  const [primeHeures, setPrimeHeures] = useState("");
  const [primeTarif, setPrimeTarif] = useState("");
  const lastAutoRemarkRef = useRef("");

  // Réinitialise tout à l'ouverture du modal (mois en cours par défaut)
  useEffect(() => {
    if (!open || !professeur) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on open */
    setSelectedMonth(currentYearMonth());
    setDatePaiement(todayISODate());
    setError("");
    setShowConfirm(false);
    setLocalResume(null);
    setPrimeMontant("");
    setPrimeRemarque("");
    setPrimeParHeures(false);
    setPrimeHeures("");
    setPrimeTarif("");
    lastAutoRemarkRef.current = "";
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, professeur?.id]);

  // Recharge le récapitulatif quand le mois sélectionné change
  useEffect(() => {
    if (!open || !professeur?.id || !selectedMonth) return;
    const [yStr, mStr] = selectedMonth.split("-");
    const mois = String(Number(mStr));
    const annee = String(Number(yStr));
    let cancelled = false;

    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingResume(true);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */

    apiFetch(
      `${API_PROFESSEURS}${professeur.id}/resume_paie/?mois=${encodeURIComponent(mois)}&annee=${encodeURIComponent(annee)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setLocalResume(data);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger le récapitulatif pour ce mois.");
      })
      .finally(() => {
        if (!cancelled) setLoadingResume(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, professeur?.id, selectedMonth]);

  // Total net à verser = net récapitulatif + primes (synchronisé avec le champ montant)
  useEffect(() => {
    if (!open || !localResume) return;
    const net = localResume.net_a_payer ?? localResume.salaire_net;
    if (net == null || net === "") return;
    const base = Number(String(net).replace(",", "."));
    if (!Number.isFinite(base)) return;
    let p = 0;
    if (primeParHeures) {
      const h = parsePositiveDecimalInput(primeHeures);
      const t = parsePositiveDecimalInput(primeTarif);
      if (h != null && t != null && h > 0 && t > 0) p = roundMoney2(h * t);
    } else {
      p = parsePrimeAmount(primeMontant);
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setMontant((base + p).toFixed(2));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, localResume, primeParHeures, primeHeures, primeTarif, primeMontant]);

  // Libellé automatique en mode rattrapage (modifiable par l'utilisateur)
  useEffect(() => {
    if (!open || !primeParHeures) return;
    const h = parsePositiveDecimalInput(primeHeures);
    const t = parsePositiveDecimalInput(primeTarif);
    if (h == null || t == null || h <= 0 || t <= 0) return;
    const auto = `Cours de rattrapage (${formatHeures(h)}h x ${formatTnd(t)})`;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrimeRemarque((prev) => {
      const prevT = prev.trim();
      if (prevT === "" || prevT === lastAutoRemarkRef.current) {
        lastAutoRemarkRef.current = auto;
        return auto;
      }
      return prev;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, primeParHeures, primeHeures, primeTarif]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !professeur) return null;

  const activeResume = localResume ?? resume;
  const isCurrentMonth = selectedMonth === currentYearMonth();
  const periodeLabel = activeResume?.periode_libelle ?? buildPeriodeLabel(selectedMonth);
  const moisLabel = moisLongLabel(selectedMonth);

  const netRef = activeResume ? (activeResume.net_a_payer ?? activeResume.salaire_net) : null;
  let primeNumAff = 0;
  if (primeParHeures) {
    const h = parsePositiveDecimalInput(primeHeures);
    const t = parsePositiveDecimalInput(primeTarif);
    if (h != null && t != null && h > 0 && t > 0) primeNumAff = roundMoney2(h * t);
  } else {
    primeNumAff = parsePrimeAmount(primeMontant);
  }
  const netBaseNum =
    netRef != null && netRef !== "" ? Number(String(netRef).replace(",", ".")) : null;
  const totalNetAff =
    netBaseNum != null && Number.isFinite(netBaseNum) ? netBaseNum + primeNumAff : null;
  const brut = activeResume ? (activeResume.total_brut ?? activeResume.salaire_brut) : null;
  const heures = activeResume ? (activeResume.heures_non_payees ?? activeResume.total_heures) : null;
  const heuresRel = activeResume?.heures_reliquat_mois_precedent;
  const heuresM = activeResume?.heures_mois_prestation;
  const avances = activeResume ? (activeResume.avances_non_soldees ?? activeResume.total_avances) : null;
  const heuresRestantes = activeResume?.heures_restantes_mois;

  function validateAmounts() {
    const montantStr = String(montant).trim().replace(",", ".");
    const montantNum = Number(montantStr);
    if (!montantStr || Number.isNaN(montantNum) || montantNum <= 0) {
      setError("Indiquez un montant net valide (supérieur à 0).");
      return null;
    }
    let primeNum = 0;
    let nhForPayload = null;
    let ttForPayload = null;
    if (primeParHeures) {
      const hRaw = String(primeHeures).trim();
      const tRaw = String(primeTarif).trim();
      if (hRaw || tRaw) {
        const h = parsePositiveDecimalInput(primeHeures);
        const t = parsePositiveDecimalInput(primeTarif);
        if (h == null || t == null || h <= 0 || t <= 0) {
          setError(
            "Indiquez un nombre d'heures et un tarif horaire valides (supérieurs à 0) pour la prime rattrapage.",
          );
          return null;
        }
        primeNum = roundMoney2(h * t);
        nhForPayload = h;
        ttForPayload = t;
      }
    } else {
      const rawPr = String(primeMontant).trim().replace(",", ".");
      if (rawPr) {
        const pn = Number(rawPr);
        if (!Number.isFinite(pn) || pn < 0) {
          setError("Montant de primes invalide.");
          return null;
        }
        primeNum = pn;
      }
    }
    if (netRef != null && netRef !== "") {
      const base = Number(String(netRef).replace(",", "."));
      if (Number.isFinite(base)) {
        if (montantNum + 0.02 < base + primeNum) {
          setError("Le montant total doit au moins égaler le net récapitulatif + les primes.");
          return null;
        }
        if (Math.abs(montantNum - base - primeNum) > 0.05) {
          setError(
            "Le montant net à verser doit correspondre au récapitulatif + les primes (ou ajustez les primes).",
          );
          return null;
        }
      }
    }
    if (!datePaiement) {
      setError("Indiquez la date du paiement.");
      return null;
    }
    return { montantStr, montantNum, primeNum, nhForPayload, ttForPayload };
  }

  function handleRequestSubmit(e) {
    e.preventDefault();
    const v = validateAmounts();
    if (!v) return;
    setError("");
    setShowConfirm(true);
  }

  async function postPaiement(v) {
    const url = `${API_PROFESSEURS}${professeur.id}/executer_paiement/`;
    const [yStr, mStr] = selectedMonth.split("-");
    const rem = primeRemarque.trim();
    const payload = {
      montant: v.montantNum.toFixed(2),
      date_paiement: datePaiement,
      mois: String(Number(mStr)),
      annee: String(Number(yStr)),
      primes: v.primeNum.toFixed(2),
      ...(rem ? { primes_remarque: rem } : {}),
      ...(v.nhForPayload != null && v.ttForPayload != null
        ? {
            nb_heures_prime: v.nhForPayload.toFixed(2),
            tarif_prime: v.ttForPayload.toFixed(2),
          }
        : {}),
    };
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") msg = data.detail;
        else if (data && typeof data === "object") {
          const first = Object.entries(data).find(([, val]) => val != null);
          if (first) msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
        }
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.json();
  }

  async function handleFinaliser(shouldPrint) {
    const v = validateAmounts();
    if (!v) {
      setShowConfirm(false);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await postPaiement(v);
      if (shouldPrint && created?.receipt_id != null && professeur?.id) {
        const resFiche = await apiFetch(
          `${API_PROFESSEURS}${professeur.id}/fiche_paie_salaire/${created.receipt_id}/`,
        );
        if (!resFiche.ok) {
          let msg = `Erreur ${resFiche.status}`;
          try {
            const body = await resFiche.json();
            if (typeof body.detail === "string") msg = body.detail;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const ficheData = await resFiche.json();
        const props = mapFichePaieApiToSalaryReceiptProps(ficheData);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onSalaryReceiptPrint?.(props));
        });
        onToast?.({ type: "success", message: "Fiche de paie enregistrée — impression du reçu." });
      } else if (shouldPrint) {
        onToast?.({
          type: "warning",
          message: "Paiement enregistré — reçu papier indisponible (identifiant manquant).",
        });
      } else {
        onToast?.({ type: "success", message: "Fiche de paie enregistrée." });
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  const subtitle = [professeur.prenom, professeur.nom].filter(Boolean).join(" ").trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-3 backdrop-blur-[1px] sm:p-4"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(90vh,80vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-4 py-3 sm:px-5 sm:py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
              Valider la fiche de paie
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">{subtitle || "—"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
            aria-label="Fermer"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        {showConfirm ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-center text-sm leading-relaxed text-[#0f172a]">
              Voulez-vous enregistrer cette fiche de paie et l'imprimer ?
            </p>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirm(false)}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleFinaliser(false)}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:opacity-50"
              >
                {submitting ? "Traitement…" : "Valider sans imprimer"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleFinaliser(true)}
                className="rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:opacity-50"
              >
                {submitting ? "Traitement…" : "Valider et Imprimer"}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleRequestSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4">
            {/* Sélecteur de mois de prestation */}
            <div className="mb-3">
              <label
                htmlFor="pay-mois-prestation"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
              >
                Mois de prestation
              </label>
              <input
                id="pay-mois-prestation"
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={loadingResume || submitting}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
              />
              <p className="mt-1 text-[11px] text-[#94a3b8]">
                {isCurrentMonth
                  ? "Mois en cours — seules les heures pointées jusqu'à aujourd'hui sont comptées."
                  : "Mois clôturé — toutes les heures du mois sont comptées."}
              </p>
            </div>

            {/* Récapitulatif dynamique */}
            {loadingResume ? (
              <div className="mb-3 flex items-center justify-center rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#64748b] sm:p-5">
                <span className="animate-pulse">Chargement du récapitulatif…</span>
              </div>
            ) : activeResume ? (
              <div className="mb-3 space-y-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm text-[#0f172a] sm:p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Récapitulatif</p>

                {/* Période */}
                <p className="text-[11px] text-[#475569]">
                  <span className="font-semibold">Période :</span> {periodeLabel}
                </p>

                {heuresRel != null && Number(heuresRel) > 0 && heuresM != null ? (
                  <p>
                    <span className="text-[#475569]">Mois M (h impayées)</span>
                    <span className="float-right tabular-nums font-semibold">{formatHeures(heuresM)} h</span>
                  </p>
                ) : null}
                {heuresRel != null && Number(heuresRel) > 0 ? (
                  <p>
                    <span className="text-[#475569]">Reliquat mois précédent</span>
                    <span className="float-right tabular-nums font-semibold text-amber-900">
                      {formatHeures(heuresRel)} h
                    </span>
                  </p>
                ) : null}
                <p className="clear-both">
                  <span className="text-[#475569]">Heures retenues (M + reliquat)</span>
                  <span className="float-right tabular-nums font-semibold">
                    {formatHeures(heures)} h → {formatTnd(brut)}
                  </span>
                </p>
                <p className="clear-both text-xs leading-relaxed text-[#64748b]">
                  Séances en <strong>attente de paiement</strong> sur la période choisie ; le reliquat M-1 est
                  ajouté automatiquement. Les avances non soldées sont déduites.
                </p>
                <p>
                  <span className="text-[#475569]">Avances à déduire</span>
                  <span className="float-right tabular-nums font-semibold text-amber-900">
                    − {formatTnd(avances)}
                  </span>
                </p>
                {primeNumAff > 0 ? (
                  <p className="clear-both">
                    <span className="text-[#475569]">Primes &amp; bonus</span>
                    <span className="float-right tabular-nums font-semibold text-emerald-800">
                      + {formatTnd(primeNumAff)}
                    </span>
                  </p>
                ) : null}

                {/* Note de report — mois en cours uniquement */}
                {isCurrentMonth && heuresRestantes != null && Number(heuresRestantes) > 0 ? (
                  <p className="clear-both rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                    <strong>À reporter :</strong> {formatHeures(heuresRestantes)} h restantes sur l'emploi
                    du temps de {moisLabel} — seront incluses dans le prochain versement.
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  Primes &amp; bonus
                </p>
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
                  <input
                    type="checkbox"
                    checked={primeParHeures}
                    disabled={submitting}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setPrimeParHeures(checked);
                      lastAutoRemarkRef.current = "";
                      if (checked) {
                        setPrimeMontant("");
                        setPrimeHeures("");
                        const th = professeur?.tarif_horaire ?? activeResume?.tarif_horaire;
                        setPrimeTarif(
                          th != null && th !== "" ? String(th).replace(",", ".") : "",
                        );
                      } else {
                        setPrimeHeures("");
                        setPrimeTarif("");
                      }
                    }}
                    className="h-4 w-4 rounded border-[#cbd5e1] text-[#15803d] focus:ring-[#3b82f6]"
                  />
                  <span>Calculer par heures (Rattrapage)</span>
                </label>

                {primeParHeures ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                      <div>
                        <label
                          htmlFor="pay-prime-heures"
                          className="mb-1.5 block text-[11px] font-medium text-[#64748b]"
                        >
                          Nombre d&apos;heures
                        </label>
                        <input
                          id="pay-prime-heures"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={primeHeures}
                          onChange={(e) => setPrimeHeures(e.target.value)}
                          disabled={submitting}
                          placeholder="ex. 4"
                          className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="pay-prime-tarif"
                          className="mb-1.5 block text-[11px] font-medium text-[#64748b]"
                        >
                          Tarif horaire (DT)
                        </label>
                        <input
                          id="pay-prime-tarif"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={primeTarif}
                          onChange={(e) => setPrimeTarif(e.target.value)}
                          disabled={submitting}
                          placeholder="Tarif du professeur"
                          className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
                        />
                      </div>
                    </div>
                    {primeNumAff > 0 ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm font-semibold text-emerald-900">
                        Total prime : {formatTnd(primeNumAff)}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <label
                        htmlFor="pay-prime-remarque"
                        className="mb-1 block text-[11px] font-medium text-[#64748b]"
                      >
                        Libellé / remarque
                      </label>
                      <input
                        id="pay-prime-remarque"
                        type="text"
                        autoComplete="off"
                        value={primeRemarque}
                        onChange={(e) => setPrimeRemarque(e.target.value)}
                        disabled={submitting}
                        placeholder="Rempli automatiquement en mode rattrapage"
                        className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50 sm:py-2.5"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                    <div>
                      <label
                        htmlFor="pay-prime-montant"
                        className="mb-1 block text-[11px] font-medium text-[#64748b]"
                      >
                        Montant (DT)
                      </label>
                      <input
                        id="pay-prime-montant"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={primeMontant}
                        onChange={(e) => setPrimeMontant(e.target.value)}
                        disabled={submitting}
                        placeholder="0"
                        className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50 sm:py-2.5"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label
                        htmlFor="pay-prime-remarque"
                        className="mb-1 block text-[11px] font-medium text-[#64748b]"
                      >
                        Libellé / remarque
                      </label>
                      <input
                        id="pay-prime-remarque"
                        type="text"
                        autoComplete="off"
                        value={primeRemarque}
                        onChange={(e) => setPrimeRemarque(e.target.value)}
                        disabled={submitting}
                        placeholder="ex. Heures sup. étude"
                        className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50 sm:py-2.5"
                      />
                    </div>
                  </div>
                )}

                <p className="mt-1 text-[11px] text-[#94a3b8]">
                  Le montant de prime s&apos;ajoute au net du récapitulatif dans le total à verser.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <div>
                  <label
                    htmlFor="pay-montant"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Montant net à verser (DT)
                  </label>
                  <input
                    id="pay-montant"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] sm:py-2.5"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pay-date"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Date du paiement
                  </label>
                  <input
                    id="pay-date"
                    type="date"
                    value={datePaiement}
                    onChange={(e) => setDatePaiement(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] sm:py-2.5"
                  />
                </div>
              </div>
            </div>
            </div>

            <div className="sticky bottom-0 shrink-0 border-t border-[#e2e8f0] bg-white px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.12)] sm:px-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 gap-y-1">
                <span className="text-sm font-semibold text-[#0f172a]">Total net à payer</span>
                <span className="tabular-nums text-lg font-bold leading-none text-[#15803d] sm:text-xl">
                  {activeResume ? formatTnd(totalNetAff ?? netRef) : "—"}
                </span>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting || loadingResume || !activeResume}
                  className="rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:opacity-50"
                >
                  Valider la fiche de paie
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
