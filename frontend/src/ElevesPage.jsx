import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReactToPrint } from "react-to-print";

import { Pencil } from "lucide-react";

import { useAuth } from "./AuthContext.jsx";
import { isAdminUser, isComptable, isPointageAgent } from "./authRoles.js";
import { useSettings } from "./context/SettingsContext.jsx";
import AnnualProgressCell from "./components/AnnualProgressCell.jsx";
import EleveDetailsModal from "./components/EleveDetailsModal.jsx";
import EleveModal from "./components/EleveModal.jsx";
import RegistrationFormPrint from "./components/RegistrationFormPrint.jsx";
import Loading from "./components/ui/Loading.jsx";
import { Infobulle } from "./components/ui/Infobulle.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import {
  filterClassesByNiveauSection,
  formatSectionCell,
  isTroncNiveau,
  NIVEAU_OPTIONS,
  SECTION_FILTER_OPTIONS,
} from "./constants/tunisianAcademic.js";
import { API_CLASSES, API_ELEVES, apiFetch } from "./config.js";
import EleveTarifTypeBadges, { TARIF_TYPE_FILTER_OPTIONS } from "./components/EleveTarifTypeBadges.jsx";
import { eleveListeResteDisplay } from "./utils/eleveListeResteDisplay.js";
import { formatTnd } from "./utils/tunisianMoney.js";

function formatTarif(value) {
  return formatTnd(value);
}

/** Crédit (acompte) affiché en liste : `acompte` persisté, puis `credit_eleve`, compat. `avoir`. */
function eleveListeAcompteCredit(row) {
  const signed = Number(String(row?.acompte ?? row?.avoir ?? "").replace(",", "."));
  if (Number.isFinite(signed)) return Math.max(0, Math.round(signed * 100) / 100);
  const c = Number(String(row?.credit_eleve ?? "").replace(",", "."));
  if (Number.isFinite(c)) return Math.max(0, Math.round(c * 100) / 100);
  return 0;
}

