import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { SCHOOL_NAME, SCHOOL_TAGLINE, getSchoolLogoDataUrlForPdf } from "../branding.js";
import { formatMoisConcernesLabels } from "../constants/academicMonths.js";
import { formatTndPdf } from "./tunisianMoney.js";

const ACADEMIC_MONTHS_COUNT = 10;

const LOGO_HEADER_MM = 14;

const COLOR_BLACK = [15, 23, 42];
const COLOR_MUTED = [100, 116, 139];
const COLOR_LINE = [203, 213, 225];
/** En-têtes tableau — slate foncé (#1e293b) */
const COLOR_TABLE_HEAD_BG = [30, 41, 59];
const COLOR_TABLE_HEAD_TEXT = [255, 255, 255];
const COLOR_ZEBRA = [248, 250, 252];
const COLOR_SUMMARY_BG = [236, 238, 241];

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

/** Lettres accentuees -> ASCII pour jsPDF (Helvetica). */
function pdfSafeText(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\u00d7/g, "x");
}

/**
 * Parse API / form amounts: numbers, "940.00", "940,00", strings with spaces.
 * Returns null if not a finite number.
 */
function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNumber(v) {
  const p = parseAmount(v);
  return p == null ? 0 : p;
}

function formatMontantPdf(value) {
  const n = parseAmount(value);
  if (n == null) return "-";
  return formatTndPdf(n);
}

/** Montants scolarité / historique (TND, espaces normalisés pour jsPDF). */
function formatMontantDt(value) {
  return formatTndPdf(toNumber(value));
}

/** Lignes PDF : TND (fr-TN) avec parse `toNumber`. */
function formatCurrency(val) {
  return formatTndPdf(toNumber(val));
}

function formatDateTimeFr(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return String(iso);
  }
}

function formatDatePaiementFr(iso) {
  if (!iso) return "—";
  const s = String(iso);
  const d = s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
  try {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(y, m - 1, day));
  } catch {
    return d;
  }
}

/** Date JJ/MM/AAAA sans caracteres de locale (PDF). */
function formatDatePdfNumeric(iso) {
  if (!iso) return "-";
  const s = String(iso).slice(0, 10);
  const parts = s.split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

/** Date du releve : jour mois annee en texte simple (sans symboles exotiques). */
function formatReportDatePdf() {
  const d = new Date();
  const months = [
    "janvier",
    "fevrier",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "aout",
    "septembre",
    "octobre",
    "novembre",
    "decembre",
  ];
  const day = d.getDate();
  const month = months[d.getMonth()] ?? "";
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

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
    /* ignore */
  }
  return day;
}

function formatHeuresPdf(v) {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  const t = Math.round(n * 100) / 100;
  const s = Number.isInteger(t) ? String(t) : t.toFixed(2).replace(/\.?0+$/, "");
  return s.replace(".", ",");
}

/** Horodatage pied de page PDF : ASCII uniquement (Helvetica). */
function footerTimestampAscii() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/** Bloc en-tête établissement (logo + nom) pour jsPDF, unités mm. Retourne la hauteur du bloc. */
export function drawSchoolPdfHeader(doc, x, yTop, logoDataUrl) {
  const gap = 4;
  const blockH = Math.max(LOGO_HEADER_MM, 16);
  let textX = x;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", x, yTop, LOGO_HEADER_MM, LOGO_HEADER_MM);
      textX = x + LOGO_HEADER_MM + gap;
    } catch {
      /* format ou image invalide : texte seul */
    }
  }
  const textBaseline = yTop + blockH / 2 + 2;
  doc.setTextColor(...COLOR_BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(SCHOOL_NAME, textX, textBaseline - 2);
  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.35);
  const pageW = doc.internal.pageSize.getWidth();
  const marginRight = 18;
  const underlineW = Math.min(120, pageW - textX - marginRight);
  doc.line(textX, textBaseline + 0.5, textX + underlineW, textBaseline + 0.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(SCHOOL_TAGLINE, textX, textBaseline + 5);
  doc.setTextColor(...COLOR_BLACK);
  return blockH + 3;
}

