/**
 * Tarif mensuel total élève : champ calculé `tarif_mensuel` (API) ou somme des quatre postes.
 * @param {object | null | undefined} el
 * @returns {number}
 */
export function eleveTarifMensuelTotal(el) {
  if (!el) return NaN;
  if (el.tarif_mensuel != null && el.tarif_mensuel !== "") {
    const n = Number(String(el.tarif_mensuel).replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  let s = 0;
  for (const k of ["tarif_scolarite", "tarif_transport", "tarif_etudes", "tarif_autre"]) {
    const v = el[k];
    if (v != null && v !== "") {
      const n = Number(String(v).replace(",", "."));
      if (Number.isFinite(n)) s += n;
    }
  }
  return s;
}
