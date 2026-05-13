import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endOfDay, format, isAfter, startOfDay } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Eye, FileDown, HandCoins, History, Pencil, Banknote } from "lucide-react";

import { useAuth } from "./AuthContext.jsx";
import { isAdminUser, isComptable, isPointageAgent, isPointageOnlyAgent } from "./authRoles.js";
import { useSettings } from "./context/SettingsContext.jsx";
import DateRangeFilter from "./components/DateRangeFilter.jsx";
import GestionSalairesTab from "./components/GestionSalairesTab.jsx";
import AvanceSalaireModal from "./components/AvanceSalaireModal.jsx";
import HistoriqueFichesModal from "./components/HistoriqueFichesModal.jsx";
import PointageModal from "./components/PointageModal.jsx";
import PaymentModal from "./components/PaymentModal.jsx";
import SalaryReceiptPrintHost from "./components/SalaryReceiptPrintHost.jsx";
import ProfesseurDetailsModal from "./components/ProfesseurDetailsModal.jsx";
import ProfesseurModal from "./components/ProfesseurModal.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import { API_POINTAGES, API_POINTAGES_PROF_MANQUANTS, API_PROFESSEURS, apiFetch } from "./config.js";
import { getSchoolLogoDataUrlForPdf } from "./branding.js";
import { drawSchoolPdfHeader } from "./utils/pdfGenerator.js";
import { localISODate } from "./utils/dateLocal.js";
import { normalizeNameSearch } from "./utils/nameSearch.js";
import { normalizeProfesseursListFromApi } from "./utils/professeurApi.js";
import { formatTnd, formatTnNumber } from "./utils/tunisianMoney.js";

const tabBtnClass = (active) =>
  [
    "rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
    active
      ? "bg-[#0f172a] text-white shadow-sm"
      : "bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#0f172a]",
  ].join(" ");

function formatTarifHoraire(value) {
  return formatTnd(value);
}

function formatDateCourte(isoDate) {
  if (!isoDate) return "—";
  const s = String(isoDate).slice(0, 10);
  try {
    const [y, m, d] = s.split("-");
    if (y && m && d) {
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(dt);
    }
  } catch {
    /* ignore */
  }
  return s;
}

