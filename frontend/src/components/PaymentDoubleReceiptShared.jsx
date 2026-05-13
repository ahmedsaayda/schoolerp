import { schoolLogoPrintPublicUrl } from "../branding.js";

import { formatTnd } from "../utils/tunisianMoney.js";

function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function formatDt(value) {
  return formatTnd(toNumber(value));
}

/** Styles impression : reçu double + fiche historique (identique à l’ancien bloc EleveDetailsModal). */
export const PRINT_DOUBLE_RECEIPT_STYLES = `
@media screen {
  .print-section {
    position: fixed !important;
    left: -99999px !important;
    top: 0 !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    white-space: nowrap !important;
  }
}
@media print {
  @page {
    size: A4 landscape !important;
    margin: 5mm !important;
  }
  @page portrait_full {
    size: A4 portrait !important;
    margin: 10mm !important;
  }
  html {
    margin: 0 !important;
    padding: 0 !important;
  }
  body {
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html:has(.print-container),
  body:has(.print-container) {
    height: 100% !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .no-print {
    display: none !important;
  }
  body * { visibility: hidden !important; }
  .print-section, .print-section * { visibility: visible !important; }
  .print-section:has(.print-container) {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    clip: auto !important;
  }
  .print-section:not(:has(.print-container)) {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    clip: auto !important;
    height: auto !important;
    overflow: visible !important;
  }
  .print-container {
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    page-break-after: avoid !important;
    page-break-before: avoid !important;
    break-after: avoid !important;
    break-before: avoid !important;
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
  }
  .print-only-receipt-root {
    box-sizing: border-box !important;
  }
  .print-receipt-landscape-root {
    width: 100% !important;
    max-width: 100% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    font-family: ui-sans-serif, system-ui, sans-serif !important;
    font-size: 12pt !important;
    line-height: 1.35 !important;
    color: #0f172a !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  .print-receipt-landscape-root * {
    box-sizing: border-box;
  }
  .print-receipt-sheet-grid {
    width: 280mm !important;
    max-width: 280mm !important;
    min-height: 0 !important;
    max-height: 100% !important;
    height: 100% !important;
    margin: 0 auto !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 10mm !important;
    align-items: stretch !important;
    background: #fff !important;
    overflow: hidden !important;
  }
  .print-receipt-cell {
    min-width: 0 !important;
    min-height: 0 !important;
    max-height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .print-receipt-cell:first-child {
    border-right: 2px dashed black !important;
  }
  .receipt-a5 {
    min-height: 0 !important;
    height: 100% !important;
    max-height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .receipt-a5-card {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    padding-bottom: 0 !important;
    margin-bottom: 0 !important;
  }
  .receipt-sig-sticky {
    margin-top: auto !important;
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }
  .receipt-sig-sticky .receipt-print-foot {
    margin-bottom: 0.3em !important;
  }
  .receipt-sig-columns {
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }
  .receipt-sig-columns .receipt-print-sig p {
    margin-bottom: 0 !important;
  }
  .print-receipt-landscape-root .receipt-print-h1 {
    font-size: 18pt !important;
    line-height: 1.2 !important;
  }
  .print-receipt-landscape-root .receipt-print-sub {
    font-size: 12pt !important;
  }
  .print-receipt-landscape-root .receipt-print-label-top {
    font-size: 10pt !important;
    letter-spacing: 0.05em !important;
  }
  .print-receipt-landscape-root .receipt-print-text {
    font-size: 12pt !important;
    line-height: 1.4 !important;
  }
  .print-receipt-landscape-root .receipt-print-amount {
    font-size: 16pt !important;
  }
  .print-receipt-landscape-root .receipt-print-foot {
    font-size: 10pt !important;
  }
  .print-receipt-landscape-root .receipt-print-sig {
    font-size: 11pt !important;
  }
  .print-root-full {
    page: portrait_full !important;
    max-width: none !important;
    width: 100% !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    padding: 8mm;
    font-family: ui-sans-serif, system-ui, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .print-page {
    page-break-after: avoid !important;
    page-break-before: avoid !important;
    break-after: avoid !important;
    height: auto !important;
    max-height: 205mm !important;
    overflow: hidden !important;
  }
  .print-container.print-page {
    height: auto !important;
    max-height: 205mm !important;
    overflow: hidden !important;
  }
  .print-fiche-scale {
    zoom: 0.95;
  }
  footer:not(.fiche-print-footer),
  .footer-space {
    display: none !important;
  }
  .print-only-receipt-root.print-container {
    height: auto !important;
    max-height: 200mm !important;
    min-height: 0 !important;
  }
  .print-receipt-landscape-root {
    max-height: 200mm !important;
    height: 200mm !important;
  }
  .print-receipt-sheet-grid {
    max-height: 200mm !important;
    height: 200mm !important;
    gap: 6mm !important;
  }
  .print-receipt-landscape-root .receipt-a5-card {
    padding: 5px 6px !important;
  }
  .print-receipt-landscape-root .receipt-print-h1 {
    font-size: 16pt !important;
  }
  .print-receipt-landscape-root .receipt-print-text {
    font-size: 11pt !important;
    line-height: 1.3 !important;
  }
}
`;