function drawFooterPrintDate(doc, pageW, pageH, margin) {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Document genere le ${footerTimestampAscii()}`, margin, pageH - margin);
  doc.setTextColor(...COLOR_BLACK);
}

/** Horodatage document historique paiements (chiffres et / uniquement). */
function drawHistoryDocumentMeta(doc, pageW, pageH, margin) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ts = `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Document genere le ${ts}`, margin, pageH - margin - 6);
  doc.setTextColor(...COLOR_BLACK);
}

function drawSignatureBlock(doc, pageW, pageH, margin) {
  const boxW = 88;
  const boxH = 28;
  const boxX = pageW - margin - boxW;
  const boxY = pageH - margin - boxH - 14;
  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.35);
  doc.rect(boxX, boxY, boxW, boxH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Signature et cachet de l'etablissement", boxX + 4, boxY + 10);
  doc.setTextColor(...COLOR_BLACK);
}

/** Marque pied de page - toutes les pages (tout en bas). */
function drawBrandingFooterEveryPage(doc, pageW, pageH) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`${SCHOOL_NAME} - ${SCHOOL_TAGLINE}`, pageW / 2, pageH - 4, { align: "center" });
  doc.setTextColor(...COLOR_BLACK);
}

/**
 * Relevé PDF — historique complet des paiements d’un élève (A4).
 * @param {object} eleve — objet API dossier élève (historique_paiements, tarif_mensuel, total_paye, …)
 */
export async function generateHistoryPDF(eleve) {
  if (!eleve || typeof eleve !== "object") return;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  const logo = await getSchoolLogoDataUrlForPdf();
  y += drawSchoolPdfHeader(doc, margin, y, logo) + 5;

  const nomComplet = [eleve.prenom, eleve.nom].filter(Boolean).join(" ").trim() || "-";
  const classe = eleve.classe ?? "-";
  const reportDate = formatReportDatePdf();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...COLOR_BLACK);
  doc.text("HISTORIQUE DES PAIEMENTS", margin, y);
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Eleve : ${nomComplet}`, margin, y);
  y += 5;
  doc.text(`Classe : ${classe}`, margin, y);
  y += 5;
  doc.text(`Date du releve : ${reportDate}`, margin, y);
  doc.setTextColor(...COLOR_BLACK);
  y += 12;

  const tarifMensuel = toNumber(eleve.tarif_mensuel);
  const totalAnnuelDu = tarifMensuel * ACADEMIC_MONTHS_COUNT;
  const totalPaye = toNumber(eleve.total_paye);
  const reste = toNumber(eleve.reste_a_payer);
  const credit = toNumber(eleve.credit_eleve);

  let statusLabel = "Statut";
  let statusValue;
  if (reste > 0.005) {
    statusValue = `Reste a payer : ${formatCurrency(reste)}`;
  } else if (credit > 0.005) {
    statusValue = `Crédit (acompte) : ${formatCurrency(credit)}`;
  } else {
    statusValue = "Compte solde : ni reste a payer ni acompte";
  }

  const summaryX = margin;
  const summaryW = pageW - 2 * margin;
  const pad = 8;
  const innerLeft = summaryX + pad;
  const innerRight = summaryX + summaryW - pad;
  const rowGap = 8;
  const statusValueColW = summaryW - 2 * pad - 40;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const statusLines = doc.splitTextToSize(statusValue, statusValueColW);
  const linePitch = 4.6;
  const statusBlockH = Math.max(rowGap, statusLines.length * linePitch);

  const summaryH =
    pad + 5 + (rowGap + 2) + rowGap + rowGap + (rowGap + 1) + 6 + statusBlockH + pad;

  doc.setFillColor(...COLOR_SUMMARY_BG);
  doc.roundedRect(summaryX, y, summaryW, summaryH, 2, 2, "F");
  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.25);
  doc.roundedRect(summaryX, y, summaryW, summaryH, 2, 2, "S");

  let sy = y + pad + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Synthèse financière", innerLeft, sy);
  sy += rowGap + 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_BLACK);
  doc.text("Total annuel dû (tarif mensuel x 10)", innerLeft, sy);
  doc.setFont("helvetica", "normal");
  doc.text(formatCurrency(totalAnnuelDu), innerRight, sy, { align: "right" });
  sy += rowGap;

  doc.setFont("helvetica", "bold");
  doc.text("Total payé (encaissements)", innerLeft, sy);
  doc.setFont("helvetica", "normal");
  doc.text(formatCurrency(totalPaye), innerRight, sy, { align: "right" });
  sy += rowGap + 1;

  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.2);
  doc.line(innerLeft, sy, innerRight, sy);
  sy += 6;

  doc.setFont("helvetica", "bold");
  doc.text(statusLabel, innerLeft, sy);
  doc.setFont("helvetica", "normal");
  let statusY = sy;
  for (const line of statusLines) {
    doc.text(line, innerRight, statusY, { align: "right" });
    statusY += linePitch;
  }

  y += summaryH + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_BLACK);
  doc.text("Détail des encaissements", margin, y);
  y += 4;

  const historique = Array.isArray(eleve.historique_paiements) ? [...eleve.historique_paiements] : [];
  historique.sort((a, b) => String(a.date_encaissement).localeCompare(String(b.date_encaissement)));

  const body = historique.map((p) => {
    const moisListe =
      Array.isArray(p.mois_concernes) && p.mois_concernes.length > 0
        ? formatMoisConcernesLabels(p.mois_concernes)
        : formatMoisConcerne(p.mois_concerne);
    return [
      formatDatePdfNumeric(p.date_encaissement),
      TYPE_FRAIS_LABEL[p.type_frais] ?? p.type_frais ?? "-",
      moisListe || "-",
      formatCurrency(p.montant_paye),
      METHODE_LABEL[p.methode] ?? p.methode ?? "-",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Date", "Type", "Mois couverts", "Montant", "Méthode"]],
    body: body.length ? body : [["-", "Aucun paiement enregistre", "", "", ""]],
    margin: { left: margin, right: margin, bottom: 52 },
    headStyles: {
      fillColor: COLOR_TABLE_HEAD_BG,
      textColor: COLOR_TABLE_HEAD_TEXT,
      fontStyle: "bold",
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 30 },
      2: { cellWidth: 58, overflow: "linebreak" },
      3: { cellWidth: 28, halign: "right" },
      4: { cellWidth: 26 },
    },
    styles: {
      fontSize: 9,
      minCellHeight: 10,
      cellPadding: 5,
      valign: "middle",
      textColor: COLOR_BLACK,
      lineColor: COLOR_LINE,
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    alternateRowStyles: { fillColor: COLOR_ZEBRA },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawBrandingFooterEveryPage(doc, pageW, pageH);
  }
  doc.setPage(pageCount);
  drawHistoryDocumentMeta(doc, pageW, pageH, margin);
  drawSignatureBlock(doc, pageW, pageH, margin);

  const id = eleve.id != null ? String(eleve.id) : "eleve";
  doc.save(`historique-paiements-${id}.pdf`);
}

/**
 * Reçu de paiement scolaire (A4).
 * @param {object} paiement — ligne API (type_frais, montant_du, montant_paye, reste_a_payer, mois_concerne, …)
 */
export async function generateRecuPaiement(paiement) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  const logo = await getSchoolLogoDataUrlForPdf();
  y += drawSchoolPdfHeader(doc, margin, y, logo) + 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Reçu de paiement", margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const eleveNom = [paiement?.eleve_prenom, paiement?.eleve_nom].filter(Boolean).join(" ").trim() || "—";
  const typeLabel =
    TYPE_FRAIS_LABEL[paiement?.type_frais] ?? paiement?.type_frais ?? "—";
  const fraisDu = parseAmount(paiement?.montant_du) ?? 0;
  const payeDu = parseAmount(paiement?.montant_paye) ?? 0;
  const resteLigne = Math.max(0, Math.round((fraisDu - payeDu) * 100) / 100);
  const acompteLigne = Math.max(0, Math.round((payeDu - fraisDu) * 100) / 100);

  const moisListe =
    Array.isArray(paiement?.mois_concernes) && paiement.mois_concernes.length > 0
      ? formatMoisConcernesLabels(paiement.mois_concernes)
      : formatMoisConcerne(paiement?.mois_concerne);

  const rows = [
    ["Élève", eleveNom],
    ["Classe", paiement?.eleve_classe ?? "—"],
    ["Type de frais", typeLabel],
    ["Mois concernés", moisListe || "—"],
    ["Frais exigés (DT)", formatMontantPdf(paiement?.montant_du)],
    ["Montant payé", formatMontantPdf(paiement?.montant_paye)],
    ["Reste à payer (ligne)", formatMontantPdf(resteLigne)],
    ["Acompte (ligne)", acompteLigne > 0.005 ? formatMontantPdf(acompteLigne) : "—"],
    ["Méthode de paiement", METHODE_LABEL[paiement?.methode] ?? paiement?.methode ?? "—"],
    ["Date d’encaissement", formatDateTimeFr(paiement?.date_encaissement)],
  ];

  const labelW = 52;
  const lineH = 8;
  doc.setDrawColor(...COLOR_LINE);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_BLACK);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(String(value), pageW - margin * 2 - labelW - 4);
    doc.text(lines, margin + labelW, y);
    doc.line(margin, y + 2, pageW - margin, y + 2);
    y += Math.max(lineH, (lines.length - 1) * 5 + lineH);
  }

  y += 12;
  const boxW = 78;
  const boxH = 32;
  const boxX = pageW - margin - boxW;
  doc.setDrawColor(...COLOR_LINE);
  doc.setLineWidth(0.4);
  doc.rect(boxX, y, boxW, boxH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Signature et cachet de l’établissement", boxX + 4, y + 8);

  drawFooterPrintDate(doc, pageW, pageH, margin);

  const id = paiement?.id != null ? String(paiement.id) : "paiement";
  doc.save(`recu-paiement-${id}.pdf`);
}

