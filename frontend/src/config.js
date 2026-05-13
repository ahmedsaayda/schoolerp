/**
 * Origine du backend Django (sans slash final, sans suffixe /api — les routes utilisent `/api/...`).
 * Si VITE_API_URL contient erreur commune `…/api`, on le retire pour éviter `/api/api/...`.
 */
function normalizeApiOrigin(raw) {
  let s = String(raw ?? "").trim().replace(/\/+$/, "");
  if (/\/api$/i.test(s)) {
    s = s.replace(/\/api$/i, "").replace(/\/+$/, "");
  }
  return s || "http://localhost:8000";
}

export const API_BASE = normalizeApiOrigin(import.meta.env.VITE_API_URL);

export const API_AUTH_CSRF = `${API_BASE}/api/auth/csrf/`;
export const API_AUTH_LOGIN = `${API_BASE}/api/auth/login/`;
export const API_AUTH_LOGOUT = `${API_BASE}/api/auth/logout/`;
export const API_AUTH_ME = `${API_BASE}/api/auth/me/`;
export const API_AUTH_PASSWORD_RESET_REQUEST = `${API_BASE}/api/auth/password-reset/request/`;
export const API_AUTH_PASSWORD_RESET_CONFIRM = `${API_BASE}/api/auth/password-reset/confirm/`;
export const API_AUTH_PASSWORD_CHANGE = `${API_BASE}/api/auth/password/change/`;
export const API_AUTH_PASSWORD_OPS_SEND_RESET = `${API_BASE}/api/auth/password-ops/send-reset/`;
export const API_ELEVES = `${API_BASE}/api/eleves/`;
export const API_ELEVES_IMPAYES = `${API_BASE}/api/eleves/impayes/`;
export const API_PAIEMENTS = `${API_BASE}/api/paiements/`;
export const API_PROFESSEURS = `${API_BASE}/api/professeurs/`;
export const API_PERSONNEL = `${API_BASE}/api/personnel/`;
export const API_PAIEMENTS_SALAIRE = `${API_BASE}/api/paiements-salaire/`;
/** GET — filtres : ?personnel=&date=YYYY-MM-DD (liste des `PointagePersonnel`). */
export const API_POINTAGE_PERSONNEL = `${API_BASE}/api/pointage-personnel/`;
/** GET ?date=YYYY-MM-DD — personnel + pointages du jour (directrice / ADMIN uniquement). */
export const API_POINTAGE_PERSONNEL_JOUR = `${API_BASE}/api/pointage-personnel/get-personnel-and-pointages/`;
export const API_POINTAGE_PERSONNEL_BULK = `${API_BASE}/api/pointage-personnel/bulk-enregistrer/`;
/** GET ?date=YYYY-MM-DD (optionnel, défaut aujourd’hui) — personnel sans `PointagePersonnel` ce jour. */
export const API_POINTAGE_PERSONNEL_MANQUANTS = `${API_BASE}/api/pointage-personnel/pointage-manquants/`;
export const API_EMPLOIS_DU_TEMPS = `${API_BASE}/api/emplois-du-temps/`;
/** POST : remplacer toutes les séances du trimestre pour une classe (modèle hebdo → dates). */
export const API_EMPLOIS_REMPLACER_TRIMESTRE = `${API_BASE}/api/emplois-du-temps/remplacer-modele-trimestre/`;
export const API_EMPLOIS_REMPLACER_ANNUEL = `${API_BASE}/api/emplois-du-temps/remplacer-modele-annuel/`;
/** POST : régénère les dates du trimestre à partir des séances déjà enregistrées (déduplication hebdo). */
export const API_EMPLOIS_BULK_GENERATE_FROM_TEMPLATE = `${API_BASE}/api/emplois-du-temps/bulk-generate-from-template/`;
export const API_CLASSES = `${API_BASE}/api/classes/`;
export const API_DEPENSES = `${API_BASE}/api/depenses/`;
export const API_POINTAGES = `${API_BASE}/api/pointages/`;
export const API_POINTAGES_SESSIONS_JOUR = `${API_BASE}/api/pointages/sessions_du_jour/`;
/** GET ?date= — professeurs avec séance (emploi du temps) ce jour et au moins un créneau sans pointage. */
export const API_POINTAGES_PROF_MANQUANTS = `${API_BASE}/api/pointages/professeurs-pointage-manquants/`;
export const API_AVANCES_SALAIRE = `${API_BASE}/api/avances-salaire/`;
export const API_SESSIONS_CAISSE = `${API_BASE}/api/sessions-caisse/`;
/** GET — { solde_actuel } (banque interne) */
export const API_BANQUE_SOLDE = `${API_BASE}/api/banque/solde/`;
/** POST — { solde_actuel } forcé pour Banque(pk=1) — installation / réconciliation (ADMIN uniquement). */
export const API_BANQUE_DEFINIR_SOLDE = `${API_BASE}/api/banque/definir-solde-actuel/`;
/** CRUD vacances et jours fériés (ADMIN uniquement). */
export const API_CALENDRIER_SCOLAIRE = `${API_BASE}/api/calendrier-scolaire/`;
/** POST multipart — verser de la caisse vers la banque (justificatif obligatoire) */
export const API_BANQUE_VERSER = `${API_BASE}/api/banque/verser-vers-banque/`;
/** POST multipart — retrait banque (alimentation de la caisse) */
export const API_BANQUE_RETRAIT = `${API_BASE}/api/banque/retrait-alimentation/`;
/** GET — { session: null | object, ouverture_session_bloquee: bool } */
export const API_SESSION_CAISSE_COURANTE = `${API_BASE}/api/sessions-caisse/courante/`;
/** GET — liste complète avec filtres : ?date_debut=&date_fin=&type=versement|retrait */
export const API_MOUVEMENTS_BANQUE = `${API_BASE}/api/mouvements-banque/`;
/** GET — versements avec promesse de justificatif (badge header / liste restreinte). */
export const API_MOUVEMENTS_BANQUE_PROMESSES = `${API_BASE}/api/mouvements-banque/promesses/`;
/** @deprecated Remplacé par API_MOUVEMENTS_BANQUE_PROMESSES */
export const API_SESSION_CAISSE_PROMESSES = `${API_BASE}/api/sessions-caisse/promesses-justificatif/`;
/** POST — annuler un MouvementBanque en attente (restaure la caisse, ne touche pas la banque). */
export const apiMouvementBanqueAnnulerVersement = (id) =>
  `${API_BASE}/api/mouvements-banque/${id}/annuler_versement/`;