/**
 * Un exemplaire de reçu (même contenu, libellé de copie + styles pt à l’impression).
 */
export function ReceiptExemplaire({ copyLabel, eleve, monthLabel, monthCode, montantApplique, dateEmission }) {
  const montantStr = formatDt(montantApplique);
  return (
    <div className="receipt-a5 flex h-full min-h-0 min-w-0 w-full flex-1 flex-col text-slate-900">
      <p className="receipt-print-label-top mb-1.5 shrink-0 text-center text-xs font-bold uppercase text-slate-500">
        {copyLabel}
      </p>
      <div className="receipt-a5-card flex min-h-0 flex-1 flex-col border-2 border-slate-900 bg-white p-2 text-sm leading-normal sm:p-3">
        <div className="mb-6 flex shrink-0 items-center justify-between gap-4 border-b-2 border-slate-900 pb-3">
          <img
            src={schoolLogoPrintPublicUrl()}
            alt="SAMAH SCHOOL Logo"
            className="h-16 w-auto shrink-0 object-contain"
          />
          <div className="min-w-0 text-right">
            <p className="receipt-print-sub text-[10px] font-semibold uppercase tracking-widest text-slate-600 sm:text-xs">
              Établissement scolaire
            </p>
            <h1 className="receipt-print-h1 mt-0.5 text-lg font-bold uppercase tracking-tight sm:text-xl">Reçu de paiement</h1>
            <p className="receipt-print-sub mt-0.5 text-[10px] text-slate-600 sm:text-xs">Mensualité scolaire</p>
          </div>
        </div>
        <div className="receipt-print-text mt-2 min-h-0 flex-1 space-y-2 sm:mt-3 sm:space-y-2.5">
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 gap-y-0.5 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Élève</span>
            <span className="min-w-0 break-words font-bold leading-tight">
              {eleve.prenom} {eleve.nom}
            </span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Classe</span>
            <span className="leading-tight">{eleve.classe || "—"}</span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Mois concerné</span>
            <span className="leading-tight">
              {monthLabel} <span className="text-slate-500">({monthCode})</span>
            </span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Montant payé</span>
            <span className="receipt-print-amount text-lg font-bold tabular-nums sm:text-xl">{montantStr} DT</span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Date</span>
            <span className="break-words leading-tight">{dateEmission}</span>
          </div>
        </div>
        <div className="receipt-sig-sticky mt-auto w-full pt-2">
          <p className="receipt-print-foot mb-2 shrink-0 text-center text-[9px] leading-tight text-slate-500 sm:mb-3 sm:text-[10px]">
            Document généré à titre de reçu — sans valeur fiscale contractuelle.
          </p>
          <div className="receipt-sig-columns flex w-full flex-row gap-2 border-t border-slate-300 pt-2 sm:gap-3 sm:pt-3">
            <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
              <p>Signature et cachet de l&apos;établissement</p>
              <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
            </div>
            <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
              <p>Signature de l&apos;élève / tuteur</p>
              <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reçu paysage : deux exemplaires (Administration + Parent). */
export function ReceiptTemplate(props) {
  return (
    <div className="print-receipt-landscape-root">
      <div className="print-receipt-sheet-grid w-full max-w-full sm:max-w-[280mm]">
        <div className="print-receipt-cell min-h-0">
          <ReceiptExemplaire copyLabel="COPIE ADMINISTRATION" {...props} />
        </div>
        <div className="print-receipt-cell min-h-0">
          <ReceiptExemplaire copyLabel="COPIE ÉLÈVE / PARENT" {...props} />
        </div>
      </div>
    </div>
  );
}
