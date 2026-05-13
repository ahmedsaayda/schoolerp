import { useEffect, useId, useState } from "react";

import { API_PERSONNEL, apiFetch } from "../config.js";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aligné sur `Personnel.Role` côté API. */
export const PERSONNEL_ROLE_OPTIONS = [
  { value: "ADMIN", label: "Administratif" },
  { value: "AGENT", label: "Agent" },
  { value: "TECHNICIEN", label: "Technicien" },
  { value: "CHAUFFEUR", label: "Chauffeur" },
  { value: "CUISINIER", label: "Cuisinier" },
  { value: "SECURITE", label: "Sécurité" },
  { value: "ENTRETIEN", label: "Entretien" },
  { value: "AUTRE", label: "Autre" },
];

function emptyForm() {
  return {
    nom: "",
    prenom: "",
    telephone: "",
    adresse: "",
    role: "AGENT",
    salaire_mensuel: "",
    retenue_par_absence: "0",
    date_embauche: todayISODate(),
  };
}

function personnelToForm(row) {
  if (!row) return emptyForm();
  const d = row.date_embauche;
  const dateStr =
    typeof d === "string" ? d.slice(0, 10) : d ? new Date(d).toISOString().slice(0, 10) : todayISODate();
  return {
    nom: row.nom ?? "",
    prenom: row.prenom ?? "",
    telephone: digitsOnlyMax8(row.telephone),
    adresse: row.adresse ?? "",
    role: row.role && PERSONNEL_ROLE_OPTIONS.some((o) => o.value === row.role) ? row.role : "AGENT",
    salaire_mensuel:
      row.salaire_mensuel != null && row.salaire_mensuel !== "" ? String(row.salaire_mensuel) : "",
    retenue_par_absence:
      row.retenue_par_absence != null && row.retenue_par_absence !== ""
        ? String(row.retenue_par_absence)
        : "0",
    date_embauche: dateStr,
  };
}

function digitsOnlyMax8(s) {
  return String(s ?? "").replace(/\D/g, "").slice(0, 8);
}

async function parseErrorResponse(res) {
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
  return msg;
}

/**
 * Modale d’ajout, modification ou suppression d’un membre du personnel non enseignant.
 */
export default function PersonnelModal({ open, mode, personnel, onClose, onSuccess }) {
  const titleId = useId();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (mode === "edit" && personnel) {
      setForm(personnelToForm(personnel));
    } else {
      setForm(emptyForm());
    }
  }, [open, mode, personnel]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updatePhone(raw) {
    update("telephone", digitsOnlyMax8(raw));
  }

  const telPartial = form.telephone.length > 0 && form.telephone.length < 8;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.telephone.length !== 8) {
      setError("Le téléphone doit contenir exactement 8 chiffres.");
      return;
    }
    const salaire = form.salaire_mensuel === "" ? NaN : Number(String(form.salaire_mensuel).replace(",", "."));
    if (Number.isNaN(salaire) || salaire < 0) {
      setError("Indiquez un salaire mensuel valide.");
      return;
    }
    const retenue =
      form.retenue_par_absence === "" ? NaN : Number(String(form.retenue_par_absence).replace(",", "."));
    if (Number.isNaN(retenue) || retenue < 0) {
      setError("Indiquez une retenue par absence valide (0 ou plus).");
      return;
    }
    if (!form.date_embauche) {
      setError("Indiquez la date d’embauche.");
      return;
    }

    const payload = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      telephone: form.telephone,
      adresse: form.adresse.trim(),
      role: form.role,
      salaire_mensuel: salaire.toFixed(2),
      retenue_par_absence: retenue.toFixed(2),
      date_embauche: form.date_embauche,
    };

    setSubmitting(true);
    try {
      const url = mode === "edit" && personnel?.id != null ? `${API_PERSONNEL}${personnel.id}/` : API_PERSONNEL;
      const res = await apiFetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setError(await parseErrorResponse(res));
        return;
      }

      onSuccess?.();
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!personnel?.id) return;
    if (!window.confirm(`Supprimer ${personnel.prenom} ${personnel.nom} du personnel ?`)) return;
    setError("");
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_PERSONNEL}${personnel.id}/`, { method: "DELETE" });
      if (!res.ok) {
        setError(await parseErrorResponse(res));
        return;
      }
      onSuccess?.();
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  const inputClass =
    "w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60";
  const inputClassPhoneInvalid = `${inputClass} border-red-300 focus:border-red-500 focus:ring-red-500`;
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]";
  const title = mode === "edit" ? "Modifier un membre du personnel" : "Ajouter un membre du personnel";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
            {title}
          </h2>
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

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pers-nom" className={labelClass}>
                Nom
              </label>
              <input
                id="pers-nom"
                value={form.nom}
                onChange={(e) => update("nom", e.target.value)}
                required
                disabled={submitting || deleting}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="pers-prenom" className={labelClass}>
                Prénom
              </label>
              <input
                id="pers-prenom"
                value={form.prenom}
                onChange={(e) => update("prenom", e.target.value)}
                required
                disabled={submitting || deleting}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pers-role" className={labelClass}>
              Rôle
            </label>
            <select
              id="pers-role"
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              required
              disabled={submitting || deleting}
              className={inputClass}
            >
              {PERSONNEL_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pers-adresse" className={labelClass}>
              Adresse
            </label>
            <textarea
              id="pers-adresse"
              value={form.adresse}
              onChange={(e) => update("adresse", e.target.value)}
              rows={2}
              disabled={submitting || deleting}
              className={inputClass}
              placeholder="Adresse complète (optionnel)"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pers-tel" className={labelClass}>
                Téléphone
              </label>
              <input
                id="pers-tel"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={8}
                value={form.telephone}
                onChange={(e) => updatePhone(e.target.value)}
                required
                disabled={submitting || deleting}
                className={telPartial ? inputClassPhoneInvalid : inputClass}
                aria-invalid={telPartial}
              />
              {telPartial ? (
                <p className="mt-1 text-xs text-red-600">8 chiffres requis ({form.telephone.length}/8).</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pers-salaire" className={labelClass}>
                Salaire mensuel (DT)
              </label>
              <input
                id="pers-salaire"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.salaire_mensuel}
                onChange={(e) => update("salaire_mensuel", e.target.value)}
                required
                disabled={submitting || deleting}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pers-retenue" className={labelClass}>
                Retenue / jour absent (DT)
              </label>
              <input
                id="pers-retenue"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.retenue_par_absence}
                onChange={(e) => update("retenue_par_absence", e.target.value)}
                disabled={submitting || deleting}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-[#94a3b8]">Déduit du salaire pour chaque jour « Absent » pointé dans le mois.</p>
            </div>
          </div>

          <div>
            <label htmlFor="pers-embauche" className={labelClass}>
              Date d&apos;embauche
            </label>
            <input
              id="pers-embauche"
              type="date"
              value={form.date_embauche}
              onChange={(e) => update("date_embauche", e.target.value)}
              required
              disabled={submitting || deleting}
              className={inputClass}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] pt-4">
            {mode === "edit" && personnel?.id != null ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting || deleting}
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 transition hover:bg-red-100 disabled:opacity-60"
              >
                {deleting ? "Suppression…" : "Supprimer"}
              </button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || deleting}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition hover:bg-[#f8fafc] disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || deleting}
                className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
              >
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
