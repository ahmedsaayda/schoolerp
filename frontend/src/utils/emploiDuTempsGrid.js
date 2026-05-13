/** 0 = lundi … 6 = dimanche (aligné API). */
export const GRID_JOUR_INDICES = [0, 1, 2, 3, 4, 5, 6];

export const GRID_JOUR_LABELS = {
  0: "Lundi",
  1: "Mardi",
  2: "Mercredi",
  3: "Jeudi",
  4: "Vendredi",
  5: "Samedi",
  6: "Dimanche",
};

/** Lundi–Samedi (sans dimanche) — impression et documents. */
export const GRID_JOUR_PRINT_INDICES = [0, 1, 2, 3, 4, 5];

/** Lundi–Samedi pour les formulaires (spec métier : pas de dimanche en saisie courante). */
export const JOUR_LUN_A_SAM = [0, 1, 2, 3, 4, 5].map((v) => ({
  value: String(v),
  label: GRID_JOUR_LABELS[v],
}));

export const GRID_ROWS = [
  { start: "08:00", end: "09:00" },
  { start: "09:00", end: "10:00" },
  { start: "10:00", end: "11:00" },
  { start: "11:00", end: "12:00" },
  { start: "14:00", end: "15:00" },
  { start: "15:00", end: "16:00" },
  { start: "16:00", end: "17:00" },
  { start: "17:00", end: "18:00" },
];

/** Hauteur cible d’une ligne horaire 1h (synchronisée cartes + grille). */
export const GRID_ONE_HOUR_MIN_HEIGHT_REM = 5.25;

/**
 * @param {string} hhmm "HH:MM" ou "HH:MM:SS"
 * @returns {number} minutes depuis minuit
 */