/**
 * Fiche de paie professeur (A4).
 * @param {object} data — réponse API resume_paie / calculer_paie + professeur, periodeLabel
 */
export async function generateFichePaie(data) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  const logo = await getSchoolLogoDataUrlForPdf();
  y += drawSchoolPdfHeader(doc, margin, y, logo) + 6;

  const hist = data?.fiche_historique === true;
  const fichePartielle = data?.fiche_donnee_partielle === true;

  const prenom = data?.professeur?.prenom ?? data?.professeurPrenom ?? "";
  const nom = data?.professeur?.nom ?? data?.professeurNom ?? "";
  const nomComplet = [prenom, nom].filter(Boolean).join(" ").trim() || "-";

  let periode = data?.periode_libelle ?? data?.periodeLabel;
  if (!periode && data?.mois != null && data?.annee != null) {
    periode = `${String(data.mois).padStart(2, "0")}/${data.annee}`;
  }
  if (!periode) periode = "-";

  const heuresVal = data?.heures_non_payees ?? data?.total_heures;
  const brutVal = data?.total_brut ?? data?.salaire_brut;
  const avancesVal = data?.avances_non_soldees ?? data?.total_avances;
  const netVal = data?.net_a_payer ?? data?.salaire_net;
  const netRestant = data?.net_restant ?? data?.net_a_payer_restant;
  const primesRaw = data?.primes_affichees ?? data?.primes;
  const primesVal = parseAmount(primesRaw) ?? 0;
  const showPrimes = primesVal > 0.005;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COLOR_BLACK);
  doc.text("Fiche de paie - Enseignant", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_BLACK);
  doc.text(pdfSafeText(nomComplet), margin, y);
  y += 5;
  const periodeLines = doc.splitTextToSize(pdfSafeText(String(periode)), pageW - 2 * margin);
  doc.text(periodeLines, margin, y);
  y += periodeLines.length * 5 + 3;
  if (data?.date_reference) {
    doc.text(
      hist ? `Paiement enregistre le ${data.date_reference}` : `Calcul au ${data.date_reference}`,
      margin,
      y,
    );
    y += 7;
  }
  doc.setTextColor(...COLOR_BLACK);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Detail du calcul", margin, y);
  y += 7;

  const th = Number(heuresVal);
  const rate = Number(data?.tarif_horaire);

  const heuresStr = formatHeuresPdf(heuresVal);
  const tarifStr = formatMontantDt(data?.tarif_horaire);
  const brutStr = formatMontantDt(brutVal);
  const avancesStr = formatMontantDt(avancesVal);
  const netStr = formatMontantDt(netVal);
  const primesStr = formatMontantDt(primesRaw);

  const heuresLabel = hist
    ? "Heures retenues pour ce versement"
    : "Heures non payees (jusqu'a la date du jour)";

  const detailLines = [
    [heuresLabel, `${heuresStr} h`],
    ["Tarif horaire", tarifStr],
    ["Salaire de base (heures x tarif)", brutStr],
  ];
  if (showPrimes) {
    detailLines.push(["Primes / bonus", primesStr]);
  }

  doc.setDrawColor(...COLOR_LINE);
  doc.setFontSize(10);
  for (const [label, value] of detailLines) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLOR_BLACK);
    const labelLines = doc.splitTextToSize(label, pageW - 2 * margin - 50);
    doc.text(labelLines, margin, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    doc.line(margin, y + 2, pageW - margin, y + 2);
    y += Math.max(9, labelLines.length * 5);
  }

  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const avanceLabel = hist ? "Avances deduites (ce versement)" : "Avances deduites (non soldees)";
  const labelA = doc.splitTextToSize(avanceLabel, pageW - 2 * margin - 50);
  doc.text(labelA, margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(`- ${avancesStr}`, pageW - margin, y, { align: "right" });
  doc.line(margin, y + 2, pageW - margin, y + 2);
  y += Math.max(11, labelA.length * 5) + 1;

  const netH = 16;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...COLOR_LINE);
  doc.rect(margin, y - 3, pageW - 2 * margin, netH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_BLACK);
  const netLabel = hist ? "Net verse" : "Net a payer";
  doc.text(netLabel, margin + 3, y + 6);
  doc.text(netStr, pageW - margin - 3, y + 6, { align: "right" });

  y += netH + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_MUTED);
  const baseFormula =
    !Number.isNaN(th) && !Number.isNaN(rate) ? `${heuresStr} h x ${tarifStr}` : "Heures x Tarif";
  let formuleBas = `(${baseFormula})`;
  if (showPrimes) formuleBas += " + Primes";
  formuleBas += " - Avances";
  const formula = `${formuleBas} = ${netLabel.toLowerCase()}`;
  const formulaWrapped = doc.splitTextToSize(formula, pageW - 2 * margin);
  doc.text(formulaWrapped, margin, y);
  y += formulaWrapped.length * 4 + 3;

  if (fichePartielle) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Document archive : certains champs n'ont pas ete enregistres a l'epoque du versement.",
      margin,
      y,
    );
    y += 5;
  }

  if (!hist && netRestant != null && netRestant !== "" && Number(netRestant) > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_BLACK);
    doc.text(`Solde restant du : ${formatMontantDt(netRestant)}`, margin, y);
    y += 6;
  }

  if (!hist && data?.note_reliquat_anticipatif) {
    y += 2;
    doc.setDrawColor(...COLOR_LINE);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(120, 92, 20);
    const noteLines = doc.splitTextToSize(
      pdfSafeText(String(data.note_reliquat_anticipatif)),
      pageW - 2 * margin,
    );
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4.5 + 2;
    doc.setTextColor(...COLOR_BLACK);
  }

  drawFooterPrintDate(doc, pageW, pageH, margin);

  const id = data?.date_reference ?? data?.mois ?? "";
  const slug = `${pdfSafeText(nom) || "prof"}-${id}`
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  doc.save(`fiche-paie-${slug || "prof"}.pdf`);
}

