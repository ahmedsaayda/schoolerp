import { useEffect, useId, useState } from "react";

import { API_DEPENSES, apiFetch, dispatchCaisseSessionChanged } from "../config.js";
import { useSessionRequirementOptional } from "./SessionRequirementModal.jsx";
import { isNoSessionCaisseErrorMessage } from "../utils/sessionCaisseErrors.js";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aligné sur `Depense.Categorie` côté API. */
export const DEPENSE_CATEGORIE_OPTIONS = [
  { value: "LOYER", label: "Loyer" },
  { value: "FACTURES", label: "Factures (STEG, SONEDE, etc.)" },
  { value: "FOURNITURES", label: "Fournitures" },
  { value: "ENTRETIEN", label: "Entretien" },
  { value: "SALAIRE", label: "Salaires" },
  { value: "AUTRE", label: "Autre" },
];

function emptyForm() {
  return {
    titre: "",
    categorie: "AUTRE",
    montant: "",
    date_depense: todayISODate(),
    note: "",
  };
}

function rowToForm(row) {
  if (!row) return emptyForm();
  const d = row.date_depense;
  const dateStr =
    typeof d === "string" ? d.slice(0, 10) : d ? new Date(d).toISOString().slice(0, 10) : todayISODate();
  return {
    titre: row.titre ?? "",
    categorie:
      row.categorie && DEPENSE_CATEGORIE_OPTIONS.some((o) => o.value === row.categorie)
        ? row.categorie
        : "AUTRE",
    montant: row.montant != null && row.montant !== "" ? String(row.montant) : "",
    date_depense: dateStr,
    note: row.note ?? "",
  };
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
 * Modale création / édition d'une dépense.
 */
export default function DepenseModal({ open, mode, depense, onClose, onSuccess }) {
  const titleId = useId();
  const sessionRequirement = useSessionRequirementOptional();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [noteError, setNoteError] = useState("");
  const [pieceJointeFile, setPieceJointeFile] = useState(null);
  const [pieceJointeError, setPieceJointeError] = useState("");
  const isCreateMode = mode !== "edit";

  useEffect(() => {
    if (!open) return;
    setError("");
    setNoteError("");
    setPieceJointeError("");
    setPieceJointeFile(null);
    if (mode === "edit" && depense) {
      setForm(rowToForm(depense));
    } else {
      setForm(emptyForm());
    }
  }, [open, mode, depense]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function setField(key, value) {
    if (key === "note") setNoteError("");
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNoteError("");
    setPieceJointeError("");
    const montantNum = Number(String(form.montant).replace(",", "."));
    if (!form.titre.trim()) {
      setError("Le titre est obligatoire.");
      return;
    }
    if (!Number.isFinite(montantNum) || montantNum < 0) {
      setError("Montant invalide.");
      return;
    }
    if (!form.note.trim()) {
      setNoteError("Veuillez ajouter une note explicative");
      return;
    }
    if (isCreateMode && !pieceJointeFile) {
      setPieceJointeError("Veuillez ajouter un justificatif (facture/pièce jointe).");
      return;
    }

    const body = new FormData();
    body.append("titre", form.titre.trim());
    body.append("categorie", form.categorie);
    body.append("montant", montantNum.toFixed(2));
    body.append("date_depense", form.date_depense);
    body.append("note", form.note.trim());
    if (pieceJointeFile) {
      body.append("piece_jointe", pieceJointeFile);
    }
    setSubmitting(true);
    try {
      const url = mode === "edit" && depense?.id ? `${API_DEPENSES}${depense.id}/` : API_DEPENSES;
      const res = await apiFetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        body,
      });
      if (!res.ok) {
        const msg = await parseErrorResponse(res);
        if (sessionRequirement?.showSessionRequired && isNoSessionCaisseErrorMessage(msg)) {
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
          {mode === "edit" ? "Modifier la dépense" : "Ajouter une dépense"}
        </h2>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="dep-titre" className="block text-sm font-medium text-[#475569]">
              Titre
            </label>
            <input
              id="dep-titre"
              type="text"
              value={form.titre}
              onChange={(e) => setField("titre", e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              placeholder="ex. Facture STEG"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="dep-cat" className="block text-sm font-medium text-[#475569]">
              Catégorie
            </label>
            <select
              id="dep-cat"
              value={form.categorie}
              onChange={(e) => setField("categorie", e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
            >
              {DEPENSE_CATEGORIE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dep-montant" className="block text-sm font-medium text-[#475569]">
                Montant (DT)
              </label>
              <input
                id="dep-montant"
                type="text"
                inputMode="decimal"
                value={form.montant}
                onChange={(e) => setField("montant", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
                placeholder="0,00"
              />
            </div>
            <div>
              <label htmlFor="dep-date" className="block text-sm font-medium text-[#475569]">
                Date
              </label>
              <input
                id="dep-date"
                type="date"
                value={form.date_depense}
                onChange={(e) => setField("date_depense", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2"
              />
            </div>
          </div>
          <div>
            <label htmlFor="dep-note" className="block text-sm font-medium text-[#475569]">
              Note *
            </label>
            <textarea
              id="dep-note"
              name="note"
              rows={2}
              required
              value={form.note}
              onChange={(e) => setField("note", e.target.value)}
              aria-invalid={noteError ? "true" : "false"}
              aria-describedby={noteError ? "dep-note-error" : undefined}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2 ${
                noteError ? "border-red-300 ring-red-200" : "border-[#e2e8f0]"
              }`}
            />
            {noteError ? (
              <p id="dep-note-error" className="mt-1 text-xs font-medium text-red-700" role="alert">
                {noteError}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="dep-piece-jointe" className="block text-sm font-medium text-[#475569]">
              Pièce jointe (justificatif/facture) {isCreateMode ? "*" : "(optionnelle)"}
            </label>
            <input
              id="dep-piece-jointe"
              name="piece_jointe"
              type="file"
              required={isCreateMode}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPieceJointeFile(file);
                setPieceJointeError("");
              }}
              aria-invalid={pieceJointeError ? "true" : "false"}
              aria-describedby={pieceJointeError ? "dep-piece-jointe-error" : undefined}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-slate-300 focus:ring-2 ${
                pieceJointeError ? "border-red-300 ring-red-200" : "border-[#e2e8f0]"
              }`}
            />
            {pieceJointeError ? (
              <p id="dep-piece-jointe-error" className="mt-1 text-xs font-medium text-red-700" role="alert">
                {pieceJointeError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#f8fafc]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || (isCreateMode && !pieceJointeFile)}
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-60"
            >
              {submitting ? "Enregistrement…" : mode === "edit" ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
