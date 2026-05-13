/**
 * Affichage « Reste à payer » en liste : EXONÉRÉ pour les élèves gratuits (évite de fausser les totaux visuels).
 * @param {{ is_gratuit?: boolean, reste_a_payer?: string|number }} row
 * @param {(v: string|number) => string} formatAmount
 * @returns {{ text: string, isExonere: boolean }}
 */
export function eleveListeResteDisplay(row, formatAmount) {
  if (row?.is_gratuit) {
    return { text: "EXONÉRÉ", isExonere: true };
  }
  const r = row?.reste_a_payer;
  return { text: formatAmount(r ?? 0), isExonere: false };
}