/** POST multipart — compléter le justificatif d'un MouvementBanque en attente (crédite la banque). */
export const apiMouvementBanqueCompleterJustificatif = (id) =>
  `${API_BASE}/api/mouvements-banque/${id}/completer-justificatif/`;
/** GET ?start_date=&end_date= — journal ; avec ?session_caisse=ID : lignes de cette session + bilan clôture. */
export const API_CAISSE_JOURNAL = `${API_BASE}/api/caisse/journal/`;
export const API_AUDIT_LOGS = `${API_BASE}/api/audit-logs/`;
/** GET — [{ id, label }] pour le filtre Modèle / Entité du journal d'audit. */
export const API_AUDIT_LOGS_MODELS = `${API_BASE}/api/audit-logs/models/`;
export const API_STAFF_USERS = `${API_BASE}/api/staff-users/`;
export const API_STATS_DASHBOARD = `${API_BASE}/api/stats/dashboard/`;
export const API_STATS_FINANCIAL = `${API_BASE}/api/stats/financial-analytics/`;
export const API_DASHBOARD_ANALYTICS = `${API_BASE}/api/dashboard-analytics/`;
/** Agrégats dashboard (KPI, séries mensuelles, impayés) — à implémenter côté Django. */
export const API_DASHBOARD_STATS = `${API_BASE}/api/dashboard/stats/`;

export const STORAGE_AUTH_KEY = "erp_auth";

/**
 * Événement document : session ou solde de caisse mis à jour (paiement, dépense, ouverture / clôture).
 * Sert à rafraîchir la barre globale et la page Caisse (pas de WebSocket côté projet).
 */
export const EVENT_CAISSE_SESSION_CHANGED = "school-caisse-session-changed";

export function dispatchCaisseSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_CAISSE_SESSION_CHANGED));
}

/**
 * Reads a cookie value by name from document.cookie.
 * Returns null when the cookie is absent or the environment has no document
 * (e.g. SSR / test runners).
 */
function getCookie(name) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Central fetch wrapper for the Django API.
 *
 * - Toujours `credentials: "include"` pour envoyer sessionid (ne peut pas être écrasé par `options`).
 * - Envoie `X-CSRFToken` si le cookie `csrftoken` est lisible (même origine) ; avec l’API sur un
 *   autre domaine, le backend utilise `SessionAuthenticationWithoutCSRF`.
 * - Les en-têtes passés par l’appellant priment sur les défauts (sauf credentials).
 */
export function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const csrfHeaders = {};

  if (MUTATING_METHODS.has(method)) {
    const token = getCookie("csrftoken");
    if (token) {
      csrfHeaders["X-CSRFToken"] = token;
    }
  }

  const isFormData =
    typeof FormData !== "undefined" &&
    options.body != null &&
    options.body instanceof FormData;
  const defaultHeaders = isFormData
    ? { Accept: "application/json", ...csrfHeaders }
    : { Accept: "application/json", "Content-Type": "application/json", ...csrfHeaders };

  const { headers: callerHeaders = {}, ...rest } = options;
  return fetch(url, {
    ...rest,
    headers: {
      ...defaultHeaders,
      ...callerHeaders,
    },
    credentials: "include",
  });
}
