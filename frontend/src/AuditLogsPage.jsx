import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthContext.jsx";
import { isAdminUser } from "./authRoles.js";
import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { useSettings } from "./context/SettingsContext.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import { API_AUDIT_LOGS, API_AUDIT_LOGS_MODELS, apiFetch } from "./config.js";
import { localISODate } from "./utils/dateLocal.js";

const ACTION_LABELS = {
  CREATION: "Création",
  MODIFICATION: "Modification",
  SUPPRESSION: "Suppression",
};

/** Normalise l’entrée API (objet JSON ou chaîne) vers un objet parsé ou une repli. */
function parseAuditDetails(details) {
  if (details == null || details === "") return { parsed: null, fallback: "—" };
  if (typeof details === "object") return { parsed: details, fallback: null };
  if (typeof details === "string") {
    try {
      return { parsed: JSON.parse(details), fallback: details };
    } catch {
      return { parsed: null, fallback: details };
    }
  }
  return { parsed: null, fallback: String(details) };
}

function prettifyFieldLabel(key) {
  if (typeof key !== "string") return String(key);
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isOldNewEntry(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "old" in value &&
    "new" in value
  );
}

function formatScalarForDisplay(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

/** Affiche une valeur (scalaire ou objet imbriqué) sans accolades ni guillemets bruts. */
function DetailValue({ value, className = "" }) {
  if (value === null || value === undefined) {
    return <span className={`text-sm text-slate-400 ${className}`}>—</span>;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className={`text-sm text-slate-400 ${className}`}>—</span>;
    }
    return (
      <ul className={`mt-0.5 list-none space-y-0.5 pl-0 ${className}`}>
        {entries.map(([k, v]) => (
          <li key={k} className="text-sm text-slate-700">
            <span className="font-medium text-slate-600">{prettifyFieldLabel(k)} :</span>{" "}
            <DetailValue value={v} />
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className={`text-sm text-slate-400 ${className}`}>—</span>;
    }
    return (
      <span className={className}>
        {value.map((item, i) => (
          <span key={i} className="text-sm text-slate-700">
            {i > 0 ? ", " : ""}
            {typeof item === "object" ? <DetailValue value={item} /> : formatScalarForDisplay(item)}
          </span>
        ))}
      </span>
    );
  }
  return <span className={`text-sm text-slate-800 ${className}`}>{formatScalarForDisplay(value)}</span>;
}

function ValuesBlock({ values }) {
  if (!values || typeof values !== "object") {
    return <p className="text-sm text-slate-500">—</p>;
  }
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">—</p>;
  }
  return (
    <ul className="mt-1 list-none space-y-1 border-l-2 border-emerald-200 pl-3">
      {entries.map(([key, val]) => (
        <li key={key}>
          <span className="text-sm font-medium text-slate-600">{prettifyFieldLabel(key)} :</span>{" "}
          <DetailValue value={val} />
        </li>
      ))}
    </ul>
  );
}

function ChangesList({ entries }) {
  return (
    <ul className="mt-1 list-none space-y-2 border-l-2 border-blue-200 pl-3">
      {entries.map(({ field, old: oldVal, new: newVal }) => (
        <li key={field} className="text-sm text-slate-800">
          <span className="font-medium text-slate-700">{prettifyFieldLabel(field)} :</span>{" "}
          <span className="text-gray-500 line-through decoration-slate-400" title="Ancienne valeur">
            {formatScalarForDisplay(oldVal)}
          </span>{" "}
          <span className="text-slate-400" aria-hidden="true">
            →
          </span>{" "}
          <span className="font-medium text-emerald-700" title="Nouvelle valeur">
            {formatScalarForDisplay(newVal)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Extrait les paires ancien / nouveau depuis un objet diff ou la clé `changes`. */
function collectChangeEntries(parsed) {
  const raw =
    parsed.changes != null
      ? parsed.changes
      : parsed.modifications != null
        ? parsed.modifications
        : parsed;

  const out = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const field = item.field ?? item.name ?? item.key ?? "";
        const oldVal = item.old ?? item.old_value ?? item.from;
        const newVal = item.new ?? item.new_value ?? item.to;
        if (field !== "" || oldVal !== undefined || newVal !== undefined) {
          out.push({ field: field || "Champ", old: oldVal, new: newVal });
        }
      }
    }
    return out;
  }

  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (key === "created" || key === "deleted" || key === "values" || key === "changes" || key === "modifications") {
        continue;
      }
      if (isOldNewEntry(value)) {
        out.push({ field: key, old: value.old, new: value.new });
      }
    }
  }

  return out;
}

function PlainKeyValueDetails({ parsed }) {
  const entries = Object.entries(parsed).filter(([k]) => k !== "created" && k !== "deleted");
  if (entries.length === 0) {
    return <span className="text-sm text-slate-500">—</span>;
  }
  const resumeEntry = entries.find(([k]) => k === "resume");
  const listEntries = entries
    .filter(([k]) => k !== "resume")
    .filter(([, val]) => !isOldNewEntry(val));

  if (!resumeEntry && listEntries.length === 0) {
    return <span className="text-sm text-slate-500">—</span>;
  }

  return (
    <div className="space-y-2 text-sm text-slate-800">
      {resumeEntry && (
        <p className="font-medium text-slate-900">{formatScalarForDisplay(resumeEntry[1])}</p>
      )}
      {listEntries.length > 0 && (
        <ul className="list-none space-y-1">
          {listEntries.map(([key, val]) => (
            <li key={key}>
              <span className="font-medium text-slate-600">{prettifyFieldLabel(key)} :</span>{" "}
              <DetailValue value={val} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Affiche les détails d’audit de façon lisible (création, modification, suppression, message libre).
 */
function AuditDetailsViewer({ details, action }) {
  const { parsed, fallback } = parseAuditDetails(details);

  if (parsed === null) {
    return <span className="text-sm text-slate-600">{fallback}</span>;
  }

  if (parsed.created === true && parsed.values != null && typeof parsed.values === "object") {
    return (
      <div className="space-y-1.5 text-sm">
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          Création
        </span>
        <p className="font-medium text-slate-800">Création avec les valeurs :</p>
        <ValuesBlock values={parsed.values} />
      </div>
    );
  }

  const isSuppression =
    parsed.deleted === true ||
    (action === "SUPPRESSION" &&
      parsed.values != null &&
      typeof parsed.values === "object" &&
      parsed.created !== true);

  if (isSuppression && parsed.values != null && typeof parsed.values === "object") {
    const contextEntries = Object.entries(parsed).filter(
      ([k]) => !["deleted", "values", "created"].includes(k),
    );
    return (
      <div className="space-y-1.5 text-sm">
        <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
          Suppression
        </span>
        <p className="font-medium text-slate-800">Suppression de :</p>
        {contextEntries.length > 0 && (
          <ul className="mb-2 list-none space-y-1 border-l-2 border-rose-100 pl-3">
            {contextEntries.map(([key, val]) => (
              <li key={key}>
                <span className="font-medium text-slate-600">{prettifyFieldLabel(key)} :</span>{" "}
                <DetailValue value={val} />
              </li>
            ))}
          </ul>
        )}
        <ValuesBlock values={parsed.values} />
      </div>
    );
  }

  if (parsed.deleted === true) {
    return (
      <div className="space-y-1.5 text-sm">
        <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
          Suppression
        </span>
        <PlainKeyValueDetails parsed={parsed} />
      </div>
    );
  }

  const changeEntries = collectChangeEntries(parsed);
  if (changeEntries.length > 0) {
    return (
      <div className="space-y-1.5 text-sm">
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">
          Modification
        </span>
        <p className="font-medium text-slate-800">Champs modifiés :</p>
        <ChangesList entries={changeEntries} />
      </div>
    );
  }

  return <PlainKeyValueDetails parsed={parsed} />;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return iso;
  }
}

/** Libellé utilisateur depuis la réponse API (champs aplatis ou objet nested). */
function formatUserLabel(row) {
  if (row.utilisateur_display_name) return row.utilisateur_display_name;
  if (row.utilisateur_username) return row.utilisateur_username;
  const u = row.utilisateur;
  if (u != null && typeof u === "object" && typeof u.username === "string") {
    return u.username;
  }
  if (typeof u === "number" || typeof u === "string") {
    return String(u);
  }
  return "—";
}

/**
 * Journaux d’audit (administrateur uniquement) — filtres par période et tableau des entrées.
 */
export default function AuditLogsPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { itemsPerPage } = useSettings();
  const [startInput, setStartInput] = useState(() => localISODate());
  const [endInput, setEndInput] = useState(() => localISODate());
  const [selectedAction, setSelectedAction] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [appliedStart, setAppliedStart] = useState(() => localISODate());
  const [appliedEnd, setAppliedEnd] = useState(() => localISODate());
  const [appliedModel, setAppliedModel] = useState("");
  /** @type {[{ id: string, label: string }]} */
  const [availableModels, setAvailableModels] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const idxLast = page * itemsPerPage;
  const idxFirst = idxLast - itemsPerPage;
  const pageRows = useMemo(() => rows.slice(idxFirst, idxLast), [rows, idxFirst, idxLast]);

  useEffect(() => {
    setPage(1);
  }, [appliedStart, appliedEnd, selectedAction, appliedModel]);

  useEffect(() => {
    const total = rows.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (page > lastPage) setPage(lastPage);
  }, [rows.length, page, itemsPerPage]);

  useEffect(() => {
    if (!authUser) {
      navigate("/login", { replace: true });
      return;
    }
    if (!isAdminUser(authUser)) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate, authUser]);

  useEffect(() => {
    if (!authUser || !isAdminUser(authUser)) return;
    let cancelled = false;

    async function loadModels() {
      try {
        const res = await apiFetch(API_AUDIT_LOGS_MODELS);
        if (res.status === 403 || res.status === 401) return;
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setAvailableModels(data.filter((x) => x && typeof x.id === "string" && typeof x.label === "string"));
        }
      } catch {
        /* menu dégradé : seulement « Tous les modèles » */
      }
    }

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (appliedStart) params.set("start_date", appliedStart);
        if (appliedEnd) params.set("end_date", appliedEnd);
        if (selectedAction) params.set("action", selectedAction);
        if (appliedModel) params.set("model_name", appliedModel);
        const qs = params.toString();
        const url = qs ? `${API_AUDIT_LOGS}?${qs}` : API_AUDIT_LOGS;
        const res = await apiFetch(url);
        if (res.status === 403 || res.status === 401) {
          if (!cancelled) navigate("/dashboard", { replace: true });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.results ?? [];
        if (!cancelled) setRows(list);
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError("Impossible de charger les journaux d’audit.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [appliedStart, appliedEnd, selectedAction, appliedModel, navigate]);

  function handleFilter(e) {
    e.preventDefault();
    setAppliedStart(startInput);
    setAppliedEnd(endInput);
    setAppliedModel(selectedModel);
  }

  return (
    <div className="w-full min-w-0">
      <header className="mb-7">
        <h1 className="text-[28px] font-semibold leading-tight text-[#0f172a]">Journaux d&apos;audit</h1>
        <p className="mt-1.5 max-w-[900px] text-sm leading-relaxed text-[#64748b]">
          Historique des actions sensibles sur la plateforme. Filtrez par période si besoin.
        </p>
      </header>

      <form
        onSubmit={handleFilter}
        className="mb-8 flex flex-col flex-wrap items-stretch gap-4 rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-card sm:flex-row sm:items-end xl:flex-nowrap"
      >
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5 basis-[280px] sm:max-w-[360px]">
          <DateRangePickerCustom
            id="audit-periode"
            label="Période"
            startDate={startInput}
            endDate={endInput}
            onChange={({ startDate: s, endDate: e }) => {
              setStartInput(s);
              setEndInput(e);
            }}
            allowEmpty
            className="w-full"
          />
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1.5 basis-[160px] sm:max-w-[200px]">
          <label htmlFor="audit-action" className="text-xs font-medium text-[#64748b]">
            Action
          </label>
          <select
            id="audit-action"
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="h-10 w-full min-w-0 cursor-pointer rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
          >
            <option value="">Toutes les actions</option>
            <option value="CREATION">Création</option>
            <option value="MODIFICATION">Modification</option>
            <option value="SUPPRESSION">Suppression</option>
          </select>
        </div>
        <div className="flex min-w-[140px] flex-1 flex-col gap-1.5 basis-[160px] sm:max-w-[220px]">
          <label htmlFor="audit-model" className="text-xs font-medium text-[#64748b]">
            Modèle / Entité
          </label>
          <select
            id="audit-model"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="h-10 w-full min-w-0 cursor-pointer rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
          >
            <option value="">Tous les modèles</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-10 w-full shrink-0 rounded-lg bg-[#3b82f6] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 sm:w-auto sm:self-end xl:ml-auto"
        >
          Filtrer
        </button>
      </form>

      <section
        className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-card"
        aria-labelledby="audit-table-heading"
      >
        <div className="border-b border-[#e2e8f0] px-4 py-4">
          <h2 id="audit-table-heading" className="text-base font-semibold text-[#0f172a]">
            Entrées
          </h2>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <Loading message="Chargement des journaux…" className="min-h-[200px] px-4 py-10" />
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#64748b]">Aucune entrée pour cette période.</p>
          ) : (
            <table className="w-full min-w-0 border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                  <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Utilisateur
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3.5 text-left">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Modèle concerné
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-left">
                    Détails
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                {pageRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-[#475569]">{formatDate(row.date)}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 align-top font-medium`}>
                      {formatUserLabel(row)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
                        {ACTION_LABELS[row.action] ?? row.action}
                      </span>
                    </td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 align-top`}>{row.modele_concerne ?? "—"}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 align-top`}>
                      <AuditDetailsViewer details={row.details} action={row.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!loading && rows.length > 0 ? (
          <Pagination
            totalItems={rows.length}
            itemsPerPage={itemsPerPage}
            currentPage={page}
            paginate={setPage}
            itemLabel="entrées"
            className="border-[#e2e8f0] bg-[#fafbfc]/80"
          />
        ) : null}
      </section>
    </div>
  );
}
