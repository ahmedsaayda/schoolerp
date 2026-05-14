import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { useNavigate } from "react-router-dom";
import { Copy, Printer } from "lucide-react";

import { useAuth } from "./AuthContext.jsx";
import { defaultHomePath, isAdminUser } from "./authRoles.js";
import AddSeanceModal from "./components/AddSeanceModal.jsx";
import Calendrier from "./components/Calendrier.jsx";
import TimetablePrintView from "./components/TimetablePrintView.jsx";
import Loading from "./components/ui/Loading.jsx";
import {
  API_CLASSES,
  API_EMPLOIS_DU_TEMPS,
  API_EMPLOIS_REMPLACER_ANNUEL,
  API_PROFESSEURS,
  apiFetch,
} from "./config.js";
import { normalizeProfesseursListFromApi } from "./utils/professeurApi.js";
import {
  GRID_ROWS,
  totalWeeklyHoursFromFlatSessions,
  anchorGridRowForSession,
  buildCoveredCellKeysSet,
  buildGridDataFromSessions,
  cellKey,
  collapseSessionsToTemplate,
  computeDisplayRowSpan,
  profDisplayNameFromList,
  sessionPayloadForSignature,
  slotToApiTime,
  timeIntervalsOverlap,
  timeToMinutes,
  timeToSlot,
} from "./utils/emploiDuTempsGrid.js";

/** Année scolaire affichée (rentrée septembre) — cohérent avec le backend. */
const ANNEE_SCOLAIRE_DEBUT = 2025;
const ANNEE_SCOLAIRE_LABEL = "Année scolaire 2025-2026";
/** Lundi de la semaine contenant le premier jour d’enseignement (référence en-têtes de colonnes). */
const SCHOOL_YEAR_FIRST_TEACHING_ISO = "2025-09-15";