function rowMoneyNumber(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function EleveFinancesTooltipContent({ row }) {
  const totalDu = rowMoneyNumber(row.total_annuel_du);
  const paye = rowMoneyNumber(row.total_paye);
  const reste = rowMoneyNumber(row.reste_a_payer);
  const credit = rowMoneyNumber(row.credit_eleve);
  const solde = totalDu - paye;
  return (
    <div className="min-w-[200px] space-y-1.5 text-left text-xs">
      <p>
        <span className="text-slate-500">Total dû (annuel, tarif × 10) :</span>{" "}
        <span className="font-medium tabular-nums text-slate-900">{formatTnd(totalDu)}</span>
      </p>
      <p>
        <span className="text-slate-500">Total payé (Σ encaissements) :</span>{" "}
        <span className="font-medium tabular-nums text-slate-900">{formatTnd(paye)}</span>
      </p>
      <p className="border-t border-slate-200 pt-1.5 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-800">Total dû − Total payé</span> ={" "}
        <span className="font-semibold tabular-nums text-slate-900">
          {formatTnd(solde)}
        </span>
        {reste > 0.005 ? (
          <span className="ml-1 text-rose-800">(reste à payer {formatTnd(reste)})</span>
        ) : null}
        {credit > 0.005 ? (
          <span className="ml-1 text-emerald-800">(acompte / crédit {formatTnd(credit)})</span>
        ) : null}
        {reste <= 0.005 && credit <= 0.005 ? (
          <span className="ml-1 text-slate-600">(compte soldé sur l’annuité)</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Liste des élèves avec recherche et filtres (API Django REST + django-filter).
 */
export default function ElevesPage() {
  const { user: authUser } = useAuth();
  const { itemsPerPage } = useSettings();
  const canManageEleves = isAdminUser(authUser) || isPointageAgent(authUser);
  /** Dossier 360° avec historique paiements : pas pour l’agent de saisie (pas d’accès finance). */
  const showFinancialDossier = isAdminUser(authUser) || isComptable(authUser);

  const [search, setSearch] = useState("");
  const [filterNiveau, setFilterNiveau] = useState("");
  const [selectedClasse, setSelectedClasse] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  /** Filtre API `tarif_type` : Tous, standard, gratuit, convention */
  const [filterTarifType, setFilterTarifType] = useState("");
  const [eleves, setEleves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const isFirstLoad = useRef(true);
  const [eleveModalOpen, setEleveModalOpen] = useState(false);
  const [eleveModalMode, setEleveModalMode] = useState("ajout");
  const [eleveEnEdition, setEleveEnEdition] = useState(null);
  const [viewingEleveId, setViewingEleveId] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [classeRecords, setClasseRecords] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  const printFicheListRef = useRef(null);
  const [ficheListEleve, setFicheListEleve] = useState(null);
  const [ficheListPrintedAt, setFicheListPrintedAt] = useState("");

  const handlePrintFicheListe = useReactToPrint({
    contentRef: printFicheListRef,
    documentTitle: ficheListEleve ? `fiche-inscription-${ficheListEleve.id}` : "fiche-inscription",
    ignoreGlobalStyles: true,
    fonts: [
      {
        family: "Inter",
        source: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
      },
    ],
    pageStyle: `
      @page { size: A4 portrait; margin: 10mm; }
      @media print {
        html, body {
          width: 100%;
          margin: 0;
          padding: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
    onAfterPrint: () => {
      setFicheListEleve(null);
      setFicheListPrintedAt("");
    },
  });

  useEffect(() => {
    let cancelled = false;
    async function loadClasses() {
      try {
        const res = await apiFetch(API_CLASSES, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.results ?? [];
        if (!cancelled) setClasseRecords(list);
      } catch {
        if (!cancelled) setClasseRecords([]);
      }
    }
    loadClasses();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  /** Noms de classes strictement alignés sur le niveau (et la section si 2e–4e secondaire). */
  const filteredClasseNames = useMemo(() => {
    if (!filterNiveau) {
      return [...new Set(classeRecords.map((c) => c.nom).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "fr"),
      );
    }
    const filtered = filterClassesByNiveauSection(classeRecords, filterNiveau, selectedSection);
    return [...new Set(filtered.map((c) => c.nom).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  }, [classeRecords, filterNiveau, selectedSection]);

  /** Niveau issu du filtre explicite, ou du référentiel de la classe sélectionnée. */
  const niveauForSectionUi = useMemo(() => {
    if (filterNiveau) return filterNiveau;
    if (!selectedClasse) return "";
    return classeRecords.find((c) => c.nom === selectedClasse)?.niveau ?? "";
  }, [filterNiveau, selectedClasse, classeRecords]);

  const showSectionFilter = !niveauForSectionUi || !isTroncNiveau(niveauForSectionUi);

  const hasNoClassesForFilter = Boolean(filterNiveau && filteredClasseNames.length === 0);

  useEffect(() => {
    setSelectedClasse("");
  }, [filterNiveau]);

  useEffect(() => {
    if (!filterNiveau || isTroncNiveau(filterNiveau)) return;
    setSelectedClasse("");
  }, [selectedSection, filterNiveau]);

  useEffect(() => {
    if (niveauForSectionUi && isTroncNiveau(niveauForSectionUi)) setSelectedSection("");
  }, [niveauForSectionUi]);

  useEffect(() => {
    if (!selectedClasse) return;
    if (!filterNiveau) return;
    if (!filteredClasseNames.includes(selectedClasse)) setSelectedClasse("");
  }, [filterNiveau, filteredClasseNames, selectedClasse]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const first = isFirstLoad.current;
      if (first) setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const params = new URLSearchParams();
        const q = search.trim();
        if (q) params.set("search", q);
        if (filterNiveau) params.set("niveau", filterNiveau);
        if (selectedClasse) params.set("classe", selectedClasse);
        const troncListe =
          (filterNiveau && isTroncNiveau(filterNiveau)) ||
          (!filterNiveau &&
            selectedClasse &&
            (() => {
              const n = classeRecords.find((c) => c.nom === selectedClasse)?.niveau;
              return n && isTroncNiveau(n);
            })());
        if (troncListe) {
          params.set("section", "");
        } else if (selectedSection) {
          params.set("section", selectedSection);
        }
        if (filterTarifType) {
          params.set("tarif_type", filterTarifType);
        }
        const qs = params.toString();
        const url = qs ? `${API_ELEVES}?${qs}` : API_ELEVES;
        const res = await apiFetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        let list = Array.isArray(data) ? data : data.results ?? [];
        if (troncListe) {
          list = list.filter((e) => String(e.section ?? "").trim() === "");
        }
        if (!cancelled) setEleves(list);
      } catch {
        if (!cancelled) {
          setEleves([]);
          setError("Impossible de charger les élèves.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          isFirstLoad.current = false;
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [search, filterNiveau, selectedClasse, selectedSection, filterTarifType, classeRecords, refreshNonce]);

  const filteredEleves = eleves;

  const tarifTypeCounts = useMemo(() => {
    let gratuits = 0;
    let conventionnes = 0;
    for (const e of eleves) {
      if (e.is_gratuit) gratuits += 1;
      else if (e.is_convention) conventionnes += 1;
    }
    return { gratuits, conventionnes, total: eleves.length };
  }, [eleves]);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentEleves = useMemo(
    () => filteredEleves.slice(indexOfFirstItem, indexOfLastItem),
    [filteredEleves, indexOfFirstItem, indexOfLastItem],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterNiveau, selectedClasse, selectedSection, filterTarifType]);

  useEffect(() => {
    const total = filteredEleves.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (currentPage > lastPage) setCurrentPage(lastPage);
  }, [filteredEleves.length, currentPage, itemsPerPage]);

  const classeOptionsPourModal = useMemo(() => {
    if (!filterNiveau) {
      return [...new Set(classeRecords.map((c) => c.nom).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "fr"),
      );
    }
    return filteredClasseNames;
  }, [classeRecords, filterNiveau, filteredClasseNames]);

  function openModalAjout() {
    setEleveModalMode("ajout");
    setEleveEnEdition(null);
    setEleveModalOpen(true);
  }

  function openModalModification(eleve) {
    setEleveModalMode("modification");
    setEleveEnEdition(eleve);
    setEleveModalOpen(true);
  }

  function closeEleveModal() {
    setEleveModalOpen(false);
    setEleveEnEdition(null);
  }

  function handleEleveModalSuccess() {
    closeEleveModal();
    setRefreshNonce((n) => n + 1);
  }

  return (
    <>
    <div className="w-full min-w-0 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Élèves</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#64748b]">
            Recherche, filtre par classe et section, consultation des fiches.
          </p>
        </div>
        {canManageEleves ? (
          <button
            type="button"
            onClick={openModalAjout}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
          >
            Ajouter un élève
          </button>
        ) : null}
      </header>

      <section
        className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
        aria-label="Filtres"
      >
        <div className="grid gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label htmlFor="eleve-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Nom / téléphone
            </label>
            <input
              id="eleve-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="eleve-niveau" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Niveau
            </label>
            <select
              id="eleve-niveau"
              value={filterNiveau}
              onChange={(e) => {
                const v = e.target.value;
                setFilterNiveau(v);
                if (v && isTroncNiveau(v)) setSelectedSection("");
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
          <div className={showSectionFilter ? "md:col-span-2" : "md:col-span-4"}>
            <label htmlFor="eleve-classe" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Classe
            </label>
            <select
              id="eleve-classe"
              value={hasNoClassesForFilter ? "" : selectedClasse}
              onChange={(e) => setSelectedClasse(e.target.value)}
              disabled={hasNoClassesForFilter}
              aria-describedby="eleve-classe-hint"
              className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {hasNoClassesForFilter ? (
                <option value="">Aucune classe disponible</option>
              ) : (
                <>
                  <option value="">Toutes les classes</option>
                  {filteredClasseNames.map((nom) => (
                    <option key={nom} value={nom}>
                      {nom}
                    </option>
                  ))}
                </>
              )}
            </select>
            <p id="eleve-classe-hint" className="sr-only">
              Les classes listées correspondent au niveau sélectionné
              {filterNiveau && !isTroncNiveau(filterNiveau) ? " et à la section choisie" : ""}.
            </p>
          </div>
          {showSectionFilter ? (
            <div className="md:col-span-2">
              <label htmlFor="eleve-section" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                Section
              </label>
              <select
                id="eleve-section"
                value={selectedSection}
                onChange={(e) => setSelectedSection(e.target.value)}
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
          <div className="md:col-span-3">
            <label htmlFor="eleve-tarif-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Type de tarif
            </label>
            <select
              id="eleve-tarif-type"
              value={filterTarifType}
              onChange={(e) => setFilterTarifType(e.target.value)}
              className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            >
              {TARIF_TYPE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "tous"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section
        className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
        aria-labelledby="eleves-table-title"
      >
        <div className="flex flex-col gap-1 border-b border-[#e2e8f0] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
          <h2 id="eleves-table-title" className="text-base font-semibold text-[#0f172a]">
            Liste ({loading ? "…" : eleves.length})
          </h2>
          {!loading && eleves.length > 0 ? (
            <p className="text-sm text-[#64748b]" aria-live="polite">
              Total : {tarifTypeCounts.total} élèves (dont {tarifTypeCounts.gratuits} gratuit
              {tarifTypeCounts.gratuits !== 1 ? "s" : ""} et {tarifTypeCounts.conventionnes} conventionné
              {tarifTypeCounts.conventionnes !== 1 ? "s" : ""})
            </p>
          ) : null}
          {refreshing ? (
            <span className="text-xs font-medium text-[#64748b]" aria-live="polite">
              Mise à jour…
            </span>
          ) : null}
        </div>

        <div className={`overflow-x-auto ${refreshing ? "opacity-70 transition-opacity" : ""}`}>
          {error && !loading ? (
            <p className="px-4 py-10 text-center text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : loading && eleves.length === 0 ? (
            <div className="px-4 py-4">
              <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
            </div>
          ) : eleves.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#64748b]">Aucun élève ne correspond aux critères.</p>
          ) : (
            <table className="w-full min-w-0 border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Nom
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Prénom
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Classe
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Section
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                    Tarif
                  </th>
                  <th scope="col" className="min-w-[7rem] whitespace-nowrap px-4 py-3.5 text-right">
                    Acompte
                  </th>
                  <th scope="col" className="min-w-[7rem] whitespace-nowrap px-4 py-3.5 text-right">
                    Reste à payer
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Progression
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                {currentEleves.map((row, index) => {
                  const resteListe = eleveListeResteDisplay(row, formatTnd);
                  return (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium`}>
                      {row.nom}
                      <EleveTarifTypeBadges is_gratuit={row.is_gratuit} is_convention={row.is_convention} />
                    </td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.prenom}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.classe || "—"}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>
                      <span className="inline-flex max-w-full flex-wrap rounded-md bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#1d4ed8]">
                        {formatSectionCell(row.niveau, row.section, row.section_display)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                      {formatTarif(row.tarif_mensuel)}
                    </td>
                    <td className="min-w-[7rem] whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                      <Infobulle
                        content={<EleveFinancesTooltipContent row={row} />}
                        side="left"
                        touchStyle="plain"
                        className="cursor-help tabular-nums"
                      >
                        {formatTnd(eleveListeAcompteCredit(row))}
                      </Infobulle>
                    </td>
                    <td
                      className={`min-w-[7rem] whitespace-nowrap px-4 py-3 text-right font-medium ${
                        resteListe.isExonere
                          ? "text-emerald-800"
                          : rowMoneyNumber(row.reste_a_payer) > 0.005
                            ? "tabular-nums text-rose-800"
                            : "tabular-nums text-slate-600"
                      }`}
                    >
                      <Infobulle
                        content={<EleveFinancesTooltipContent row={row} />}
                        side="left"
                        touchStyle="plain"
                        className={`cursor-help ${resteListe.isExonere ? "" : "tabular-nums"}`}
                      >
                        {resteListe.isExonere ? (
                          <span className="font-semibold tracking-wide">EXONÉRÉ</span>
                        ) : (
                          resteListe.text
                        )}
                      </Infobulle>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <AnnualProgressCell
                        value={row.is_gratuit ? 100 : row.progression_annuelle}
                        label={row.is_gratuit ? "Gratuit" : undefined}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {showFinancialDossier ? (
                        <button
                          type="button"
                          onClick={() => setViewingEleveId(row.id)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[#0f172a] hover:text-[#334155]"
                          title="Voir le dossier 360°"
                        >
                          <span aria-hidden>👁️</span>
                          Voir
                        </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            flushSync(() => {
                              setFicheListEleve(row);
                              setFicheListPrintedAt(
                                new Intl.DateTimeFormat("fr-FR", {
                                  dateStyle: "long",
                                  timeStyle: "short",
                                }).format(new Date()),
                              );
                            });
                            void handlePrintFicheListe();
                          }}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[#0f172a] hover:text-[#334155]"
                          title="Imprimer la fiche d'inscription"
                        >
                          <span aria-hidden>📝</span>
                          Imprimer Fiche
                        </button>
                        {canManageEleves ? (
                          <button
                            type="button"
                            onClick={() => openModalModification(row)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563eb] hover:text-[#1d4ed8]"
                            title="Modifier la fiche"
                          >
                            <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                            Modifier
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && eleves.length > 0 ? (
          <Pagination
            totalItems={filteredEleves.length}
            itemsPerPage={itemsPerPage}
            currentPage={currentPage}
            paginate={setCurrentPage}
            itemLabel="élèves"
            className="border-[#e2e8f0] bg-[#fafbfc]/80"
          />
        ) : null}
      </section>

      <EleveModal
        open={eleveModalOpen}
        mode={eleveModalMode === "modification" ? "edit" : "add"}
        eleve={eleveEnEdition}
        classeOptions={classeOptionsPourModal}
        classeRecords={classeRecords}
        onClose={closeEleveModal}
        onSuccess={handleEleveModalSuccess}
      />

      {showFinancialDossier ? (
      <EleveDetailsModal
        open={viewingEleveId != null}
        eleveId={viewingEleveId}
        onClose={() => setViewingEleveId(null)}
      />
      ) : null}
    </div>
    <RegistrationFormPrint ref={printFicheListRef} eleve={ficheListEleve} printedAtLabel={ficheListPrintedAt} />
    </>
  );
}
