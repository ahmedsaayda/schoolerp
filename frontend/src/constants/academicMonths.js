/** Année scolaire : septembre → juin (codes « MM »). */
export const ACADEMIC_MONTHS = [
  ["09", "Septembre"],
  ["10", "Octobre"],
  ["11", "Novembre"],
  ["12", "Décembre"],
  ["01", "Janvier"],
  ["02", "Février"],
  ["03", "Mars"],
  ["04", "Avril"],
  ["05", "Mai"],
  ["06", "Juin"],
];

export const ACADEMIC_MONTH_LABEL_BY_CODE = Object.fromEntries(ACADEMIC_MONTHS);

/** Ex. "2026-04" → "04" ; sinon null. */
export function academicMonthCodeFromYearMonth(yyyyMm) {
  if (yyyyMm == null || String(yyyyMm).trim() === "") return null;
  const s = String(yyyyMm).trim().slice(0, 7);
  const parts = s.split("-");
  if (parts.length !== 2) return null;
  const code = parts[1].padStart(2, "0");
  return ACADEMIC_MONTH_LABEL_BY_CODE[code] ? code : null;
}

export function formatMoisConcernesLabels(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return "";
  return codes
    .map((c) => ACADEMIC_MONTH_LABEL_BY_CODE[String(c).padStart(2, "0")] ?? c)
    .filter(Boolean)
    .join(", ");
}
