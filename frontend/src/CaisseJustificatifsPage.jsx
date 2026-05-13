import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Landmark } from "lucide-react";

import { useAuth } from "./AuthContext.jsx";
import { isAdminOrComptable } from "./authRoles.js";
import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import {
  API_BANQUE_SOLDE,
  API_MOUVEMENTS_BANQUE,
  EVENT_CAISSE_SESSION_CHANGED,
  apiMouvementBanqueAnnulerVersement,
  apiMouvementBanqueCompleterJustificatif,
  apiFetch,
  dispatchCaisseSessionChanged,
} from "./config.js";
import { localISODate } from "./utils/dateLocal.js";
import { formatTnd } from "./utils/tunisianMoney.js";

function formatDt(isoOrDateHeureIso) {
  if (!isoOrDateHeureIso) return "\u2014";
  try {
    const d = new Date(isoOrDateHeureIso);
    if (Number.isNaN(d.getTime())) return String(isoOrDateHeureIso);
    return d.toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(isoOrDateHeureIso);
  }
}

function parseListPayload(data) {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

function logApiError(context, res, body) {
  console.error(`[Banque mouvements] ${context}`, {
    status: res?.status,
    statusText: res?.statusText,
    body,
  });
}

const BANQUE_SOLDE_POLL_MS = 30_000;

/**
 * Historique des mouvements bancaires (versements / retraits) avec filtres, totaux et actions sur lignes en attente.
 */
export default function CaisseJustificatifsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [fileById, setFileById] = useState(() => ({}));
  const fileInputRefs = useRef({});

  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());
  const [typeFilter, setTypeFilter] = useState("all");
  /** Même source que la barre compta : GET /api/banque/solde/ (affichage formaté ou masqué). */
  const [banqueSoldeLine, setBanqueSoldeLine] = useState(null);

  const fetchBanqueSolde = useCallback(async () => {
    try {
      const rb = await apiFetch(API_BANQUE_SOLDE, { cache: "no-store" });
      if (!rb.ok) {
        setBanqueSoldeLine(null);
        return;
      }
      const bd = await rb.json();
      if (bd.masque) {
        setBanqueSoldeLine("**** DT");
      } else {
        setBanqueSoldeLine(bd.solde_actuel != null ? formatTnd(bd.solde_actuel) : "—");
      }
    } catch {
      setBanqueSoldeLine(null);
    }
  }, []);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date_debut: startDate,
        date_fin: endDate,
      });
      if (typeFilter === "versement") params.set("type", "versement");
      if (typeFilter === "retrait") params.set("type", "retrait");
      const res = await apiFetch(`${API_MOUVEMENTS_BANQUE}?${params.toString()}`, {
        cache: "no-store",
      });
      const text = await res.clone().text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        logApiError("GET mouvements-banque", res, json);
        const detail = json?.detail;
        throw new Error(
          typeof detail === "string" ? detail : detail?.[0] || `HTTP ${res.status}`,
        );
      }
      setRows(parseListPayload(json));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chargement impossible.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, typeFilter]);

  useEffect(() => {
    if (!user || !isAdminOrComptable(user)) return undefined;
    void load();
    return undefined;
  }, [user, load]);

  useEffect(() => {
    if (!user || !isAdminOrComptable(user)) return undefined;
    void fetchBanqueSolde();
    const t = setInterval(() => {
      void fetchBanqueSolde();
    }, BANQUE_SOLDE_POLL_MS);
    const onFocus = () => void fetchBanqueSolde();
    const onCaisse = () => void fetchBanqueSolde();
    window.addEventListener("focus", onFocus);
    window.addEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisse);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(EVENT_CAISSE_SESSION_CHANGED, onCaisse);
    };
  }, [user, fetchBanqueSolde]);

  const totalVerse = useMemo(() => {
    return rows
      .filter((r) => r.type === "versement")
      .reduce((acc, r) => acc + Number(String(r.montant ?? 0).replace(",", ".")), 0);
  }, [rows]);

  const totalRetrait = useMemo(() => {
    return rows
      .filter((r) => r.type === "retrait")
      .reduce((acc, r) => acc + Number(String(r.montant ?? 0).replace(",", ".")), 0);
  }, [rows]);

  async function onRegulariser(mouvementId) {
    const key = String(mouvementId);
    const f = fileById[key];
    if (!f) {
      setErr("Sélectionnez un fichier justificatif avant de valider.");
      return;
    }
    setBusyId(mouvementId);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("justificatif_file", f, f.name);
      const url = apiMouvementBanqueCompleterJustificatif(mouvementId);
      const res = await apiFetch(url, { method: "POST", body: fd });
      const text = await res.clone().text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        logApiError("POST completer-justificatif", res, json);
        const detail = json?.detail;
        throw new Error(
          typeof detail === "string" ? detail : detail?.[0] || `HTTP ${res.status}`,
        );
      }
      setFileById((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      const input = fileInputRefs.current[key];
      if (input) input.value = "";
      dispatchCaisseSessionChanged();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de la régularisation.");
    } finally {
      setBusyId(null);
    }
  }

  async function onGarderEnCaisse(mouvementId) {
    if (
      !window.confirm(
        "Confirmer : aucun versement banque — le montant sera réintégré dans le solde de la session en cours, et l'ouverture sera débloquée ?",
      )
    ) {
      return;
    }
    setBusyId(mouvementId);
    setErr("");
    try {
      const url = apiMouvementBanqueAnnulerVersement(mouvementId);
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.clone().text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        logApiError("POST annuler_versement", res, json);
        const detail = json?.detail;
        throw new Error(
          typeof detail === "string" ? detail : detail?.[0] || `HTTP ${res.status}`,
        );
      }
      dispatchCaisseSessionChanged();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user || !isAdminOrComptable(user)) {
    return null;
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 print:hidden">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-900">
          <Landmark className="h-5 w-5" strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-slate-900">Historique et Justificatifs Banque</h1>
          <p className="mt-1 text-sm text-slate-600">
            Liste des mouvements caisse&nbsp;↔&nbsp;banque (versements et alimentations). Filtrez par période et type ;
            régularisez les lignes encore sans justificatif.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
        <DateRangePickerCustom
          label="Période"
          startDate={startDate}
          endDate={endDate}
          onChange={({ startDate: s, endDate: e }) => {
            setStartDate(s || localISODate());
            setEndDate(e || localISODate());
          }}
          allowEmpty={false}
          compactButton
          className="min-w-[240px]"
        />
        <div className="min-w-[200px]">
          <label htmlFor="mb-type-filter" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Type
          </label>
          <select
            id="mb-type-filter"
            value={typeFilter}
            onChange={(ev) => setTypeFilter(ev.target.value)}
            className="h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">Tous</option>
            <option value="versement">Versements (vers la banque)</option>
            <option value="retrait">Retraits (alimentation caisse)</option>
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900/80">Total versé en banque</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-800">{formatTnd(totalVerse)}</p>
          <p className="mt-1 text-[11px] text-emerald-800/80">Somme des versements sur la période filtrée</p>
        </div>
        <div className="rounded-xl border border-slate-600/50 bg-slate-800 p-4 shadow-md ring-1 ring-white/5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Solde actuel banque</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
            {banqueSoldeLine != null ? banqueSoldeLine : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Solde disponible sur le compte interne</p>
        </div>
        <div className="rounded-xl border border-sky-200/90 bg-sky-50/70 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-900/80">Total retiré (alimentation)</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-900">{formatTnd(totalRetrait)}</p>
          <p className="mt-1 text-[11px] text-sky-800/90">Somme des retraits sur la période filtrée</p>
        </div>
      </div>

      {err ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {err}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Chargement…</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Date &amp; heure</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Montant</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Statut</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Justificatif</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Aucun mouvement pour cette période et ces filtres.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const rowKey = String(row.id);
                    const busy = busyId === row.id;
                    const isVers = row.type === "versement";
                    const pending = row.justificatif_recu === false;
                    const heureDisp = row.date_heure_iso
                      ? formatDt(row.date_heure_iso)
                      : row.date
                        ? formatDt(`${String(row.date).slice(0, 10)}T12:00:00`)
                        : "\u2014";
                    const justifUrl = row.justificatif_fichier_url;

                    return (
                      <tr key={rowKey} className="hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-800">{heureDisp}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={
                              isVers
                                ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200/80"
                                : "inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900 ring-1 ring-sky-200/80"
                            }
                          >
                            {isVers ? "Versement" : "Retrait"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-900">
                          {formatTnd(row.montant)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {!pending ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                              Justifié
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-200">
                              En attente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {!pending && justifUrl ? (
                            <a
                              href={justifUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:text-indigo-900"
                            >
                              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                              Voir
                              <Download className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {!pending ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                              <input
                                ref={(el) => {
                                  fileInputRefs.current[rowKey] = el;
                                }}
                                type="file"
                                accept="application/pdf,image/*"
                                className="hidden"
                                disabled={busy}
                                onChange={(ev) => {
                                  const file = ev.target.files?.[0] ?? null;
                                  setFileById((prev) => ({ ...prev, [rowKey]: file }));
                                }}
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => fileInputRefs.current[rowKey]?.click()}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Joindre
                              </button>
                              <button
                                type="button"
                                disabled={busy || !fileById[rowKey]}
                                onClick={() => onRegulariser(row.id)}
                                className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                              >
                                {busy ? "…" : "Ajouter justificatif"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onGarderEnCaisse(row.id)}
                                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                              >
                                Retard banque
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
