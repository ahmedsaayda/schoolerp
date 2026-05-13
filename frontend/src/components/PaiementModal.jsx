import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { ACADEMIC_MONTHS } from "../constants/academicMonths.js";
import { API_ELEVES, API_PAIEMENTS, apiFetch, dispatchCaisseSessionChanged } from "../config.js";
import { useSessionRequirementOptional } from "./SessionRequirementModal.jsx";
import { eleveTarifMensuelTotal } from "../utils/eleveFees.js";
import { isNoSessionCaisseErrorMessage, messageFromDrfErrorBody } from "../utils/sessionCaisseErrors.js";
import { buildPaymentDoubleReceiptPayload } from "../utils/paymentReceiptPayload.js";
import { formatTnd } from "../utils/tunisianMoney.js";
import Loading from "./ui/Loading.jsx";

const METHODE_OPTIONS = [
  { value: "ESPECE", label: "Espèce" },
  { value: "CHEQUE", label: "Chèque" },
  { value: "VIREMENT", label: "Virement" },
];

const TYPE_FRAIS_OPTIONS = [
  { value: "SCOLARITE", label: "Scolarité" },
  { value: "INSCRIPTION", label: "Inscription" },
  { value: "ETUDES", label: "Études" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "AUTRE", label: "Autre" },
];

const DEFAULT_ELEVES_PREVIEW = 20;
const SEARCH_DEBOUNCE_MS = 320;

/** Ordre des codes mois (sept. → juin). */
const MONTH_ORDER = ACADEMIC_MONTHS.map(([c]) => c);

function repartitionByCode(moisRepartitionValeur) {
  if (!Array.isArray(moisRepartitionValeur)) return {};
  return Object.fromEntries(
    moisRepartitionValeur.map((r) => [String(r.code).padStart(2, "0"), r]),
  );
}

/**
 * Même règle que le backend : `scolarite.serializers.fifo_mois_concernes_for_payment`.
 * Ordre = ordre de `rep` (sept. → juin).
 */
