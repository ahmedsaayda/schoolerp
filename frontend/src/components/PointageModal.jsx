import { useEffect, useId, useRef, useState } from "react";

import { API_POINTAGES, API_POINTAGES_SESSIONS_JOUR, API_PROFESSEURS, apiFetch } from "../config.js";
import { normalizeProfesseursListFromApi } from "../utils/professeurApi.js";
import Loading from "./ui/Loading.jsx";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DEFAULT_PROF_PREVIEW = 20;
const SEARCH_DEBOUNCE_MS = 320;

const STATUT_PRESENCE_OPTIONS = [
  { value: "PRESENTE", label: "Present" },
  { value: "ABSENTE", label: "Absent" },
  { value: "RETARD", label: "Late" },
];

function emptyForm() {
  return {
    professeur: "",
    date_cours: todayISODate(),
    nombre_heures: "1.5",
    statut_presence: "PRESENTE",
    remarque: "",
    emploi_du_temps: "",
  };
}

function formatHeureCourt(isoTime) {
  if (!isoTime) return "—";
  const s = String(isoTime);
  const part = s.length >= 8 ? s.slice(0, 8) : s.slice(0, 5);
  try {
    const [hh, mm] = part.split(":");
    if (hh == null || mm == null) return part;
    return `${hh}h${mm}`;
  } catch {
    return part;
  }
}

function profLabel(p) {
  return `${p.nom ?? ""} ${p.prenom ?? ""}`.trim();
}

function profDetailLine(p) {
  const m = p.matiere || "—";
  const tel = p.telephone || "—";
  return `${m} · ${tel}`;
}

/**
 * Saisie d’une séance (POST /api/pointages/), avec recherche de professeur comme pour les élèves.
 * @param {null | { id: number, nom?: string, prenom?: string, matiere?: string, telephone?: string }} initialProfesseur
 */
