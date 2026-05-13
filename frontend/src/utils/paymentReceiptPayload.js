import { formatMoisConcernesLabels } from "../constants/academicMonths.js";

/**
 * Données pour le template « double reçu » à partir de la réponse API paiement (POST/PATCH).
 * @param {object} savedPayment — Corps JSON du serializer Paiement
 * @param {object | null} pickedEleve — Élève sélectionné dans le formulaire (création / édition)
 * @param {object | null} editingPayment — Ligne en édition (fallback libellés)
 */
export function buildPaymentDoubleReceiptPayload(savedPayment, pickedEleve, editingPayment) {
  if (!savedPayment || typeof savedPayment !== "object") return null;
  const mois = Array.isArray(savedPayment.mois_concernes) ? savedPayment.mois_concernes : [];
  const monthLabel = formatMoisConcernesLabels(mois) || "—";
  const monthCode = mois.length ? mois.map((c) => String(c).padStart(2, "0")).join(", ") : "—";
  let dateEmission;
  try {
    const dateRaw = savedPayment.date_encaissement;
    dateEmission = dateRaw
      ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(dateRaw))
      : new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  } catch {
    dateEmission = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  }
  const eleve = {
    prenom: savedPayment.eleve_prenom ?? pickedEleve?.prenom ?? editingPayment?.eleve_prenom ?? "",
    nom: savedPayment.eleve_nom ?? pickedEleve?.nom ?? editingPayment?.eleve_nom ?? "",
    classe: savedPayment.eleve_classe ?? pickedEleve?.classe ?? editingPayment?.eleve_classe ?? "",
  };
  return {
    eleve,
    monthLabel,
    monthCode,
    montantApplique: savedPayment.montant_paye,
    dateEmission,
  };
}