function pointageStatutLabelPdf(statut) {
  const s = statut || "PRESENTE";
  if (s === "A_VENIR") return "A venir";
  if (s === "ABSENTE") return "Absent";
  if (s === "RETARD") return "Annule / retard";
  return "Present";
}

function formatDateCourtePdf(isoDate) {
  if (!isoDate) return "-";
  const s = String(isoDate).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (y && m && d && y.length === 4) {
    return `${d}/${m}/${y}`;
  }
  return s || "-";
}

/**
 * Rapport présence / synthèse financière pour la paie (A4).
 */
export async function generateSalaireRapportPdf({ professeur, resume, pointages, periodeLabel }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = 14;

  const prenom = professeur?.prenom ?? "";
  const nom = professeur?.nom ?? "";
  const nomComplet = [prenom, nom].filter(Boolean).join(" ").trim() || "-";
  const nomCompletPdf = pdfSafeText(nomComplet);

  const logo = await getSchoolLogoDataUrlForPdf();
  y += drawSchoolPdfHeader(doc, margin, y, logo) + 6;
  doc.setFontSize(16);
  doc.setTextColor(...COLOR_BLACK);
  const title = `Rapport salaire et presence - ${nomCompletPdf}`;
  const titleLines = doc.splitTextToSize(title, pageW - margin * 2);
  doc.text(titleLines, pageW / 2, y, { align: "center" });
  y += titleLines.length * 7 + 4;

  doc.setFontSize(11);
  doc.setTextColor(...COLOR_MUTED);
  doc.text(`Periode : ${pdfSafeText(periodeLabel) || "-"}`, pageW / 2, y, { align: "center" });
  y += 10;

  doc.setFontSize(10);
  doc.setTextColor(...COLOR_BLACK);
  const heuresNonPayees = resume?.heures_non_payees ?? resume?.total_heures;
  const brut = resume?.total_brut ?? resume?.salaire_brut;
  const avancesVal = resume?.avances_non_soldees ?? resume?.total_avances;
  const net = resume?.net_a_payer ?? resume?.salaire_net;
  const reste = resume?.heures_restantes_mois;

  const heuresSeances = (pointages || []).reduce((sum, row) => {
    if (row.statut_presence === "A_VENIR" || String(row.id ?? "").startsWith("virtual_")) {
      return sum;
    }
    return sum + Number(row.nombre_heures || 0);
  }, 0);

  doc.text(`Heures (seances) sur la periode affichee : ${formatHeuresPdf(heuresSeances)} h`, margin, y);
  y += 6;
  doc.text(
    `Heures non payees jusqu'a la date du jour (calcul paie) : ${formatHeuresPdf(heuresNonPayees)} h`,
    margin,
    y,
  );
  y += 6;
  doc.text(`Total brut : ${formatCurrency(brut)}`, margin, y);
  y += 6;
  doc.text(`Avances deduites (non soldees) : ${formatCurrency(avancesVal)}`, margin, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text(`Net a payer : ${formatCurrency(net)}`, margin, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  if (reste != null && Number(reste) > 0) {
    doc.setTextColor(...COLOR_MUTED);
    doc.text(`Heures prevues restantes (fin du mois, EDT) : ${formatHeuresPdf(reste)} h`, margin, y);
    y += 6;
    doc.setTextColor(...COLOR_BLACK);
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Detail des seances", margin, y);
  y += 7;

  const tableBody = (pointages || []).map((row) => [
    formatDateCourtePdf(row.date_cours),
    `${formatHeuresPdf(row.nombre_heures)} h`,
    pointageStatutLabelPdf(row.statut_presence),
    row.est_paye ? "Paye" : "En attente",
    String(row.classe_nom ?? "").trim() || "-",
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Date", "Heures", "Statut", "Reglement", "Classe"]],
    body: tableBody,
    theme: "striped",
    headStyles: { fillColor: COLOR_TABLE_HEAD_BG, textColor: COLOR_TABLE_HEAD_TEXT, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 22, halign: "right" },
      2: { cellWidth: 32 },
      3: { cellWidth: 28 },
      4: { cellWidth: "auto" },
    },
    margin: { left: margin, right: margin },
  });

  drawFooterPrintDate(doc, pageW, pageH, margin);

  const slug = sanitizeFilenamePart(nomCompletPdf);
  doc.save(`Rapport_Paie_${slug}_${periodeLabel?.replace(/\//g, "-") || "periode"}.pdf`);
}

function sanitizeFilenamePart(name) {
  const s = String(name ?? "Professeur")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return s.slice(0, 48) || "Professeur";
}