function formatHeures(v) {
  return formatTnNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function professeurDisplayName(row) {
  const n = row.professeur_nom;
  const p = row.professeur_prenom;
  const parts = [p, n].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return "—";
}

/** Affichage présence (API : statut_presence PRESENTE | ABSENTE | RETARD | A_VENIR). */
function presenceStatusBadge(statut) {
  const s = statut || "PRESENTE";
  if (s === "A_VENIR") {
    return upcomingStatusBadge();
  }
  if (s === "ABSENTE") {
    return (
      <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-200/80">
        Absent
      </span>
    );
  }
  if (s === "RETARD") {
    return (
      <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200/80">
        Annulé / retard
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
      Présent
    </span>
  );
}

function reglementBadge(estPaye) {
  if (estPaye) {
    return (
      <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
        Payé
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950 ring-1 ring-amber-200/80">
      En attente
    </span>
  );
}

/** Absences : pas de règlement — ne pas refléter est_paye côté UI. */
function reglementNotApplicableBadge() {
  return (
    <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80">
      Non applicable
    </span>
  );
}

function isAbsenceForReglement(statutPresence) {
  const s = String(statutPresence ?? "").toUpperCase();
  return s === "ABSENTE" || s === "ABSENT";
}

/** Compare la date ISO du pointage (YYYY-MM-DD) au jour civil local — pas minuit UTC. */
function isPointageDateFuture(isoDate) {
  const s = String(isoDate ?? "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return false;
  const rowDay = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  return rowDay > today;
}

function upcomingStatusBadge() {
  return (
    <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80">
      À venir
    </span>
  );
}

function formatPctTaux(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`;
}

function sanitizePdfFilenamePart(name) {
  const s = String(name ?? "Professeur")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return s.slice(0, 48) || "Professeur";
}

function pointageStatutLabelForPdf(statut) {
  const s = statut || "PRESENTE";
  if (s === "A_VENIR") return "À venir";
  if (s === "ABSENTE") return "Absent";
  if (s === "RETARD") return "Annulé / retard";
  return "Présent";
}

function pointageReglementLabelForPdf(row) {
  const isVirtual =
    row.statut_presence === "A_VENIR" || String(row.id ?? "").startsWith("virtual_");
  if (isVirtual) return "—";
  if (isAbsenceForReglement(row.statut_presence)) return "Non applicable";
  return row.est_paye ? "Payé" : "En attente";
}

function classeRemarquePdf(row) {
  const c = row.classe_nom?.trim() ? row.classe_nom : "—";
  const rem = row.remarque?.trim();
  return rem ? `${c} — ${rem}` : c;
}

/**
 * Génère le PDF de présence pour le professeur ciblé par la recherche (une seule personne).
 */
async function generatePointagePdfReport({
  pointages,
  pointageSummary,
  pointagePeriod,
  pointageSearchDebounced,
  pointageProjectionMode,
  setPdfToast,
}) {
  try {
    const search = (pointageSearchDebounced || "").trim();
    if (!search) {
      setPdfToast({
        type: "warning",
        message: "Veuillez sélectionner un professeur pour générer son rapport.",
      });
      return;
    }

    if (!pointages.length) {
      setPdfToast({
        type: "warning",
        message: "Aucune donnée à exporter pour cette période et cette recherche.",
      });
      return;
    }

    const profIds = [...new Set(pointages.map((r) => r.professeur).filter((id) => id != null))];
    if (profIds.length > 1) {
      setPdfToast({
        type: "warning",
        message: "Affinez la recherche pour ne cibler qu'un seul professeur.",
      });
      return;
    }

    const nomProf =
      profIds.length === 1
        ? professeurDisplayName(pointages.find((r) => r.professeur === profIds[0]))
        : search;

    const startStr = format(pointagePeriod.startDate, "dd/MM/yyyy");
    const endStr = format(pointagePeriod.endDate, "dd/MM/yyyy");

    const heuresEffectuees = `${formatHeures(pointageSummary?.heures_realisees)} h`;
    const heuresProgrammees = `${formatHeures(pointageSummary?.heures_theoriques)} h`;
    const tauxPresence =
      pointageProjectionMode || pointageSummary?.taux_presence == null
        ? "—"
        : formatPctTaux(pointageSummary.taux_presence);

    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 14;

    const logo = await getSchoolLogoDataUrlForPdf();
    y += drawSchoolPdfHeader(doc, margin, y, logo) + 6;
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    const title = `Rapport de Présence - ${nomProf}`;
    const titleLines = doc.splitTextToSize(title, pageW - margin * 2);
    doc.text(titleLines, pageW / 2, y, { align: "center" });
    y += titleLines.length * 7 + 4;

    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`Période : ${startStr} au ${endStr}`, pageW / 2, y, { align: "center" });
    y += 12;

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Heures Effectuées : ${heuresEffectuees}`, margin, y);
    y += 6;
    doc.text(`Heures Programmées : ${heuresProgrammees}`, margin, y);
    y += 6;
    doc.text(`Taux de Présence : ${tauxPresence}`, margin, y);
    y += 10;

    const tableBody = pointages.map((row) => [
      formatDateCourte(row.date_cours),
      `${formatHeures(row.nombre_heures)} h`,
      pointageStatutLabelForPdf(row.statut_presence),
      pointageReglementLabelForPdf(row),
      classeRemarquePdf(row),
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Date", "Heures", "Statut", "Règlement", "Classe / Remarque"]],
      body: tableBody,
      theme: "striped",
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 36 },
        1: { cellWidth: 22, halign: "right" },
        2: { cellWidth: 32 },
        3: { cellWidth: 30 },
        4: { cellWidth: "auto" },
      },
      margin: { left: margin, right: margin },
    });

    const moisPart = format(pointagePeriod.startDate, "yyyy-MM");
    const fileBase = sanitizePdfFilenamePart(nomProf);
    doc.save(`Rapport_Presence_${fileBase}_${moisPart}.pdf`);

    setPdfToast({ type: "success", message: "Rapport PDF téléchargé." });
  } catch (err) {
    console.error(err);
    setPdfToast({
      type: "error",
      message: "Impossible de générer le PDF. Réessayez.",
    });
  }
}

/**
 * Personnel enseignant et feuille de présence / pointage.
 */
