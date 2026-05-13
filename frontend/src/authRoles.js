import { STORAGE_AUTH_KEY } from "./config.js";

export const ROLE = {
  ADMIN: "ADMIN",
  POINTAGE_AGENT: "POINTAGE_AGENT",
  COMPTABLE: "COMPTABLE",
  PASSWORD_OPS: "PASSWORD_OPS",
};

export function readStoredUserRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function userPayloadFromApi(data) {
  if (!data || typeof data !== "object") return null;
  return {
    username: data.username ?? "",
    display_name: data.display_name ?? "",
    first_name: data.first_name ?? "",
    last_name: data.last_name ?? "",
    email: data.email ?? "",
    role: data.role ?? "",
    role_label: data.role_label ?? "",
    is_superuser: Boolean(data.is_superuser),
    must_change_password: Boolean(data.must_change_password),
  };
}

export function isAdminUser(u) {
  if (!u) return false;
  if (u.is_superuser) return true;
  return u.role === ROLE.ADMIN;
}

export function isPointageAgent(u) {
  return Boolean(u && u.role === ROLE.POINTAGE_AGENT);
}

export function isComptable(u) {
  return Boolean(u && u.role === ROLE.COMPTABLE);
}

/** Compte technique « opérations mot de passe » (hors superuser Django). */
export function isPasswordOpsOnlyUser(u) {
  return Boolean(u && !u.is_superuser && u.role === ROLE.PASSWORD_OPS);
}

/**
 * Chemins autorisés pour le seul rôle POINTAGE_AGENT (sans rôle ADMIN ni superuser).
 * Navigation et garde d’URL : strictement ces trois pages (pas de tableau de bord).
 */
export const POINTAGE_AGENT_ALLOWED_PATHS = ["/eleves", "/pointage-quotidien", "/pointage-personnel"];

/** Page d’accueil après connexion pour l’agent de pointage (hors admin). */
export const POINTAGE_AGENT_HOME = "/eleves";

/**
 * Chemins autorisés pour le seul rôle COMPTABLE (sans rôle ADMIN ni superuser).
 * Finance (caisse, paiements, dépenses) + liste Professeurs / Personnel pour versements salaires.
 */
export const COMPTABLE_ALLOWED_PATHS = [
  "/caisse",
  "/caisse-justificatifs",
  "/paiements",
  "/depenses",
  "/professeurs",
  "/personnel",
];

/**
 * Rôle comptable ou administration (hors vérification pointage seul).
 */
export function isAdminOrComptable(u) {
  return isAdminUser(u) || isComptable(u);
}

/**
 * Agent POINTAGE_AGENT sans rôle admin (menu et routes limités à POINTAGE_AGENT_ALLOWED_PATHS).
 */
export function isPointageOnlyAgent(u) {
  return isPointageAgent(u) && !isAdminUser(u);
}

/**
 * Cible après connexion ou lors d’un accès refusé (ex. URL interdite).
 * — PASSWORD_OPS (non superuser) → outils mots de passe uniquement
 * — POINTAGE_AGENT → élèves (pas /dashboard)
 * — COMPTABLE (non admin) → caisse
 * — ADMIN / superuser → tableau de bord
 */
export function defaultHomePath(u) {
  if (!u) return "/dashboard";
  if (isPasswordOpsOnlyUser(u)) return "/outils-mot-de-passe";
  if (u.role === ROLE.POINTAGE_AGENT && !isAdminUser(u)) return "/eleves";
  if (isComptable(u) && !isAdminUser(u)) return "/caisse";
  return "/dashboard";
}

/** Nom affiché : display_name API, ou prénom + nom, ou identifiant. */
export function displayUserName(u) {
  if (!u) return "";
  const d = typeof u.display_name === "string" ? u.display_name.trim() : "";
  if (d) return d;
  const parts = [u.first_name, u.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return u.username || "";
}

/**
 * Contrôle d’accès aux chemins (aligné sur la sidebar).
 * — PASSWORD_OPS : uniquement /outils-mot-de-passe
 * — POINTAGE_AGENT (non admin) : uniquement POINTAGE_AGENT_ALLOWED_PATHS (pas /dashboard, pas finance, pas paramètres).
 * — /dashboard : administrateurs uniquement ; pas l’agent de pointage seul.
 * — COMPTABLE (non admin) : finance + /professeurs et /personnel (COMPTABLE_ALLOWED_PATHS).
 * — ADMIN / superuser : tous les modules.
 */
export function canAccessPath(pathname, u) {
  if (!u || !u.role) return false;
  if (isPasswordOpsOnlyUser(u)) {
    return pathname === "/outils-mot-de-passe";
  }
  if (u.role === ROLE.POINTAGE_AGENT && !isAdminUser(u)) {
    return POINTAGE_AGENT_ALLOWED_PATHS.includes(pathname);
  }
  if (pathname === "/dashboard") {
    return isAdminUser(u);
  }
  if (
    pathname === "/audit-logs" ||
    pathname === "/settings" ||
    pathname === "/emploi-du-temps" ||
    pathname === "/historique-emploi" ||
    pathname === "/gestion-classes" ||
    pathname === "/pointage-personnel"
  ) {
    return isAdminUser(u);
  }
  if (isAdminUser(u)) return true;
  if (u.role === ROLE.COMPTABLE) {
    return COMPTABLE_ALLOWED_PATHS.includes(pathname);
  }
  return false;
}