export default function PointageModal({ open, onClose, onSuccess, initialProfesseur = null }) {
  const titleId = useId();
  const comboboxId = useId();
  const listboxId = useId();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pickedProf, setPickedProf] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");

  const comboboxWrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- réinitialisation du formulaire à l’ouverture */
    setError("");
    setIsDropdownOpen(false);
    setSearchLoading(false);
    setSearchResults([]);
    setSlots([]);
    setSlotsError("");
    setSlotsLoading(false);
    const base = emptyForm();
    if (initialProfesseur != null && initialProfesseur.id != null) {
      setPickedProf(initialProfesseur);
      setForm({ ...base, professeur: String(initialProfesseur.id) });
      setSearchTerm(profLabel(initialProfesseur));
    } else {
      setPickedProf(null);
      setForm(base);
      setSearchTerm("");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initialProfesseur]);

  useEffect(() => {
    if (!open) return;
    const pid = pickedProf?.id;
    if (!Number.isInteger(pid) || pid < 1 || !form.date_cours) {
      setSlots([]);
      setSlotsError("");
      setSlotsLoading(false);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError("");

    const url = `${API_POINTAGES_SESSIONS_JOUR}?date=${encodeURIComponent(form.date_cours)}`;
    apiFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      })
      .then((list) => {
        if (cancelled) return;
        const mine = list.filter((s) => s.professeur_id === pid);
        setSlots(mine);
        if (mine.length === 0) {
          setForm((f) => ({ ...f, emploi_du_temps: "" }));
        } else if (mine.length === 1) {
          const sl = mine[0];
          setForm((f) => ({
            ...f,
            emploi_du_temps: String(sl.schedule_id),
            nombre_heures: String(sl.duree_heures ?? f.nombre_heures),
          }));
        } else {
          setForm((f) => {
            const ok = mine.some((s) => String(s.schedule_id) === f.emploi_du_temps);
            if (ok) return f;
            return { ...f, emploi_du_temps: "" };
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setSlotsError("Impossible de charger les créneaux pour cette date.");
          setForm((f) => ({ ...f, emploi_du_temps: "" }));
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, pickedProf?.id, form.date_cours]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const q = searchTerm.trim();
    const delay = q.length > 0 ? SEARCH_DEBOUNCE_MS : 0;

    const handle = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("search", q);
        const url = params.toString() ? `${API_PROFESSEURS}?${params.toString()}` : API_PROFESSEURS;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const raw = Array.isArray(data) ? data : data.results ?? [];
        let list = normalizeProfesseursListFromApi(raw);
        if (!q) {
          list = list.slice(0, DEFAULT_PROF_PREVIEW);
        }
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, delay);

    return () => clearTimeout(handle);
  }, [searchTerm, open]);

  useEffect(() => {
    if (!open || !isDropdownOpen) return;

    function onDocMouseDown(ev) {
      const root = comboboxWrapRef.current;
      if (root && !root.contains(ev.target)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, isDropdownOpen]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function onSearchInputChange(raw) {
    setSearchTerm(raw);
    setIsDropdownOpen(true);
    const label = pickedProf ? profLabel(pickedProf) : null;
    if (label != null && raw.trim() !== label) {
      setPickedProf(null);
      setForm((f) => ({ ...f, professeur: "", emploi_du_temps: "" }));
    }
  }

  function selectProf(p) {
    setPickedProf(p);
    setForm((f) => ({
      ...f,
      professeur: String(p.id),
      emploi_du_temps: "",
    }));
    setSearchTerm(profLabel(p));
    setIsDropdownOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const pid = form.professeur === "" ? NaN : Number(form.professeur);
    if (!Number.isInteger(pid) || pid < 1) {
      setError("Sélectionnez un professeur dans la liste.");
      return;
    }
    const heures = Number(String(form.nombre_heures).replace(",", "."));
    const absent = form.statut_presence === "ABSENTE";
    if (Number.isNaN(heures) || heures < 0 || (!absent && heures <= 0)) {
      setError(
        absent
          ? "Indiquez un nombre d’heures valide (0 si aucune heure facturée)."
          : "Indiquez un nombre d’heures valide.",
      );
      return;
    }
    if (!form.date_cours) {
      setError("Indiquez la date du cours.");
      return;
    }

    const edtId = form.emploi_du_temps === "" ? NaN : Number(form.emploi_du_temps);
    if (!Number.isInteger(edtId) || edtId < 1) {
      setError(
        "Sélectionnez le créneau (classe) prévu dans l’emploi du temps pour cette date.",
      );
      return;
    }
    const slotOk = slots.some((s) => s.schedule_id === edtId);
    if (!slotOk) {
      setError("Créneau invalide ou plus disponible. Vérifiez la date et le professeur.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        professeur: pid,
        date_cours: form.date_cours,
        nombre_heures: heures.toFixed(2),
        statut_presence: form.statut_presence,
        est_paye: false,
        remarque: form.remarque.trim() === "" ? null : form.remarque.trim(),
        emploi_du_temps: edtId,
      };

      const res = await apiFetch(API_POINTAGES, {
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
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const inputClass =
    "w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60";
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
            Enregistrer une séance
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

          <div ref={comboboxWrapRef} className="relative">
            <label htmlFor={comboboxId} className={labelClass}>
              Professeur
            </label>
            <input
              id={comboboxId}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isDropdownOpen}
              aria-controls={listboxId}
              autoComplete="off"
              placeholder="Rechercher par nom, prénom, matière, téléphone…"
              value={searchTerm}
              onChange={(e) => onSearchInputChange(e.target.value)}
              onFocus={() => setIsDropdownOpen(true)}
              disabled={submitting}
              className={inputClass}
            />
            {isDropdownOpen ? (
              <ul
                id={listboxId}
                role="listbox"
                className="absolute left-0 right-0 z-[100] mt-1 max-h-60 overflow-y-auto rounded-lg border border-[#e2e8f0] bg-white py-1 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.25)]"
              >
                {searchLoading ? (
                  <li className="px-3 py-2.5 text-sm text-[#64748b]" role="status">
                    Recherche…
                  </li>
                ) : searchResults.length === 0 ? (
                  <li className="px-3 py-2.5 text-sm text-[#64748b]">Aucun professeur trouvé.</li>
                ) : (
                  searchResults.map((p) => (
                    <li key={p.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={form.professeur === String(p.id)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => selectProf(p)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-[#f1f5f9]"
                      >
                        <span className="font-medium text-[#0f172a]">
                          {p.nom} {p.prenom}
                        </span>
                        <span className="text-xs text-[#64748b]">{profDetailLine(p)}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {pickedProf && form.professeur ? (
              <p className="mt-1 text-xs font-medium text-[#15803d]" aria-live="polite">
                Professeur sélectionné — validez pour enregistrer la séance.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#94a3b8]">
                Sans recherche : les {DEFAULT_PROF_PREVIEW} premiers professeurs ; affinez par nom, matière ou téléphone.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pointage-date" className={labelClass}>
                Date du cours
              </label>
              <input
                id="pointage-date"
                type="date"
                max={todayISODate()}
                value={form.date_cours}
                onChange={(e) => {
                  const v = e.target.value;
                  const t = todayISODate();
                  update("date_cours", v > t ? t : v);
                }}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="pointage-heures" className={labelClass}>
                Nombre d&apos;heures
              </label>
              <input
                id="pointage-heures"
                type="number"
                inputMode="decimal"
                min={form.statut_presence === "ABSENTE" ? "0" : "0.5"}
                step="0.5"
                value={form.nombre_heures}
                onChange={(e) => update("nombre_heures", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
          </div>

          {pickedProf && form.professeur ? (
            <div>
              <label htmlFor="pointage-creneau" className={labelClass}>
                Créneau (classe · emploi du temps)
              </label>
              {slotsError ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
                  {slotsError}
                </p>
              ) : slotsLoading ? (
                <Loading
                  message="Chargement des créneaux…"
                  className="min-h-[100px] justify-start py-2"
                />
              ) : slots.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
                  Aucun créneau d’emploi du temps pour ce professeur à cette date. Ajoutez un créneau
                  dans l’emploi du temps ou choisissez une autre journée.
                </p>
              ) : (
                <select
                  id="pointage-creneau"
                  value={form.emploi_du_temps}
                  onChange={(e) => {
                    const id = e.target.value;
                    const sl = slots.find((s) => String(s.schedule_id) === id);
                    setForm((f) => ({
                      ...f,
                      emploi_du_temps: id,
                      nombre_heures:
                        sl != null && sl.duree_heures != null ? String(sl.duree_heures) : f.nombre_heures,
                    }));
                  }}
                  required
                  disabled={submitting}
                  className={inputClass}
                >
                  <option value="">— Choisir la classe / l’horaire —</option>
                  {slots.map((s) => (
                    <option key={s.schedule_id} value={s.schedule_id}>
                      {(s.classe_nom ?? "Sans classe").trim()} · {formatHeureCourt(s.heure_debut)}–
                      {formatHeureCourt(s.heure_fin)} ({s.duree_heures} h)
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          <div>
            <label htmlFor="pointage-statut" className={labelClass}>
              Statut
            </label>
            <select
              id="pointage-statut"
              value={form.statut_presence}
              onChange={(e) => update("statut_presence", e.target.value)}
              disabled={submitting}
              className={inputClass}
            >
              {STATUT_PRESENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pointage-remarque" className={labelClass}>
              Remarque <span className="font-normal normal-case text-[#94a3b8]">(optionnel)</span>
            </label>
            <textarea
              id="pointage-remarque"
              value={form.remarque}
              onChange={(e) => update("remarque", e.target.value)}
              disabled={submitting}
              rows={3}
              className={`${inputClass} resize-y`}
              placeholder="Notes internes…"
            />
          </div>

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
              disabled={
                submitting ||
                slotsLoading ||
                Boolean(slotsError) ||
                (Boolean(pickedProf && form.professeur) && slots.length === 0)
              }
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
            >
              {submitting ? "Enregistrement…" : "Enregistrer la séance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
