import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Eye, Pencil, Printer, Search, Trash2 } from "lucide-react";

import AnnualProgressCell from "./components/AnnualProgressCell.jsx";
import EleveTarifTypeBadges, { TARIF_TYPE_FILTER_OPTIONS } from "./components/EleveTarifTypeBadges.jsx";
import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import EleveDetailsModal from "./components/EleveDetailsModal.jsx";
import PaiementModal from "./components/PaiementModal.jsx";
import PaymentReceiptPrintHost from "./components/PaymentReceiptPrintHost.jsx";
import Loading from "./components/ui/Loading.jsx";
import { Infobulle } from "./components/ui/Infobulle.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { useSettings } from "./context/SettingsContext.jsx";
import { formatMoisConcernesLabels } from "./constants/academicMonths.js";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import {
  filterClassesByNiveauSection,
  isTroncNiveau,
  NIVEAU_OPTIONS,
  SECTION_FILTER_OPTIONS,
} from "./constants/tunisianAcademic.js";
import { SCHOOL_NAME, schoolLogoPrintPublicUrl } from "./branding.js";
import { API_CLASSES, API_ELEVES, API_ELEVES_IMPAYES, API_PAIEMENTS, apiFetch } from "./config.js";
import { eleveTarifMensuelTotal } from "./utils/eleveFees.js";
import { eleveListeResteDisplay } from "./utils/eleveListeResteDisplay.js";
import { localISODate } from "./utils/dateLocal.js";
import { formatTnd } from "./utils/tunisianMoney.js";
import { generateRecuPaiement } from "./utils/pdfGenerator.js";

const METHODE_LABEL = {
  ESPECE: "Espèce",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
};

const TYPE_FRAIS_LABEL = {
  SCOLARITE: "Scolarité",
  INSCRIPTION: "Inscription",
  ETUDES: "Études",
  TRANSPORT: "Transport",
  AUTRE: "Autre",
};

function currentMonthInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMontant(value) {
  return formatTnd(value);
}