function fifoMoisCodesFromRepartition(moisRepartitionValeur, montantEncaisse) {
  if (!Array.isArray(moisRepartitionValeur) || moisRepartitionValeur.length === 0) {
    return [];
  }
  const pay = Number(String(montantEncaisse).replace(",", "."));
  if (!Number.isFinite(pay) || pay <= 0) return [];
  let remaining = Math.round(pay * 100) / 100;
  const out = [];
  for (const row of moisRepartitionValeur) {
    const owed = Number(String(row.reliquat).replace(",", "."));
    if (!Number.isFinite(owed) || owed <= 0) continue;
    const take = Math.min(remaining, owed);
    if (take > 0) {
      out.push(String(row.code).padStart(2, "0"));
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    if (remaining <= 0) break;
  }
  return out;
}

const ALLOC_EPS = 0.005;

/**
 * Découpe une allocation FIFO (même itération que `fifoMoisCodesFromRepartition`) pour les messages UI.
 * @returns {{ fullLabels: string[], partial: null | { label: string, applied: number, code: string } }}
 */
function walkFifoForUi(rep, payNum) {
  const out = { fullLabels: [], fullCodes: [], partial: null, touchedCodes: [] };
  if (!Array.isArray(rep) || !Number.isFinite(payNum) || payNum < 0) return out;
  let remaining = Math.round(payNum * 100) / 100;
  for (const row of rep) {
    const owed = Number(String(row.reliquat).replace(",", "."));
    if (!Number.isFinite(owed) || owed <= 0) continue;
    if (remaining <= 0) break;
    const take = Math.min(remaining, owed);
    if (take <= 0) break;
    const code = String(row.code).padStart(2, "0");
    out.touchedCodes.push(code);
    const label = row.label ?? ACADEMIC_MONTHS.find(([c]) => c === code)?.[1] ?? code;
    if (take + ALLOC_EPS >= owed) {
      out.fullLabels.push(label);
      out.fullCodes.push(code);
    } else {
      out.partial = { code, label, applied: Math.round(take * 100) / 100 };
      break;
    }
    remaining = Math.round((remaining - take) * 100) / 100;
  }
  return out;
}

/**
 * Reste à payer sur l’échéance (séquentiel strict) : reliquats de tous les mois non soldés avant le premier mois sélectionné
 * + reliquats des mois sélectionnés (aligné sur `expected_montant_du_for_mois` côté API).
 */
/** Crédit annuel (acompte, surpaiement tarif × 10) depuis le détail élève API. */
function creditAcompteFromDetail(detail) {
  if (!detail) return 0;
  if (detail.acompte != null && detail.acompte !== "") {
    const a = Number(String(detail.acompte).replace(",", "."));
    if (Number.isFinite(a)) return Math.max(0, a);
  }
  if (detail.avoir != null && detail.avoir !== "") {
    const legacy = Number(String(detail.avoir).replace(",", "."));
    if (Number.isFinite(legacy)) return Math.max(0, legacy);
  }
  if (detail.credit_eleve == null || detail.credit_eleve === "") return 0;
  const n = Number(String(detail.credit_eleve).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseDetailAmount(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Reste annuel théorique **avant** l’encaissement en cours (édition : exclut l’ancien `montant_paye` de la ligne). */
function annualRemainingBeforePayment(eleveDetail, editingPayment) {
  if (!eleveDetail) return 0;
  const tam = parseDetailAmount(eleveDetail.total_annuel_du);
  let tp = parseDetailAmount(eleveDetail.total_paye);
  if (editingPayment?.id != null) {
    tp -= parseDetailAmount(editingPayment.montant_paye);
  }
  return Math.max(0, Math.round((tam - tp) * 100) / 100);
}

export function calculateStrictSequentialDue(moisConcernes, moisRepartitionValeur) {
  if (!Array.isArray(moisConcernes) || moisConcernes.length === 0) return null;
  if (!Array.isArray(moisRepartitionValeur) || moisRepartitionValeur.length === 0) return null;
  const rowsByCode = repartitionByCode(moisRepartitionValeur);
  const sortedSel = [...moisConcernes].sort(
    (a, b) => MONTH_ORDER.indexOf(String(a).padStart(2, "0")) - MONTH_ORDER.indexOf(String(b).padStart(2, "0")),
  );
  const firstCode = String(sortedSel[0]).padStart(2, "0");
  const firstSelIdx = MONTH_ORDER.indexOf(firstCode);
  if (firstSelIdx < 0) return null;

  let sum = 0;
  for (let i = 0; i < firstSelIdx; i++) {
    const c = MONTH_ORDER[i];
    const row = rowsByCode[c];
    if (!row || row.status === "PAID") continue;
    const rel = Number(String(row.reliquat).replace(",", "."));
    if (Number.isFinite(rel)) sum += rel;
  }
  for (const c of sortedSel) {
    const key = String(c).padStart(2, "0");
    const row = rowsByCode[key];
    if (!row) continue;
    const rel = Number(String(row.reliquat).replace(",", "."));
    if (Number.isFinite(rel)) sum += rel;
  }
  if (!Number.isFinite(sum)) return null;
  return Math.round(sum * 100) / 100;
}

function emptyForm() {
  return {
    eleve: "",
    type_frais: "SCOLARITE",
    montant_du: "",
    montant_paye: "",
    mois_concernes: [],
    methode: "ESPECE",
    remarque: "",
  };
}

function eleveLabel(el) {
  return `${el.nom ?? ""} ${el.prenom ?? ""}`.trim();
}

function eleveDetailLine(el) {
  const tel = el.telephone_1 || el.telephone_2 || "—";
  const cls = el.classe || "—";
  return `${tel} · ${cls}`;
}

/**
 * Modale d’enregistrement d’un encaissement (POST /api/paiements/).
 * @param {object | null} [initialEleve] — Élève pré-sélectionné (ex. depuis la liste des impayés).
 * @param {string | null} [initialMoisConcerne] — (Obsolète vis-à-vis de l’UI) conservé pour compatibilité appelant.
 * @param {string | number | null} [initialMontant] — Montant pré-rempli (ex. tarif mensuel).
 * @param {'create' | 'edit'} [mode] — Création ou modification d’une ligne existante.
 * @param {object | null} [editingPayment] — Ligne historique (champs API) si `mode === 'edit'`.
 * @param {boolean} [lockEleveSelection] — Si vrai (création), le champ Élève est figé (ex. depuis la fiche élève).
 * @param {object | null} [prefetchedEleveDetail] — GET `/api/eleves/:id/` déjà chargé pour afficher les soldes sans délai.
 * @param {function} [onSuccess] — `(receiptPrintPayload | null) => void` après succès API ; non-null déclenche l’impression auto du double reçu côté parent.
 */
export default function PaiementModal({
  open,
  onClose,
  onSuccess,
  initialEleve = null,
  initialMoisConcerne = null,
  initialMontant = null,
  mode = "create",
  editingPayment = null,
  lockEleveSelection = false,
  prefetchedEleveDetail = null,
}) {
  const titleId = useId();
  const comboboxId = useId();
  const listboxId = useId();
  const sessionRequirement = useSessionRequirementOptional();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  /** Élève choisi : on compare le libellé pour savoir si l’utilisateur a modifié la recherche. */
  const [pickedEleve, setPickedEleve] = useState(null);
  /** Détail élève (GET retrieve) : `mois_repartition_valeur`, `reste_a_payer`, etc. */
  const [eleveDetail, setEleveDetail] = useState(null);
  const [eleveDetailLoading, setEleveDetailLoading] = useState(false);
  const [showOverpayConfirm, setShowOverpayConfirm] = useState(false);
  const [overpayAnnualRest, setOverpayAnnualRest] = useState(0);
  const [overpayPayeNum, setOverpayPayeNum] = useState(0);

  const comboboxWrapRef = useRef(null);

  const editingForAnnual =
    mode === "edit" && editingPayment != null && editingPayment.id != null ? editingPayment : null;

  useEffect(() => {
    if (!open) return;
    setError("");
    setShowOverpayConfirm(false);
    setIsDropdownOpen(false);
    setSearchLoading(false);

    if (mode === "edit" && editingPayment?.id != null) {
      const ep = editingPayment;
      setForm({
        eleve: String(ep.eleve),
        type_frais: ep.type_frais ?? "SCOLARITE",
        montant_du: ep.montant_du != null && ep.montant_du !== "" ? String(ep.montant_du) : "",
        montant_paye: ep.montant_paye != null && ep.montant_paye !== "" ? String(ep.montant_paye) : "",
        mois_concernes: Array.isArray(ep.mois_concernes) ? [...ep.mois_concernes] : [],
        methode: ep.methode ?? "ESPECE",
        remarque: ep.remarque ?? "",
      });
      setPickedEleve({
        id: ep.eleve,
        nom: ep.eleve_nom,
        prenom: ep.eleve_prenom,
        classe: ep.eleve_classe,
        telephone_1: "",
        telephone_2: "",
      });
      setSearchTerm(`${ep.eleve_nom ?? ""} ${ep.eleve_prenom ?? ""}`.trim());
      setSearchResults([]);
      setEleveDetail(null);
      return;
    }

    const hasPreset = initialEleve != null && initialEleve.id != null;

    if (hasPreset) {
      const presetTarif = eleveTarifMensuelTotal(initialEleve);
      const montStr =
        initialMontant != null && initialMontant !== ""
          ? String(initialMontant).replace(",", ".")
          : Number.isFinite(presetTarif) && presetTarif > 0
            ? String(presetTarif)
            : "";
      setForm({
        eleve: String(initialEleve.id),
        type_frais: "SCOLARITE",
        montant_du: "",
        montant_paye: montStr,
        mois_concernes: [],
        methode: "ESPECE",
        remarque: "",
      });
      setPickedEleve(initialEleve);
      setSearchTerm(eleveLabel(initialEleve));
      setSearchResults([]);
      setEleveDetail(prefetchedEleveDetail ?? null);
    } else {
      setForm(emptyForm());
      setSearchTerm("");
      setPickedEleve(null);
      setSearchResults([]);
      setEleveDetail(null);
    }
  }, [open, mode, editingPayment, initialEleve, initialMoisConcerne, initialMontant, prefetchedEleveDetail]);

  useEffect(() => {
    if (!open || pickedEleve?.id == null) {
      setEleveDetail(null);
      setEleveDetailLoading(false);
      return;
    }
    let cancelled = false;
    const usePrefetchFirst =
      lockEleveSelection &&
      prefetchedEleveDetail != null &&
      Number(prefetchedEleveDetail.id) === Number(pickedEleve.id);
    setEleveDetailLoading(!usePrefetchFirst);
    (async () => {
      try {
        const res = await apiFetch(`${API_ELEVES}${pickedEleve.id}/`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setEleveDetail(data);
      } catch {
        if (!cancelled && !usePrefetchFirst) setEleveDetail(null);
      } finally {
        if (!cancelled) setEleveDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pickedEleve?.id, lockEleveSelection, prefetchedEleveDetail]);

  useEffect(() => {
    if (!open || pickedEleve?.id == null) return;
    const rep = eleveDetail?.mois_repartition_valeur;
    if (!rep?.length) {
      if (eleveDetailLoading) return;
      setForm((f) =>
        f.montant_du === "" && f.mois_concernes.length === 0 ? f : { ...f, montant_du: "", mois_concernes: [] },
      );
      return;
    }
    const raw = String(form.montant_paye ?? "").trim();
    if (raw === "") {
      setForm((f) =>
        f.montant_du === "" && f.mois_concernes.length === 0 ? f : { ...f, montant_du: "", mois_concernes: [] },
      );
      return;
    }
    const paye = Number(raw.replace(",", "."));
    if (!Number.isFinite(paye) || paye < 0) return;
    if (paye === 0) {
      setForm((f) =>
        f.montant_du === "" && f.mois_concernes.length === 0 ? f : { ...f, montant_du: "", mois_concernes: [] },
      );
      return;
    }
    const codes = fifoMoisCodesFromRepartition(rep, paye);
    const suggested = codes.length ? calculateStrictSequentialDue(codes, rep) : null;
    const credit = creditAcompteFromDetail(eleveDetail);
    const nextDu =
      suggested == null
        ? ""
        : Math.max(0, Math.round((suggested - credit) * 100) / 100).toFixed(2);
    setForm((f) => {
      const same =
        f.montant_du === nextDu &&
        f.mois_concernes.length === codes.length &&
        f.mois_concernes.every((c, i) => String(c).padStart(2, "0") === String(codes[i]).padStart(2, "0"));
      if (same) return f;
      return { ...f, mois_concernes: codes, montant_du: nextDu };
    });
  }, [
    open,
    pickedEleve?.id,
    form.montant_paye,
    eleveDetail,
    eleveDetail?.mois_repartition_valeur,
    eleveDetail?.credit_eleve,
    eleveDetailLoading,
  ]);

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
        const url = params.toString() ? `${API_ELEVES}?${params.toString()}` : API_ELEVES;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let list = Array.isArray(data) ? data : data.results ?? [];
        if (!q) {
          list = list.slice(0, DEFAULT_ELEVES_PREVIEW);
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

  const creditAppliedOnPayment = useMemo(() => {
    const rep = eleveDetail?.mois_repartition_valeur;
    if (!rep?.length) return null;
    const codes = Array.isArray(form.mois_concernes) ? form.mois_concernes : [];
    if (codes.length === 0) return null;
    const raw = calculateStrictSequentialDue(codes, rep);
    if (raw == null || raw <= 0) return null;
    const cred = creditAcompteFromDetail(eleveDetail);
    if (cred <= 0) return null;
    const applied = Math.min(cred, raw);
    if (applied <= 0.005) return null;
    return { applied };
  }, [eleveDetail, form.mois_concernes]);

  const partialReliquatNotice = useMemo(() => {
    const rep = eleveDetail?.mois_repartition_valeur;
    if (!rep?.length) return null;
    const row = rep.find((r) => r.status === "PARTIAL");
    if (!row) return null;
    const amt = Number(String(row.reliquat).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) return null;
    const label = row.label ?? ACADEMIC_MONTHS.find(([c]) => c === String(row.code).padStart(2, "0"))?.[1] ?? row.code;
    return { amt, label };
  }, [eleveDetail?.mois_repartition_valeur]);

  /**
   * Année scolaire (frais) entièrement couverte : pas de reliquat annuel, type Scolarité.
   * (Acompte / crédit = encaissements ≥ tarif × 10 → reste 0, aucun encaissement requis.)
   */
  const isScolariteYearFullyPaid = useMemo(() => {
    if (!open || pickedEleve == null || eleveDetailLoading || !eleveDetail) return false;
    if (form.type_frais !== "SCOLARITE") return false;
    const t = eleveTarifMensuelTotal(pickedEleve);
    if (!Number.isFinite(t) || t <= 0) return false;
    const r = Number(String(eleveDetail.reste_a_payer ?? 0).replace(",", "."));
    return Number.isFinite(r) && r <= 0.005;
  }, [open, pickedEleve, eleveDetail, eleveDetailLoading, form.type_frais]);

  const showFullyPaidCelebration = mode === "create" && isScolariteYearFullyPaid;

  /** Aperçu du reste annuel après l’encaissement saisi (aligné sur `annualRemainingBeforePayment`). */
  const nouveauResteAnnuelPreview = useMemo(() => {
    if (!open || !eleveDetail || showFullyPaidCelebration) return null;
    const raw = String(form.montant_paye ?? "").trim();
    if (raw === "") return null;
    const paye = Number(raw.replace(",", "."));
    if (!Number.isFinite(paye) || paye < 0) return null;
    const avant = annualRemainingBeforePayment(eleveDetail, editingForAnnual);
    const apres = Math.max(0, Math.round((avant - paye) * 100) / 100);
    return { avant, apres, paye };
  }, [open, eleveDetail, form.montant_paye, editingForAnnual, showFullyPaidCelebration]);

  /** Résumé d’imputation FIFO (texte demandé : mois entiers, surplus vers le suivant, ou premier mois partiel). */
  const fifoAutoAlert = useMemo(() => {
    if (!open || pickedEleve == null || eleveDetailLoading || !eleveDetail?.mois_repartition_valeur?.length) {
      return null;
    }
    const raw = String(form.montant_paye ?? "").trim();
    if (raw === "") return null;
    const paye = Number(raw.replace(",", "."));
    if (!Number.isFinite(paye) || paye <= 0) return null;
    const { fullLabels, partial } = walkFifoForUi(eleveDetail.mois_repartition_valeur, paye);
    if (partial == null) {
      if (fullLabels.length === 0) return null;
      if (fullLabels.length === 1) {
        return { variant: "success", text: `✅ Le mois de ${fullLabels[0]} est coché et réglé.` };
      }
      return {
        variant: "success",
        text: `✅ Les mois de [${fullLabels.join(", ")}] sont cochés et réglés.`,
      };
    }
    if (fullLabels.length > 0) {
      return {
        variant: "success",
        text: `✅ Les mois de [${fullLabels.join(", ")}] sont cochés. Il reste un surplus (acompte) de ${formatTnd(
          partial.applied,
        )} qui couvrira une partie du mois de ${partial.label}.`,
      };
    }
    return {
      variant: "warning",
      text: `⚠️ Le montant couvre une partie du premier mois impayé (${partial.label}).`,
    };
  }, [open, pickedEleve, eleveDetail, eleveDetailLoading, form.montant_paye]);

  const fifoMonthWalk = useMemo(() => {
    if (!eleveDetail?.mois_repartition_valeur?.length) return null;
    const raw = String(form.montant_paye ?? "").trim();
    if (raw === "") return null;
    const paye = Number(raw.replace(",", "."));
    if (!Number.isFinite(paye) || paye <= 0) return null;
    return walkFifoForUi(eleveDetail.mois_repartition_valeur, paye);
  }, [eleveDetail?.mois_repartition_valeur, form.montant_paye]);

  function onSearchInputChange(raw) {
    if (lockEleveSelection) return;
    const v = raw;
    setSearchTerm(v);
    setIsDropdownOpen(true);
    const label = pickedEleve ? eleveLabel(pickedEleve) : null;
    if (label != null && v.trim() !== label) {
      setPickedEleve(null);
      setForm((f) => ({ ...f, eleve: "", montant_du: "", montant_paye: "", mois_concernes: [] }));
    }
  }

  function selectEleve(el) {
    setPickedEleve(el);
    update("eleve", String(el.id));
    setSearchTerm(eleveLabel(el));
    setIsDropdownOpen(false);
  }

  async function runPaymentSubmit(skipOverpayCheck) {
    setError("");
    if (mode === "create" && isScolariteYearFullyPaid) return;

    const eleveId = form.eleve === "" ? NaN : Number(form.eleve);
    if (!Number.isInteger(eleveId) || eleveId < 1) {
      setError("Sélectionnez un élève dans la liste.");
      return;
    }
    if (pickedEleve && !eleveDetailLoading && eleveDetail == null) {
      setError("Impossible de charger les informations financières de l’élève. Réessayez.");
      return;
    }
    const duNum = Number(String(form.montant_du).replace(",", "."));
    const payeNum = Number(String(form.montant_paye).replace(",", "."));
    if (Number.isNaN(duNum) || duNum < 0) {
      setError("Indiquez un reste à payer sur l’échéance valide (≥ 0).");
      return;
    }
    if (duNum <= 0) {
      setError(
        "Le crédit disponible couvre intégralement le reste à payer pour ces mois — aucun encaissement à enregistrer.",
      );
      return;
    }
    if (Number.isNaN(payeNum) || payeNum < 0) {
      setError("Indiquez un montant encaissé valide (≥ 0).");
      return;
    }
    const moisConcernes = Array.isArray(form.mois_concernes) ? [...form.mois_concernes] : [];
    if (moisConcernes.length === 0) {
      setError("Sélectionnez au moins un mois concerné par cet encaissement.");
      return;
    }

    const annualRest = annualRemainingBeforePayment(eleveDetail, editingForAnnual);
    if (!skipOverpayCheck && payeNum > annualRest + 0.005) {
      setOverpayAnnualRest(annualRest);
      setOverpayPayeNum(payeNum);
      setShowOverpayConfirm(true);
      return;
    }

    setShowOverpayConfirm(false);

    setSubmitting(true);
    try {
      const formData = {
        eleve: eleveId,
        type_frais: form.type_frais,
        montant_du: duNum.toFixed(2),
        montant_paye: payeNum.toFixed(2),
        mois_concerne: null,
        mois_concernes: moisConcernes,
        methode: form.methode,
        remarque: form.remarque.trim() === "" ? null : form.remarque.trim(),
      };

      const isEdit = mode === "edit" && editingPayment?.id != null;
      const url = isEdit ? `${API_PAIEMENTS}${editingPayment.id}/` : API_PAIEMENTS;
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
          const extracted = messageFromDrfErrorBody(data);
          if (extracted) msg = extracted;
        } catch {
          /* ignore */
        }
        if (sessionRequirement?.showSessionRequired && isNoSessionCaisseErrorMessage(msg)) {
          sessionRequirement.showSessionRequired();
          return;
        }
        setError(msg);
        return;
      }

      let savedPayment = null;
      try {
        savedPayment = await res.json();
      } catch {
        savedPayment = null;
      }

      if (mode === "create") {
        const payRecorded = payeNum;
        setEleveDetail((prev) => {
          if (!prev) return prev;
          const tam = parseDetailAmount(prev.total_annuel_du);
          const tp = parseDetailAmount(prev.total_paye) + payRecorded;
          const reste = Math.max(0, tam - tp);
          const credit = Math.max(0, tp - tam);
          const acompteSigned = (tp - tam).toFixed(2);
          return {
            ...prev,
            total_paye: tp.toFixed(2),
            reste_a_payer: reste.toFixed(2),
            credit_eleve: credit.toFixed(2),
            acompte: acompteSigned,
          };
        });
      }

      const refreshEleveId = eleveId;
      void (async () => {
        try {
          const r = await apiFetch(`${API_ELEVES}${refreshEleveId}/`);
          if (!r.ok) return;
          const data = await r.json();
          setEleveDetail((cur) => (cur && Number(cur.id) === refreshEleveId ? data : cur));
        } catch {
          /* reconcile with server when possible */
        }
      })();

      if (typeof window !== "undefined" && refreshEleveId != null) {
        window.dispatchEvent(
          new CustomEvent("school-eleve-finances-changed", { detail: { eleveId: refreshEleveId } }),
        );
      }

      dispatchCaisseSessionChanged();

      const receiptPayload =
        savedPayment != null
          ? buildPaymentDoubleReceiptPayload(
              savedPayment,
              pickedEleve,
              mode === "edit" && editingPayment ? editingPayment : null,
            )
          : null;
      onSuccess?.(receiptPayload);
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    void runPaymentSubmit(false);
  }

  function dismissOverpayConfirm() {
    setShowOverpayConfirm(false);
  }

  function confirmOverpayAndSubmit() {
    setShowOverpayConfirm(false);
    void runPaymentSubmit(true);
  }

  if (!open) return null;

  const financeUnavailable = pickedEleve != null && !eleveDetailLoading && eleveDetail == null;
  const eleveFieldReadOnly = mode === "edit" || (mode === "create" && lockEleveSelection);

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
            {mode === "edit" ? "Modifier l’encaissement" : "Nouvel encaissement"}
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
              Élève
              {mode === "create" && lockEleveSelection ? (
                <span className="ml-2 font-normal normal-case text-[#94a3b8]">(verrouillé)</span>
              ) : null}
            </label>
            {eleveFieldReadOnly ? (
              <div
                id={comboboxId}
                className={`${inputClass} cursor-default bg-[#f8fafc] text-[#0f172a]`}
                aria-readonly="true"
              >
                {searchTerm || "—"}
              </div>
            ) : (
              <input
                id={comboboxId}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isDropdownOpen}
                aria-controls={listboxId}
                autoComplete="off"
                placeholder="Rechercher par nom, parent, téléphone…"
                value={searchTerm}
                onChange={(e) => onSearchInputChange(e.target.value)}
                onFocus={() => setIsDropdownOpen(true)}
                disabled={submitting}
                className={inputClass}
              />
            )}
            {mode === "create" && !lockEleveSelection && isDropdownOpen ? (
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
                  <li className="px-3 py-2.5 text-sm text-[#64748b]">Aucun élève trouvé.</li>
                ) : (
                  searchResults.map((el) => (
                    <li key={el.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={form.eleve === String(el.id)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => selectEleve(el)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-[#f1f5f9]"
                      >
                        <span className="font-medium text-[#0f172a]">
                          {el.nom} {el.prenom}
                        </span>
                        <span className="text-xs text-[#64748b]">{eleveDetailLine(el)}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {pickedEleve && form.eleve && showFullyPaidCelebration ? (
              <p className="mt-1 text-xs font-medium text-green-800" aria-live="polite">
                Solde annuel nul : aucun encaissement n’est nécessaire pour la scolarité.
              </p>
            ) : pickedEleve && form.eleve ? (
              <p className="mt-1 text-xs font-medium text-[#15803d]" aria-live="polite">
                {mode === "edit"
                  ? "Modification d’un encaissement existant — ajustez les montants ou les mois puis enregistrez."
                  : lockEleveSelection
                    ? "Élève issu de la fiche — le nom ne peut pas être modifié ici."
                    : "Élève sélectionné — validez le formulaire pour enregistrer l’encaissement."}
              </p>
            ) : mode === "create" && !lockEleveSelection ? (
              <p className="mt-1 text-xs text-[#94a3b8]">
                Sans recherche : les {DEFAULT_ELEVES_PREVIEW} premiers élèves (ordre serveur) ; affinez par nom,
                parent ou téléphone.
              </p>
            ) : null}
          </div>

          {pickedEleve && form.eleve ? (
            <div
              className="rounded-xl border-2 border-[#93c5fd] bg-gradient-to-br from-[#eff6ff] to-white px-4 py-3 shadow-sm"
              role="region"
              aria-label="Soldes de l’élève en dinars tunisiens"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#1d4ed8]">Soldes (DT)</p>
              {eleveDetailLoading ? (
                <div className="mt-2">
                  <Loading inline message="Chargement des soldes…" className="min-h-0 py-0" />
                </div>
              ) : financeUnavailable ? (
                <p className="mt-2 text-xs font-medium text-red-700" role="alert">
                  Impossible d’afficher les soldes — vérifiez la connexion.
                </p>
              ) : eleveDetail ? (
                <dl className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt className="text-sm font-semibold text-[#1e3a8a]">Reste à payer annuel</dt>
                    <dd className="text-xl font-bold tabular-nums tracking-tight text-[#0f172a]">
                      {formatTnd(parseDetailAmount(eleveDetail.reste_a_payer))}
                    </dd>
                  </div>
                  {parseDetailAmount(eleveDetail.credit_eleve) > 0.005 ? (
                    <p className="text-xs font-medium text-emerald-800">
                      Acompte actuel :{" "}
                      <span className="tabular-nums font-semibold">
                        {formatTnd(parseDetailAmount(eleveDetail.credit_eleve))}
                      </span>
                    </p>
                  ) : null}
                </dl>
              ) : null}
            </div>
          ) : null}

          <div>
            <label htmlFor="paiement-type-frais" className={labelClass}>
              Type de frais
            </label>
            <select
              id="paiement-type-frais"
              value={form.type_frais}
              onChange={(e) => update("type_frais", e.target.value)}
              disabled={submitting}
              className={inputClass}
            >
              {TYPE_FRAIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {showFullyPaidCelebration ? (
            <div
              className="rounded-2xl border-2 border-green-400 bg-green-50 px-5 py-6 text-center shadow-sm"
              role="status"
            >
              <div className="mb-4 flex justify-center" aria-hidden>
                <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-green-100 ring-2 ring-green-200">
                  <CheckCircle2 className="h-12 w-12 text-green-600" strokeWidth={2.25} />
                </div>
              </div>
              <p className="text-lg font-bold tracking-tight text-green-900">Année entièrement soldée 🎉</p>
              <p className="mt-3 text-left text-sm leading-relaxed text-green-800">
                Cet élève a réglé la totalité de ses frais de scolarité pour l&apos;année en cours. Aucun paiement
                supplémentaire n&apos;est requis.
              </p>
            </div>
          ) : null}

          {!showFullyPaidCelebration ? (
            <>
          <div>
            <label htmlFor="paiement-montant-paye" className={labelClass}>
              Montant encaissé (DT)
            </label>
            <input
              id="paiement-montant-paye"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.montant_paye}
              onChange={(e) => update("montant_paye", e.target.value)}
              required
              disabled={submitting}
              className={inputClass}
            />
            {nouveauResteAnnuelPreview && eleveDetail ? (
              <p
                className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-snug text-slate-900"
                role="status"
                aria-live="polite"
              >
                Nouveau reste annuel = {formatTnd(nouveauResteAnnuelPreview.avant)} −{" "}
                {formatTnd(nouveauResteAnnuelPreview.paye)} = {formatTnd(nouveauResteAnnuelPreview.apres)}
              </p>
            ) : null}
          </div>

          {fifoAutoAlert && eleveDetail ? (
            <div
              className={[
                "rounded-xl border-2 px-3 py-3 text-sm font-medium shadow-sm",
                fifoAutoAlert.variant === "warning"
                  ? "border-amber-400 bg-amber-50 text-amber-950"
                  : "border-emerald-500 bg-emerald-50/95 text-emerald-950",
              ].join(" ")}
              role="status"
              aria-live="polite"
            >
              <p className="leading-relaxed">{fifoAutoAlert.text}</p>
            </div>
          ) : null}

          <div>
            <label htmlFor="paiement-montant-du" className={labelClass}>
              Reste à payer sur l’échéance (DT){" "}
              <span className="font-normal normal-case text-[#94a3b8]">(calculé, FIFO)</span>
            </label>
            <input
              id="paiement-montant-du"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.montant_du}
              readOnly
              disabled={submitting || eleveDetailLoading || pickedEleve == null}
              className={`${inputClass} cursor-not-allowed bg-[#f8fafc]`}
              title="Dérivé de la répartition des mois — aligné sur le serveur."
            />
            {financeUnavailable ? (
              <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                Échec du chargement du détail élève (répartition des mois). Vérifiez la connexion et réessayez.
              </p>
            ) : eleveDetailLoading ? (
              <div className="mt-1">
                <Loading
                  inline
                  message="Chargement de la répartition des mois…"
                  className="min-h-0 py-0"
                />
              </div>
            ) : pickedEleve && eleveDetail && creditAppliedOnPayment ? (
              <p className="mt-1 text-xs text-emerald-900" role="status">
                Un crédit de{" "}
                <span className="font-semibold tabular-nums">
                  {formatTnd(creditAppliedOnPayment.applied)}
                </span>{" "}
                a été appliqué sur ce paiement.
              </p>
            ) : null}
          </div>

          {partialReliquatNotice && eleveDetail ? (
            <p className="rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs leading-relaxed text-sky-950">
              <span className="font-semibold">Note :</span> un reliquat de{" "}
              <span className="tabular-nums font-semibold">{formatTnd(partialReliquatNotice.amt)}</span> pour le mois
              de {partialReliquatNotice.label} pèse sur le prochain imputation (déjà pris en compte dans l’échéance
              affichée).
            </p>
          ) : null}

          <fieldset className="min-w-0">
            <legend className={`${labelClass} mb-2`}>Imputation automatique (mois)</legend>
            <p className="mb-3 text-xs text-[#64748b]">
              Les cases reflètent l’imputation FIFO (relativat d’abord) pour le montant saisi. Le serveur enregistre le
              même principe.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ACADEMIC_MONTHS.map(([code, label]) => {
                const rep = eleveDetail?.mois_repartition_valeur;
                const row = rep?.length ? repartitionByCode(rep)[code] : null;
                const st = row?.status;
                const paidLocked = st === "PAID";
                const partialHighlight = st === "PARTIAL";
                const inFifoFull = fifoMonthWalk?.fullCodes?.includes(code) ?? false;
                const inFifoPart = fifoMonthWalk?.partial?.code === code;
                const isAlloc = inFifoFull || inFifoPart;
                return (
                  <div
                    key={code}
                    title={
                      paidLocked
                        ? "Mois soldé (historique des encaissements)."
                        : inFifoPart
                          ? "Partie du montant imputé sur ce mois (incomplet)."
                          : inFifoFull
                            ? "Montant couvrant la totalité de ce reliquat."
                            : undefined
                    }
                    className={[
                      "rounded-xl border px-2 py-2.5 text-center text-xs font-semibold",
                      paidLocked
                        ? "border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8] line-through opacity-70"
                        : inFifoPart
                          ? "border-amber-500 bg-amber-100 text-amber-950 ring-2 ring-amber-400"
                          : inFifoFull
                            ? "border-emerald-500 bg-emerald-500 text-white shadow-sm ring-2 ring-emerald-200"
                            : partialHighlight
                              ? "border-amber-200 bg-amber-50/90 text-amber-950"
                              : "border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]",
                    ].join(" ")}
                    aria-label={`${label}${isAlloc ? " — reçoit une partie de ce versement" : ""}`}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="paiement-methode" className={labelClass}>
              Méthode
            </label>
            <select
              id="paiement-methode"
              value={form.methode}
              onChange={(e) => update("methode", e.target.value)}
              required
              disabled={submitting}
              className={inputClass}
            >
              {METHODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="paiement-remarque" className={labelClass}>
              Remarque <span className="font-normal normal-case text-[#94a3b8]">(optionnel)</span>
            </label>
            <textarea
              id="paiement-remarque"
              value={form.remarque}
              onChange={(e) => update("remarque", e.target.value)}
              disabled={submitting}
              rows={3}
              className={`${inputClass} resize-y`}
              placeholder="Notes internes…"
            />
          </div>
            </>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[#e2e8f0] pt-4">
            {showFullyPaidCelebration ? (
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-[#16a34a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#15803d] sm:w-auto"
              >
                Fermer
              </button>
            ) : (
              <>
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
                  disabled={submitting || financeUnavailable}
                  className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  {submitting
                    ? "Enregistrement…"
                    : mode === "edit"
                      ? "Enregistrer les modifications"
                      : "Enregistrer l’encaissement"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>

      {showOverpayConfirm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f172a]/55 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) dismissOverpayConfirm();
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="overpay-title"
            aria-describedby="overpay-desc"
            className="max-h-[min(90vh,520px)] w-full max-w-md overflow-y-auto rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-amber-50 to-orange-50/90 p-6 shadow-[0_24px_60px_-12px_rgba(120,53,15,0.45)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-200/90 text-amber-950 ring-2 ring-amber-400/80">
                <AlertTriangle className="h-7 w-7" aria-hidden strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 id="overpay-title" className="text-lg font-bold leading-tight text-amber-950">
                  Trop-perçu / Acompte
                </h3>
                <p id="overpay-desc" className="mt-3 text-sm leading-relaxed text-amber-950/95">
                  Attention : le montant saisi dépasse le reste à payer annuel de{" "}
                  <span className="font-bold tabular-nums">{formatTnd(overpayAnnualRest)}</span> DT. Voulez-vous
                  enregistrer ce surplus comme <span className="font-semibold">acompte</span> (crédit sur la fiche
                  élève, utilisable notamment pour l&apos;année scolaire suivante) ?
                </p>
                <p className="mt-2 text-xs font-medium text-amber-900/90">
                  Montant encaissé saisi :{" "}
                  <span className="tabular-nums font-bold">{formatTnd(overpayPayeNum)}</span> DT
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={dismissOverpayConfirm}
                disabled={submitting}
                className="rounded-lg border-2 border-amber-700/40 bg-white px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100/80 disabled:opacity-50"
              >
                Non, corriger le montant
              </button>
              <button
                type="button"
                onClick={confirmOverpayAndSubmit}
                disabled={submitting}
                className="rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-amber-700 disabled:opacity-60"
              >
                {submitting ? "Enregistrement…" : "Oui, garder comme acompte"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
