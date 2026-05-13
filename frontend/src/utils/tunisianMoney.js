/**
 * Tunisian market: dinar tunisien (ISO 4217 TND) with locale fr-TN
 * (grouping and decimals; suffix DT from Intl, not browser default currency).
 */
const LOCALE = "fr-TN";
const CURRENCY = "TND";

/**
 * @param {unknown} value
 * @param {{
 *   minFractionDigits?: number;
 *   maxFractionDigits?: number;
 *   minimumFractionDigits?: number;
 *   maximumFractionDigits?: number;
 *   empty?: string;
 * }} [opts]
 */
export function formatTnd(value, opts = {}) {
  const min = opts.minFractionDigits ?? opts.minimumFractionDigits ?? 2;
  const max = opts.maxFractionDigits ?? opts.maximumFractionDigits ?? 2;
  const empty = opts.empty ?? "—";
  if (value == null || value === "") return empty;
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: CURRENCY,
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }).format(n);
  } catch {
    return `${n.toLocaleString(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max })} DT`;
  }
}

/**
 * Montant TND pour jsPDF : chiffres, espace milliers, virgule décimale, suffixe « DT » — uniquement ASCII
 * (Helvetica standard ne gère pas bien les symboles / espaces insécables produits par Intl).
 */
export function formatTndPdf(value, opts = {}) {
  const empty = opts.empty ?? "-";
  if (value == null || value === "") return empty;
  let n;
  if (typeof value === "number" && Number.isFinite(value)) {
    n = value;
  } else {
    const s = String(value).trim().replace(/\s/g, "").replace(",", ".");
    n = Number(s);
  }
  if (!Number.isFinite(n)) return empty;
  const neg = n < 0;
  const abs = Math.abs(n);
  const [intRaw, dec] = abs.toFixed(2).split(".");
  const intGrouped = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = `${intGrouped},${dec} DT`;
  return neg ? `- ${body}` : body;
}

/**
 * Plain numbers (axes, heures) — fr-TN grouping, no currency symbol.
 * @param {unknown} value
 * @param {{ minimumFractionDigits?: number; maximumFractionDigits?: number; empty?: string }} [opts]
 */
export function formatTnNumber(value, opts = {}) {
  const empty = opts.empty ?? "—";
  if (value == null || value === "") return empty;
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: opts.minimumFractionDigits ?? 0,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  }).format(n);
}
