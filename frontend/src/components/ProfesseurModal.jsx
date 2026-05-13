import { useEffect, useId, useState } from "react";

import { API_PROFESSEURS, apiFetch } from "../config.js";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyForm() {
  return {
    nom: "",
    prenom: "",
    matiere: "",
    telephone: "",
    tarif_horaire: "",
    date_embauche: todayISODate(),
    travaille_ailleurs: false,
    nom_autre_etablissement: "",
  };
}

function formFromProf(p) {
  const emb = p.date_embauche ? String(p.date_embauche).slice(0, 10) : todayISODate();
  const tarif = p.tarif_horaire != null ? String(p.tarif_horaire).replace(".", ",") : "";
  const nomAutre = p.nom_autre_etablissement ?? p.autre_etablissement ?? "";
  return {
    nom: p.nom ?? "",
    prenom: p.prenom ?? "",
    matiere: p.matiere ?? "",
    telephone: p.telephone ?? "",
    tarif_horaire: tarif,
    date_embauche: emb,
    travaille_ailleurs: p.travaille_ailleurs === true,
    nom_autre_etablissement: nomAutre,
  };
}

function digitsOnlyMax8(s) {
  return String(s ?? "").replace(/\D/g, "").slice(0, 8);
}

/**
 * Modale d’ajout (POST) ou modification (PATCH) d’un professeur.
 */
export default function ProfesseurModal({ open, onClose, onSuccess, editProf = null }) {
  const titleId = useId();
  const situationLegendId = useId();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEdit = editProf != null && editProf.id != null;

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- réinitialisation du formulaire à l’ouverture */
    setError("");
    if (editProf?.id != null) {
      setForm(formFromProf(editProf));
    } else {
      setForm(emptyForm());
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Intentionnellement seulement open + id : évite de réinitialiser pendant la saisie si le parent rerend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editProf?.id]);

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
    const tarif = form.tarif_horaire === "" ? NaN : Number(String(form.tarif_horaire).replace(",", "."));
    if (Number.isNaN(tarif) || tarif < 0) {
      setError("Indiquez un tarif horaire valide.");
      return;
    }
    if (!form.date_embauche) {
      setError("Indiquez la date d’embauche.");
      return;
    }
    if (form.travaille_ailleurs && !String(form.nom_autre_etablissement ?? "").trim()) {
      setError("Indiquez le nom de l’autre établissement.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = {
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        matiere: form.matiere.trim(),
        telephone: form.telephone,
        tarif_horaire: tarif.toFixed(2),
        date_embauche: form.date_embauche,
        travaille_ailleurs: form.travaille_ailleurs,
        nom_autre_etablissement: form.travaille_ailleurs ? String(form.nom_autre_etablissement).trim() : "",
      };

      const url = isEdit ? `${API_PROFESSEURS}${editProf.id}/` : API_PROFESSEURS;
      const method = isEdit ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
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
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const inputClass =
    "w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60";
  const inputClassPhoneInvalid = `${inputClass} border-red-300 focus:border-red-500 focus:ring-red-500`;
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]";

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
            {isEdit ? "Modifier le professeur" : "Ajouter un professeur"}
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
              <label htmlFor="prof-nom" className={labelClass}>
                Nom
              </label>
              <input
                id="prof-nom"
                value={form.nom}
                onChange={(e) => update("nom", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="prof-prenom" className={labelClass}>
                Prénom
              </label>
              <input
                id="prof-prenom"
                value={form.prenom}
                onChange={(e) => update("prenom", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="prof-matiere" className={labelClass}>
              Matière
            </label>
            <input
              id="prof-matiere"
              value={form.matiere}
              onChange={(e) => update("matiere", e.target.value)}
              required
              disabled={submitting}
              className={inputClass}
              placeholder="Ex. Mathématiques"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="prof-tel" className={labelClass}>
                Téléphone
              </label>
              <input
                id="prof-tel"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={8}
                value={form.telephone}
                onChange={(e) => updatePhone(e.target.value)}
                required
                disabled={submitting}
                className={telPartial ? inputClassPhoneInvalid : inputClass}
                aria-invalid={telPartial}
              />
              {telPartial ? (
                <p className="mt-1 text-xs text-red-600">8 chiffres requis ({form.telephone.length}/8).</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="prof-tarif" className={labelClass}>
                Tarif horaire (DT)
              </label>
              <input
                id="prof-tarif"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.tarif_horaire}
                onChange={(e) => update("tarif_horaire", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="prof-embauche" className={labelClass}>
              Date d&apos;embauche
            </label>
            <input
              id="prof-embauche"
              type="date"
              value={form.date_embauche}
              onChange={(e) => update("date_embauche", e.target.value)}
              required
              disabled={submitting}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-[#94a3b8]">Requis par le dossier administratif ; par défaut : aujourd’hui.</p>
          </div>

          <fieldset className="rounded-xl border border-[#e2e8f0] bg-[#fafbfc] px-4 py-4">
            <legend id={situationLegendId} className="px-1 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Situation professionnelle
            </legend>
            <p className="mb-3 text-sm font-medium text-[#0f172a]" id={`${situationLegendId}-q`}>
              Travaille dans un autre établissement ?
            </p>
            <div
              className="flex flex-wrap gap-4"
              role="radiogroup"
              aria-labelledby={`${situationLegendId}-q`}
            >
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
                <input
                  type="radio"
                  name="prof-travaille-ailleurs"
                  checked={form.travaille_ailleurs === true}
                  onChange={() => {
                    update("travaille_ailleurs", true);
                  }}
                  disabled={submitting}
                  className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                />
                Oui
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
                <input
                  type="radio"
                  name="prof-travaille-ailleurs"
                  checked={form.travaille_ailleurs === false}
                  onChange={() => {
                    setForm((f) => ({ ...f, travaille_ailleurs: false, nom_autre_etablissement: "" }));
                  }}
                  disabled={submitting}
                  className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                />
                Non
              </label>
            </div>
            {form.travaille_ailleurs ? (
              <div className="mt-4">
                <label htmlFor="prof-autre-etab" className={labelClass}>
                  Nom de l&apos;autre établissement
                </label>
                <input
                  id="prof-autre-etab"
                  value={form.nom_autre_etablissement}
                  onChange={(e) => update("nom_autre_etablissement", e.target.value)}
                  required
                  disabled={submitting}
                  className={inputClass}
                  placeholder="Ex. Lycée pilote de…"
                />
              </div>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2 border-t border-[#e2e8f0] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition hover:bg-[#f8fafc] disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
            >
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
