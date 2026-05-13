/** Normalise une chaîne pour recherche insensible aux accents / casse. */
export function normalizeNameSearch(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}
