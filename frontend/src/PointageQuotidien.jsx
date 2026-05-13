import { useCallback, useEffect, useMemo, useState } from "react";

import { Search } from "lucide-react";

import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import { Infobulle } from "./components/ui/Infobulle.jsx";
import Loading from "./components/ui/Loading.jsx";
import { API_POINTAGES, API_POINTAGES_SESSIONS_JOUR, apiFetch } from "./config.js";
import { normalizeNameSearch } from "./utils/nameSearch.js";
import { localISODate } from "./utils/dateLocal.js";

function formatHeure(isoTime) {
  if (!isoTime) return "—";
  const s = String(isoTime);
  const part = s.length >= 8 ? s.slice(0, 8) : s.slice(0, 5);
  try {
    const [hh, mm] = part.split(":");
    if (hh == null || mm == null) return part;
    return `${hh}h${mm}`;
  } catch {
    return part;
  }
}

const STATUT_LABELS = {
  PRESENTE: "Présent",
  ABSENTE: "Absent",
  RETARD: "Retard",
};

const STATUT_OPTIONS = [
  { value: "PRESENTE", label: "Présent" },
  { value: "ABSENTE", label: "Absent" },
  { value: "RETARD", label: "Retard" },
];

function badgeClassForStatut(statut) {
  if (statut === "PRESENTE") {
    return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  }
  if (statut === "ABSENTE") {
    return "bg-red-50 text-red-900 ring-red-200";
  }
  if (statut === "RETARD") {
    return "bg-amber-50 text-amber-950 ring-amber-200";
  }
  return "bg-slate-50 text-slate-800 ring-slate-200";
}

