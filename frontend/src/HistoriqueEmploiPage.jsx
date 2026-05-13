import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { useNavigate } from "react-router-dom";
import { MapPin, Printer, User } from "lucide-react";

import { useAuth } from "./AuthContext.jsx";
import { defaultHomePath, isAdminUser } from "./authRoles.js";
import TimetablePrintView from "./components/TimetablePrintView.jsx";
import Loading from "./components/ui/Loading.jsx";
import { API_CLASSES, API_EMPLOIS_DU_TEMPS, API_PROFESSEURS, apiFetch } from "./config.js";
import { normalizeProfesseursListFromApi } from "./utils/professeurApi.js";
import {
  GRID_JOUR_LABELS,
  GRID_JOUR_PRINT_INDICES,
  GRID_ROWS,
  buildCoveredCellKeysSet,
  buildGridDataFromSessions,
  cellKey,
  collapseSessionsToTemplate,
  matiereColorScheme,
  matiereLabelForSession,
  profDisplayNameFromList,
  timeToSlot,
  totalWeeklyHoursFromFlatSessions,
  GRID_ONE_HOUR_MIN_HEIGHT_REM,
} from "./utils/emploiDuTempsGrid.js";

const ANNEE_SCOLAIRE_DEBUT = 2025;
const ANNEE_SCOLAIRE_LABEL = "Année scolaire 2025-2026";
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

function formatHeaderDate(d) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(d);
}

function formatDayMonthLong(d) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(d);
}

function emploisUrlClasseAnnee(classeId) {
  if (!classeId) return API_EMPLOIS_DU_TEMPS;
  const params = new URLSearchParams({
    classe: String(classeId),
    annee_scolaire_debut: String(ANNEE_SCOLAIRE_DEBUT),
  });
  return `${API_EMPLOIS_DU_TEMPS}?${params.toString()}`;
}

function emploisUrlProfAnnee(profId) {
  if (!profId) return API_EMPLOIS_DU_TEMPS;
  const params = new URLSearchParams({
    professeur: String(profId),
    annee_scolaire_debut: String(ANNEE_SCOLAIRE_DEBUT),
  });
  return `${API_EMPLOIS_DU_TEMPS}?${params.toString()}`;
}

function flattenGridData(gridData) {
  return Object.values(gridData).filter(Boolean);
}

/**
 * @param {"classe"|"prof"} searchMode
 */
