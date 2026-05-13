import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Printer } from "lucide-react";
import { useReactToPrint } from "react-to-print";

import EleveModal from "./components/EleveModal.jsx";
import ListeElevesClassePrint from "./components/ListeElevesClassePrint.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { useSettings } from "./context/SettingsContext.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import {
  CAPACITE_CLASSE_MAX,
  filterClassesByNiveauSection,
  formatSectionCell,
  isTroncNiveau,
  NIVEAU_OPTIONS,
  SECONDARY_SECTION_OPTIONS,
  SECTION_FILTER_OPTIONS,
} from "./constants/tunisianAcademic.js";
import { API_CLASSES, API_ELEVES, apiFetch } from "./config.js";

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

export default function GestionClasses() {
  const { itemsPerPage } = useSettings();
  const [classes, setClasses] = useState([]);
  const [filterNiveau, setFilterNiveau] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classesError, setClassesError] = useState("");

  const [selectedClasse, setSelectedClasse] = useState(null);
  const [eleves, setEleves] = useState([]);
  const [loadingEleves, setLoadingEleves] = useState(false);
  const [elevesError, setElevesError] = useState("");

  const [classeModalOpen, setClasseModalOpen] = useState(false);
  const [newClasseNom, setNewClasseNom] = useState("");
  const [newClasseNiveau, setNewClasseNiveau] = useState("");
  const [newClasseSection, setNewClasseSection] = useState("");
  const [classeSaving, setClasseSaving] = useState(false);
  const [classeFormError, setClasseFormError] = useState("");

  const [eleveModalOpen, setEleveModalOpen] = useState(false);
  const [eleveModalMode, setEleveModalMode] = useState("add");
  const [eleveEnEdition, setEleveEnEdition] = useState(null);
  const [coordonneesEleve, setCoordonneesEleve] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [eleveListPage, setEleveListPage] = useState(1);

  const listePrintRef = useRef(null);
  const handlePrintListeEleves = useReactToPrint({
    contentRef: listePrintRef,
    documentTitle: selectedClasse
      ? `Liste-eleves-${String(selectedClasse.nom).replace(/[/\\?%*:|"<>]/g, "-")}`
      : "Liste-eleves",
    ignoreGlobalStyles: true,
    pageStyle: `
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        html, body {
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

  const elIdxLast = eleveListPage * itemsPerPage;
  const elIdxFirst = elIdxLast - itemsPerPage;
  const currentEleves = useMemo(() => eleves.slice(elIdxFirst, elIdxLast), [eleves, elIdxFirst, elIdxLast]);

  useEffect(() => {
    setEleveListPage(1);
  }, [selectedClasse?.id]);

  useEffect(() => {
    const total = eleves.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (eleveListPage > lastPage) setEleveListPage(lastPage);
  }, [eleves.length, eleveListPage, itemsPerPage]);

  const classeOptionsNoms = useMemo(
    () => classes.map((c) => c.nom).filter(Boolean),
    [classes],
  );

  /** Section (filière) : uniquement pour 2e–4e secondaire ; masquée pour le tronc et « Tous les niveaux ». */
  const showSectionFilter = !filterNiveau || !isTroncNiveau(filterNiveau);

  useEffect(() => {
    if (filterNiveau && isTroncNiveau(filterNiveau)) {
      setFilterSection("");
    }
  }, [filterNiveau]);

  useEffect(() => {
    setSelectedClasse(null);
  }, [filterNiveau]);

  useEffect(() => {
    if (!filterNiveau || isTroncNiveau(filterNiveau)) return;
    setSelectedClasse(null);
  }, [filterSection, filterNiveau]);

  useEffect(() => {
    if (isTroncNiveau(newClasseNiveau)) setNewClasseSection("");
  }, [newClasseNiveau]);

  const loadClasses = useCallback(async () => {
    setClassesError("");
    setLoadingClasses(true);
    try {
      const params = new URLSearchParams();
      if (filterNiveau) params.set("niveau", filterNiveau);
      const troncNiveauFiltre = Boolean(filterNiveau && isTroncNiveau(filterNiveau));
      if (troncNiveauFiltre) params.set("section", "");
      else if (filterSection) params.set("section", filterSection);
      const qs = params.toString();
      const url = qs ? `${API_CLASSES}?${qs}` : API_CLASSES;
      const res = await apiFetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let list = normalizeList(await res.json());
      if (filterNiveau) {
        list = filterClassesByNiveauSection(
          list,
          filterNiveau,
          isTroncNiveau(filterNiveau) ? "" : filterSection,
        );
      }
      setClasses(list);
    } catch {
      setClasses([]);
      setClassesError("Impossible de charger les classes.");
    } finally {
      setLoadingClasses(false);
    }
  }, [filterNiveau, filterSection]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses, refreshKey]);

  useEffect(() => {
    if (!selectedClasse) return;
    const stillThere = classes.some((c) => c.id === selectedClasse.id);
    if (!stillThere) setSelectedClasse(null);
  }, [classes, selectedClasse]);

  const fetchElevesForClasse = useCallback(async (classeNom) => {
    if (!classeNom) {
      setEleves([]);
      return;
    }
    setElevesError("");
    setLoadingEleves(true);
    try {
      const params = new URLSearchParams({ classe: classeNom });
      const res = await apiFetch(`${API_ELEVES}?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEleves(normalizeList(await res.json()));
    } catch {
      setEleves([]);
      setElevesError("Impossible de charger les élèves de cette classe.");
    } finally {
      setLoadingEleves(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClasse?.nom) {
      fetchElevesForClasse(selectedClasse.nom);
    } else {
      setEleves([]);
    }
  }, [selectedClasse, fetchElevesForClasse, refreshKey]);

  function selectClasse(c) {
    setSelectedClasse(c);
  }

  function openCreateClasseModal() {
    setClasseFormError("");
    setNewClasseNom("");
    setNewClasseNiveau("7BASE");
    setNewClasseSection("");
    setClasseModalOpen(true);
  }

  async function submitCreateClasse(e) {
    e.preventDefault();
    setClasseFormError("");
    const nom = newClasseNom.trim();
    if (!nom) {
      setClasseFormError("Le nom de la classe est obligatoire.");
      return;
    }
    if (!newClasseNiveau.trim()) {
      setClasseFormError("Le niveau est obligatoire.");
      return;
    }
    setClasseSaving(true);
    try {
      const niv = newClasseNiveau.trim();
      const sec = isTroncNiveau(niv) ? "" : newClasseSection || "";
      if (!isTroncNiveau(niv) && !sec) {
        setClasseFormError("Choisissez une section pour ce niveau (2ème à 4ème année secondaire).");
        return;
      }
      const body = {
        nom,
        niveau: niv,
        section: sec,
        capacite_max: CAPACITE_CLASSE_MAX,
      };
      const res = await apiFetch(API_CLASSES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        setClasseFormError(msg);
        return;
      }
      setClasseModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch {
      setClasseFormError("Erreur réseau ou serveur indisponible.");
    } finally {
      setClasseSaving(false);
    }
  }

  function openAddEleve() {
    if (!selectedClasse?.nom) return;
    setEleveEnEdition(null);
    setEleveModalMode("add");
    setEleveModalOpen(true);
  }

  function openEditEleve(eleve) {
    setEleveEnEdition(eleve);
    setEleveModalMode("edit");
    setEleveModalOpen(true);
  }

  function closeEleveModal() {
    setEleveModalOpen(false);
    setEleveEnEdition(null);
  }

  function onEleveModalSuccess() {
    closeEleveModal();
    setRefreshKey((k) => k + 1);
    if (selectedClasse?.nom) fetchElevesForClasse(selectedClasse.nom);
  }

  async function deleteEleve(eleve) {
    if (!eleve?.id) return;
    const ok = window.confirm(
      `Supprimer définitivement l’élève « ${eleve.prenom} ${eleve.nom} » ? Cette action est irréversible.`,
    );
    if (!ok) return;
    try {
      const res = await apiFetch(`${API_ELEVES}${eleve.id}/`, { method: "DELETE" });
      if (!res.ok) {
        setElevesError(`Suppression impossible (erreur ${res.status}).`);
        return;
      }
      setRefreshKey((k) => k + 1);
      if (selectedClasse?.nom) fetchElevesForClasse(selectedClasse.nom);
    } catch {
      setElevesError("Erreur réseau lors de la suppression.");
    }
  }

  function coordonneesFromEleve(e) {
    if (e?.coordonnees && typeof e.coordonnees === "object") return e.coordonnees;
    return {
      telephone_1: e?.telephone_1 ?? "",
      telephone_2: e?.telephone_2 ?? "",
      adresse: e?.adresse ?? "",
      nom_parent: e?.nom_parent ?? "",
    };
  }

  return (
    <div className="w-full min-w-0 space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Gestion des classes</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#64748b]">
            Référentiel tunisien : effectif par groupe (max {CAPACITE_CLASSE_MAX}), filtres niveau / section, élèves
            rattachés par nom de classe et section.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateClasseModal}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
        >
          Ajouter une classe
        </button>
      </header>

      <section
        className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
        aria-label="Filtres classes"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
          <div>
            <label htmlFor="gc-niveau" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Niveau
            </label>
            <select
              id="gc-niveau"
              value={filterNiveau}
              onChange={(e) => {
                const v = e.target.value;
                setFilterNiveau(v);
                if (v && isTroncNiveau(v)) setFilterSection("");
              }}
              className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            >
              <option value="">Tous les niveaux</option>
              {NIVEAU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {showSectionFilter ? (
            <div>
              <label htmlFor="gc-section" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                Section
              </label>
              <select
                id="gc-section"
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
              >
                {SECTION_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </section>

      {classesError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {classesError}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#64748b]">Classes</h2>
          {loadingClasses ? (
            <Loading message="Chargement des données…" className="min-h-[160px] py-4" />
          ) : classes.length === 0 ? (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center text-sm text-[#64748b]">
              Aucune classe ne correspond aux filtres.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {classes.map((c) => {
                const selected = selectedClasse?.id === c.id;
                const cap = Number(c.capacite_max ?? CAPACITE_CLASSE_MAX);
                const nEl = Number(c.nombre_eleves ?? 0);
                const pct = cap > 0 ? Math.min(100, (nEl / cap) * 100) : 0;
                const full = nEl >= cap && cap > 0;
                const nivLabel = NIVEAU_OPTIONS.find((o) => o.value === c.niveau)?.label ?? c.niveau;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectClasse(c)}
                      className={[
                        "w-full rounded-2xl border p-4 text-left shadow-sm transition",
                        selected
                          ? "border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#3b82f6]/30"
                          : "border-[#e2e8f0] bg-white hover:border-[#cbd5e1]",
                      ].join(" ")}
                    >
                      <p className="font-semibold text-[#0f172a]">{c.nom}</p>
                      <p className="mt-1 text-sm text-[#64748b]">
                        {nEl} / {cap} élève{nEl !== 1 ? "s" : ""}
                      </p>
                      <div
                        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#e2e8f0]"
                        aria-hidden
                      >
                        <div
                          className={[
                            "h-full rounded-full transition-all",
                            full ? "bg-red-500" : "bg-[#3b82f6]",
                          ].join(" ")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {c.niveau ? (
                        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          <span className="rounded-md bg-[#f1f5f9] px-2 py-0.5 font-medium text-[#475569]">
                            {nivLabel}
                          </span>
                          <span className="rounded-md bg-[#eff6ff] px-2 py-0.5 font-medium text-[#1d4ed8]">
                            {formatSectionCell(c.niveau, c.section, null)}
                          </span>
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#64748b]">
              Élèves {selectedClasse ? `— ${selectedClasse.nom}` : ""}
            </h2>
            <button
              type="button"
              onClick={() => handlePrintListeEleves()}
              disabled={!selectedClasse}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-4 w-4 shrink-0 text-[#475569]" aria-hidden />
              Imprimer la liste
            </button>
          </div>
          {!selectedClasse ? (
            <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-10 text-center text-sm text-[#64748b]">
              Sélectionnez une classe pour afficher et gérer ses élèves.
            </div>
          ) : (
            <>
              {elevesError ? (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {elevesError}
                </p>
              ) : null}
              <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
                <div className="overflow-x-auto">
                  {loadingEleves ? (
                    <Loading message="Chargement des élèves…" className="min-h-[200px] p-8" />
                  ) : (
                    <table className="w-full min-w-0 border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                          <th className="px-4 py-3 text-left">Nom</th>
                          <th className="whitespace-nowrap px-4 py-3 text-left">N° élève</th>
                          <th className="px-4 py-3 text-left">Section</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eef2f6]">
                        {eleves.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-10 text-center text-[#64748b]">
                              Aucun élève dans cette classe.
                            </td>
                          </tr>
                        ) : (
                          currentEleves.map((row) => (
                            <tr key={row.id} className="text-[#0f172a]">
                              <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium`}>
                                {row.prenom} {row.nom}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#475569]">{row.id}</td>
                              <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>
                                <span className="inline-flex max-w-full flex-wrap rounded-md bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#1d4ed8]">
                                  {formatSectionCell(row.niveau, row.section, row.section_display)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    title="Voir coordonnées"
                                    onClick={() => setCoordonneesEleve({ eleve: row, data: coordonneesFromEleve(row) })}
                                    className="rounded-lg p-2 text-base leading-none text-[#475569] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
                                  >
                                    👁️
                                  </button>
                                  <button
                                    type="button"
                                    title="Modifier"
                                    onClick={() => openEditEleve(row)}
                                    className="rounded-lg p-2 text-base leading-none text-[#475569] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    title="Supprimer"
                                    onClick={() => deleteEleve(row)}
                                    className="rounded-lg p-2 text-base leading-none text-red-600 transition hover:bg-red-50"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                {!loadingEleves && eleves.length > 0 ? (
                  <Pagination
                    totalItems={eleves.length}
                    itemsPerPage={itemsPerPage}
                    currentPage={eleveListPage}
                    paginate={setEleveListPage}
                    itemLabel="élèves"
                    className="border-[#e2e8f0] bg-[#fafbfc]/80"
                  />
                ) : null}
              </div>
              <button
                type="button"
                onClick={openAddEleve}
                disabled={!selectedClasse}
                className="mt-4 flex w-full min-h-[52px] items-center justify-center rounded-xl border-2 border-dashed border-[#93c5fd] bg-[#eff6ff] px-4 py-3 text-base font-semibold text-[#1e40af] transition hover:border-[#3b82f6] hover:bg-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ajouter un élève à cette classe
              </button>
            </>
          )}
        </div>
      </div>

      {classeModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setClasseModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gc-new-classe-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#e2e8f0] px-5 py-4">
              <h2 id="gc-new-classe-title" className="text-lg font-semibold text-[#0f172a]">
                Nouvelle classe
              </h2>
            </div>
            <form onSubmit={submitCreateClasse} className="space-y-4 px-5 py-5">
              {classeFormError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {classeFormError}
                </p>
              ) : null}
              <div>
                <label htmlFor="gc-nc-nom" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  Nom de la classe
                </label>
                <input
                  id="gc-nc-nom"
                  value={newClasseNom}
                  onChange={(e) => setNewClasseNom(e.target.value)}
                  required
                  disabled={classeSaving}
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                  placeholder="Ex. Terminale S2"
                />
              </div>
              <div>
                <label htmlFor="gc-nc-niveau" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                  Niveau
                </label>
                <select
                  id="gc-nc-niveau"
                  value={newClasseNiveau}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewClasseNiveau(v);
                    if (isTroncNiveau(v)) setNewClasseSection("");
                  }}
                  disabled={classeSaving}
                  className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                >
                  <option value="">— Choisir —</option>
                  {NIVEAU_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {newClasseNiveau && !isTroncNiveau(newClasseNiveau) ? (
                <div>
                  <label htmlFor="gc-nc-section" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    Section
                  </label>
                  <select
                    id="gc-nc-section"
                    value={newClasseSection}
                    onChange={(e) => setNewClasseSection(e.target.value)}
                    disabled={classeSaving}
                    className="w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                  >
                    <option value="">— Choisir —</option>
                    {SECONDARY_SECTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex justify-end gap-2 border-t border-[#e2e8f0] pt-4">
                <button
                  type="button"
                  onClick={() => setClasseModalOpen(false)}
                  disabled={classeSaving}
                  className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] hover:bg-[#f8fafc] disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={classeSaving}
                  className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  {classeSaving ? "Création…" : "Créer la classe"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {coordonneesEleve ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setCoordonneesEleve(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gc-crd-title"
            className="w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] px-5 py-4">
              <h2 id="gc-crd-title" className="text-lg font-semibold text-[#0f172a]">
                Coordonnées — {coordonneesEleve.eleve.prenom} {coordonneesEleve.eleve.nom}
              </h2>
              <button
                type="button"
                onClick={() => setCoordonneesEleve(null)}
                className="rounded-lg p-1 text-[#64748b] hover:bg-[#f1f5f9]"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>
            <div className="space-y-3 px-5 py-5 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Parent / tuteur</p>
                <p className="mt-0.5 text-[#0f172a]">{coordonneesEleve.data.nom_parent || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Téléphones</p>
                <p className="mt-0.5 font-mono text-[#0f172a]">
                  {[coordonneesEleve.data.telephone_1, coordonneesEleve.data.telephone_2].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Adresse</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[#0f172a]">{coordonneesEleve.data.adresse || "—"}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ListeElevesClassePrint ref={listePrintRef} classe={selectedClasse} eleves={eleves} />

      <EleveModal
        open={eleveModalOpen}
        mode={eleveModalMode}
        eleve={eleveEnEdition}
        initialClasse={eleveModalMode === "add" ? selectedClasse?.nom : undefined}
        initialClasseRecord={eleveModalMode === "add" ? selectedClasse : null}
        classeOptions={classeOptionsNoms}
        classeRecords={classes}
        onClose={closeEleveModal}
        onSuccess={onEleveModalSuccess}
      />
    </div>
  );
}
