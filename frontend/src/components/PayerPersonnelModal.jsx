import { useEffect, useId, useState } from "react";

import { X } from "lucide-react";

import { API_PERSONNEL, apiFetch } from "../config.js";
import { mapFichePersonnelPaiementToSalaryReceiptProps } from "./SalaryDoubleReceiptShared.jsx";
import { formatTnd } from "../utils/tunisianMoney.js";
import { PERSONNEL_ROLE_OPTIONS } from "./PersonnelModal.jsx";

function roleLabel(code) {
  const o = PERSONNEL_ROLE_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code || "—";
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function moisConcerneFromYearMonth(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return "";
  return `${ym}-01`;
}

function parseYearMonth(ym) {
  const [y, m] = (ym || "").split("-").map((x) => Number(x));
  return { y, m: m || 1 };
}

/**
 * Fiche de paie personnel (POST …/executer_paiement/) + reçu double (même gabarit que profs/élèves).
 */
export default function PayerPersonnelModal({
  open,
  personnel,
  onClose,
  onSuccess,
  onToast,
  onSalaryReceiptPrint,
}) {
  const formId = useId();
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [primes, setPrimes] = useState("0");
  const [primesRemarque, setPrimesRemarque] = useState("");
  const [datePaiement, setDatePaiement] = useState(todayISODate);
  const [montant, setMontant] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [resume, setResume] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(false);

  useEffect(() => {
    if (!open || !personnel) return;
    /* eslint-disable react-hooks/set-state-in-effect -- réinitialisation à l'ouverture (comme PaymentModal) */
    setSelectedMonth(currentYearMonth());
    setPrimes("0");
    setPrimesRemarque("");
    setDatePaiement(todayISODate());
    setError("");
    setShowConfirm(false);
    setResume(null);
    setMontant("");
    /* eslint-enable react-hooks/set-state-in-effect */
    // Réinitialiser seulement à l’ouverture ou changement de fiche (id), pas à chaque rerender de l’objet `personnel`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, personnel?.id]);

  useEffect(() => {
    if (!open || !personnel?.id) return;
    const mc = moisConcerneFromYearMonth(selectedMonth);
    if (!mc) return;
    const ps = String(primes).trim().replace(",", ".") || "0";
    let cancelled = false;
    (async () => {
      setResumeLoading(true);
      setError("");
      try {
        const q = new URLSearchParams();
        q.set("mois_concerne", mc);
        q.set("primes", ps);
        const res = await apiFetch(
          `${API_PERSONNEL}${personnel.id}/resume-paie/?${q.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) setResume(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setResume(data);
          if (data && typeof data.salaire_net === "string") {
            setMontant(String(data.salaire_net).replace(",", "."));
          }
        }
      } catch {
        if (!cancelled) setResume(null);
      } finally {
        if (!cancelled) setResumeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, personnel?.id, selectedMonth, primes]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !personnel) return null;

  const periodeL = resume?.periode_libelle ?? "—";

  function parseMontant() {
    const s = String(montant).trim().replace(",", ".");
    return Number(s);
  }

  function validate() {
    const m = parseMontant();
    if (!Number.isFinite(m) || m < 0) {
      setError("Indiquez un montant net valide.");
      return null;
    }
    const exp =
      resume != null && resume.salaire_net != null && resume.salaire_net !== ""
        ? Number(String(resume.salaire_net).replace(",", "."))
        : null;
    if (exp != null && Number.isFinite(exp) && exp > 0 && m < 0.01) {
      setError("Indiquez le montant net versé (supérieur à 0).");
      return null;
    }
    if (!datePaiement) {
      setError("Indiquez la date du paiement.");
      return null;
    }
    return { m };
  }

  function handleRequestSubmit(e) {
    e.preventDefault();
    const v = validate();
    if (!v) return;
    setError("");
    setShowConfirm(true);
  }

  async function postExecuter(shouldPrint) {
    const v = validate();
    if (!v) {
      setShowConfirm(false);
      return;
    }
    const m = v.m;
    setSubmitting(true);
    setError("");
    try {
      const { y, m: monthNum } = parseYearMonth(selectedMonth);
      const pr = String(primes).trim().replace(",", ".") || "0";
      const rem = primesRemarque.trim();
      const res = await apiFetch(`${API_PERSONNEL}${personnel.id}/executer_paiement/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          montant: m.toFixed(2),
          date_paiement: datePaiement,
          mois_prestation: monthNum,
          annee_prestation: y,
          primes: pr === "0" || pr === "0.00" ? "0.00" : Number(pr).toFixed(2),
          ...(rem ? { primes_remarque: rem } : {}),
        }),
      });
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const d = await res.json();
          if (typeof d.detail === "string") msg = d.detail;
          else if (d && typeof d === "object") {
            const first = Object.entries(d).find(([, val]) => val != null);
            if (first) msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
          }
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      const created = await res.json();
      if (shouldPrint && created?.receipt_id != null) {
        const rF = await apiFetch(
          `${API_PERSONNEL}${personnel.id}/fiche_paie_salaire/${created.receipt_id}/`,
        );
        if (!rF.ok) {
          let msg2 = `Erreur ${rF.status}`;
          try {
            const b2 = await rF.json();
            if (typeof b2.detail === "string") msg2 = b2.detail;
          } catch {
            /* ignore */
          }
          setError(msg2);
          return;
        }
        const ficheData = await rF.json();
        const props = mapFichePersonnelPaiementToSalaryReceiptProps(ficheData);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => onSalaryReceiptPrint?.(props));
        });
        onToast?.({ type: "success", message: "Fiche de paie enregistrée — impression du reçu." });
      } else if (shouldPrint) {
        onToast?.({
          type: "warning",
          message: "Paiement enregistré — reçu indisponible (identifiant manquant).",
        });
      } else {
        onToast?.({ type: "success", message: "Fiche de paie enregistrée." });
      }
      onSuccess?.();
      onClose();
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px] sm:items-center"
        role="presentation"
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${formId}-title`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] px-5 py-4">
            <div>
              <h2 id={`${formId}-title`} className="text-lg font-semibold text-[#0f172a]">
                Fiche de paie
              </h2>
              <p className="mt-0.5 text-sm text-[#64748b]">
                {personnel.prenom} {personnel.nom} — {roleLabel(personnel.role)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg p-1 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {showConfirm ? (
            <div className="space-y-4 px-5 py-5">
              <p className="text-center text-sm leading-relaxed text-[#0f172a]">
                Voulez-vous enregistrer cette fiche de paie et l&apos;imprimer ?
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
                  onClick={() => void postExecuter(false)}
                  className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:opacity-50"
                >
                  {submitting ? "Traitement…" : "Valider sans imprimer"}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void postExecuter(true)}
                  className="rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:opacity-50"
                >
                  {submitting ? "Traitement…" : "Valider et imprimer"}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleRequestSubmit} className="px-5 py-5">
              <div className="mb-4">
                <label
                  htmlFor={`${formId}-ym`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                >
                  Mois de prestation
                </label>
                <input
                  id={`${formId}-ym`}
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  disabled={submitting || resumeLoading}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-[#64748b]">{periodeL}</p>
              </div>

              <div className="mb-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  Primes &amp; bonus
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`${formId}-primes`}
                      className="mb-1.5 block text-[11px] font-medium text-[#64748b]"
                    >
                      Montant (DT)
                    </label>
                    <input
                      id={`${formId}-primes`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={primes}
                      onChange={(e) => setPrimes(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${formId}-primes-rem`}
                      className="mb-1.5 block text-[11px] font-medium text-[#64748b]"
                    >
                      Libellé / remarque
                    </label>
                    <input
                      id={`${formId}-primes-rem`}
                      type="text"
                      autoComplete="off"
                      value={primesRemarque}
                      onChange={(e) => setPrimesRemarque(e.target.value)}
                      disabled={submitting}
                      placeholder="ex. Prime de rendement"
                      className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-[#94a3b8]">
                  Le montant de prime est inclus dans le total net du récapitulatif.
                </p>
              </div>

              {resumeLoading ? (
                <div className="mb-4 flex items-center justify-center rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-6 text-sm text-[#64748b]">
                  <span className="animate-pulse">Chargement du récapitulatif…</span>
                </div>
              ) : resume ? (
                <div className="mb-4 space-y-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#0f172a]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Récapitulatif</p>
                  <p className="text-[11px] text-[#475569]">Contrat : {formatTnd(resume.salaire_base)} DT / mois</p>
                  <p className="clear-both">
                    <span className="text-[#475569]">Salaire mensuel fixe (après absences)</span>
                    <span className="float-right tabular-nums font-semibold">
                      {formatTnd(resume.salaire_mensuel_fixe)} DT
                    </span>
                  </p>
                  {Number(resume.jours_absents) > 0 ? (
                    <p className="clear-both text-xs text-[#64748b]">
                      Retenue absences : {resume.jours_absents} j. × {formatTnd(resume.retenue_par_absence)} DT = −
                      {formatTnd(resume.retenue_totale)} DT
                    </p>
                  ) : null}
                  <p className="clear-both">
                    <span className="text-[#475569]">Primes / bonus</span>
                    <span className="float-right tabular-nums font-semibold text-emerald-800">
                      + {formatTnd(resume.primes)} DT
                    </span>
                  </p>
                  <p className="clear-both">
                    <span className="text-[#475569]">Avances à déduire</span>
                    <span className="float-right tabular-nums font-semibold text-amber-900">
                      − {formatTnd(resume.avances_non_soldees)} DT
                    </span>
                  </p>
                  <p className="clear-both border-t border-[#e2e8f0] pt-3">
                    <span className="font-semibold text-[#0f172a]">Total net</span>
                    <span className="float-right text-lg font-bold text-[#15803d]">
                      {formatTnd(resume.salaire_net)} DT
                    </span>
                  </p>
                </div>
              ) : null}

              {error ? (
                <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor={`${formId}-montant`}
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Montant net à verser (DT)
                  </label>
                  <input
                    id={`${formId}-montant`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] tabular-nums focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-date`}
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Date du paiement
                  </label>
                  <input
                    id={`${formId}-date`}
                    type="date"
                    value={datePaiement}
                    onChange={(e) => setDatePaiement(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
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
                  disabled={submitting || resumeLoading || !resume}
                  className="rounded-lg bg-[#15803d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:opacity-50"
                >
                  Valider la fiche de paie
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
  );
}