export default function HistoriqueEmploiPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();

  const [classes, setClasses] = useState([]);
  const [professeurs, setProfesseurs] = useState([]);

  const [searchMode, setSearchMode] = useState(/** @type {"classe"|"prof"} */ ("classe"));
  const [selectedClasse, setSelectedClasse] = useState("");
  const [selectedProf, setSelectedProf] = useState("");

  const [appliedMode, setAppliedMode] = useState(/** @type {"classe"|"prof"} */ ("classe"));
  const [appliedClasseId, setAppliedClasseId] = useState("");
  const [appliedProfId, setAppliedProfId] = useState("");

  const [gridData, setGridData] = useState(() => buildGridDataFromSessions([]));
  const [metaLoading, setMetaLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [error, setError] = useState("");

  const monday = useMemo(() => mondayReferenceSchoolYear(), []);
  const saturday = useMemo(() => addDaysLocal(monday, 5), [monday]);
  const anneeScolaireLabel = ANNEE_SCOLAIRE_LABEL;
  const weekRangeLabel = useMemo(
    () =>
      `Grille hebdomadaire (lundi – samedi) : ${formatDayMonthLong(monday)} – ${formatDayMonthLong(saturday)}`,
    [monday, saturday],
  );

  const columnDates = useMemo(
    () => GRID_JOUR_PRINT_INDICES.map((j) => addDaysLocal(monday, j)),
    [monday],
  );

  const coveredCellKeys = useMemo(() => buildCoveredCellKeysSet(gridData), [gridData]);
  const totalHeuresSemaine = useMemo(
    () => totalWeeklyHoursFromFlatSessions(flattenGridData(gridData)),
    [gridData],
  );

  const hasDimancheCreneau = useMemo(() => {
    for (const s of Object.values(gridData)) {
      if (s && Number(s.jour_semaine) === 6) return true;
    }
    return false;
  }, [gridData]);

  const appliedClasseNom = classes.find((c) => String(c.id) === String(appliedClasseId))?.nom ?? "";
  const appliedProf = professeurs.find((p) => String(p.id) === String(appliedProfId));
  const appliedProfNom = appliedProf
    ? `${appliedProf.prenom} ${appliedProf.nom}`.trim()
    : appliedProfId
      ? "Professeur"
      : "";

  const printRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: () =>
      appliedMode === "classe"
        ? `Emploi du temps - ${appliedClasseNom || "classe"}`
        : `Emploi du temps - ${appliedProfNom || "enseignant"}`,
    ignoreGlobalStyles: true,
    pageStyle: `
      @media print {
        @page { size: landscape; margin: 10mm; }
        html, body { margin: 0 !important; padding: 0 !important; }
      }
    `,
  });

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
    if (authUser && isAdminUser(authUser)) loadMeta();
    return () => {
      cancelled = true;
    };
  }, [authUser, navigate]);

  const loadGrid = useCallback(async (mode, classeId, profId) => {
      if (mode === "classe" && !classeId) {
        setGridData(buildGridDataFromSessions([]));
        return;
      }
      if (mode === "prof" && !profId) {
        setGridData(buildGridDataFromSessions([]));
        return;
      }
      setGridLoading(true);
      setError("");
      setGridData(buildGridDataFromSessions([]));
      try {
        const url = mode === "classe" ? emploisUrlClasseAnnee(classeId) : emploisUrlProfAnnee(profId);
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`emplois HTTP ${res.status}`);
        const data = await res.json();
        const raw = listFromApiPayload(data).filter((s) => Number(s.jour_semaine) < 6);
        const list = collapseSessionsToTemplate(raw);
        setGridData(buildGridDataFromSessions(list));
      } catch {
        setGridData(buildGridDataFromSessions([]));
        setError("Impossible de charger l’emploi du temps.");
      } finally {
        setGridLoading(false);
      }
  }, []);

  useEffect(() => {
    if (appliedMode === "classe" && !appliedClasseId) return;
    if (appliedMode === "prof" && !appliedProfId) return;
    queueMicrotask(() => {
      loadGrid(appliedMode, appliedClasseId, appliedProfId);
    });
  }, [appliedMode, appliedClasseId, appliedProfId, loadGrid]);

  function applyFilters() {
    if (searchMode === "classe") {
      if (!selectedClasse) {
        setError("Choisissez une classe.");
        return;
      }
      setError("");
      setAppliedMode("classe");
      setAppliedClasseId(String(selectedClasse));
      setAppliedProfId("");
    } else {
      if (!selectedProf) {
        setError("Choisissez un professeur.");
        return;
      }
      setError("");
      setAppliedMode("prof");
      setAppliedProfId(String(selectedProf));
      setAppliedClasseId("");
    }
  }

  function matiereForCell(s) {
    return matiereLabelForSession(s, professeurs);
  }

  const sessionCount = useMemo(() => flattenGridData(gridData).length, [gridData]);

  function ReadOnlySessionCard({ cellSession }) {
    const mat = matiereForCell(cellSession);
    const scheme = matiereColorScheme(mat);
    const profName = cellSession.professeur_name ?? profDisplayNameFromList(cellSession.professeur, professeurs);
    const salle = (cellSession.salle && String(cellSession.salle).trim()) || "";
    const rowSpan = Math.max(1, Number(cellSession._rowSpan) || 1);
    const hRem = rowSpan * GRID_ONE_HOUR_MIN_HEIGHT_REM;
    const hd = timeToSlot(cellSession.heure_debut);
    const hf = timeToSlot(cellSession.heure_fin);
    const classeLine =
      (cellSession.classe_nom && String(cellSession.classe_nom).trim()) ||
      (cellSession.classe != null ? `Classe #${cellSession.classe}` : "");

    return (
      <div
        style={rowSpan > 1 ? { minHeight: `${hRem}rem` } : undefined}
        className={[
          "flex min-h-[5.25rem] w-full min-w-0 flex-col rounded-xl border bg-gradient-to-br px-2.5 py-2 text-left shadow-sm",
          scheme.border,
          scheme.bg,
        ].join(" ")}
      >
        <p className={`text-sm font-bold leading-tight ${scheme.text}`}>{mat || "Matière"}</p>
        <p className={`mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-600 ${scheme.sub}`}>
          {hd} – {hf}
        </p>
        {appliedMode === "classe" ? (
          <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${scheme.sub}`}>
            <User className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0 break-words">{profName}</span>
          </p>
        ) : classeLine ? (
          <p className={`mt-1 text-xs font-medium ${scheme.sub}`}>Classe : {classeLine}</p>
        ) : null}
        {salle ? (
          <span
            className={`mt-1.5 inline-flex w-fit max-w-full items-center gap-1 rounded-md border border-black/5 bg-white/70 px-2 py-0.5 text-[10px] font-semibold ${scheme.text}`}
          >
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {salle}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="print:hidden">
        <header className="mb-6">
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Imprimer l’emploi du temps</h1>
          <p className="mt-1.5 max-w-[800px] text-sm leading-relaxed text-[#64748b]">
            Recherche par classe (emploi de la classe) ou par enseignant (tous ses créneaux). Aperçu en grille
            lundi–samedi, puis impression au format A4 paysage avec l’en-tête {anneeScolaireLabel.toLowerCase()}.
          </p>
        </header>

        <div className="sticky top-0 z-30 mb-6 border-b border-[#e2e8f0] bg-[#f8fafc]/95 py-3 backdrop-blur-md">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Recherche</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="edt-search-mode"
                  checked={searchMode === "classe"}
                  onChange={() => setSearchMode("classe")}
                  className="accent-sky-600"
                />
                Par classe
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="edt-search-mode"
                  checked={searchMode === "prof"}
                  onChange={() => setSearchMode("prof")}
                  className="accent-sky-600"
                />
                Par professeur
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              {searchMode === "classe" ? (
                <div className="min-w-[220px] flex-1">
                  <label
                    htmlFor="impr-emploi-classe"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Classe
                  </label>
                  <select
                    id="impr-emploi-classe"
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
              ) : (
                <div className="min-w-[220px] flex-1">
                  <label
                    htmlFor="impr-emploi-prof"
                    className="block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                  >
                    Professeur
                  </label>
                  <select
                    id="impr-emploi-prof"
                    value={selectedProf}
                    onChange={(e) => setSelectedProf(e.target.value)}
                    disabled={metaLoading}
                    className="mt-2 w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-base font-medium text-[#0f172a] shadow-sm focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30"
                  >
                    <option value="">— Choisir un enseignant —</option>
                    {professeurs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.prenom} {p.nom}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:ml-auto">
                <button
                  type="button"
                  onClick={applyFilters}
                  disabled={metaLoading || (searchMode === "classe" && !selectedClasse) || (searchMode === "prof" && !selectedProf)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b82f6] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Appliquer
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={
                    (appliedMode === "classe" && !appliedClasseId) || (appliedMode === "prof" && !appliedProfId) || gridLoading
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  Imprimer l’emploi du temps
                </button>
              </div>
            </div>

            {metaLoading ? (
              <Loading message="Chargement des référentiels…" className="mt-3 min-h-[100px] py-4" />
            ) : null}
          </div>
        </div>

        {error ? (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {((appliedMode === "classe" && appliedClasseId) || (appliedMode === "prof" && appliedProfId)) ? null : (
          <div className="rounded-2xl border-2 border-dashed border-[#e2e8f0] bg-[#f8fafc] px-8 py-16 text-center">
            <p className="text-lg font-medium text-[#475569]">Aucun résultat</p>
            <p className="mt-2 text-sm text-[#94a3b8]">Choisissez une classe ou un professeur, puis « Appliquer ».</p>
          </div>
        )}

        {((appliedMode === "classe" && appliedClasseId) || (appliedMode === "prof" && appliedProfId)) && (
          <section
            className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
            aria-label="Aperçu emploi du temps"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-[#0f172a]">
                  {appliedMode === "classe" ? (
                    <>
                      Classe : <span className="text-[#3b82f6]">{appliedClasseNom || `#${appliedClasseId}`}</span>
                    </>
                  ) : (
                    <>
                      Professeur : <span className="text-[#3b82f6]">{appliedProfNom}</span>
                    </>
                  )}
                </h2>
                <p className="text-xs text-[#64748b]">
                  {anneeScolaireLabel} · {weekRangeLabel}
                </p>
              </div>
              {gridLoading ? (
                <Loading inline message="Chargement…" className="min-h-0" />
              ) : (
                <span className="text-sm text-[#64748b]">
                  {sessionCount} créneau{sessionCount !== 1 ? "x" : ""}
                </span>
              )}
            </div>

            <div className="overflow-x-auto p-1">
              {gridLoading ? (
                <Loading message="Lecture de l’emploi…" className="min-h-[200px] py-8" />
              ) : (
                <table className="min-w-[680px] w-full border-collapse border border-[#e2e8f0] text-sm text-[#0f172a]">
                  <thead>
                    <tr>
                      <th
                        className="sticky top-0 z-20 w-[100px] border-b border-r border-[#334155] bg-[#1e293b] px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white"
                        scope="col"
                      >
                        Heure
                      </th>
                      {GRID_JOUR_PRINT_INDICES.map((j) => (
                        <th
                          key={j}
                          className="sticky top-0 z-20 min-w-[100px] border-b border-l border-[#334155] bg-[#1e293b] px-1 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-white"
                          scope="col"
                        >
                          <span className="block">{GRID_JOUR_LABELS[j]}</span>
                          <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-slate-300">
                            {formatHeaderDate(columnDates[j])}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {GRID_ROWS.map((row, rowIdx) => (
                      <tr
                        key={`${row.start}-${row.end}`}
                        className={rowIdx % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}
                      >
                        <th
                          className="sticky left-0 z-10 w-[100px] border-b border-r border-[#e2e8f0] bg-clip-padding px-2 py-2 text-left text-xs font-semibold text-[#475569]"
                          scope="row"
                        >
                          {row.start} – {row.end}
                        </th>
                        {GRID_JOUR_PRINT_INDICES.map((jour) => {
                          const k = cellKey(jour, row);
                          if (coveredCellKeys.has(k)) {
                            return null;
                          }
                          const cellSession = gridData[k];
                          const occupied = Boolean(cellSession);
                          const rowSpan = occupied ? Number(cellSession._rowSpan) || 1 : 1;
                          return (
                            <td
                              key={k}
                              rowSpan={rowSpan > 1 ? rowSpan : undefined}
                              className="border-b border-l border-[#e2e8f0] p-1 align-top"
                            >
                              {occupied ? <ReadOnlySessionCard cellSession={cellSession} /> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#f1f5f9]">
                      <th
                        className="border border-[#e2e8f0] px-3 py-2.5 text-right text-xs font-bold text-[#0f172a] sm:text-sm"
                        colSpan={1 + GRID_JOUR_PRINT_INDICES.length}
                        scope="row"
                      >
                        Total des heures par semaine :{" "}
                        {totalHeuresSemaine.toLocaleString("fr-FR", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}{" "}
                        h
                      </th>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </section>
        )}
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
        viewVariant={appliedMode === "prof" ? "prof" : "classe"}
        professeurNom={appliedMode === "prof" ? appliedProfNom : ""}
      />
    </>
  );
}
