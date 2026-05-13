/**
 * Détecte les erreurs API lorsqu’aucune session de caisse n’est ouverte (messages DRF).
 */
export function isNoSessionCaisseErrorMessage(message) {
  if (typeof message !== "string") return false;
  const m = message.trim().toLowerCase();
  return m.includes("aucune session de caisse") && m.includes("ouverte");
}

/** Extrait un message lisible depuis un corps JSON d’erreur DRF. */
export function messageFromDrfErrorBody(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail) && data.detail.length) {
    const parts = data.detail
      .map((x) => (typeof x === "string" ? x : x?.msg ?? ""))
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    const s = Array.isArray(v) ? v.map((x) => String(x)).join(" ") : String(v);
    if (s) return `${k}: ${s}`;
  }
  return "";
}
