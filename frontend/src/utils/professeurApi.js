/**
 * Normalise une ligne API professeur (compat. anciennes réponses / champs null).
 */
export function normalizeProfesseurFromApi(row) {
  if (!row || typeof row !== "object") return row;
  const ta = row.travaille_ailleurs;
  const worksElsewhere = ta === true || ta === "true" || ta === 1;
  const nomAutreRaw =
    row.nom_autre_etablissement != null && String(row.nom_autre_etablissement).length
      ? row.nom_autre_etablissement
      : row.autre_etablissement;
  const nomAutre = nomAutreRaw != null ? String(nomAutreRaw) : "";
  return {
    ...row,
    travaille_ailleurs: worksElsewhere,
    nom_autre_etablissement: nomAutre,
  };
}

export function normalizeProfesseursListFromApi(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProfesseurFromApi);
}