export default function PointageQuotidien() {
  /** Plage calendaire (préréglage par défaut : « Aujourd'hui » = même jour en début et fin). */
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());

  /** Jour de référence pour l’API (emploi / pointage) : dernier jour de la plage, plafonné à aujourd’hui. */
  const selectedDate = useMemo(() => {
    const cap = localISODate();
    const e = endDate || startDate;
    if (!e) return cap;
    return e > cap ? cap : e;
  }, [startDate, endDate]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  /** Ligne (schedule_id) en cours de correction de pointage existant. */
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [patchDraftStatut, setPatchDraftStatut] = useState("PRESENTE");
  const [patchingScheduleId, setPatchingScheduleId] = useState(null);
  /** Statut choisi par professeur (plusieurs lignes même prof partagent la même valeur). */
  const [statusByProf, setStatusByProf] = useState({});
  const [filterProfName, setFilterProfName] = useState("");
  const [filterClasseKey, setFilterClasseKey] = useState("");

  const fetchSessions = useCallback(
    async (dateStr, options = {}) => {
      const { signal } = options;
      setError("");
      setLoading(true);
      try {
        const url = `${API_POINTAGES_SESSIONS_JOUR}?date=${encodeURIComponent(dateStr)}`;
        const res = await apiFetch(url, { signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err?.name === "AbortError") return;
        setError("Impossible de charger les séances pour cette date.");
        setSessions([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchSessions(selectedDate, { signal: ac.signal });
    return () => ac.abort();
  }, [selectedDate, fetchSessions]);

  useEffect(() => {
    setEditingScheduleId(null);
  }, [selectedDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- défauts PRESENTE + conservation des choix utilisateur
    setStatusByProf((prev) => {
      const next = {};
      for (const s of sessions) {
        if (s.deja_pointe) continue;
        const pid = s.professeur_id;
        if (next[pid] === undefined) {
          next[pid] = prev[pid] ?? "PRESENTE";
        }
      }
      return next;
    });
  }, [sessions]);

  const classeOptions = useMemo(() => {
    const rows = [];
    const seen = new Set();
    for (const s of sessions) {
      const key = s.classe_id != null ? `id:${s.classe_id}` : "__sans_classe__";
      if (seen.has(key)) continue;
      seen.add(key);
      const label = s.classe_nom?.trim() ? s.classe_nom.trim() : "Sans classe";
      rows.push({ key, label });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
    return rows;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const q = normalizeNameSearch(filterProfName.trim());
    return sessions.filter((s) => {
      if (q) {
        const nameNorm = normalizeNameSearch(s.professeur_name);
        if (!nameNorm.includes(q)) return false;
      }
      if (filterClasseKey) {
        const sk = s.classe_id != null ? `id:${s.classe_id}` : "__sans_classe__";
        if (sk !== filterClasseKey) return false;
      }
      return true;
    });
  }, [sessions, filterProfName, filterClasseKey]);

  useEffect(() => {
    if (!filterClasseKey) return;
    if (!classeOptions.some((o) => o.key === filterClasseKey)) {
      setFilterClasseKey("");
    }
  }, [classeOptions, filterClasseKey]);

  const unpresentedCount = useMemo(
    () => sessions.filter((s) => !s.deja_pointe).length,
    [sessions],
  );

  const uniqueUnpointedProfs = useMemo(() => {
    const seen = new Set();
    const ids = [];
    for (const s of sessions) {
      if (s.deja_pointe) continue;
      if (seen.has(s.professeur_id)) continue;
      seen.add(s.professeur_id);
      ids.push(s.professeur_id);
    }
    return ids;
  }, [sessions]);

  /** Créneaux non pointés regroupés par enseignant (emploi du jour) pour l’infobulle « à pointer ». */
  const unpointedSessionsByProf = useMemo(() => {
    const m = new Map();
    for (const s of sessions) {
      if (s.deja_pointe) continue;
      if (!m.has(s.professeur_id)) m.set(s.professeur_id, []);
      m.get(s.professeur_id).push(s);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => String(a.heure_debut ?? "").localeCompare(String(b.heure_debut ?? "")));
    }
    return m;
  }, [sessions]);

  function setStatutProf(professeurId, value) {
    setStatusByProf((prev) => ({ ...prev, [professeurId]: value }));
  }

  function beginEditPointage(s) {
    if (s.pointage_id == null) return;
    setEditingScheduleId(s.schedule_id);
    setPatchDraftStatut(s.statut_presence ?? "PRESENTE");
  }

  async function validerModificationPointage(s) {
    if (s.pointage_id == null) return;
    setError("");
    setPatchingScheduleId(s.schedule_id);
    try {
      const res = await apiFetch(`${API_POINTAGES}${s.pointage_id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut_presence: patchDraftStatut }),
      });
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      setEditingScheduleId(null);
      await fetchSessions(selectedDate);
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setPatchingScheduleId(null);
    }
  }

  async function enregistrerJournee() {
    if (unpresentedCount === 0) return;
    setError("");
    setSaving(true);
    try {
      const dateCours = selectedDate;
      const posts = sessions
        .filter((s) => !s.deja_pointe)
        .map((s) => {
          const h = Number(s.duree_heures);
          const heures = Number.isFinite(h) && h >= 0 ? h : 0;
          const statut = statusByProf[s.professeur_id] ?? "PRESENTE";
          return apiFetch(API_POINTAGES, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              professeur: s.professeur_id,
              date_cours: dateCours,
              nombre_heures: heures.toFixed(2),
              statut_presence: statut,
              est_paye: false,
              remarque: null,
              classe: s.classe_id ?? null,
              emploi_du_temps: s.schedule_id,
            }),
          });
        });

      const results = await Promise.all(posts);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        let msg = `Erreur ${failed.status}`;
        try {
          const data = await failed.json();
          if (typeof data.detail === "string") msg = data.detail;
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      await fetchSessions(selectedDate);
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSaving(false);
    }
  }

  const titleDate = useMemo(() => {
    const parts = selectedDate.split("-").map(Number);
    const y = parts[0];
    const mo = parts[1];
    const da = parts[2];
    if (!y || !mo || !da) return selectedDate;
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(y, mo - 1, da));
  }, [selectedDate]);

  const hasUnpointed = unpresentedCount > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Emploi du jour</h1>
        <div className="mt-4 flex flex-col items-start gap-2">
          <div className="w-full min-w-0 sm:max-w-md">
            <DateRangePickerCustom
              id="pointage-quoti-periode"
              label="Journée (pointage)"
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: s, endDate: e }) => {
                setStartDate(s);
                setEndDate(e);
              }}
              allowEmpty={false}
              disabled={saving || patchingScheduleId !== null}
              popoverAlign="left"
              compactButton
              className="w-fit"
            />
          </div>
          <p className="text-xs text-[#94a3b8]">
            Affichage et enregistrement pour le <strong>dernier jour</strong> de la plage (au plus tard
            aujourd’hui).
          </p>
          <p className="text-sm text-[#64748b]">
            Séances prévues pour <span className="font-medium text-[#0f172a]">{titleDate}</span>
          </p>
        </div>
        {!loading && sessions.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm sm:p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              Filtrer les séances
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="pointage-filter-prof"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
                >
                  Recherche par nom
                </label>
                <div className="relative min-w-0">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
                    aria-hidden
                  />
                  <input
                    id="pointage-filter-prof"
                    type="search"
                    value={filterProfName}
                    onChange={(e) => setFilterProfName(e.target.value)}
                    placeholder="Nom du professeur…"
                    autoComplete="off"
                    className="w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-2.5 pl-10 pr-3 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60"
                    disabled={saving || patchingScheduleId !== null}
                  />
                </div>
              </div>
              <div className="min-w-0 w-full sm:max-w-xs sm:flex-1">
                <label
                  htmlFor="pointage-filter-classe"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]"
                >
                  Classe
                </label>
                <select
                  id="pointage-filter-classe"
                  value={filterClasseKey}
                  onChange={(e) => setFilterClasseKey(e.target.value)}
                  disabled={saving || patchingScheduleId !== null}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm font-medium text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60"
                >
                  <option value="">Toutes les classes</option>
                  {classeOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : null}
        {hasUnpointed ? (
          <p className="mt-2 max-w-2xl text-sm text-[#475569]">
            Par défaut, tous les professeurs non pointés sont <strong>présents</strong>. Ne modifiez le
            statut que pour les absences ou retards, puis enregistrez la journée en une seule fois.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-[#0f172a]">Aucune séance prévue pour cette date</p>
          <p className="mt-2 text-sm text-[#64748b]">
            Les créneaux dépendent de l’emploi du temps (jour de la semaine). Choisissez une autre journée si besoin.
          </p>
        </div>
      ) : (
        <>
          {filteredSessions.length === 0 ? (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center shadow-sm">
              <p className="text-sm font-medium text-[#0f172a]">Aucune séance trouvée pour ces critères.</p>
              <p className="mt-2 text-sm text-[#64748b]">
                Modifiez le nom ou la classe sélectionnée pour afficher à nouveau des créneaux.
              </p>
            </div>
          ) : (
            <>
          <ul className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {filteredSessions.map((s) => (
              <li
                key={s.schedule_id}
                className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="text-base font-semibold text-[#0f172a]">{s.professeur_name}</p>
                      <span className="text-sm text-[#64748b]">
                        Classe : {s.classe_nom ?? "Sans classe"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#64748b]">
                      {formatHeure(s.heure_debut)} – {formatHeure(s.heure_fin)} · {s.duree_heures} h
                    </p>
                  </div>
                  {s.deja_pointe ? (
                    editingScheduleId === s.schedule_id ? (
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${badgeClassForStatut(s.statut_presence)}`}
                      >
                        Déjà pointé — {STATUT_LABELS[s.statut_presence] ?? s.statut_presence}
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${badgeClassForStatut(s.statut_presence)}`}
                        >
                          Déjà pointé — {STATUT_LABELS[s.statut_presence] ?? s.statut_presence}
                        </span>
                        <button
                          type="button"
                          onClick={() => beginEditPointage(s)}
                          disabled={saving || patchingScheduleId !== null}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-semibold text-[#334155] shadow-sm transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] disabled:opacity-50"
                          title="Modifier le statut"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden
                          >
                            <path d="M2.695 14.295 13.5 3.49a2.121 2.121 0 013 3L5.695 17.295a4.5 4.5 0 01-1.879 1.127l-2.12.53a.75.75 0 01-.913-.913l.53-2.12a4.5 4.5 0 011.127-1.879z" />
                          </svg>
                          Modifier
                        </button>
                      </div>
                    )
                  ) : (
                    <Infobulle
                      content={
                        <div className="w-[min(100vw-2rem,20rem)] space-y-1.5 text-left text-[11px] text-slate-800">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Emploi du jour
                          </p>
                          <p className="text-xs font-semibold text-slate-900">{s.professeur_name}</p>
                          <ul className="space-y-0.5 border-t border-slate-200 pt-1.5 text-[11px]">
                            {(unpointedSessionsByProf.get(s.professeur_id) ?? [s]).map((x) => (
                              <li key={x.schedule_id}>
                                {formatHeure(x.heure_debut)} – {formatHeure(x.heure_fin)} · {x.duree_heures} h
                                {x.classe_nom != null && x.classe_nom !== "" ? ` · ${x.classe_nom}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      }
                      side="left"
                    >
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                        À pointer
                      </span>
                    </Infobulle>
                  )}
                </div>

                {s.deja_pointe && editingScheduleId === s.schedule_id ? (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="min-w-0 flex-1 sm:max-w-xs">
                      <label
                        htmlFor={`patch-statut-${s.schedule_id}`}
                        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                      >
                        Nouveau statut
                      </label>
                      <select
                        id={`patch-statut-${s.schedule_id}`}
                        value={patchDraftStatut}
                        onChange={(e) => setPatchDraftStatut(e.target.value)}
                        disabled={patchingScheduleId === s.schedule_id}
                        className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm font-medium text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60"
                      >
                        {STATUT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => validerModificationPointage(s)}
                        disabled={patchingScheduleId === s.schedule_id}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#0f172a] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e293b] disabled:opacity-60"
                      >
                        {patchingScheduleId === s.schedule_id ? "Enregistrement…" : "Valider la modification"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingScheduleId(null)}
                        disabled={patchingScheduleId === s.schedule_id}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] transition hover:bg-[#f8fafc] disabled:opacity-60"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : null}

                {!s.deja_pointe ? (
                  <div className="mt-4">
                    <label
                      htmlFor={`statut-prof-${s.professeur_id}-${s.schedule_id}`}
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
                    >
                      Statut de présence
                    </label>
                    <select
                      id={`statut-prof-${s.professeur_id}-${s.schedule_id}`}
                      value={statusByProf[s.professeur_id] ?? "PRESENTE"}
                      onChange={(e) => setStatutProf(s.professeur_id, e.target.value)}
                      disabled={saving || patchingScheduleId !== null}
                      className="w-full max-w-xs rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm font-medium text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60"
                    >
                      {STATUT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {hasUnpointed ? (
            <div className="sticky bottom-0 z-10 border-t border-[#e2e8f0] bg-[#f8fafc]/95 py-5 backdrop-blur supports-[backdrop-filter]:bg-[#f8fafc]/80">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[#64748b]">
                  <span className="font-medium text-[#0f172a]">{unpresentedCount}</span> créneau
                  {unpresentedCount > 1 ? "x" : ""} à valider ·{" "}
                  <span className="font-medium text-[#0f172a]">{uniqueUnpointedProfs.length}</span>{" "}
                  enseignant
                  {uniqueUnpointedProfs.length > 1 ? "s" : ""}
                </p>
                <button
                  type="button"
                  onClick={() => enregistrerJournee()}
                  disabled={saving || patchingScheduleId !== null}
                  className="inline-flex min-h-[52px] min-w-[min(100%,280px)] items-center justify-center rounded-xl bg-[#0f172a] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#0f172a]/20 transition hover:bg-[#1e293b] disabled:opacity-60 sm:ml-auto"
                >
                  {saving ? "Enregistrement…" : "Enregistrer la journée"}
                </button>
              </div>
            </div>
          ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
