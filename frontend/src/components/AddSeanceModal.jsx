import { useId, useMemo } from "react";

import { GRID_JOUR_LABELS, JOUR_LUN_A_SAM, timeToSlot } from "../utils/emploiDuTempsGrid.js";

const JOUR_MODAL_OPTIONS = [...JOUR_LUN_A_SAM, { value: "6", label: GRID_JOUR_LABELS[6] }];

/**
 * Modal d’ajout / édition d’un créneau d’emploi du temps (modèle hebdo).
 * Enseignants = ressource `Professeur` (API /api/professeurs/) — rôle enseignant.
 */
export default function AddSeanceModal({
  open,
  onClose,
  onApply,
  onDeleteFromGrid,
  form,
  onFormChange,
  formError,
  professeurs,
  classes,
  appliedClasseNom,
  modalMode,
  editingCellKey,
  canDelete = false,
}) {
  const baseId = useId();
  const listId = `${baseId}-matieres`;

  const matiereSuggestions = useMemo(() => {
    const set = new Set();
    for (const p of professeurs) {
      if (p.matiere && String(p.matiere).trim()) {
        set.add(String(p.matiere).trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [professeurs]);

  if (!open) return null;

  function update(field, value) {
    onFormChange((f) => ({ ...f, [field]: value }));
  }

  function handleProfChange(e) {
    const id = e.target.value;
    onFormChange((f) => {
      const p = professeurs.find((x) => String(x.id) === String(id));
      const m = p?.matiere && String(p.matiere).trim() ? p.matiere : f.matiere;
      return { ...f, professeur: id, matiere: m || "" };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onApply();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${baseId}-title`}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-2xl">
        <h3 id={`${baseId}-title`} className="text-lg font-semibold text-[#0f172a]">
          {modalMode === "edit" ? "Modifier la séance" : "Nouvelle séance"}
        </h3>
        <p className="mt-1 text-sm text-[#64748b]">
          Les changements s’appliquent à la grille ; utilisez le bouton d’enregistrement de la page pour envoyer le modèle
          au serveur (séances datées du trimestre).
        </p>
        {appliedClasseNom || form.classe ? (
          <p className="mt-2 text-sm text-[#64748b]">
            Classe :{" "}
            <span className="font-medium text-[#0f172a]">
              {classes.find((c) => String(c.id) === String(form.classe))?.nom ?? appliedClasseNom ?? "—"}
            </span>
          </p>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-prof`} className="text-xs font-medium text-[#64748b]">
              Enseignant
            </label>
            <select
              id={`${baseId}-prof`}
              required
              value={form.professeur}
              onChange={handleProfChange}
              className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
            >
              <option value="">— Sélectionner un enseignant —</option>
              {professeurs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.prenom} {p.nom} — {p.matiere || "—"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-mat`} className="text-xs font-medium text-[#64748b]">
              Matière
            </label>
            <input
              id={`${baseId}-mat`}
              type="text"
              value={form.matiere}
              onChange={(e) => update("matiere", e.target.value)}
              list={listId}
              autoComplete="off"
              placeholder="ex. Mathématiques, Français…"
              className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] placeholder:text-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
            />
            <datalist id={listId}>
              {matiereSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-jour`} className="text-xs font-medium text-[#64748b]">
              Jour
            </label>
            <select
              id={`${baseId}-jour`}
              value={form.jour_semaine}
              onChange={(e) => update("jour_semaine", e.target.value)}
              className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
            >
              {JOUR_MODAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#94a3b8]">Par défaut lundi–samedi ; le dimanche est réservé aux cas exceptionnels.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-debut`} className="text-xs font-medium text-[#64748b]">
                Heure début
              </label>
              <input
                id={`${baseId}-debut`}
                type="time"
                value={form.heure_debut}
                onChange={(e) => update("heure_debut", timeToSlot(e.target.value) || e.target.value)}
                className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-fin`} className="text-xs font-medium text-[#64748b]">
                Heure fin
              </label>
              <input
                id={`${baseId}-fin`}
                type="time"
                value={form.heure_fin}
                onChange={(e) => update("heure_fin", timeToSlot(e.target.value) || e.target.value)}
                className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-salle`} className="text-xs font-medium text-[#64748b]">
              Salle
            </label>
            <input
              id={`${baseId}-salle`}
              type="text"
              value={form.salle}
              onChange={(e) => update("salle", e.target.value)}
              placeholder="ex. Salle 3, Labo…"
              className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/25"
            />
          </div>

          {formError ? (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#f1f5f9] pt-4">
            {canDelete && editingCellKey ? (
              <button
                type="button"
                onClick={onDeleteFromGrid}
                className="mr-auto rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Retirer de la grille
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#f8fafc]"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#2563eb]"
            >
              Placer sur la grille
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