export function timeToMinutes(hhmm) {
  if (hhmm == null || hhmm === "") return 0;
  const s = String(hhmm).trim();
  const p = s.split(":");
  const h = Number(p[0]);
  const m = p.length > 1 ? Number(p[1]) : 0;
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * [a0, a1) vs [b0, b1) (demi-ouvert fin exclu sauf a1=b1 explicite).
 * @param {number} a0
 * @param {number} a1
 * @param {number} b0
 * @param {number} b1
 */
export function timeIntervalsOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

/**
 * Indice de la première ligne `GRID_ROWS` dont le créneau 1h contient l’heure de début.
 * @param {string} heureDebut
 * @returns {number} -1 si hors grille
 */
export function findStartRowIndexForDebut(heureDebut) {
  const t = timeToSlot(heureDebut);
  const m = timeToMinutes(t);
  for (let i = 0; i < GRID_ROWS.length; i += 1) {
    if (GRID_ROWS[i].start === t) return i;
  }
  for (let i = 0; i < GRID_ROWS.length; i += 1) {
    const a0 = timeToMinutes(GRID_ROWS[i].start);
    const a1 = timeToMinutes(GRID_ROWS[i].end);
    if (m >= a0 && m < a1) return i;
  }
  return -1;
}

/**
 * Nombre de lignes 1h couvertes par [heure_debut, heure_fin) (p.ex. 08:00–10:00 => 2).
 * @param {string} heureDebut
 * @param {string} heureFin
 * @param {number} [maxSpan]
 */
export function rowSpan1hForSession(heureDebut, heureFin, maxSpan) {
  const s0 = timeToMinutes(timeToSlot(heureDebut));
  const s1 = timeToMinutes(timeToSlot(heureFin));
  if (s1 <= s0) return 1;
  const raw = Math.ceil((s1 - s0) / 60);
  const cap = maxSpan == null ? GRID_ROWS.length : maxSpan;
  return Math.max(1, Math.min(raw, cap));
}

/**
 * Détache l’en-tête d’affichage (_rowSpan) d’une session pour les signatures.
 * @param {object} s
 */
export function sessionPayloadForSignature(s) {
  if (!s) return s;
  const { _rowSpan, ...rest } = s;
  return rest;
}

export function timeToSlot(t) {
  if (t == null || t === "") return "";
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export function slotToApiTime(slot) {
  if (!slot) return null;
  const parts = String(slot).split(":");
  if (parts.length >= 2) {
    const h = parts[0].padStart(2, "0");
    const m = parts[1].padStart(2, "0");
    return `${h}:${m}:00`;
  }
  return `${slot}:00`;
}

export function cellKey(jour, row) {
  return `${jour}|${row.start}|${row.end}`;
}

export function rowMatchingForm(debutSlot, finSlot) {
  const exact = GRID_ROWS.find((r) => r.start === debutSlot && r.end === finSlot);
  if (exact) return exact;
  return GRID_ROWS.find((r) => r.start === debutSlot);
}

/**
 * Ligne d’ancrage (clé de cellule) pour un couple début/fin : 1re ligne 1h alignée sur heure_debut.
 * @param {string} debutSlot
 * @param {string} finSlot
 */
export function anchorGridRowForSession(debutSlot, finSlot) {
  const t0 = timeToSlot(debutSlot);
  const t1 = timeToSlot(finSlot);
  const byForm = rowMatchingForm(t0, t1);
  if (byForm) return byForm;
  const i = findStartRowIndexForDebut(t0);
  return i >= 0 ? GRID_ROWS[i] : null;
}

/** Réduit les séances datées à un seul modèle hebdomadaire (par jour + horaires + matière + salle). */
export function collapseSessionsToTemplate(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const hd = timeToSlot(s.heure_debut);
    const hf = timeToSlot(s.heure_fin);
    const mat = (s.matiere && String(s.matiere).trim()) || "";
    const salle = (s.salle && String(s.salle).trim()) || "";
    const key = `${s.jour_semaine}|${hd}|${hf}|${mat}|${salle}`;
    if (!map.has(key)) {
      map.set(key, { ...s });
    }
  }
  return Array.from(map.values());
}

/**
 * @param {number} startIdx
 * @param {number} rowSpan
 */
function rowSpanCappedToGrid(startIdx, rowSpan) {
  if (startIdx < 0) return 1;
  const max = GRID_ROWS.length - startIdx;
  return Math.max(1, Math.min(rowSpan, max));
}

/**
 * Rowspan 1h borné (affichage / formulaire) pour une plage d’heures.
 * @param {string} heureDebut
 * @param {string} heureFin
 */
export function computeDisplayRowSpan(heureDebut, heureFin) {
  const startIdx = findStartRowIndexForDebut(heureDebut);
  if (startIdx < 0) return 1;
  const raw = rowSpan1hForSession(heureDebut, heureFin);
  return rowSpanCappedToGrid(startIdx, raw);
}

/**
 * Toutes les clés (jour, ligne 1h) recouvertes par une séance multi-heures, sauf la ligne d’ancrage.
 * @param {number} jour
 * @param {number} startRowIndex
 * @param {number} rowSpan
 * @returns {string[]}
 */
export function cellKeysCoveredBySpan(jour, startRowIndex, rowSpan) {
  if (rowSpan <= 1 || startRowIndex < 0) return [];
  const out = [];
  for (let k = 1; k < rowSpan; k += 1) {
    const idx = startRowIndex + k;
    if (idx < GRID_ROWS.length) {
      out.push(cellKey(jour, GRID_ROWS[idx]));
    }
  }
  return out;
}

/**
 * Ensembles des cellules 1h « englouties » par le rowspan d’autres séances.
 * @param {Record<string, object | null | undefined>} gridData
 * @returns {Set<string>}
 */
export function buildCoveredCellKeysSet(gridData) {
  const set = new Set();
  for (const s of Object.values(gridData)) {
    if (!s) continue;
    const span = Number(s._rowSpan) || 1;
    if (span <= 1) continue;
    const j = Number(s.jour_semaine);
    if (!GRID_JOUR_INDICES.includes(j)) continue;
    const startIdx = findStartRowIndexForDebut(s.heure_debut);
    if (startIdx < 0) continue;
    for (const k of cellKeysCoveredBySpan(j, startIdx, span)) {
      set.add(k);
    }
  }
  return set;
}

/**
 * Somme des durées (h) des créneaux du modèle hebdomadaire (chaque case comptée une fois).
 * @param {Array<object| null | undefined>} flatSessions
 */
export function totalWeeklyHoursFromFlatSessions(flatSessions) {
  if (!Array.isArray(flatSessions)) return 0;
  let total = 0;
  for (const s of flatSessions) {
    if (!s) continue;
    const a = timeToMinutes(timeToSlot(s.heure_debut));
    const b = timeToMinutes(timeToSlot(s.heure_fin));
    if (b > a) total += (b - a) / 60;
  }
  return Math.round(total * 100) / 100;
}

export function buildGridDataFromSessions(sessions) {
  /** @type {Record<string, object | null>} */
  const map = {};
  for (const row of GRID_ROWS) {
    for (const jour of GRID_JOUR_INDICES) {
      map[cellKey(jour, row)] = null;
    }
  }
  const list = Array.isArray(sessions) ? sessions : [];
  const sorted = [...list].sort(
    (a, b) =>
      Number(a.jour_semaine) - Number(b.jour_semaine) ||
      String(a.heure_debut || "").localeCompare(String(b.heure_debut || "")) ||
      Number(a.id) - Number(b.id),
  );
  for (const s of sorted) {
    const j = Number(s.jour_semaine);
    if (!GRID_JOUR_INDICES.includes(j)) continue;
    const hd = timeToSlot(s.heure_debut);
    const hf = timeToSlot(s.heure_fin);
    const sm = timeToMinutes(hd);
    const em = timeToMinutes(hf);
    if (em <= sm) continue;
    const startIdx = findStartRowIndexForDebut(hd);
    if (startIdx < 0) continue;
    const rawSpan = rowSpan1hForSession(hd, hf);
    const rowSpan = rowSpanCappedToGrid(startIdx, rawSpan);
    const anchor = GRID_ROWS[startIdx];
    for (const row of GRID_ROWS) {
      const k0 = cellKey(j, row);
      const ex = map[k0];
      if (ex) {
        const e0 = timeToMinutes(timeToSlot(ex.heure_debut));
        const e1 = timeToMinutes(timeToSlot(ex.heure_fin));
        if (timeIntervalsOverlap(sm, em, e0, e1)) {
          map[k0] = null;
        }
      }
    }
    const payload = { ...s, _rowSpan: rowSpan };
    map[cellKey(j, anchor)] = payload;
  }
  return map;
}

/** Fond très clair, lisible à l’impression N&B (niveaux de gris légers). */
const MATIERE_PRINT_BACKGROUNDS = [
  "#f3f4f6",
  "#f1f5f9",
  "#ecfdf5",
  "#fffbeb",
  "#eff6ff",
  "#fdf4ff",
  "#f5f3ff",
  "#ecfeff",
  "#f7fee7",
];

/** Styles carte cellule (fond) selon libellé de matière (hash simple). */
const MATIERE_SCHEMES = [
  { border: "border-violet-200", bg: "from-violet-50 to-violet-100/90", text: "text-violet-950", sub: "text-violet-900/80" },
  { border: "border-emerald-200", bg: "from-emerald-50 to-emerald-100/90", text: "text-emerald-950", sub: "text-emerald-900/80" },
  { border: "border-amber-200", bg: "from-amber-50 to-amber-100/90", text: "text-amber-950", sub: "text-amber-900/80" },
  { border: "border-rose-200", bg: "from-rose-50 to-rose-100/90", text: "text-rose-950", sub: "text-rose-900/80" },
  { border: "border-cyan-200", bg: "from-cyan-50 to-cyan-100/90", text: "text-cyan-950", sub: "text-cyan-900/80" },
  { border: "border-fuchsia-200", bg: "from-fuchsia-50 to-fuchsia-100/90", text: "text-fuchsia-950", sub: "text-fuchsia-900/80" },
  { border: "border-indigo-200", bg: "from-indigo-50 to-indigo-100/90", text: "text-indigo-950", sub: "text-indigo-900/80" },
  { border: "border-lime-200", bg: "from-lime-50 to-lime-100/90", text: "text-lime-950", sub: "text-lime-900/80" },
];

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Style inline pour cellules d’impression (fond pâle, contrasté en noir & blanc).
 * @param {string} [label] libellé matière
 * @returns {{ backgroundColor: string }}
 */
export function matierePrintCellStyle(label) {
  const t = (label && String(label).trim()) || "";
  if (!t) {
    return { backgroundColor: "#ffffff" };
  }
  return { backgroundColor: MATIERE_PRINT_BACKGROUNDS[simpleHash(t) % MATIERE_PRINT_BACKGROUNDS.length] };
}

/**
 * Libellé de durée pour affichage (p.ex. "2 h", "90 min").
 * @param {string} heureDebut
 * @param {string} heureFin
 */
export function formatSeanceDurationLabel(heureDebut, heureFin) {
  const a = timeToMinutes(timeToSlot(heureDebut));
  const b = timeToMinutes(timeToSlot(heureFin));
  if (b <= a) return "";
  const mins = b - a;
  if (mins % 60 === 0) {
    const h = mins / 60;
    return h === 1 ? "1 h" : `${h} h`;
  }
  return `${mins} min`;
}

/**
 * @param {number|string|undefined} profId
 * @param {Array<{ id: number, nom: string, prenom: string }>} professeurs
 */
export function profDisplayNameFromList(profId, professeurs) {
  const p = professeurs.find((x) => Number(x.id) === Number(profId));
  return p ? `${p.prenom} ${p.nom}`.trim() : "Professeur";
}

/**
 * @param {object | null | undefined} s session créneau
 * @param {Array<{ id: number, matiere?: string }>} professeurs
 */
export function matiereLabelForSession(s, professeurs) {
  if (!s) return "";
  const m = s.matiere && String(s.matiere).trim();
  if (m) return m;
  const p = professeurs.find((x) => Number(x.id) === Number(s.professeur));
  return (p?.matiere && String(p.matiere).trim()) || "";
}

export function matiereColorScheme(label, fallback = null) {
  const t = (label && String(label).trim()) || "";
  if (!t) {
    return (
      fallback || {
        border: "border-sky-200",
        bg: "from-sky-50 to-sky-100/90",
        text: "text-sky-950",
        sub: "text-sky-900/80",
      }
    );
  }
  return MATIERE_SCHEMES[simpleHash(t) % MATIERE_SCHEMES.length];
}