/** À partir des montants enregistrés sur la ligne : pas de valeurs négatives à l’écran. */
function parseMontantCell(v) {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function transactionResteEtAcompteLigne(montantDu, montantPaye) {
  const frais = parseMontantCell(montantDu);
  const paye = parseMontantCell(montantPaye);
  if (!Number.isFinite(frais) || !Number.isFinite(paye)) return null;
  const reste = Math.max(0, Math.round((frais - paye) * 100) / 100);
  const acompteLigne = Math.max(0, Math.round((paye - frais) * 100) / 100);
  return { frais, paye, reste, acompteLigne };
}

/** Dette annuelle globale de l’élève sur la ligne d’historique (API : eleve_reste_a_payer_annuel / eleve_snapshot). */
function historiqueResteAnnuelPaiement(row) {
  const raw = row?.eleve_reste_a_payer_annuel ?? row?.eleve_snapshot?.reste_a_payer_annuel;
  const n = parseMontantCell(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : null;
}

/**
 * Dette annuelle globale (solde sur l’année scolaire : frais totaux − encaissements).
 * Utilise `reste_a_payer_annuel` si l’API l’expose, sinon `reste_a_payer`, sinon calcul depuis totaux.
 */
function impayeResteAnnuel(row) {
  const annuelField = parseMontantCell(row?.reste_a_payer_annuel);
  if (Number.isFinite(annuelField)) return Math.max(0, Math.round(annuelField * 100) / 100);
  const fromApi = parseMontantCell(row?.reste_a_payer);
  if (Number.isFinite(fromApi)) return Math.max(0, Math.round(fromApi * 100) / 100);
  const total = parseMontantCell(row?.total_annuel_du);
  const paye = parseMontantCell(row?.total_paye);
  if (Number.isFinite(total) && Number.isFinite(paye)) {
    return Math.max(0, Math.round((total - paye) * 100) / 100);
  }
  return 0;
}

/** Crédit affichable (acompte ≥ 0) : priorité au champ persisté `acompte`, puis API dérivée, puis ancien nom `avoir`. */
function impayeCreditAcompte(row) {
  const signed = parseMontantCell(row?.acompte ?? row?.avoir);
  if (Number.isFinite(signed)) return Math.max(0, Math.round(signed * 100) / 100);
  const fromCredit = parseMontantCell(row?.credit_eleve);
  if (Number.isFinite(fromCredit)) return Math.max(0, Math.round(fromCredit * 100) / 100);
  return 0;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatMoisCell(row) {
  if (Array.isArray(row?.mois_concernes) && row.mois_concernes.length > 0) {
    return formatMoisConcernesLabels(row.mois_concernes);
  }
  return formatMoisConcerne(row?.mois_concerne);
}

/** mois_concerne : YYYY-MM-DD du backend → affichage mois/année */
function formatMoisConcerne(isoOrDate) {
  if (!isoOrDate) return "—";
  const s = String(isoOrDate);
  const day = s.length >= 10 ? s.slice(0, 10) : s;
  try {
    const [y, m] = day.split("-");
    if (y && m) {
      const d = new Date(Number(y), Number(m) - 1, 1);
      return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);
    }
  } catch {
    /* fall through */
  }
  return day;
}

function formatParentPhones(e) {
  const parts = [e.telephone_1, e.telephone_2].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function sumMontantPayePaiementRows(rows) {
  return rows.reduce((acc, r) => {
    const v = parseMontantCell(r?.montant_paye);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

function parentTelHref(row) {
  if (row.telephone_1) return `tel:${row.telephone_1}`;
  if (row.telephone_2) return `tel:${row.telephone_2}`;
  return null;
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
        <span className="font-semibold tabular-nums text-slate-900">{formatTnd(solde)}</span>
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

const tabBtnClass = (active) =>
  [
    "rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
    active
      ? "bg-[#0f172a] text-white shadow-sm"
      : "bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#0f172a]",
  ].join(" ");

const debtSegmentClass = (active) =>
  [
    "flex-1 rounded-md px-3 py-2 text-xs font-semibold transition sm:flex-none sm:px-4",
    active
      ? "bg-white text-[#0f172a] shadow-sm ring-1 ring-[#e2e8f0]"
      : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]",
  ].join(" ");

/**
 * Historique des encaissements, impayés par mois, et saisie d’un nouveau paiement.
 */
export default function PaiementsPage() {
  const { itemsPerPage } = useSettings();
  const [tab, setTab] = useState("liste");

  const [searchQuery, setSearchQuery] = useState("");
  /** Période d’encaissement (YYYY-MM-DD) — filtre API historique */
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());
  /** 'all' | 'debt' — filtre rapide sur la présence de dette */
  const [debtFilter, setDebtFilter] = useState("all");
  /** Tranche de progression annuelle (élève) — filtre API historique */
  const [progressionFilter, setProgressionFilter] = useState("");

  const [paiements, setPaiements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const isFirstLoad = useRef(true);

  const [impayeMonth, setImpayeMonth] = useState(currentMonthInputValue);
  const [impayes, setImpayes] = useState([]);
  const [impayesComptage, setImpayesComptage] = useState(null);
  const [impayesLoading, setImpayesLoading] = useState(false);
  const [impayesError, setImpayesError] = useState("");
  const [impayesNonce, setImpayesNonce] = useState(0);
  const [impayesSearchDebounced, setImpayesSearchDebounced] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  /** null | { eleve, moisConcerne } — préremplissage depuis « Encaisser » */
  const [paymentModalPreset, setPaymentModalPreset] = useState(null);
  const [paymentModalMode, setPaymentModalMode] = useState("create");
  const [editingPayment, setEditingPayment] = useState(null);
  /** Fiche élève depuis l’onglet liste — verrou du champ Élève + snapshot GET pour PaiementModal */
  const [listeEleveDetailsId, setListeEleveDetailsId] = useState(null);
  const [paymentModalLockEleve, setPaymentModalLockEleve] = useState(false);
  const [paymentModalPrefetchedDetail, setPaymentModalPrefetchedDetail] = useState(null);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(null);

  const [pageHistorique, setPageHistorique] = useState(1);
  const [pageImpayes, setPageImpayes] = useState(1);
  const [pageListeEleves, setPageListeEleves] = useState(1);

  /** Onglet « Liste des élèves » — mêmes filtres API que la page Élèves */
  const [listeNiveau, setListeNiveau] = useState("");
  const [listeClasse, setListeClasse] = useState("");
  const [listeSection, setListeSection] = useState("");
  /** Filtre API `tarif_type` (Encaissement rapide) */
  const [listeTarifType, setListeTarifType] = useState("");
  const [classeRecords, setClasseRecords] = useState([]);
  const [elevesListe, setElevesListe] = useState([]);
  const [elevesListeLoading, setElevesListeLoading] = useState(true);
  const [elevesListeError, setElevesListeError] = useState("");
  const [elevesListeNonce, setElevesListeNonce] = useState(0);
  const isFirstElevesListeLoad = useRef(true);

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
  }, []);

  const listeFilteredClasseNames = useMemo(() => {
    if (!listeNiveau) {
      return [...new Set(classeRecords.map((c) => c.nom).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "fr"),
      );
    }
    const filtered = filterClassesByNiveauSection(classeRecords, listeNiveau, listeSection);
    return [...new Set(filtered.map((c) => c.nom).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  }, [classeRecords, listeNiveau, listeSection]);

  const listeNiveauForSectionUi = useMemo(() => {
    if (listeNiveau) return listeNiveau;
    if (!listeClasse) return "";
    return classeRecords.find((c) => c.nom === listeClasse)?.niveau ?? "";
  }, [listeNiveau, listeClasse, classeRecords]);

  const listeShowSectionFilter = !listeNiveauForSectionUi || !isTroncNiveau(listeNiveauForSectionUi);
  const listeHasNoClassesForFilter = Boolean(listeNiveau && listeFilteredClasseNames.length === 0);

  useEffect(() => {
    setListeClasse("");
  }, [listeNiveau]);

  useEffect(() => {
    if (!listeNiveau || isTroncNiveau(listeNiveau)) return;
    setListeClasse("");
  }, [listeSection, listeNiveau]);

  useEffect(() => {
    if (listeNiveauForSectionUi && isTroncNiveau(listeNiveauForSectionUi)) setListeSection("");
  }, [listeNiveauForSectionUi]);

  useEffect(() => {
    if (!listeClasse) return;
    if (!listeNiveau) return;
    if (!listeFilteredClasseNames.includes(listeClasse)) setListeClasse("");
  }, [listeNiveau, listeFilteredClasseNames, listeClasse]);

  useEffect(() => {
    if (tab !== "liste") return;
    let cancelled = false;

    async function load() {
      const first = isFirstElevesListeLoad.current;
      if (first) setElevesListeLoading(true);
      setElevesListeError("");
      try {
        const params = new URLSearchParams();
        const q = searchQuery.trim();
        if (q) params.set("search", q);
        if (listeNiveau) params.set("niveau", listeNiveau);
        if (listeClasse) params.set("classe", listeClasse);
        const troncListe =
          (listeNiveau && isTroncNiveau(listeNiveau)) ||
          (!listeNiveau &&
            listeClasse &&
            (() => {
              const n = classeRecords.find((c) => c.nom === listeClasse)?.niveau;
              return n && isTroncNiveau(n);
            })());
        if (troncListe) {
          params.set("section", "");
        } else if (listeSection) {
          params.set("section", listeSection);
        }
        if (listeTarifType) {
          params.set("tarif_type", listeTarifType);
        }
        const qs = params.toString();
        const url = qs ? `${API_ELEVES}?${qs}` : API_ELEVES;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let list = Array.isArray(data) ? data : data.results ?? [];
        if (troncListe) {
          list = list.filter((e) => String(e.section ?? "").trim() === "");
        }
        if (!cancelled) setElevesListe(list);
      } catch {
        if (!cancelled) {
          setElevesListe([]);
          setElevesListeError("Impossible de charger les élèves.");
        }
      } finally {
        if (!cancelled) {
          setElevesListeLoading(false);
          isFirstElevesListeLoad.current = false;
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tab, searchQuery, listeNiveau, listeClasse, listeSection, listeTarifType, classeRecords, elevesListeNonce]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const first = isFirstLoad.current;
      if (first) setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const params = new URLSearchParams();
        const q = searchQuery.trim();
        if (q) params.set("search", q);
        if (debtFilter === "debt") params.set("debt_only", "true");
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
        if (progressionFilter) params.set("progression_range", progressionFilter);
        const qs = params.toString();
        const url = qs ? `${API_PAIEMENTS}?${qs}` : API_PAIEMENTS;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.results ?? [];
        if (!cancelled) setPaiements(list);
      } catch {
        if (!cancelled) {
          setPaiements([]);
          setError("Impossible de charger les paiements.");
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
  }, [refreshNonce, searchQuery, startDate, endDate, debtFilter, progressionFilter]);

  useEffect(() => {
    if (tab !== "impayes") return;
    setImpayesSearchDebounced(searchQuery.trim());
  }, [tab]);

  useEffect(() => {
    if (tab !== "impayes") return;
    const t = setTimeout(() => setImpayesSearchDebounced(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery, tab]);

  useEffect(() => {
    if (tab !== "impayes") return;
    let cancelled = false;

    async function loadImpayes() {
      setImpayesLoading(true);
      setImpayesError("");
      try {
        const [yStr, mStr] = impayeMonth.split("-");
        const annee = Number(yStr);
        const mois = Number(mStr);
        if (!Number.isFinite(annee) || !Number.isFinite(mois)) {
          throw new Error("Mois invalide");
        }
        const params = new URLSearchParams({ mois: String(mois), annee: String(annee) });
        if (impayesSearchDebounced) params.set("search", impayesSearchDebounced);
        if (debtFilter === "debt") params.set("debt_only", "true");
        const res = await apiFetch(`${API_ELEVES_IMPAYES}?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          if (!cancelled) {
            setImpayes(data);
            setImpayesComptage(null);
          }
        } else {
          const list = data.eleves ?? data.results ?? [];
          if (!cancelled) {
            setImpayes(Array.isArray(list) ? list : []);
            setImpayesComptage(
              data.comptage
                ? {
                    retardataires_tous: Number(data.comptage.retardataires_tous) || 0,
                    exclus_gratuits: Number(data.comptage.exclus_gratuits) || 0,
                    exclus_conventionnes: Number(data.comptage.exclus_conventionnes) || 0,
                    vrais_impayes: Number(data.comptage.vrais_impayes) || 0,
                  }
                : null,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setImpayes([]);
          setImpayesComptage(null);
          setImpayesError("Impossible de charger les impayés.");
        }
      } finally {
        if (!cancelled) setImpayesLoading(false);
      }
    }

    loadImpayes();
    return () => {
      cancelled = true;
    };
  }, [tab, impayeMonth, impayesNonce, impayesSearchDebounced, debtFilter]);

  const clearReceiptAutoPrint = useCallback(() => setReceiptAutoPrint(null), []);

  function handleModalSuccess(receiptPayload) {
    setModalOpen(false);
    setPaymentModalPreset(null);
    setEditingPayment(null);
    setPaymentModalMode("create");
    setPaymentModalLockEleve(false);
    setPaymentModalPrefetchedDetail(null);
    setRefreshNonce((n) => n + 1);
    setImpayesNonce((n) => n + 1);
    setElevesListeNonce((n) => n + 1);
    if (receiptPayload) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setReceiptAutoPrint(receiptPayload));
      });
    }
  }

  function openNewEncaissement() {
    setPaymentModalMode("create");
    setEditingPayment(null);
    setPaymentModalPreset(null);
    setPaymentModalLockEleve(false);
    setPaymentModalPrefetchedDetail(null);
    setModalOpen(true);
  }

  function openEncaissementForEleve(eleve, moisConcerne) {
    setPaymentModalMode("create");
    setEditingPayment(null);
    setPaymentModalLockEleve(false);
    setPaymentModalPrefetchedDetail(null);
    setPaymentModalPreset({ eleve, moisConcerne });
    setModalOpen(true);
  }

  /** Depuis EleveDetailsModal : fermer la fiche puis ouvrir l’encaissement avec élève figé. */
  function openEncaissementFromEleveFiche(eleveDetailFromApi) {
    if (!eleveDetailFromApi?.id) return;
    setListeEleveDetailsId(null);
    setPaymentModalLockEleve(true);
    setPaymentModalPrefetchedDetail(eleveDetailFromApi);
    setPaymentModalMode("create");
    setEditingPayment(null);
    setPaymentModalPreset({
      eleve: eleveDetailFromApi,
      moisConcerne: currentMonthInputValue(),
    });
    setModalOpen(true);
  }

  function openEncaissementFor(eleve) {
    openEncaissementForEleve(eleve, impayeMonth);
  }

  function openEditPayment(row) {
    setPaymentModalMode("edit");
    setEditingPayment(row);
    setPaymentModalPreset(null);
    setPaymentModalLockEleve(false);
    setPaymentModalPrefetchedDetail(null);
    setModalOpen(true);
  }

  async function handleDeletePayment(row) {
    const label = `${row.eleve_nom ?? ""} ${row.eleve_prenom ?? ""}`.trim();
    if (
      !window.confirm(
        `Supprimer définitivement cet encaissement${label ? ` pour ${label}` : ""} ? Les soldes de l’élève seront recalculés.`,
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch(`${API_PAIEMENTS}${row.id}/`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
        } catch {
          /* ignore */
        }
        window.alert(msg);
        return;
      }
      setRefreshNonce((n) => n + 1);
      setImpayesNonce((n) => n + 1);
      if (row.eleve != null && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("school-eleve-finances-changed", { detail: { eleveId: row.eleve } }),
        );
      }
    } catch {
      window.alert("Suppression impossible (réseau ou serveur).");
    }
  }

  function closeModal() {
    setModalOpen(false);
    setPaymentModalPreset(null);
    setEditingPayment(null);
    setPaymentModalMode("create");
    setPaymentModalLockEleve(false);
    setPaymentModalPrefetchedDetail(null);
  }

  function clearFilters() {
    setSearchQuery("");
    setDebtFilter("all");
    setProgressionFilter("");
  }

  function clearListeElevesFilters() {
    setSearchQuery("");
    setListeNiveau("");
    setListeClasse("");
    setListeSection("");
    setListeTarifType("");
  }

  function clearDateFilters() {
    setStartDate("");
    setEndDate("");
  }

  /** Historique : filtrage nom / prénom / téléphone / dette / dates via l’API */
  const filteredPaiements = paiements;

  /** Filtres recherche / dette appliqués côté API pour cohérence avec les agrégats comptables. */
  const filteredImpayes = impayes;

  const sortedImpayes = useMemo(() => {
    return [...filteredImpayes].sort(
      (a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }),
    );
  }, [filteredImpayes]);

  const impayesComptageDisplay = useMemo(() => {
    if (impayesComptage) return impayesComptage;
    return {
      retardataires_tous: filteredImpayes.length,
      exclus_gratuits: 0,
      exclus_conventionnes: 0,
      vrais_impayes: filteredImpayes.length,
    };
  }, [impayesComptage, filteredImpayes.length]);

  const histLast = pageHistorique * itemsPerPage;
  const histFirst = histLast - itemsPerPage;
  const currentHistorique = useMemo(
    () => filteredPaiements.slice(histFirst, histLast),
    [filteredPaiements, histFirst, histLast],
  );

  /** En impression : toutes les lignes filtrées (total = cohérent avec le relevé). */
  const [printHistoriqueFull, setPrintHistoriqueFull] = useState(false);
  useEffect(() => {
    const onBefore = () => setPrintHistoriqueFull(true);
    const onAfter = () => setPrintHistoriqueFull(false);
    if (typeof window === "undefined") return undefined;
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const historiqueTableRows = printHistoriqueFull ? filteredPaiements : currentHistorique;

  const totalMontantPayeHistorique = useMemo(
    () => sumMontantPayePaiementRows(filteredPaiements),
    [filteredPaiements],
  );

  const impLast = pageImpayes * itemsPerPage;
  const impFirst = impLast - itemsPerPage;
  const currentImpayes = useMemo(
    () => sortedImpayes.slice(impFirst, impLast),
    [sortedImpayes, impFirst, impLast],
  );

  const listeLast = pageListeEleves * itemsPerPage;
  const listeFirst = listeLast - itemsPerPage;
  const currentListeEleves = useMemo(
    () => elevesListe.slice(listeFirst, listeLast),
    [elevesListe, listeFirst, listeLast],
  );

  const listeElevesTarifCounts = useMemo(() => {
    let gratuits = 0;
    let conventionnes = 0;
    for (const e of elevesListe) {
      if (e.is_gratuit) gratuits += 1;
      else if (e.is_convention) conventionnes += 1;
    }
    return { gratuits, conventionnes, total: elevesListe.length };
  }, [elevesListe]);

  useEffect(() => {
    setPageHistorique(1);
  }, [searchQuery, debtFilter, startDate, endDate, progressionFilter]);

  useEffect(() => {
    setPageImpayes(1);
  }, [impayesSearchDebounced, debtFilter, impayeMonth]);

  useEffect(() => {
    setPageListeEleves(1);
  }, [searchQuery, listeNiveau, listeClasse, listeSection, listeTarifType]);

  useEffect(() => {
    const total = filteredPaiements.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (pageHistorique > lastPage) setPageHistorique(lastPage);
  }, [filteredPaiements.length, pageHistorique, itemsPerPage]);

  useEffect(() => {
    const total = sortedImpayes.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (pageImpayes > lastPage) setPageImpayes(lastPage);
  }, [sortedImpayes.length, pageImpayes, itemsPerPage]);

  useEffect(() => {
    const total = elevesListe.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (pageListeEleves > lastPage) setPageListeEleves(lastPage);
  }, [elevesListe.length, pageListeEleves, itemsPerPage]);

  const listeElevesToolbar = (
    <section
      className="w-full rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] print:hidden"
      aria-label="Filtres liste des élèves"
    >
      <div className="grid gap-4 md:grid-cols-12 md:items-end">
        <div className="md:col-span-3">
          <label
            htmlFor="paiements-liste-search"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
          >
            Recherche
          </label>
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <input
              id="paiements-liste-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Nom, Prénom, Téléphone…"
              autoComplete="off"
              className="w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-2.5 pl-10 pr-3 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            />
          </div>
        </div>
        <div className="md:col-span-2">
          <label
            htmlFor="paiements-liste-niveau"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
          >
            Niveau
          </label>
          <select
            id="paiements-liste-niveau"
            value={listeNiveau}
            onChange={(e) => {
              const v = e.target.value;
              setListeNiveau(v);
              if (v && isTroncNiveau(v)) setListeSection("");
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
        <div className={listeShowSectionFilter ? "md:col-span-2" : "md:col-span-4"}>
          <label
            htmlFor="paiements-liste-classe"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
          >
            Classe
          </label>
          <select
            id="paiements-liste-classe"
            value={listeHasNoClassesForFilter ? "" : listeClasse}
            onChange={(e) => setListeClasse(e.target.value)}
            disabled={listeHasNoClassesForFilter}
            className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {listeHasNoClassesForFilter ? (
              <option value="">Aucune classe disponible</option>
            ) : (
              <>
                <option value="">Toutes les classes</option>
                {listeFilteredClasseNames.map((nom) => (
                  <option key={nom} value={nom}>
                    {nom}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
        {listeShowSectionFilter ? (
          <div className="md:col-span-2">
            <label
              htmlFor="paiements-liste-section"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
            >
              Section
            </label>
            <select
              id="paiements-liste-section"
              value={listeSection}
              onChange={(e) => setListeSection(e.target.value)}
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
          <label
            htmlFor="paiements-liste-tarif-type"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
          >
            Type de tarif
          </label>
          <select
            id="paiements-liste-tarif-type"
            value={listeTarifType}
            onChange={(e) => setListeTarifType(e.target.value)}
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
      <div className="mt-3 flex justify-end border-t border-[#eef2f6] pt-3">
        <button
          type="button"
          onClick={clearListeElevesFilters}
          disabled={
            searchQuery.trim() === "" && !listeNiveau && !listeClasse && !listeSection && !listeTarifType
          }
          className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Effacer les filtres
        </button>
      </div>
    </section>
  );

  const searchToolbar = (
    <div className="w-full rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)] print:hidden sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
        <div className="w-full min-w-0 flex-1">
          <label htmlFor="paiements-search" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
            Recherche
          </label>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
                aria-hidden
              />
              <input
                id="paiements-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher (Nom, Prénom, Téléphone)..."
                autoComplete="off"
                className="w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-2.5 pl-10 pr-3 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
              />
            </div>
            <button
              type="button"
              onClick={clearFilters}
              disabled={searchQuery.trim() === "" && debtFilter === "all" && !progressionFilter}
              className="shrink-0 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Effacer
            </button>
          </div>
        </div>
        <div className="w-full min-w-0 sm:max-w-[220px]">
          <label
            htmlFor="paiements-progression"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
          >
            Progression
          </label>
          <select
            id="paiements-progression"
            value={progressionFilter}
            onChange={(e) => setProgressionFilter(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-2.5 pl-3 pr-3 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
          >
            <option value="">Tous les niveaux</option>
            <option value="0-20">De 0% à 20%</option>
            <option value="20-40">De 20% à 40%</option>
            <option value="40-60">De 40% à 60%</option>
            <option value="60-80">De 60% à 80%</option>
            <option value="80-100">De 80% à 100%</option>
          </select>
        </div>
        <div className="w-full shrink-0 lg:max-w-md">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Filtre dette</p>
          <div className="flex w-full rounded-lg bg-[#f1f5f9] p-1">
            <button
              type="button"
              className={debtSegmentClass(debtFilter === "all")}
              aria-pressed={debtFilter === "all"}
              onClick={() => setDebtFilter("all")}
            >
              Tous
            </button>
            <button
              type="button"
              className={debtSegmentClass(debtFilter === "debt")}
              aria-pressed={debtFilter === "debt"}
              onClick={() => setDebtFilter("debt")}
            >
              Dette &gt; 0
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-[#eef2f6] pt-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full min-w-0 sm:max-w-md sm:flex-1">
          <DateRangePickerCustom
            id="paiements-periode"
            label="Période (date d’encaissement)"
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: s, endDate: e }) => {
              setStartDate(s);
              setEndDate(e);
            }}
            allowEmpty
          />
        </div>
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
          <button
            type="button"
            onClick={clearDateFilters}
            disabled={!startDate && !endDate}
            className="w-full rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="paiements-print-root w-full min-w-0 space-y-6 print:max-w-none print:overflow-visible">
      <header className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Paiements</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#64748b]">
            Encaissements, historique et suivi des familles en retard.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewEncaissement}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
        >
          Nouvel encaissement
        </button>
      </header>

      <div
        className="flex flex-wrap gap-2 rounded-xl border border-[#e2e8f0] bg-white p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] print:hidden"
        role="tablist"
        aria-label="Sections paiements"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "liste"}
          className={tabBtnClass(tab === "liste")}
          onClick={() => setTab("liste")}
        >
          Liste des élèves
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "historique"}
          className={tabBtnClass(tab === "historique")}
          onClick={() => setTab("historique")}
        >
          Historique des paiements
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "impayes"}
          className={tabBtnClass(tab === "impayes")}
          onClick={() => setTab("impayes")}
        >
          Élèves en impayé
        </button>
      </div>

      {tab === "liste" ? listeElevesToolbar : searchToolbar}

      {tab === "liste" ? (
        <section
          className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          aria-labelledby="paiements-liste-eleves-title"
        >
          <div className="flex flex-col gap-2 border-b border-[#e2e8f0] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <h2 id="paiements-liste-eleves-title" className="text-base font-semibold text-[#0f172a]">
              Encaissement rapide ({elevesListeLoading ? "…" : elevesListe.length})
            </h2>
            <div className="flex min-w-0 flex-col gap-1 text-right sm:items-end">
              <p className="max-w-md text-left text-xs text-[#64748b] sm:text-right">
                Sélectionnez un élève puis validez le mois dans le formulaire d&apos;encaissement.
              </p>
              {!elevesListeLoading && elevesListe.length > 0 ? (
                <p className="text-sm text-[#64748b]" aria-live="polite">
                  Total : {listeElevesTarifCounts.total} élèves (dont {listeElevesTarifCounts.gratuits} gratuit
                  {listeElevesTarifCounts.gratuits !== 1 ? "s" : ""} et {listeElevesTarifCounts.conventionnes}{" "}
                  conventionné
                  {listeElevesTarifCounts.conventionnes !== 1 ? "s" : ""})
                </p>
              ) : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            {elevesListeError && !elevesListeLoading ? (
              <p className="px-4 py-10 text-center text-sm text-red-600" role="alert">
                {elevesListeError}
              </p>
            ) : elevesListeLoading && elevesListe.length === 0 ? (
              <div className="px-4 py-4">
                <Loading message="Chargement des élèves…" className="min-h-[200px] py-6" />
              </div>
            ) : elevesListe.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64748b]">
                Aucun élève ne correspond aux critères.
              </p>
            ) : (
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Nom / Prénom
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Classe
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Tarif
                    </th>
                    <th scope="col" className="min-w-[7rem] whitespace-nowrap px-4 py-3.5 text-right">
                      Reste à payer
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Progression
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                  {currentListeEleves.map((row, index) => {
                    const resteListe = eleveListeResteDisplay(row, formatMontant);
                    return (
                    <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>
                        <span className="font-medium">
                          {row.nom} {row.prenom}
                        </span>
                        <EleveTarifTypeBadges is_gratuit={row.is_gratuit} is_convention={row.is_convention} />
                      </td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.classe || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                        {formatMontant(row.tarif_mensuel)}
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
                        <button
                          type="button"
                          onClick={() => setListeEleveDetailsId(row.id)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm transition hover:border-[#93c5fd] hover:bg-[#eff6ff] hover:text-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
                          title="Voir la fiche élève"
                        >
                          <Eye className="h-4 w-4 shrink-0" aria-hidden />
                          Voir
                        </button>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {!elevesListeLoading && elevesListe.length > 0 ? (
            <Pagination
              totalItems={elevesListe.length}
              itemsPerPage={itemsPerPage}
              currentPage={pageListeEleves}
              paginate={setPageListeEleves}
              itemLabel="élèves"
              className="border-[#e2e8f0] bg-[#fafbfc]/80"
            />
          ) : null}
        </section>
      ) : null}

      {tab === "historique" ? (
        <section
          className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] print:m-0 print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-slate-300 print:shadow-none"
          aria-labelledby="paiements-table-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-4 print:hidden">
            <h2 id="paiements-table-title" className="text-base font-semibold text-[#0f172a]">
              Historique ({loading ? "…" : filteredPaiements.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-semibold text-[#475569] shadow-sm transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2"
              >
                <Printer className="h-4 w-4 shrink-0" aria-hidden />
                Imprimer l&apos;historique
              </button>
              {refreshing ? (
                <span className="text-xs font-medium text-[#64748b]" aria-live="polite">
                  Mise à jour…
                </span>
              ) : null}
            </div>
          </div>

          <div className={`w-full print:m-0 print:w-full print:max-w-none print:p-0 print:overflow-visible ${refreshing ? "overflow-x-auto opacity-70 transition-opacity" : "overflow-x-auto"}`}>
            {error && !loading ? (
              <p className="px-4 py-10 text-center text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : loading && paiements.length === 0 ? (
              <div className="px-4 py-4">
                <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
              </div>
            ) : paiements.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64748b]">Aucun encaissement enregistré.</p>
            ) : filteredPaiements.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64748b]" role="status">
                Aucun résultat pour ces critères — modifiez la recherche ou le filtre dette.
              </p>
            ) : (
              <>
                <div className="hidden px-4 print:mb-8 print:flex print:w-full print:items-center print:justify-between print:border-b print:border-slate-300 print:px-0 print:pb-4">
                  <div className="print:flex print:items-center print:gap-4">
                    <img
                      src={schoolLogoPrintPublicUrl()}
                      alt="SAMAH SCHOOL Logo"
                      className="h-16 w-auto max-w-[200px] object-contain"
                      width={64}
                      height={64}
                    />
                    <p className="text-2xl font-bold leading-tight text-[#0f172a]">{SCHOOL_NAME}</p>
                  </div>
                  <p className="shrink-0 text-right text-sm text-slate-600">
                    Date d&apos;impression :{" "}
                    {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}
                  </p>
                </div>
                <h2 className="mb-3 hidden px-4 text-center text-lg font-bold tracking-tight text-[#0f172a] print:mb-4 print:block print:px-0 print:text-xl">
                  Historique des encaissements
                </h2>
              <table className="w-full min-w-0 border-collapse text-left text-sm print:w-full">
                <thead>
                  <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b] print:bg-white print:text-slate-800">
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Élève
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Classe
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Type de frais
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Mois concernés
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Frais exigés
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Montant payé
                    </th>
                    <th scope="col" className="max-w-[150px] px-4 py-3.5 text-right leading-tight">
                      Reste à payer (annuel)
                      <span className="mt-0.5 block font-normal normal-case text-[10px] text-[#94a3b8]">
                        (solde global après encaissements)
                      </span>
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Acompte (ligne)
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                      Méthode
                    </th>
                    <th scope="col" className="w-[8.5rem] min-w-[7rem] px-4 py-3.5 text-left">
                      Progression
                    </th>
                    <th scope="col" className="min-w-[10.5rem] whitespace-nowrap px-4 py-3.5 text-right print:hidden">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f6] text-[#0f172a] print:divide-slate-200">
                  {historiqueTableRows.map((row, index) => {
                    const ligneBal = transactionResteEtAcompteLigne(row.montant_du, row.montant_paye);
                    const resteAnnuelGlobal = historiqueResteAnnuelPaiement(row);
                    return (
                    <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#475569]">
                        {formatDateTime(row.date_encaissement)}
                      </td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>
                        <span className="font-medium">
                          {row.eleve_nom ?? "—"} {row.eleve_prenom ?? ""}
                        </span>
                      </td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.eleve_classe ?? "—"}</td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-[#475569]`}>
                        {TYPE_FRAIS_LABEL[row.type_frais] ?? row.type_frais ?? "—"}
                      </td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 capitalize text-[#475569]`}>
                        {formatMoisCell(row)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[#475569]">
                        {formatMontant(row.montant_du)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-[#0f172a]">
                        {formatMontant(row.montant_paye)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                        {resteAnnuelGlobal == null ? (
                          "—"
                        ) : resteAnnuelGlobal > 0.005 ? (
                          <span className="text-red-600">{formatMontant(resteAnnuelGlobal)}</span>
                        ) : (
                          <span className="text-[#64748b]">{formatMontant(0)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                        {!ligneBal ? (
                          "—"
                        ) : ligneBal.acompteLigne > 0.005 ? (
                          <span className="text-emerald-700">{formatMontant(ligneBal.acompteLigne)}</span>
                        ) : (
                          <span className="text-[#64748b]">{formatMontant(0)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded-md bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#15803d]">
                          {METHODE_LABEL[row.methode] ?? row.methode ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <AnnualProgressCell value={row.progression_annuelle} />
                      </td>
                      <td className="print:hidden whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1 print:hidden">
                          <button
                            type="button"
                            onClick={() => openEditPayment(row)}
                            className="inline-flex rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#475569] transition hover:border-[#93c5fd] hover:bg-[#eff6ff] hover:text-[#1d4ed8] print:hidden"
                            title="Modifier l’encaissement"
                            aria-label={`Modifier l’encaissement — ${row.eleve_nom ?? ""} ${row.eleve_prenom ?? ""}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(row)}
                            className="inline-flex rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#475569] transition hover:border-[#fecaca] hover:bg-red-50 hover:text-[#b91c1c] print:hidden"
                            title="Supprimer l’encaissement"
                            aria-label={`Supprimer l’encaissement — ${row.eleve_nom ?? ""} ${row.eleve_prenom ?? ""}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateRecuPaiement(row)}
                            className="inline-flex rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#475569] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#0f172a] print:hidden"
                            title="Imprimer le reçu (PDF)"
                            aria-label={`Imprimer le reçu PDF pour ${row.eleve_nom ?? ""} ${row.eleve_prenom ?? ""}`}
                          >
                            <Printer className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <div
                className="flex justify-end border-t border-slate-200 bg-slate-50/80 px-4 py-4 print:block print:w-full print:border-slate-300 print:bg-white print:py-4"
                role="region"
                aria-label="Synthèse des encaissements sur la période filtrée"
              >
                <p className="max-w-full text-right text-sm leading-relaxed text-[#334155]">
                  <span className="font-semibold text-[#0f172a]">Total encaissement pour cette période :</span>{" "}
                  <span className="text-xl font-bold tabular-nums text-green-700 print:text-xl">
                    {formatMontant(totalMontantPayeHistorique)}
                  </span>
                </p>
              </div>
              </>
            )}
          </div>
          {!loading && filteredPaiements.length > 0 ? (
            <Pagination
              totalItems={filteredPaiements.length}
              itemsPerPage={itemsPerPage}
              currentPage={pageHistorique}
              paginate={setPageHistorique}
              itemLabel="paiements"
              className="print:hidden border-[#e2e8f0] bg-[#fafbfc]/80"
            />
          ) : null}
        </section>
      ) : null}

      {tab === "impayes" ? (
        <section
          className="w-full min-w-0 overflow-hidden rounded-xl border-2 border-[#fdba74] bg-gradient-to-b from-[#fff7ed] to-[#ffedd5] shadow-[0_4px_14px_-4px_rgba(234,88,12,0.35)] print:overflow-visible"
          aria-labelledby="impayes-title"
        >
          <div className="flex flex-col gap-4 border-b border-[#fed7aa] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 id="impayes-title" className="text-base font-semibold text-[#9a3412]">
                Impayés pour la période sélectionnée
              </h2>
              <p className="mt-1 text-xs text-[#c2410c]">
                Élèves <span className="font-semibold">sans encaissement enregistré</span> pour le mois de référence,{" "}
                <span className="font-semibold">hors exonérés (gratuités) et conventionnés</span> : ils n’apparaissent
                pas dans le tableau afin d’isoler les retards de paiement à traiter. La colonne principale indique le{" "}
                <span className="font-semibold">reste à payer annuel</span> (tarif × 10 − encaissements) ; le détail
                regroupe l’échéance cumulée à date et l’éventuel acompte.
              </p>
              {!impayesLoading && !impayesError ? (
                <div className="mt-3 space-y-2 rounded-lg border border-[#fed7aa] bg-white/60 px-3 py-2.5 text-sm text-[#7c2d12]">
                  <p className="font-medium leading-snug text-[#9a3412]">
                    <span className="me-1">
                      Nombre d&apos;élèves en retard de paiement (Hors gratuités et conventions) :{" "}
                      <span className="tabular-nums font-bold text-[#c2410c]">
                        {impayesComptageDisplay.vrais_impayes}
                      </span>
                    </span>
                    <Infobulle
                      content="Ce chiffre exclut les élèves exonérés et les dossiers conventionnés (paiement en fin d’année)."
                      side="top"
                      touchStyle="plain"
                    >
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#fdba74] bg-[#fff7ed] text-[10px] font-bold text-[#9a3412] align-middle"
                        aria-label="Aide : périmètre du compteur"
                      >
                        i
                      </span>
                    </Infobulle>
                  </p>
                  {impayesComptage ? (
                    <p className="text-xs leading-relaxed text-[#9a3412]">
                      <span className="me-1 font-semibold text-[#7c2d12]">Vrais impayés :</span>
                      {impayesComptage.vrais_impayes} ·<span className="ms-1 font-semibold">Gratuits :</span>{" "}
                      {impayesComptage.exclus_gratuits} (échéance mois, non payée) ·
                      <span className="ms-1 font-semibold">Conventionnés :</span> {impayesComptage.exclus_conventionnes}{" "}
                      (échéance mois, non payée) ·<span className="ms-1 font-medium text-[#64748b]">Tous statuts (réf. mois) :</span>{" "}
                      {impayesComptage.retardataires_tous}
                    </p>
                  ) : null}
                  <p className="text-[11px] leading-snug text-[#9a3412]/85">Ce chiffre exclut exonérations et conventions.</p>
                  {debtFilter === "debt" && impayesComptage && impayesComptage.vrais_impayes > sortedImpayes.length ? (
                    <p className="text-[11px] font-medium text-[#b45309]" role="status">
                      Filtre « Dette &gt; 0 » : {sortedImpayes.length} affiché
                      {sortedImpayes.length !== 1 ? "s" : ""} sur {impayesComptage.vrais_impayes} vrai
                      {impayesComptage.vrais_impayes !== 1 ? "s" : ""} impayé{impayesComptage.vrais_impayes !== 1 ? "s" : ""} pour
                      cette période.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="shrink-0">
              <label htmlFor="impaye-mois" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#9a3412]">
                Mois de référence
              </label>
              <input
                id="impaye-mois"
                type="month"
                value={impayeMonth}
                onChange={(e) => setImpayeMonth(e.target.value)}
                className="rounded-lg border border-[#fdba74] bg-white px-3 py-2 text-sm font-medium text-[#7c2d12] shadow-sm focus:border-[#ea580c] focus:outline-none focus:ring-1 focus:ring-[#ea580c]"
              />
            </div>
          </div>

          <div className="overflow-x-auto print:overflow-visible">
            {impayesError && !impayesLoading ? (
              <p className="px-4 py-10 text-center text-sm text-red-700" role="alert">
                {impayesError}
              </p>
            ) : impayesLoading ? (
              <div className="px-4 py-4">
                <Loading message="Chargement des impayés…" className="min-h-[200px] py-6" />
              </div>
            ) : impayesComptage && impayesComptage.retardataires_tous === 0 && impayesSearchDebounced ? (
              <p className="px-4 py-10 text-center text-sm font-medium text-[#c2410c]" role="status">
                Aucun élève ne correspond à cette recherche pour le mois sélectionné.
              </p>
            ) : impayesComptage && impayesComptage.retardataires_tous === 0 ? (
              <p className="px-4 py-10 text-center text-sm font-medium text-[#c2410c]">
                Aucun élève n’est en retard de paiement pour ce mois : un encaissement est enregistré pour chaque
                dossier (tous types de tarif).
              </p>
            ) : impayesComptage && impayesComptage.vrais_impayes === 0 && impayesComptage.retardataires_tous > 0 ? (
              <p className="px-4 py-10 text-center text-sm font-medium text-[#c2410c]" role="status">
                Aucun « vrai » impayé pour ce mois : les seuls élèves sans encaissement enregistré pour la période sont
                en exonération totale (gratuit) ou en convention (paiement différé).
              </p>
            ) : impayes.length === 0 && debtFilter === "debt" && impayesComptage && impayesComptage.vrais_impayes > 0 ? (
              <p className="px-4 py-10 text-center text-sm font-medium text-[#c2410c]" role="status">
                Aucun vrai impayé n’a une dette annuelle &gt; 0 avec le filtre actuel. Retirez le filtre « Dette &gt; 0
                » pour voir l’ensemble des retards.
              </p>
            ) : impayes.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm font-medium text-[#c2410c]">
                {impayesComptage
                  ? "Aucune ligne à afficher."
                  : "Aucun impayé pour ce mois — toutes les familles concernées ont un encaissement enregistré."}
              </p>
            ) : (
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#ffedd5] text-[11px] font-semibold uppercase tracking-wide text-[#9a3412]">
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Élève
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Classe
                    </th>
                    <th scope="col" className="px-4 py-3.5 text-left">
                      Téléphones (parents)
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      Tarif mensuel
                    </th>
                    <th scope="col" className="max-w-[140px] px-4 py-3.5 text-right leading-tight">
                      Reste à payer (annuel)
                      <span className="mt-0.5 block font-normal normal-case text-[10px] text-[#9a3412]/90">
                        (tarif × 10 − total payé)
                      </span>
                    </th>
                    <th scope="col" className="max-w-[180px] px-4 py-3.5 text-right leading-tight">
                      À date &amp; acompte
                      <span className="mt-0.5 block font-normal normal-case text-[10px] text-[#9a3412]/90">
                        (échéances cumulées · crédit en compte)
                      </span>
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-center">
                      État
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-right">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#fed7aa] text-[#431407]">
                  {currentImpayes.map((row, index) => {
                    const telHref = parentTelHref(row);
                    const phonesText = formatParentPhones(row);
                    const tone = row.statut_reglement ?? "rouge";
                    const rowBg =
                      tone === "vert"
                        ? index % 2 === 0
                          ? "bg-emerald-50/55"
                          : "bg-emerald-50/40"
                        : tone === "orange"
                          ? index % 2 === 0
                            ? "bg-amber-50/50"
                            : "bg-amber-50/35"
                          : index % 2 === 0
                            ? "bg-red-50/40"
                            : "bg-red-50/25";
                    const borderL =
                      tone === "vert"
                        ? "border-l-emerald-600"
                        : tone === "orange"
                          ? "border-l-amber-500"
                          : "border-l-red-600";
                    const detteProrata = Number(String(row.dette_prorata_echeance ?? "").replace(",", ".")) || 0;
                    const debtAnn = impayeResteAnnuel(row);
                    const creditAnn = impayeCreditAcompte(row);
                    return (
                    <tr
                      key={row.id}
                      className={`border-l-4 ${borderL} ${rowBg}`}
                    >
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>
                        <span className="font-semibold text-[#9a3412]">
                          {row.nom} {row.prenom}
                        </span>
                        {row.is_convention ? (
                          <span className="ml-2 inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800">
                            Convention
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3`}>{row.classe || "—"}</td>
                      <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-mono text-sm`}>
                        {telHref ? (
                          <a
                            href={telHref}
                            className="font-mono text-sm text-[#c2410c] underline decoration-[#fdba74] underline-offset-2 hover:text-[#9a3412]"
                          >
                            {phonesText}
                          </a>
                        ) : (
                          <span className="font-mono text-sm text-[#9a3412]">{phonesText}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-bold text-[#ea580c]">
                        {formatMontant(row.tarif_mensuel)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-bold">
                        {debtAnn > 0.005 ? (
                          <span className="text-red-600">{formatMontant(debtAnn)}</span>
                        ) : (
                          <span className="text-[#64748b]">{formatMontant(0)}</span>
                        )}
                      </td>
                      <td className="max-w-[180px] px-4 py-3 text-right tabular-nums font-semibold leading-snug">
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[11px] font-normal text-[#9a3412]/90">À date</span>
                          <span className="font-bold text-[#9a3412]">{formatMontant(Math.max(0, detteProrata))}</span>
                          <span className="text-[11px] font-normal text-emerald-800/90">Acompte</span>
                          <span
                            className={
                              creditAnn > 0.005 ? "font-bold text-emerald-700" : "font-bold text-[#64748b]"
                            }
                          >
                            {formatMontant(creditAnn)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                            tone === "vert"
                              ? "bg-emerald-200 text-emerald-950"
                              : tone === "orange"
                                ? "bg-amber-200 text-amber-950"
                                : "bg-red-200 text-red-950"
                          }`}
                        >
                          {tone === "vert" ? "Année OK" : tone === "orange" ? "Mois OK" : "Retard"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEncaissementFor(row)}
                          className="rounded-lg bg-[#ea580c] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#c2410c]"
                        >
                          Encaisser
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {!impayesLoading && filteredImpayes.length > 0 ? (
            <Pagination
              totalItems={filteredImpayes.length}
              itemsPerPage={itemsPerPage}
              currentPage={pageImpayes}
              paginate={setPageImpayes}
              itemLabel="élèves"
              className="border-[#fed7aa] bg-[#fff7ed]/90"
            />
          ) : null}
        </section>
      ) : null}

      <EleveDetailsModal
        open={listeEleveDetailsId != null}
        eleveId={listeEleveDetailsId}
        onClose={() => setListeEleveDetailsId(null)}
        onEncaissementMois={openEncaissementFromEleveFiche}
      />

      <PaiementModal
        open={modalOpen}
        mode={paymentModalMode}
        editingPayment={editingPayment}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        initialEleve={paymentModalPreset?.eleve ?? null}
        initialMoisConcerne={paymentModalPreset?.moisConcerne ?? null}
        initialMontant={
          paymentModalPreset?.eleve
            ? (() => {
                const t = eleveTarifMensuelTotal(paymentModalPreset.eleve);
                return Number.isFinite(t) && t > 0 ? t : null;
              })()
            : null
        }
        lockEleveSelection={paymentModalLockEleve}
        prefetchedEleveDetail={paymentModalPrefetchedDetail}
      />

      <PaymentReceiptPrintHost payload={receiptAutoPrint} onDone={clearReceiptAutoPrint} />
    </div>
  );
}
