import { useEffect, useId, useState } from "react";

import { X } from "lucide-react";

import { API_PERSONNEL, API_PROFESSEURS, apiFetch } from "../config.js";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyForm() {
  return {
    montant: "",
    date: todayISODate(),
    methode: "caisse",
    remarque: "",
  };
}

function accorderAvanceUrl(personnel, professeur) {
  if (personnel?.id != null) return `${API_PERSONNEL}${personnel.id}/accorder-avance/`;
  if (professeur?.id != null) return `${API_PROFESSEURS}${professeur.id}/accorder-avance/`;
  return "";
}

/**
 * Avance sur salaire — POST …/accorder-avance/ (dépense caisse ou retrait banque + fiche avance).
 */
export default function AvanceSalaireModal({
  open,
  onClose,
  onSuccess,
  professeur = null,
  personnel = null,
}) {
  const titleId = useId();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- réinitialisation à l’ouverture */
    setError("");
    setForm(emptyForm());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, professeur?.id, personnel?.id]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const url = accorderAvanceUrl(personnel, professeur);
    if (!url) return;

    const montantStr = String(form.montant).trim().replace(",", ".");
    const montantNum = Number(montantStr);
    if (!montantStr || Number.isNaN(montantNum) || montantNum <= 0) {
      setError("Indiquez un montant valide (supérieur à 0).");
      return;
    }
    if (!form.date) {
      setError("Indiquez la date de l’avance.");
      return;
    }
    const meth = form.methode === "banque" ? "banque" : "caisse";

    setSubmitting(true);
    setError("");
    try {
      const payload = {
        montant: montantNum.toFixed(2),
        date: form.date,
        methode: meth,
      };
      const rem = form.remarque.trim();
      if (rem) payload.remarque = rem;

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
            const first = Object.entries(data).find(([, v]) => v != null);
            if (first) msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
          }
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }

      onSuccess?.();
      onClose();
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || (!professeur && !personnel)) return null;

  const subtitle = personnel
    ? [personnel.prenom, personnel.nom].filter(Boolean).join(" ").trim()
    : [professeur.prenom, professeur.nom].filter(Boolean).join(" ").trim();

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
              Avance sur salaire
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">{subtitle || "—"}</p>
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

        <form onSubmit={handleSubmit} className="px-5 py-5">
          {error ? (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="av-salaire-montant"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
              >
                Montant de l&apos;avance (DT)
              </label>
              <input
                id="av-salaire-montant"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.montant}
                onChange={(e) => update("montant", e.target.value)}
                placeholder="0,00"
                disabled={submitting}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] tabular-nums placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="av-salaire-date"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
              >
                Date de l&apos;avance
              </label>
              <input
                id="av-salaire-date"
                type="date"
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                Méthode de décaissement
              </legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
                  <input
                    type="radio"
                    name="av-methode"
                    checked={form.methode === "caisse"}
                    onChange={() => update("methode", "caisse")}
                    disabled={submitting}
                    className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                  />
                  Caisse (espèces)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
                  <input
                    type="radio"
                    name="av-methode"
                    checked={form.methode === "banque"}
                    onChange={() => update("methode", "banque")}
                    disabled={submitting}
                    className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                  />
                  Banque (compte interne)
                </label>
              </div>
            </fieldset>
            <div>
              <label
                htmlFor="av-salaire-rem"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
              >
                Remarque (optionnel)
              </label>
              <textarea
                id="av-salaire-rem"
                rows={2}
                value={form.remarque}
                onChange={(e) => update("remarque", e.target.value)}
                disabled={submitting}
                placeholder="Optionnel"
                className="w-full resize-y rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-50"
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
              disabled={submitting}
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50"
            >
              {submitting ? "Enregistrement…" : "Valider l'avance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