function listFromApiPayload(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function parseISODateLocal(iso) {
  if (!iso) return new Date();
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  return new Date(y, m - 1, d);
}

function toISODateLocal(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Lundi de la semaine calendaire contenant `date` (lundi = début). */
function mondayOfWeekContaining(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDaysLocal(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function mondayReferenceSchoolYear() {
  return mondayOfWeekContaining(parseISODateLocal(SCHOOL_YEAR_FIRST_TEACHING_ISO));
}

/**
 * Liste API : toute l’année scolaire pour la classe (modèle hebdo déduit côté client).
 */
function emploisUrlForClasseAnnee(classeId) {
  if (!classeId) return API_EMPLOIS_DU_TEMPS;
  const params = new URLSearchParams({
    classe: String(classeId),
    annee_scolaire_debut: String(ANNEE_SCOLAIRE_DEBUT),
  });
  return `${API_EMPLOIS_DU_TEMPS}?${params.toString()}`;
}

function gridToCreneauxPayload(flatSessions) {
  return flatSessions.map((s) => ({
    professeur: Number(s.professeur),
    jour_semaine: Number(s.jour_semaine),
    heure_debut: slotToApiTime(timeToSlot(s.heure_debut)),
    heure_fin: slotToApiTime(timeToSlot(s.heure_fin)),
    matiere: (s.matiere && String(s.matiere).trim()) || "",
    salle: (s.salle && String(s.salle).trim()) || "",
  }));
}

function formatDayMonthLong(d) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(d);
}

function flattenGridData(gridData) {
  return /** @type {object[]} */ (Object.values(gridData).filter(Boolean));
}

function creneauxSignatureFromGrid(gridData) {
  const rows = flattenGridData(gridData).map((s) => {
    const u = sessionPayloadForSignature(s);
    return {
      professeur: Number(u.professeur),
      jour_semaine: Number(u.jour_semaine),
      hd: timeToSlot(u.heure_debut),
      hf: timeToSlot(u.heure_fin),
      mat: (u.matiere && String(u.matiere).trim()) || "",
      salle: (u.salle && String(u.salle).trim()) || "",
    };
  });
  rows.sort(
    (a, b) =>
      a.jour_semaine - b.jour_semaine ||
      a.hd.localeCompare(b.hd) ||
      a.hf.localeCompare(b.hf) ||
      a.professeur - b.professeur ||
      a.mat.localeCompare(b.mat) ||
      a.salle.localeCompare(b.salle),
  );
  return JSON.stringify(rows);
}

const emptyForm = () => ({
  professeur: "",
  classe: "",
  jour_semaine: "0",
  heure_debut: "08:00",
  heure_fin: "09:00",
  matiere: "",
  salle: "",
});

export default function EmploiDuTempsPage() {
  const navigate = useNavigate();
  const { user: authUser, csrfReady } = useAuth();
  const [classes, setClasses] = useState([]);
  const [professeurs, setProfesseurs] = useState([]);

  const [selectedClasse, setSelectedClasse] = useState("");
  const [appliedFilters, setAppliedFilters] = useState(() => ({ classe: null }));

  const [gridData, setGridData] = useState(() => buildGridDataFromSessions([]));
  const [baselineSessions, setBaselineSessions] = useState([]);
  const [baselineSignature, setBaselineSignature] = useState("");

  const [metaLoading, setMetaLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [error, setError] = useState("");

  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingCellKey, setEditingCellKey] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourceClasse, setCopySourceClasse] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);

  const appliedClasseId = appliedFilters.classe ?? "";

  const monday = useMemo(() => mondayReferenceSchoolYear(), []);
  const saturday = useMemo(() => addDaysLocal(monday, 5), [monday]);
  const anneeScolaireLabel = ANNEE_SCOLAIRE_LABEL;
  const weekRangeLabel = useMemo(
    () =>
      `Grille hebdomadaire (lundi – samedi) : ${formatDayMonthLong(monday)} – ${formatDayMonthLong(saturday)}`,
    [monday, saturday],
  );

  const totalHeuresSemaine = useMemo(
    () => totalWeeklyHoursFromFlatSessions(flattenGridData(gridData)),
    [gridData],
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!baselineSignature) return false;
    return creneauxSignatureFromGrid(gridData) !== baselineSignature;
  }, [gridData, baselineSignature]);

  const sessionCount = useMemo(() => flattenGridData(gridData).length, [gridData]);

  const coveredCellKeys = useMemo(() => buildCoveredCellKeysSet(gridData), [gridData]);

  const sessionsWithMeta = useMemo(() => {
    const out = [];
    for (const [k, s] of Object.entries(gridData)) {
      if (!s) continue;
      const jour = Number(s.jour_semaine);
      const hd = timeToSlot(s.heure_debut);
      const hf = timeToSlot(s.heure_fin);
      const row = anchorGridRowForSession(hd, hf);
      if (!row) continue;
      out.push({ session: s, jour, row, cellKey: k });
    }
    return out;
  }, [gridData]);

  const calendarRefreshKey = useMemo(() => creneauxSignatureFromGrid(gridData), [gridData]);

  const hasDimancheCreneau = useMemo(() => {
    for (const s of Object.values(gridData)) {
      if (s && Number(s.jour_semaine) === 6) return true;
    }
    return false;
  }, [gridData]);

  useEffect(() => {
    if (!authUser) {
      navigate("/login", { replace: true });
      return;
    }
    if (!isAdminUser(authUser)) {
      navigate(defaultHomePath(authUser), { replace: true });
    }
  }, [navigate, authUser]);

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      setMetaLoading(true);
      setError("");
      try {
        const [resP, resC] = await Promise.all([apiFetch(API_PROFESSEURS), apiFetch(API_CLASSES)]);
        if (resP.status === 403 || resP.status === 401) {
          if (!cancelled) navigate(defaultHomePath(authUser), { replace: true });
          return;
        }
        if (!resP.ok) throw new Error(`professeurs HTTP ${resP.status}`);
        if (!resC.ok) throw new Error(`classes HTTP ${resC.status}`);
        const dataP = await resP.json();
        const dataC = await resC.json();
        const listP = normalizeProfesseursListFromApi(listFromApiPayload(dataP));
        const listC = listFromApiPayload(dataC);
        if (!cancelled) {
          setProfesseurs(
            listP.sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr")),
          );
          setClasses(listC.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr")));
        }
      } catch {
        if (!cancelled) {
          setError("Impossible de charger les classes ou les professeurs.");
          setProfesseurs([]);
          setClasses([]);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    }

    if (authUser && isAdminUser(authUser) && csrfReady) {
      loadMeta();
    }
    return () => {
      cancelled = true;
    };
  }, [authUser, csrfReady, navigate]);

  const loadSchedule = useCallback(async (classeId) => {
    if (!classeId) {
      setGridData(buildGridDataFromSessions([]));
      setBaselineSessions([]);
      setBaselineSignature("");
      return;
    }
    setBaselineSessions([]);
    setBaselineSignature("");
    setGridData(buildGridDataFromSessions([]));
    setGridLoading(true);
    setError("");
    setSaveSuccess(false);
    try {
      const res = await apiFetch(emploisUrlForClasseAnnee(classeId));
      if (!res.ok) throw new Error(`emplois HTTP ${res.status}`);
      const data = await res.json();
      const rawList = listFromApiPayload(data).filter((s) => Number(s.jour_semaine) < 6);
      const list = collapseSessionsToTemplate(rawList);
      setBaselineSessions(list.map((s) => ({ ...s })));
      const built = buildGridDataFromSessions(list);
      setGridData(built);
      setBaselineSignature(creneauxSignatureFromGrid(built));
    } catch {
      setGridData(buildGridDataFromSessions([]));
      setBaselineSessions([]);
      setBaselineSignature("");
      setError("Impossible de charger l'emploi du temps pour cette classe.");
    } finally {
      setGridLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = appliedFilters.classe;
    if (!c) return;
    queueMicrotask(() => {
      loadSchedule(c);
    });
  }, [appliedFilters.classe, loadSchedule]);

  /* Réinitialise l’édition quand la classe appliquée change (les données sont rechargées par loadSchedule). */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset d’UI lié au changement de filtre appliqué */
    setIsEditing(false);
    setModalOpen(false);
    setEditingCellKey(null);
    setEditingSessionId(null);
    setFormError("");
    setCopyModalOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [appliedFilters.classe]);

  useEffect(() => {
    if (!saveSuccess) return;
    const t = setTimeout(() => setSaveSuccess(false), 4500);
    return () => clearTimeout(t);
  }, [saveSuccess]);

  const appliedClasseNom = classes.find((c) => String(c.id) === String(appliedClasseId))?.nom ?? "";

  const printRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const handlePrintEdt = useReactToPrint({
    contentRef: printRef,
    documentTitle: () => `Emploi du temps - ${appliedClasseNom || "classe"}`,
    ignoreGlobalStyles: true,
    pageStyle: `
      @media print {
        @page { size: landscape; margin: 10mm; }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .timetable-print-surface,
        .timetable-print-inner {
          width: 100% !important;
          max-width: none !important;
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        .timetable-print-header {
          width: 100% !important;
          max-width: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .timetable-print-table {
          width: 100% !important;
          max-width: none !important;
          table-layout: fixed !important;
        }
        .timetable-print-table thead th {
          font-size: 11pt !important;
          padding: 6px 5px !important;
        }
        .timetable-print-table tbody th[scope="row"] {
          font-size: 11pt !important;
          padding: 6px 5px !important;
          min-height: 15mm !important;
        }
        .timetable-print-table tbody td {
          font-size: 11pt !important;
          padding: 6px 5px !important;
          min-height: 15mm !important;
          vertical-align: top !important;
        }
        .timetable-print-table tbody tr {
          min-height: 15mm !important;
        }
      }
    `,
    onBeforePrint: async () => {
      await new Promise((r) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(r);
        });
      });
      const root = printRef.current;
      if (root) {
        const img = root.querySelector("img");
        if (img && !img.complete) {
          await new Promise((res) => {
            img.addEventListener("load", res, { once: true });
            img.addEventListener("error", res, { once: true });
          });
        }
      }
    },
  });

  function profDisplayName(profId) {
    return profDisplayNameFromList(profId, professeurs);
  }

  function ensureEditMode() {
    if (!isEditing) setIsEditing(true);
  }

  function openCreateEmpty() {
    const cid = appliedClasseId || selectedClasse;
    if (!cid) return;
    ensureEditMode();
    setModalMode("create");
    setEditingCellKey(null);
    setEditingSessionId(null);
    setForm({
      professeur: "",
      classe: String(cid),
      jour_semaine: "0",
      heure_debut: "08:00",
      heure_fin: "09:00",
      matiere: "",
      salle: "",
    });
    setFormError("");
    setModalOpen(true);
  }

  function openCreateFromCell(jour, row) {
    if (!appliedClasseId) return;
    ensureEditMode();
    setModalMode("create");
    setEditingCellKey(null);
    setEditingSessionId(null);
    setForm({
      professeur: "",
      classe: String(appliedClasseId),
      jour_semaine: String(jour),
      heure_debut: row.start,
      heure_fin: row.end,
      matiere: "",
      salle: "",
    });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(cellSession, jour, row) {
    if (!isEditing) return;
    setModalMode("edit");
    setEditingCellKey(cellKey(jour, row));
    setEditingSessionId(cellSession.id ?? null);
    const p = professeurs.find((x) => Number(x.id) === Number(cellSession.professeur));
    setForm({
      professeur: String(cellSession.professeur),
      classe: cellSession.classe != null ? String(cellSession.classe) : appliedClasseId,
      jour_semaine: String(cellSession.jour_semaine),
      heure_debut: timeToSlot(cellSession.heure_debut),
      heure_fin: timeToSlot(cellSession.heure_fin),
      matiere: (cellSession.matiere && String(cellSession.matiere).trim()) || p?.matiere || "",
      salle: (cellSession.salle && String(cellSession.salle).trim()) || "",
    });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setFormError("");
    setEditingCellKey(null);
    setEditingSessionId(null);
  }

  function applyModalToGrid() {
    setFormError("");
    const profId = Number(form.professeur);
    if (!Number.isFinite(profId) || profId <= 0) {
      setFormError("Choisissez un professeur.");
      return;
    }
    const classeId = Number(form.classe);
    if (!Number.isFinite(classeId) || classeId <= 0) {
      setFormError("Choisissez une classe.");
      return;
    }
    const debut = form.heure_debut;
    const fin = form.heure_fin;
    const debutApi = slotToApiTime(debut);
    const finApi = slotToApiTime(fin);
    if (!debutApi || !finApi) {
      setFormError("Heures invalides.");
      return;
    }
    if (debutApi >= finApi) {
      setFormError("L’heure de fin doit être après l’heure de début.");
      return;
    }
    const row = anchorGridRowForSession(debut, fin);
    if (!row) {
      setFormError("Horaire de début hors plage de la grille (08:00 – 18:00, pas le dimanche côté saisie).");
      return;
    }
    const newJour = Number(form.jour_semaine);
    const newKey = cellKey(newJour, row);
    const classeNom = classes.find((c) => Number(c.id) === classeId)?.nom ?? appliedClasseNom;
    const pObj = professeurs.find((x) => Number(x.id) === profId);
    const matiereLine =
      (form.matiere && String(form.matiere).trim()) || (pObj?.matiere && String(pObj.matiere).trim()) || "";

    const occupant = gridData[newKey];
    const sameSlotEdit =
      modalMode === "edit" && editingCellKey === newKey && Number(occupant?.id) === Number(editingSessionId);
    if (
      occupant &&
      !sameSlotEdit &&
      (modalMode === "create" || Number(occupant.id) !== Number(editingSessionId))
    ) {
      setFormError("Cette case est déjà occupée. Modifiez ou supprimez le créneau existant.");
      return;
    }

    const newSm = timeToMinutes(debut);
    const newEm = timeToMinutes(fin);
    const displaySpan = computeDisplayRowSpan(debut, fin);

    setGridData((prev) => {
      const next = { ...prev };
      if (editingCellKey) {
        next[editingCellKey] = null;
      }
      for (const r0 of GRID_ROWS) {
        const k0 = cellKey(newJour, r0);
        const ex = next[k0];
        if (!ex) continue;
        const e0 = timeToMinutes(timeToSlot(ex.heure_debut));
        const e1 = timeToMinutes(timeToSlot(ex.heure_fin));
        if (timeIntervalsOverlap(newSm, newEm, e0, e1)) {
          next[k0] = null;
        }
      }
      next[newKey] = {
        id: editingSessionId ?? undefined,
        professeur: profId,
        classe: classeId,
        jour_semaine: newJour,
        date_seance: toISODateLocal(addDaysLocal(monday, newJour)),
        heure_debut: debutApi,
        heure_fin: finApi,
        professeur_name: profDisplayName(profId),
        classe_nom: classeNom,
        matiere: (form.matiere && String(form.matiere).trim()) || "",
        salle: (form.salle && String(form.salle).trim()) || "",
        matiere_display: matiereLine,
        _rowSpan: displaySpan,
      };
      return next;
    });

    closeModal();
  }

  function removeCellFromGridLocal() {
    if (!editingCellKey) return;
    setGridData((prev) => ({ ...prev, [editingCellKey]: null }));
    closeModal();
  }

  function cancelEditMode() {
    if (hasUnsavedChanges) {
      if (!window.confirm("Annuler les modifications non enregistrées ?")) return;
    }
    setGridData(buildGridDataFromSessions(baselineSessions));
    setIsEditing(false);
    closeModal();
  }

  function toggleEditMode() {
    if (isEditing) {
      cancelEditMode();
      return;
    }
    setIsEditing(true);
  }

  function applyFilterControls() {
    if (!selectedClasse) {
      setError("Choisissez une classe avant d’appliquer.");
      return;
    }
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "Des modifications ne sont pas enregistrées. Appliquer les filtres va recharger la grille et les perdre. Continuer ?",
        )
      ) {
        return;
      }
    }
    setError("");
    setAppliedFilters({ classe: selectedClasse });
  }

  async function bulkSave() {
    if (!appliedClasseId || bulkSaving || !isEditing) return;
    const flat = flattenGridData(gridData);
    if (flat.length === 0) {
      setError("Ajoutez au moins un créneau : le modèle hebdomadaire ne peut pas être vide.");
      return;
    }
    setBulkSaving(true);
    setError("");
    setSaveSuccess(false);
    try {
      const res = await apiFetch(API_EMPLOIS_REMPLACER_ANNUEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classe: Number(appliedClasseId),
          annee_scolaire_debut: ANNEE_SCOLAIRE_DEBUT,
          creneaux: gridToCreneauxPayload(flat),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.detail === "string" ? err.detail : `Enregistrement refusé (${res.status})`,
        );
      }
      await loadSchedule(appliedClasseId);
      setSaveSuccess(true);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function copyWeekFromOtherClass() {
    if (!appliedClasseId || !copySourceClasse || copySourceClasse === appliedClasseId) {
      setError("Choisissez une classe source différente de la classe affichée.");
      return;
    }
    setCopyLoading(true);
    setError("");
    try {
      const res = await apiFetch(emploisUrlForClasseAnnee(copySourceClasse));
      if (!res.ok) throw new Error(`emplois HTTP ${res.status}`);
      const data = await res.json();
      const rawList = listFromApiPayload(data).filter((s) => Number(s.jour_semaine) < 6);
      const list = collapseSessionsToTemplate(rawList);
      const remapped = list.map((s) => {
        const p = professeurs.find((x) => Number(x.id) === Number(s.professeur));
        return {
          ...s,
          id: undefined,
          classe: Number(appliedClasseId),
          classe_nom: appliedClasseNom,
          professeur_name: s.professeur_name ?? (p ? `${p.prenom} ${p.nom}`.trim() : undefined),
        };
      });
      const built = buildGridDataFromSessions(remapped);
      setGridData(built);
      setIsEditing(true);
      setCopyModalOpen(false);
      setCopySourceClasse("");
    } catch {
      setError("Impossible de copier l’emploi de la classe choisie.");
    } finally {
      setCopyLoading(false);
    }
  }

  return (
    <>
      <div className="print:hidden">
        <header className="mb-6">
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Emploi du temps</h1>
          <p className="mt-1.5 max-w-[760px] text-sm leading-relaxed text-[#64748b]">
            Choisissez une classe. La grille affiche la semaine type (lundi – samedi) : matière, enseignant, salle.
            Enregistrez pour appliquer le modèle sur toute l’année scolaire (séances datées).
          </p>
        </header>

        <div className="sticky top-0 z-30 mb-6 border-b border-[#e2e8f0] bg-[#f8fafc]/95 py-3 backdrop-blur-md">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
              <div className="min-w-[200px] flex-1">
                <label
                  htmlFor="filter-classe"
                  className="block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                >
                  Classe
                </label>
                <select
                  id="filter-classe"
                  value={selectedClasse}
                  onChange={(e) => setSelectedClasse(e.target.value)}
                  disabled={metaLoading}
                  className="mt-2 w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-base font-medium text-[#0f172a] shadow-sm focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
                >
                  <option value="">— Choisir une classe —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-stretch sm:justify-end lg:ml-auto">
                <button
                  type="button"
                  onClick={openCreateEmpty}
                  disabled={metaLoading || gridLoading || bulkSaving || !selectedClasse}
                  className="edt-no-print order-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f172a] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
                >
                  ＋ Ajouter une séance
                </button>
                <button
                  type="button"
                  onClick={applyFilterControls}
                  disabled={metaLoading || !selectedClasse}
                  className="edt-no-print order-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
                >
                  Appliquer
                </button>
              </div>
            </div>

            {appliedClasseId ? (
              <div className="mt-5 flex flex-col gap-3 border-t border-[#e2e8f0] pt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Actions</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={toggleEditMode}
                    disabled={metaLoading || gridLoading || bulkSaving}
                    className={`edt-no-print inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isEditing
                        ? "border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                        : "border border-amber-300 bg-white text-amber-900 hover:bg-amber-50"
                    }`}
                  >
                    {isEditing ? "Terminer l'édition" : "Modifier la grille"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyModalOpen(true)}
                    disabled={metaLoading || gridLoading || !appliedClasseId}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Copy className="h-4 w-4" />
                    Copier l’emploi d’une autre classe
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintEdt}
                    disabled={!appliedClasseId}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Printer className="h-4 w-4" />
                    Imprimer l’emploi du temps
                  </button>
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={bulkSave}
                      disabled={!appliedClasseId || gridLoading || bulkSaving || !hasUnsavedChanges}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto"
                    >
                      {bulkSaving ? (
                        <>
                          <span
                            className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                            aria-hidden
                          />
                          Enregistrement…
                        </>
                      ) : (
                        <>Enregistrer les modifications</>
                      )}
                    </button>
                  ) : null}
                </div>
                {isEditing && hasUnsavedChanges && appliedClasseId ? (
                  <p className="text-xs text-amber-700">Modifications non enregistrées</p>
                ) : null}
              </div>
            ) : null}

            {metaLoading ? (
              <Loading message="Chargement des classes…" className="mt-3 min-h-[120px] py-4" />
            ) : classes.length === 0 ? (
              <p className="mt-3 text-sm text-amber-700">Aucune classe en base. Créez des classes avant de planifier.</p>
            ) : null}
          </div>
        </div>

        {saveSuccess ? (
          <div
            className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
            role="status"
          >
            Emploi du temps enregistré avec succès.
          </div>
        ) : null}

        {error ? (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {!appliedClasseId ? (
          <div className="rounded-2xl border-2 border-dashed border-[#e2e8f0] bg-[#f8fafc] px-8 py-16 text-center">
            <p className="text-lg font-medium text-[#475569]">Aucun filtre appliqué</p>
            <p className="mt-2 text-sm text-[#94a3b8]">
              Choisissez une classe, puis cliquez sur « Appliquer » pour afficher la grille hebdomadaire.
            </p>
          </div>
        ) : (
          <section
            className={`overflow-hidden overflow-x-hidden rounded-xl bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-[box-shadow,border-color] duration-200 ${
              isEditing ? "border-2 border-amber-300/80 ring-2 ring-amber-200/50" : "border border-[#e2e8f0]"
            }`}
            aria-label={`Emploi du temps ${appliedClasseNom || appliedClasseId}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-[#0f172a]">
                  Calendrier — <span className="text-[#3b82f6]">{appliedClasseNom || `Classe #${appliedClasseId}`}</span>
                </h2>
                <p className="text-xs text-[#64748b]">
                  {anneeScolaireLabel}
                  <span className="mx-1.5 text-slate-400">·</span>
                  {weekRangeLabel}
                </p>
                {isEditing ? (
                  <p className="mt-1 text-xs font-medium text-amber-800">
                    Édition : touchez une séance pour la modifier · touchez un jour du mois pour ajouter un créneau à partir de 08:00
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[#94a3b8]">
                    Vue mois sur grand écran, liste sur téléphone. Touchez une séance pour les détails.
                  </p>
                )}
              </div>
              {gridLoading ? (
                <Loading inline message="Chargement des données…" className="min-h-0" />
              ) : (
                <span className="text-sm text-[#64748b]">
                  {sessionCount} créneau{sessionCount !== 1 ? "x" : ""}
                </span>
              )}
            </div>

            <div className="w-full min-w-0 max-w-full overflow-x-hidden px-1 md:px-2">
              <Calendrier
                sessionsWithMeta={sessionsWithMeta}
                refreshKey={calendarRefreshKey}
                loading={gridLoading}
                isEditing={isEditing}
                professeurs={professeurs}
                onEditSession={openEdit}
                onCreateFromDay={(jour) => openCreateFromCell(jour, GRID_ROWS[0])}
              />
            </div>

            <div className="border-t border-[#e2e8f0] bg-[#f1f5f9] px-3 py-3">
              <p className="text-center text-xs font-bold text-[#0f172a] sm:text-sm">
                Total des heures par semaine :{" "}
                {totalHeuresSemaine.toLocaleString("fr-FR", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}{" "}
                h
              </p>
            </div>

            {isEditing && appliedClasseId ? (
              <div className="border-t border-[#e2e8f0] bg-[#f8fafc] px-4 py-4 sm:px-6">
                <div className="mx-auto flex max-w-2xl flex-col items-stretch gap-2 sm:items-center">
                  <p className="text-center text-xs text-[#64748b]">
                    Enregistre le modèle hebdomadaire pour la classe sur toute l’année scolaire.
                  </p>
                  <button
                    type="button"
                    onClick={bulkSave}
                    disabled={!appliedClasseId || gridLoading || bulkSaving || !hasUnsavedChanges}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
                  >
                    {bulkSaving ? (
                      <>
                        <span
                          className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                          aria-hidden
                        />
                        Enregistrement…
                      </>
                    ) : (
                      "Enregistrer l'emploi du temps"
                    )}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {copyModalOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-[#0f172a]">Copier l’emploi d’une autre classe</h3>
              <p className="mt-1 text-sm text-[#64748b]">
                Le modèle hebdomadaire de la classe source est copié vers <strong>{appliedClasseNom}</strong>. Vérifiez
                les enseignants puis enregistrez.
              </p>
              <label className="mt-4 block text-xs font-medium text-[#64748b]">Classe source</label>
              <select
                value={copySourceClasse}
                onChange={(e) => setCopySourceClasse(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm"
              >
                <option value="">— Choisir —</option>
                {classes
                  .filter((c) => String(c.id) !== String(appliedClasseId))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
              </select>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCopyModalOpen(false);
                    setCopySourceClasse("");
                  }}
                  className="rounded-lg border border-[#e2e8f0] px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#f8fafc]"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={copyLoading || !copySourceClasse}
                  onClick={copyWeekFromOtherClass}
                  className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {copyLoading ? "Copie…" : "Copier dans la grille"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <AddSeanceModal
          open={modalOpen}
          onClose={closeModal}
          onApply={applyModalToGrid}
          onDeleteFromGrid={removeCellFromGridLocal}
          form={form}
          onFormChange={setForm}
          formError={formError}
          professeurs={professeurs}
          classes={classes}
          appliedClasseNom={appliedClasseNom}
          modalMode={modalMode}
          editingCellKey={editingCellKey}
          canDelete={modalMode === "edit" && Boolean(editingCellKey)}
        />
      </div>

      <TimetablePrintView
        ref={printRef}
        gridData={gridData}
        coveredCellKeys={coveredCellKeys}
        professeurs={professeurs}
        classeNom={appliedClasseNom}
        classeId={appliedClasseId}
        anneeScolaireLabel={anneeScolaireLabel}
        weekRangeLabel={weekRangeLabel}
        hasDimancheCreneau={hasDimancheCreneau}
        totalHeuresSemaine={totalHeuresSemaine}
        viewVariant="classe"
      />
    </>
  );
}