export default function ProfesseursPage() {
  const { user: authUser } = useAuth();
  const { itemsPerPage } = useSettings();
  const admin = isAdminUser(authUser);
  const comptable = isComptable(authUser);
  const pointageOnly = isPointageOnlyAgent(authUser);
  const showSalairesTab = admin || comptable;
  const canOpenProfPayModal = admin || comptable;
  const canRecordPointageSeance = admin || isPointageAgent(authUser);

  const [tab, setTab] = useState("personnel");
  const effectiveTab = pointageOnly ? "pointage" : tab;

  const [professeurs, setProfesseurs] = useState([]);
  const [pointages, setPointages] = useState([]);
  const [pointageSummary, setPointageSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const isFirstLoad = useRef(true);

  const [pointagePeriod, setPointagePeriod] = useState(() => ({
    startDate: startOfDay(new Date()),
    endDate: endOfDay(new Date()),
  }));
  const [pointageSearchInput, setPointageSearchInput] = useState("");
  const [pointageSearchDebounced, setPointageSearchDebounced] = useState("");
  const [pointageStatut, setPointageStatut] = useState("");
  const [pointageReglement, setPointageReglement] = useState("");

  const [profModalOpen, setProfModalOpen] = useState(false);
  const [profEditRow, setProfEditRow] = useState(null);
  const [profDetailOpen, setProfDetailOpen] = useState(false);
  const [profDetailRow, setProfDetailRow] = useState(null);
  const [salairePayOpen, setSalairePayOpen] = useState(false);
  const [salairePayProf, setSalairePayProf] = useState(null);
  const [salairePayResume, setSalairePayResume] = useState(null);
  const [salairePayTargetId, setSalairePayTargetId] = useState(null);
  const [historiquePaieOpen, setHistoriquePaieOpen] = useState(false);
  const [historiquePaieProf, setHistoriquePaieProf] = useState(null);
  const [avanceProfOpen, setAvanceProfOpen] = useState(false);
  const [avanceProfRow, setAvanceProfRow] = useState(null);
  const [pointageModalOpen, setPointageModalOpen] = useState(false);
  const [pointageModalMountKey, setPointageModalMountKey] = useState(0);
  const [pointageModalInitialProf, setPointageModalInitialProf] = useState(null);
  const [profManquants, setProfManquants] = useState({ count: 0, manquants: [] });
  const [profManquantsLoading, setProfManquantsLoading] = useState(false);
  const [profManquantsModalOpen, setProfManquantsModalOpen] = useState(false);
  const [pdfToast, setPdfToast] = useState(null);
  const [salaryReceiptPrintPayload, setSalaryReceiptPrintPayload] = useState(null);

  const [profPage, setProfPage] = useState(1);
  const [pointagePage, setPointagePage] = useState(1);

  const [profListSearchInput, setProfListSearchInput] = useState("");
  const [profListSearchDebounced, setProfListSearchDebounced] = useState("");

  const clearSalaryReceiptPrint = useCallback(() => setSalaryReceiptPrintPayload(null), []);

  const filteredProfesseurs = useMemo(() => {
    const q = normalizeNameSearch(profListSearchDebounced.trim());
    if (!q) return professeurs;
    return professeurs.filter((p) => {
      const nom = normalizeNameSearch(p.nom);
      const prenom = normalizeNameSearch(p.prenom);
      return nom.includes(q) || prenom.includes(q) || `${prenom} ${nom}`.trim().includes(q);
    });
  }, [professeurs, profListSearchDebounced]);

  const profIndexLast = profPage * itemsPerPage;
  const profIndexFirst = profIndexLast - itemsPerPage;
  const currentProfs = useMemo(
    () => filteredProfesseurs.slice(profIndexFirst, profIndexLast),
    [filteredProfesseurs, profIndexFirst, profIndexLast],
  );

  const ptIndexLast = pointagePage * itemsPerPage;
  const ptIndexFirst = ptIndexLast - itemsPerPage;
  const currentPointages = useMemo(
    () => pointages.slice(ptIndexFirst, ptIndexLast),
    [pointages, ptIndexFirst, ptIndexLast],
  );

  useEffect(() => {
    setPointagePage(1);
  }, [
    pointagePeriod.startDate,
    pointagePeriod.endDate,
    pointageSearchDebounced,
    pointageStatut,
    pointageReglement,
  ]);

  useEffect(() => {
    setProfPage(1);
  }, [profListSearchDebounced]);

  useEffect(() => {
    const total = filteredProfesseurs.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (profPage > lastPage) setProfPage(lastPage);
  }, [filteredProfesseurs.length, profPage, itemsPerPage]);

  useEffect(() => {
    const total = pointages.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (pointagePage > lastPage) setPointagePage(lastPage);
  }, [pointages.length, pointagePage, itemsPerPage]);

  useEffect(() => {
    if (pointageOnly && tab !== "pointage") {
      setTab("pointage");
    }
  }, [pointageOnly, tab]);

  useEffect(() => {
    const t = setTimeout(() => setPointageSearchDebounced(pointageSearchInput.trim()), 360);
    return () => clearTimeout(t);
  }, [pointageSearchInput]);

  useEffect(() => {
    const t = setTimeout(() => setProfListSearchDebounced(profListSearchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [profListSearchInput]);

  useEffect(() => {
    if (!pdfToast) return undefined;
    const id = setTimeout(() => setPdfToast(null), 4500);
    return () => clearTimeout(id);
  }, [pdfToast]);

  const loadProfManquantsAujourdhui = useCallback(async (options = {}) => {
    const { signal, quiet = false } = options;
    if (!quiet) setProfManquantsLoading(true);
    try {
      const d = localISODate();
      const url = `${API_POINTAGES_PROF_MANQUANTS}?date=${encodeURIComponent(d)}`;
      const res = await apiFetch(url, { signal, cache: "no-store" });
      if (res.status === 403 || res.status === 404) {
        setProfManquants({ count: 0, manquants: [] });
        return;
      }
      if (!res.ok) {
        setProfManquants({ count: 0, manquants: [] });
        return;
      }
      const data = await res.json();
      if (signal?.aborted) return;
      const list = Array.isArray(data?.manquants) ? data.manquants : [];
      setProfManquants({
        count: Number(data?.count) || list.length,
        manquants: list.map((m) => ({
          professeur_id: m?.professeur_id != null ? Number(m.professeur_id) : null,
          nom: m?.nom ?? "",
          prenom: m?.prenom ?? "",
          heure_debut: m?.heure_debut ?? null,
        })),
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setProfManquants({ count: 0, manquants: [] });
    } finally {
      if (!signal?.aborted && !quiet) setProfManquantsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveTab !== "pointage") return;
    const ac = new AbortController();
    void loadProfManquantsAujourdhui({ signal: ac.signal });
    return () => ac.abort();
  }, [effectiveTab, refreshNonce, loadProfManquantsAujourdhui]);

  useEffect(() => {
    if (profManquants.count === 0) setProfManquantsModalOpen(false);
  }, [profManquants.count]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && effectiveTab === "pointage") {
        const ac = new AbortController();
        void loadProfManquantsAujourdhui({ signal: ac.signal, quiet: true });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [effectiveTab, loadProfManquantsAujourdhui]);

  useEffect(() => {
    if (effectiveTab !== "pointage") return;
    const onFocus = () => {
      void loadProfManquantsAujourdhui({ quiet: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [effectiveTab, loadProfManquantsAujourdhui]);

  const pointageProjectionMode = useMemo(() => {
    return isAfter(startOfDay(pointagePeriod.startDate), startOfDay(new Date()));
  }, [pointagePeriod.startDate]);

  const pointageTheoriquesNum = useMemo(() => {
    const raw = pointageSummary?.heures_theoriques;
    if (raw == null || raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }, [pointageSummary?.heures_theoriques]);

  const pointageShowProgrammedHoursEmpty = useMemo(() => {
    if (pointageTheoriquesNum <= 0 || pointages.length > 0) return false;
    const narrowedByExtraFilters =
      Boolean(pointageStatut) || Boolean(pointageReglement) || Boolean(pointageSearchDebounced);
    return pointageProjectionMode || !narrowedByExtraFilters;
  }, [
    pointageTheoriquesNum,
    pointages.length,
    pointageProjectionMode,
    pointageStatut,
    pointageReglement,
    pointageSearchDebounced,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const first = isFirstLoad.current;
      if (first) setLoading(true);
      else setRefreshing(true);
      setError("");
      const loadProfs = true;
      const loadPointages = pointageOnly || effectiveTab === "pointage";

      try {
        let listP = null;
        let listPt = null;
        let summary = null;

        if (loadProfs) {
          const resP = await apiFetch(API_PROFESSEURS);
          if (!resP.ok) throw new Error(`professeurs HTTP ${resP.status}`);
          const dataP = await resP.json();
          const rawList = Array.isArray(dataP) ? dataP : dataP.results ?? [];
          listP = normalizeProfesseursListFromApi(rawList);
        }

        if (loadPointages) {
          const qs = new URLSearchParams();
          qs.set("start_date", format(pointagePeriod.startDate, "yyyy-MM-dd"));
          qs.set("end_date", format(pointagePeriod.endDate, "yyyy-MM-dd"));
          if (pointageSearchDebounced) qs.set("search", pointageSearchDebounced);
          if (pointageStatut) qs.set("statut_presence", pointageStatut);
          if (pointageReglement === "paid") qs.set("est_paye", "true");
          if (pointageReglement === "pending") qs.set("est_paye", "false");
          const resPt = await apiFetch(`${API_POINTAGES}?${qs.toString()}`);
          if (!resPt.ok) throw new Error(`pointages HTTP ${resPt.status}`);
          const dataPt = await resPt.json();
          listPt = Array.isArray(dataPt) ? dataPt : dataPt.results ?? [];
          summary = !Array.isArray(dataPt) && dataPt.summary ? dataPt.summary : null;
        }

        if (!cancelled) {
          if (listP !== null) setProfesseurs(listP);
          if (loadPointages) {
            setPointages(listPt ?? []);
            setPointageSummary(summary);
          }
        }
      } catch {
        if (!cancelled) {
          if (loadProfs) setProfesseurs([]);
          if (loadPointages) {
            setPointages([]);
            setPointageSummary(null);
          }
          setError("Impossible de charger les données.");
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
  }, [
    refreshNonce,
    effectiveTab,
    pointageOnly,
    pointagePeriod.startDate,
    pointagePeriod.endDate,
    pointageSearchDebounced,
    pointageStatut,
    pointageReglement,
  ]);

  function bumpRefresh() {
    setRefreshNonce((n) => n + 1);
  }

  function openPointageModalForProfManquant(m) {
    if (m?.professeur_id == null) return;
    setProfManquantsModalOpen(false);
    setPointageModalInitialProf({ id: m.professeur_id, nom: m.nom, prenom: m.prenom });
    setPointageModalMountKey((k) => k + 1);
    setPointageModalOpen(true);
  }

  async function openSalairePayModalForRow(row) {
    if (!canOpenProfPayModal) return;
    setSalairePayTargetId(row.id);
    try {
      const r = await apiFetch(`${API_PROFESSEURS}${row.id}/resume_paie/`);
      if (!r.ok) throw new Error(`resume ${r.status}`);
      const res = await r.json();
      setSalairePayProf(row);
      setSalairePayResume(res);
      setSalairePayOpen(true);
    } catch {
      setPdfToast({ type: "error", message: "Impossible de charger le résumé de paie." });
    } finally {
      setSalairePayTargetId(null);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">
            {pointageOnly ? "Feuille de présence" : "Professeurs"}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#64748b]">
            {pointageOnly
              ? "Saisie des séances et suivi des présences des enseignants."
              : "Gestion du personnel enseignant et suivi des heures effectuées."}
          </p>
        </div>
      </header>

      {pointageOnly ? null : (
        <div
          className="flex flex-wrap gap-2 rounded-xl border border-[#e2e8f0] bg-white p-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          role="tablist"
          aria-label="Sections professeurs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "personnel"}
            className={tabBtnClass(tab === "personnel")}
            onClick={() => setTab("personnel")}
          >
            Liste des professeurs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pointage"}
            className={tabBtnClass(tab === "pointage")}
            onClick={() => setTab("pointage")}
          >
            Feuille de présence
          </button>
          {showSalairesTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "salaires"}
              className={tabBtnClass(tab === "salaires")}
              onClick={() => setTab("salaires")}
            >
              Gestion des Salaires
            </button>
          ) : null}
        </div>
      )}

      {effectiveTab === "personnel" ? (
        <section className="space-y-4">
          <div
            className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
            aria-label="Recherche professeurs"
          >
            <label htmlFor="prof-list-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Rechercher un professeur
            </label>
            <input
              id="prof-list-search"
              type="search"
              autoComplete="off"
              placeholder="Filtrer par nom ou prénom…"
              value={profListSearchInput}
              onChange={(e) => setProfListSearchInput(e.target.value)}
              disabled={loading || refreshing}
              className="w-full max-w-md rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] shadow-sm placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            />
          </div>

              {admin ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setProfEditRow(null);
                  setProfModalOpen(true);
                }}
                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
              >
                Ajouter un professeur
              </button>
            </div>
          ) : null}

          <div
            className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
            aria-labelledby="prof-table-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-4">
              <h2 id="prof-table-title" className="text-base font-semibold text-[#0f172a]">
                Liste des professeurs (
                {loading
                  ? "…"
                  : profListSearchDebounced
                    ? `${filteredProfesseurs.length} sur ${professeurs.length}`
                    : filteredProfesseurs.length}
                )
              </h2>
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
              ) : loading && professeurs.length === 0 ? (
                <div className="px-4 py-4">
                  <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
                </div>
              ) : professeurs.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[#64748b]">Aucun professeur enregistré.</p>
              ) : filteredProfesseurs.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[#64748b]" role="status">
                  Aucun professeur ne correspond à « {profListSearchDebounced} ».
                </p>
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
                        Matière
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                        Téléphone
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                        Tarif horaire
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                        Payé (ce mois)
                      </th>
                      {canOpenProfPayModal ? (
                        <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                          Paies
                        </th>
                      ) : null}
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                    {currentProfs.map((row, index) => {
                      const paid = row.is_paid_current_month === true;
                      const payShortcut = canOpenProfPayModal && !paid;
                      const payLoadingRow = salairePayTargetId === row.id;
                      return (
                      <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium`}>{row.nom}</td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.prenom}</td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.matiere || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#475569]">
                          {row.telephone || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                          {formatTarifHoraire(row.tarif_horaire)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-left">
                          {paid ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
                              <span aria-hidden>✅</span> Payé
                            </span>
                          ) : payShortcut ? (
                            <button
                              type="button"
                              onClick={() => openSalairePayModalForRow(row)}
                              disabled={payLoadingRow}
                              className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900 ring-1 ring-rose-200/80 transition hover:bg-rose-200/80 disabled:cursor-wait disabled:opacity-70"
                              title="Enregistrer un paiement de salaire"
                            >
                              <span aria-hidden>❌</span> {payLoadingRow ? "Chargement…" : "Non payé"}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80">
                              <span aria-hidden>❌</span> Non payé
                            </span>
                          )}
                        </td>
                        {canOpenProfPayModal ? (
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                setHistoriquePaieProf(row);
                                setHistoriquePaieOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]"
                              title="Historique des paies"
                            >
                              <History className="h-4 w-4 shrink-0" aria-hidden />
                              Historique des paies
                            </button>
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {canOpenProfPayModal ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setProfDetailRow(row);
                                    setProfDetailOpen(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                                  title="Voir la fiche"
                                >
                                  <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  Voir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openSalairePayModalForRow(row)}
                                  disabled={payLoadingRow}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#475569] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#0f172a] disabled:cursor-wait disabled:opacity-60"
                                  title="Payer le salaire"
                                  aria-label="Payer le salaire"
                                >
                                  <Banknote className="h-4 w-4" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAvanceProfRow(row);
                                    setAvanceProfOpen(true);
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#475569] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                                  title="Accorder une avance"
                                  aria-label="Accorder une avance"
                                >
                                  <HandCoins className="h-4 w-4" aria-hidden />
                                </button>
                              </>
                            ) : null}
                            {admin ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setProfEditRow(row);
                                  setProfModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-[#f1f5f9] px-2.5 py-1.5 text-xs font-semibold text-[#0f172a] transition hover:bg-[#e2e8f0]"
                                title="Modifier"
                              >
                                <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
            {!loading && filteredProfesseurs.length > 0 ? (
              <Pagination
                totalItems={filteredProfesseurs.length}
                itemsPerPage={itemsPerPage}
                currentPage={profPage}
                paginate={setProfPage}
                itemLabel="professeurs"
                className="border-[#e2e8f0] bg-[#fafbfc]/80"
              />
            ) : null}
          </div>
        </section>
      ) : effectiveTab === "pointage" ? (
        <section className="space-y-4 overflow-visible">
          {profManquants.count > 0 ? (
            <div
              className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              role="alert"
              aria-live="polite"
              aria-busy={profManquantsLoading}
            >
              <p className="text-sm font-medium text-amber-950">
                {profManquants.count === 1
                  ? "Attention : 1 professeur n'a pas encore été pointé pour une séance prévue aujourd'hui (emploi du temps)."
                  : `Attention : ${profManquants.count} professeurs n'ont pas encore été pointés pour leurs séances prévues aujourd'hui (emploi du temps).`}
              </p>
              <button
                type="button"
                onClick={() => setProfManquantsModalOpen(true)}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100/60"
              >
                Voir la liste
              </button>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() =>
                void generatePointagePdfReport({
                  pointages,
                  pointageSummary,
                  pointagePeriod,
                  pointageSearchDebounced,
                  pointageProjectionMode,
                  setPdfToast,
                })
              }
              disabled={loading || refreshing}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] shadow-sm transition hover:border-[#94a3b8] hover:bg-[#f8fafc] focus:outline-none focus:ring-2 focus:ring-[#94a3b8] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden />
              Télécharger le Rapport
            </button>
            {canRecordPointageSeance ? (
              <button
                type="button"
                onClick={() => {
                  setPointageModalMountKey((k) => k + 1);
                  setPointageModalOpen(true);
                }}
                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
              >
                Enregistrer une séance
              </button>
            ) : null}
          </div>

          <div
            className="overflow-visible rounded-xl border-2 border-[#0f172a]/10 bg-gradient-to-br from-slate-50 to-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
            aria-label="Filtres feuille de présence"
          >
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#64748b]">
              Filtres
            </p>
            <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              <div className="relative z-[1090] min-w-0 flex-1 overflow-visible sm:min-w-[240px] lg:max-w-none">
                <p className="mb-1.5 text-xs font-semibold text-[#475569]">Période</p>
                <DateRangeFilter
                  value={pointagePeriod}
                  disabled={loading || refreshing}
                  onApply={(next) => setPointagePeriod(next)}
                  allowFutureRanges
                  className="w-full"
                />
              </div>
              <div className="min-w-0 flex-1 lg:min-w-[200px] lg:max-w-[320px]">
                <label htmlFor="pt-search-prof" className="mb-1.5 block text-xs font-semibold text-[#475569]">
                  Professeur
                </label>
                <input
                  id="pt-search-prof"
                  type="search"
                  autoComplete="off"
                  placeholder="Rechercher un professeur…"
                  value={pointageSearchInput}
                  onChange={(e) => setPointageSearchInput(e.target.value)}
                  disabled={loading || refreshing}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] shadow-sm placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                />
              </div>
              <div className="w-full min-w-0 sm:w-auto sm:min-w-[160px]">
                <label htmlFor="pt-statut" className="mb-1.5 block text-xs font-semibold text-[#475569]">
                  Statut
                </label>
                <select
                  id="pt-statut"
                  value={pointageStatut}
                  onChange={(e) => setPointageStatut(e.target.value)}
                  disabled={loading || refreshing}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                >
                  <option value="">Tous</option>
                  <option value="PRESENTE">Présent</option>
                  <option value="ABSENTE">Absent</option>
                  <option value="RETARD">Annulé / retard</option>
                </select>
              </div>
              <div className="w-full min-w-0 sm:w-auto sm:min-w-[160px]">
                <label htmlFor="pt-reglement" className="mb-1.5 block text-xs font-semibold text-[#475569]">
                  Règlement
                </label>
                <select
                  id="pt-reglement"
                  value={pointageReglement}
                  onChange={(e) => setPointageReglement(e.target.value)}
                  disabled={loading || refreshing}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
                >
                  <option value="">Tous</option>
                  <option value="pending">En attente</option>
                  <option value="paid">Payé</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Synthèse heures">
            <article className="rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white px-4 py-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-900/75">
                Heures effectuées (pointées)
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-950">
                {loading && pointages.length === 0
                  ? "…"
                  : pointageSummary?.heures_realisees != null && pointageSummary.heures_realisees !== ""
                    ? `${formatHeures(pointageSummary.heures_realisees)} h`
                    : "—"}
              </p>
              <p className="mt-1 text-xs text-emerald-900/65">Séances pointées « Présent » sur la période filtrée.</p>
            </article>
            <article className="rounded-xl border border-sky-200/90 bg-gradient-to-br from-sky-50 to-white px-4 py-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-sky-900/75">
                Heures programmées (emploi du temps)
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-950">
                {loading && pointages.length === 0
                  ? "…"
                  : pointageSummary?.heures_theoriques != null && pointageSummary.heures_theoriques !== ""
                    ? `${formatHeures(pointageSummary.heures_theoriques)} h`
                    : "—"}
              </p>
              <p className="mt-1 text-xs text-sky-900/65">Total des heures prévues dans cette période.</p>
            </article>
            <article className="rounded-xl border border-orange-200/90 bg-gradient-to-br from-orange-50 to-white px-4 py-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-orange-900/75">
                Taux de présence / statut
              </p>
              {loading && pointages.length === 0 ? (
                <p className="mt-2 text-2xl font-semibold tabular-nums text-orange-950">…</p>
              ) : pointageProjectionMode ? (
                <p className="mt-2">
                  <span className="inline-flex rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-900 ring-1 ring-violet-200/80">
                    Période à venir — projection
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-2xl font-semibold tabular-nums text-orange-950">
                  {formatPctTaux(pointageSummary?.taux_presence)}
                </p>
              )}
              <p className="mt-1 text-xs text-orange-900/65">
                {pointageProjectionMode
                  ? "Le taux s’affichera une fois la période entamée ou passée."
                  : "Heures pointées (présent) ÷ heures programmées (emploi du temps)."}
              </p>
            </article>
          </div>

          <div
            className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
            aria-labelledby="pointage-table-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-4">
              <h2 id="pointage-table-title" className="text-base font-semibold text-[#0f172a]">
                Historique des heures ({loading ? "…" : pointages.length})
              </h2>
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
              ) : loading && pointages.length === 0 ? (
                <div className="px-4 py-4">
                  <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
                </div>
              ) : pointages.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[#64748b]">
                  {pointageShowProgrammedHoursEmpty ? (
                    <p>
                      Aucun pointage enregistré pour cette période. Les heures programmées sont de{" "}
                      <span className="font-semibold tabular-nums text-[#0f172a]">
                        {formatHeures(pointageSummary?.heures_theoriques)} h
                      </span>
                      .
                    </p>
                  ) : (
                    <p>Aucune séance ne correspond aux filtres.</p>
                  )}
                </div>
              ) : (
                <table className="w-full min-w-0 border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-left">
                        Professeur
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                        Heures
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                        Statut
                      </th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                        Règlement
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-left">
                        Classe / remarque
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                    {currentPointages.map((row, index) => {
                      const isVirtualRow =
                        row.statut_presence === "A_VENIR" || String(row.id ?? "").startsWith("virtual_");
                      const isFuture = isPointageDateFuture(row.date_cours);
                      const showUpcoming = isVirtualRow || isFuture;
                      const rem = row.remarque?.trim() ?? "";
                      const classeLabel = row.classe_nom?.trim() ? row.classe_nom : "—";
                      return (
                        <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                          <td className="whitespace-nowrap px-4 py-3 text-[#475569]">{formatDateCourte(row.date_cours)}</td>
                          <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium`}>
                            {professeurDisplayName(row)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatHeures(row.nombre_heures)}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {showUpcoming ? upcomingStatusBadge() : presenceStatusBadge(row.statut_presence)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#475569]">
                            {showUpcoming ? (
                              <span className="text-slate-400">—</span>
                            ) : isAbsenceForReglement(row.statut_presence) ? (
                              reglementNotApplicableBadge()
                            ) : (
                              reglementBadge(row.est_paye)
                            )}
                          </td>
                          <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 align-top`}>
                            <div className="font-medium text-[#0f172a]">{classeLabel}</div>
                            {rem ? <div className="mt-0.5 text-xs text-[#94a3b8]">{rem}</div> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {!loading && pointages.length > 0 ? (
              <Pagination
                totalItems={pointages.length}
                itemsPerPage={itemsPerPage}
                currentPage={pointagePage}
                paginate={setPointagePage}
                itemLabel="lignes"
                className="border-[#e2e8f0] bg-[#fafbfc]/80"
              />
            ) : null}
          </div>
        </section>
      ) : showSalairesTab && effectiveTab === "salaires" ? (
        <GestionSalairesTab
          refreshNonce={refreshNonce}
          onToast={(t) => setPdfToast(t)}
          onFinancialChange={bumpRefresh}
        />
      ) : null}

      <ProfesseurModal
        open={profModalOpen}
        editProf={profEditRow}
        onClose={() => {
          setProfModalOpen(false);
          setProfEditRow(null);
        }}
        onSuccess={() => {
          setProfModalOpen(false);
          setProfEditRow(null);
          bumpRefresh();
        }}
      />

      <ProfesseurDetailsModal
        open={profDetailOpen}
        prof={profDetailRow}
        onClose={() => {
          setProfDetailOpen(false);
          setProfDetailRow(null);
        }}
      />

      <AvanceSalaireModal
        open={avanceProfOpen}
        professeur={avanceProfRow}
        personnel={null}
        onClose={() => {
          setAvanceProfOpen(false);
          setAvanceProfRow(null);
        }}
        onSuccess={() => {
          setPdfToast({ type: "success", message: "Avance enregistrée." });
          bumpRefresh();
        }}
      />

      <PaymentModal
        open={salairePayOpen}
        onClose={() => {
          setSalairePayOpen(false);
          setSalairePayProf(null);
          setSalairePayResume(null);
        }}
        professeur={salairePayProf}
        resume={salairePayResume}
        onToast={(t) => setPdfToast(t)}
        onSalaryReceiptPrint={setSalaryReceiptPrintPayload}
        onSuccess={() => {
          bumpRefresh();
        }}
      />

      <SalaryReceiptPrintHost payload={salaryReceiptPrintPayload} onDone={clearSalaryReceiptPrint} />

      <HistoriqueFichesModal
        open={historiquePaieOpen}
        onClose={() => {
          setHistoriquePaieOpen(false);
          setHistoriquePaieProf(null);
        }}
        professeur={historiquePaieProf}
        onToast={(t) => setPdfToast(t)}
      />

      {profManquantsModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prof-manquants-title"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) setProfManquantsModalOpen(false);
          }}
        >
          <div className="max-h-[min(90vh,560px)] w-full max-w-xl overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-xl">
            <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
              <h2 id="prof-manquants-title" className="text-base font-semibold text-[#0f172a]">
                Professeurs non encore pointés
              </h2>
              <p className="mt-0.5 text-xs text-[#64748b]">
                D&apos;après l&apos;emploi du temps — aujourd&apos;hui, créneau(x) sans pointage enregistré.
              </p>
            </div>
            <div className="max-h-[min(50vh,360px)] overflow-auto px-3 py-2">
              {profManquants.manquants.length === 0 ? (
                <p className="px-1 py-2 text-xs text-[#64748b]">Aucun enseignant à afficher.</p>
              ) : (
                <table className="w-full border-separate border-spacing-0 text-left text-xs">
                  <thead className="sticky top-0 z-[1] bg-white shadow-[0_1px_0_0_#e2e8f0]">
                    <tr>
                      <th className="whitespace-nowrap py-1.5 pl-0 pr-1.5 font-semibold text-[#334155]">Nom</th>
                      <th className="whitespace-nowrap py-1.5 pr-1.5 font-semibold text-[#334155]">Prénom</th>
                      <th className="whitespace-nowrap py-1.5 pr-1.5 font-semibold text-[#334155]">Heure de début</th>
                      <th className="w-[1%] py-1.5 pl-0.5 pr-0 text-right font-semibold text-[#334155]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#0f172a]">
                    {profManquants.manquants.map((m) => {
                      const can = m.professeur_id != null;
                      const h = m.heure_debut
                        ? String(m.heure_debut).length >= 5
                          ? `${String(m.heure_debut).slice(0, 2)}h${String(m.heure_debut).slice(3, 5)}`
                          : m.heure_debut
                        : "—";
                      return (
                        <tr
                          key={m.professeur_id ?? `${m.nom}-${m.prenom}`}
                          className="border-b border-[#f1f5f9] last:border-0"
                        >
                          <td className="py-1.5 pl-0 pr-1.5 font-medium align-middle">{m.nom || "—"}</td>
                          <td className="py-1.5 pr-1.5 align-middle text-[#334155]">{m.prenom || "—"}</td>
                          <td className="whitespace-nowrap py-1.5 pr-1.5 align-middle font-mono tabular-nums text-[#334155]">
                            {h}
                          </td>
                          <td className="py-1.5 pl-0.5 text-right align-middle">
                            <button
                              type="button"
                              disabled={!can}
                              onClick={() => openPointageModalForProfManquant(m)}
                              className="inline-flex items-center justify-center rounded border border-[#3b82f6] bg-white px-2 py-1 text-[11px] font-semibold leading-tight text-[#2563eb] shadow-sm transition hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Pointer maintenant
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-[#e2e8f0] bg-white px-3 py-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setProfManquantsModalOpen(false)}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#334155] shadow-sm transition hover:bg-[#f8fafc]"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PointageModal
        key={pointageModalMountKey}
        open={pointageModalOpen}
        initialProfesseur={pointageModalInitialProf}
        onClose={() => {
          setPointageModalOpen(false);
          setPointageModalInitialProf(null);
        }}
        onSuccess={() => {
          setPointageModalOpen(false);
          setPointageModalInitialProf(null);
          bumpRefresh();
        }}
      />

      {pdfToast ? (
        <div
          className={[
            "fixed bottom-4 right-4 z-[3000] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg",
            pdfToast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : pdfToast.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-red-200 bg-red-50 text-red-900",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          {pdfToast.message}
        </div>
      ) : null}
    </div>
  );
}
