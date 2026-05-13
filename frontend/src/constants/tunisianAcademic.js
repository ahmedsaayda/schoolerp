/** Référentiel académique tunisien (aligné sur `scolarite.models`). */

export const CAPACITE_CLASSE_MAX = 30;

export const NIVEAU_OPTIONS = [
  { value: "7BASE", label: "7ème année de base" },
  { value: "8BASE", label: "8ème année de base" },
  { value: "9BASE", label: "9ème année de base" },
  { value: "1SEC", label: "1ère année secondaire" },
  { value: "2SEC", label: "2ème année secondaire" },
  { value: "3SEC", label: "3ème année secondaire" },
  { value: "4SEC", label: "4ème année secondaire (Baccalauréat)" },
];

export const SECONDARY_SECTION_OPTIONS = [
  { value: "SCI_EXP", label: "Sciences expérimentales" },
  { value: "MATH", label: "Mathématiques" },
  { value: "ECO_GEST", label: "Économie et gestion" },
  { value: "LETTRES", label: "Lettres" },
  { value: "TECH", label: "Technique" },
  { value: "INFO", label: "Sciences de l'informatique" },
];

export const TRONC_NIVEAU_CODES = new Set(["7BASE", "8BASE", "9BASE", "1SEC"]);

export function isTroncNiveau(code) {
  return TRONC_NIVEAU_CODES.has(code);
}

/** Filtres liste (toutes sections + filières secondaire). */
export const SECTION_FILTER_OPTIONS = [
  { value: "", label: "Toutes les sections" },
  ...SECONDARY_SECTION_OPTIONS,
];

export const SECTION_LABEL_BY_VALUE = Object.fromEntries(
  [["", "Tronc commun"], ...SECONDARY_SECTION_OPTIONS.map((o) => [o.value, o.label])],
);

/**
 * Libellé section pour tableaux / cartes : tronc commun pour 7BASE→1SEC ; sinon filière ou « — ».
 */
export function formatSectionCell(niveau, section, sectionDisplay) {
  if (isTroncNiveau(niveau)) return "Tronc commun";
  const raw = String(
    sectionDisplay ?? SECTION_LABEL_BY_VALUE[section] ?? section ?? "",
  ).trim();
  return raw || "—";
}

/**
 * Classes dont le niveau correspond ; tronc = section vide ; 2e–4e secondaire = section optionnelle
 * (si `sectionFilter` est renseigné, filtre strict sur la filière).
 */
export function filterClassesByNiveauSection(allClasses, niveau, sectionFilter) {
  if (!niveau || !Array.isArray(allClasses)) return allClasses ?? [];
  let list = allClasses.filter((c) => c.niveau === niveau);
  if (isTroncNiveau(niveau)) {
    return list.filter((c) => String(c.section ?? "").trim() === "");
  }
  if (sectionFilter) {
    return list.filter((c) => c.section === sectionFilter);
  }
  return list;
}
