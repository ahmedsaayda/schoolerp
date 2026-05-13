/** Identité visuelle officielle — documents et interface. */

export const SCHOOL_NAME = "SAMAH SCHOOL";
export const SCHOOL_TAGLINE = "Administration scolaire";

export function logoSchoolPublicUrl() {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}assets/logo-school.png`;
}

/** Logo officiel pour documents imprimés et PDF (`public/logo.png`). */
export function schoolLogoPrintPublicUrl() {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}logo.png`;
}

let logoPdfDataUrlPromise = null;

/**
 * Data URL PNG pour jsPDF (un seul chargement réseau, résultat mis en cache).
 * @returns {Promise<string|null>}
 */
export function getSchoolLogoDataUrlForPdf() {
  if (!logoPdfDataUrlPromise) {
    logoPdfDataUrlPromise = (async () => {
      try {
        const res = await fetch(schoolLogoPrintPublicUrl());
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    })();
  }
  return logoPdfDataUrlPromise;
}
