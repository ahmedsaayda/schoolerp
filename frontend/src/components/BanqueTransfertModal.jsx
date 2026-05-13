import { useEffect, useId, useState } from "react";

import { API_BANQUE_RETRAIT, API_BANQUE_VERSER, apiFetch, dispatchCaisseSessionChanged } from "../config.js";
import { useSessionRequirementOptional } from "./SessionRequirementModal.jsx";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function parseErrorResponse(res) {
  let msg = `Erreur ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data.detail === "string") msg = data.detail;
    else if (data && typeof data === "object") {
      const first = Object.entries(data).find(([, v]) => v != null);
      if (first) {
        const val = first[1];
        msg = `${first[0]} : ${Array.isArray(val) ? val.join(", ") : String(val)}`;
      }
    }
  } catch {
    /* ignore */
  }
  return msg;
}

/**
 * Transfert caisse ⟷ banque (multipart, justificatif image/PDF obligatoire).
 * @param {"verser" | "retrait"} mode
 */
export default function BanqueTransfertModal({ open, mode, onClose, onSuccess }) {
  const titleId = useId();
  const sessionRequirement = useSessionRequirementOptional();
  const [montant, setMontant] = useState("");
  const [dateM, setDateM] = useState(todayISODate);
  const [fichier, setFichier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setMontant("");
    setDateM(todayISODate());
    setFichier(null);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isVerser = mode === "verser";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const n = Number(String(montant).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Indiquez un montant valide et positif.");
      return;
    }
    if (!fichier) {
      setError("Le justificatif (image ou PDF) est obligatoire.");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("montant", n.toFixed(2));
    fd.append("date", dateM);
    fd.append("justificatif_file", fichier, fichier.name);
    try {
      const url = isVerser ? API_BANQUE_VERSER : API_BANQUE_RETRAIT;
      const res = await apiFetch(url, { method: "POST", body: fd });
      if (!res.ok) {
        const msg = await parseErrorResponse(res);
        if (
          sessionRequirement?.showSessionRequired &&
          /session.*ouverte|aucune session/i.test(msg)
        ) {
          sessionRequirement.showSessionRequired();
          return;
        }
        setError(msg);
        return;
      }
      dispatchCaisseSessionChanged();
      onSuccess();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
          {isVerser ? "Verser vers la banque" : "Retrait banque (alimentation caisse)"}
        </h2>
        <p className="mt-2 text-sm text-[#64748b]">
          {isVerser
            ? "Le montant est retiré de la caisse et ajouté au solde banque (justificatif obligatoire)."
            : "Le montant est pris en banque et versé en caisse (justificatif obligatoire)."}
        </p>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="bf-montant" className="block text-sm font-medium text-[#475569]">
              Montant (DT)
            </label>
            <input
              id="bf-montant"
              type="text"
              inputMode="decimal"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              autoComplete="off"
              placeholder="0,000"
            />
          </div>
          <div>
            <label htmlFor="bf-date" className="block text-sm font-medium text-[#475569]">
              Date
            </label>
            <input
              id="bf-date"
              type="date"
              value={dateM}
              onChange={(e) => setDateM(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="bf-file" className="block text-sm font-medium text-[#475569]">
              Justificatif (PDF, JPEG, PNG…)
            </label>
            <input
              id="bf-file"
              type="file"
              accept="application/pdf,image/*"
              className="mt-1 block w-full text-sm text-[#64748b] file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
              onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Enregistrement…" : "Valider"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
