import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReactToPrint } from "react-to-print";

import DateRangePickerCustom from "../components/common/DateRangePickerCustom.jsx";
import Loading from "../components/ui/Loading.jsx";
import PointagePersonnelPrintView from "../components/PointagePersonnelPrintView.jsx";
import { PERSONNEL_ROLE_OPTIONS } from "../components/PersonnelModal.jsx";
import { API_POINTAGE_PERSONNEL_BULK, API_POINTAGE_PERSONNEL_JOUR, apiFetch } from "../config.js";
import { localISODate } from "../utils/dateLocal.js";

const STATUTS = [
  { value: "PRESENT", label: "Présent" },
  { value: "ABSENT", label: "Absent" },
  { value: "RETARD", label: "Retard" },
];

function roleLabelFromOptions(code) {
  const o = PERSONNEL_ROLE_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code || "—";
}

function statutLabel(value) {
  const o = STATUTS.find((s) => s.value === value);
  return o ? o.label : "—";
}

function statusBtnClass(value, isSelected) {
  if (isSelected) {
    if (value === "PRESENT") {
      return "bg-emerald-600 text-white ring-2 ring-emerald-600 ring-offset-1";
    }
    if (value === "ABSENT") {
      return "bg-red-600 text-white ring-2 ring-red-600 ring-offset-1";
    }
    if (value === "RETARD") {
      return "bg-amber-500 text-amber-950 ring-2 ring-amber-500 ring-offset-1";
    }
  }
  return "border border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]";
}

/**
 * Pointage journalier du personnel non enseignant (administrateur ou agent de pointage).
 */
export default function PointagePersonnelPage() {
  /** Plage (par défaut : aujourd’hui — un clic sur « Aujourd’hui » ou une plage historique). */
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());

  const selectedDate = useMemo(() => {
    const cap = localISODate();
    const e = endDate || startDate;
    if (!e) return cap;
    return e > cap ? cap : e;
  }, [startDate, endDate]);
  const [lignes, setLignes] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [saveOk, setSaveOk] = useState("");
  /** Au moins un enregistrement `PointagePersonnel` existe déjà pour la date affichée. */
  const [hasExistingPointage, setHasExistingPointage] = useState(false);
  /** Identifiants des personnes dont le pointage est déjà en base : statuts modifiables après « Modifier ». */
  const [unlockedIds, setUnlockedIds] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const printRef = useRef(null);

  const titleDateEn = useMemo(() => {
    const parts = selectedDate.split("-").map(Number);
    const y = parts[0];
    const mo = parts[1];
    const da = parts[2];
    if (!y || !mo || !da) return selectedDate;
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(y, mo - 1, da));
  }, [selectedDate]);

  const printRows = useMemo(() => {
    const out = [];
    for (const row of lignes) {
      const p = row?.personnel;
      if (!p || p.id == null) continue;
      const id = Number(p.id);
      const st = statusById[id] ?? "PRESENT";
      out.push({
        id,
        nomPrenom: [p.nom, p.prenom].filter(Boolean).join(" ").trim() || "—",
        fonction: p.role_display || roleLabelFromOptions(p.role),
        statut: st,
        statutLabel: statutLabel(st),
      });
    }
    return out;
  }, [lignes, statusById]);

  const printSummary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let retard = 0;
    for (const r of printRows) {
      if (r.statut === "ABSENT") absent += 1;
      else if (r.statut === "RETARD") retard += 1;
      else present += 1;
    }
    return { present, absent, retard, total: printRows.length };
  }, [printRows]);

  const [printedAtLabel, setPrintedAtLabel] = useState(() =>
    new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date()),
  );

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Rapport-pointage-personnel-${selectedDate}`,
    ignoreGlobalStyles: true,
    fonts: [
      {
        family: "Inter",
        source: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
      },
    ],
    pageStyle: `
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        html, body {
          width: 100%;
          margin: 0;
          padding: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

  const fetchJour = useCallback(async (dateStr, options = {}) => {
    const { signal, quiet = false } = options;
    if (!quiet) {
      setError("");
      setLoading(true);
      setHasExistingPointage(false);
    }
    try {
      const url = `${API_POINTAGE_PERSONNEL_JOUR}?date=${encodeURIComponent(dateStr)}`;
      const res = await apiFetch(url, { signal, cache: "no-store" });
      if (res.status === 403) {
        setError("Accès refusé : droits insuffisants pour le pointage personnel.");
        setLignes([]);
        setStatusById({});
        setHasExistingPointage(false);
        return;
      }
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
        } catch {
          /* ignore */
        }
        setError(msg);
        setLignes([]);
        setStatusById({});
        setHasExistingPointage(false);
        return;
      }
      const data = await res.json();
      if (signal?.aborted) return;
      const results = Array.isArray(data?.results) ? data.results : [];

      const initialStatus = {};
      let exists = false;
      for (const row of results) {
        const pid = row?.personnel?.id;
        if (pid == null) continue;
        const id = Number(pid);
        const st = row?.pointage?.statut;
        if (row.pointage && st) {
          initialStatus[id] =
            st === "ABSENT" || st === "RETARD" || st === "PRESENT" ? st : "PRESENT";
          exists = true;
        } else {
          initialStatus[id] = "PRESENT";
        }
      }

      if (signal?.aborted) return;
      setLignes(results);
      setStatusById(initialStatus);
      setHasExistingPointage(exists);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError("Impossible de charger le pointage pour cette date.");
      setLignes([]);
      setStatusById({});
      setHasExistingPointage(false);
    } finally {
      if (!signal?.aborted && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSaveOk("");
    setUnlockedIds(new Set());
  }, [selectedDate]);

  useEffect(() => {
    const ac = new AbortController();
    fetchJour(selectedDate, { signal: ac.signal });
    return () => ac.abort();
  }, [selectedDate, fetchJour]);

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

  useEffect(() => {
    if (!saveOk) return;
    const t = window.setTimeout(() => setSaveOk(""), 4500);
    return () => window.clearTimeout(t);
  }, [saveOk]);

  function setStatut(personnelId, value) {
    setStatusById((prev) => ({ ...prev, [personnelId]: value }));
  }

  function unlockRow(personnelId) {
    setUnlockedIds((prev) => new Set(prev).add(personnelId));
  }

  async function executeSubmit(isUpdate) {
    setError("");
    setSaveOk("");
    if (lignes.length === 0) return;
    setSaving("Enregistrement…");
    const items = lignes
      .map((row) => {
        const id = row?.personnel?.id;
        if (id == null) return null;
        return {
          personnel_id: id,
          statut: statusById[Number(id)] ?? "PRESENT",
        };
      })
      .filter(Boolean);
    try {
      const res = await apiFetch(API_POINTAGE_PERSONNEL_BULK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, items }),
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
      await fetchJour(selectedDate, { quiet: true });
      setUnlockedIds(new Set());
      setSaveOk(
        isUpdate
          ? "Le pointage a été mis à jour avec succès."
          : "Le pointage a été enregistré avec succès.",
      );
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSaving("");
      setConfirmOpen(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (lignes.length === 0) return;
    if (hasExistingPointage) {
      setConfirmOpen(true);
      return;
    }
    void executeSubmit(false);
  }

  function handleConfirmUpdate() {
    void executeSubmit(true);
  }

  return (
    <div className="space-y-6">
      <PointagePersonnelPrintView
        ref={printRef}
        printRows={printRows}
        printSummary={printSummary}
        titleDateEn={titleDateEn}
        printedAtLabel={printedAtLabel}
      />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Pointage personnel</h1>
        <p className="text-sm text-[#64748b]">
          Présence du personnel (hors enseignement) par jour — direction et agent de pointage.
        </p>
      </header>

      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <div className="flex flex-col items-start gap-3">
          <div className="w-full min-w-0 sm:max-w-md">
            <DateRangePickerCustom
              id="pointage-personnel-periode"
              label="Jour de pointage"
              startDate={startDate}
              endDate={endDate}
              onChange={({ startDate: s, endDate: e }) => {
                setStartDate(s);
                setEndDate(e);
              }}
              allowEmpty={false}
              disabled={Boolean(saving)}
              popoverAlign="left"
              compactButton
              className="w-fit"
            />
          </div>
          <p className="text-xs text-[#94a3b8]">
            Le tableau correspond au <strong>dernier jour</strong> de la plage (au plus tard aujourd’hui).
          </p>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-sm text-[#0f172a]">
              <span className="text-[#64748b]">Journée : </span>
              <span className="font-medium capitalize">{titleDate}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                flushSync(() => {
                  setPrintedAtLabel(
                    new Intl.DateTimeFormat("fr-FR", {
                      dateStyle: "long",
                      timeStyle: "short",
                    }).format(new Date()),
                  );
                });
                handlePrint();
              }}
              disabled={Boolean(saving) || loading || lignes.length === 0}
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto sm:w-auto"
            >
              <span aria-hidden>🖨️</span>
              Imprimer le rapport
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {saveOk ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          {saveOk}
        </p>
      ) : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pp-confirm-title"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget && !saving) setConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-xl">
            <h2 id="pp-confirm-title" className="sr-only">
              Confirmation de modification
            </h2>
            <p className="text-sm leading-relaxed text-[#475569]">
              <span className="font-semibold text-[#0f172a]">Confirmation de modification :</span> Êtes-vous sûr de
              vouloir enregistrer ces changements pour la journée du{" "}
              <span className="font-medium capitalize text-[#0f172a]">{titleDate}</span> ?
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={Boolean(saving)}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={Boolean(saving)}
                onClick={handleConfirmUpdate}
                className="rounded-xl bg-[#0f172a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e293b] disabled:opacity-50"
              >
                {saving || "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <Loading message="Chargement du personnel…" className="min-h-[200px] py-6" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
            <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#0f172a]">Effectif</h2>
              <p className="mt-0.5 text-xs text-[#64748b]">Choisissez le statut pour chaque membre, puis enregistrez.</p>
            </div>
            {lignes.length === 0 ? (
              <p className="p-8 text-center text-sm text-[#64748b]">Aucun enregistrement de personnel. Ajoutez des fiches dans &laquo; Personnel &raquo;.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#e2e8f0] text-left text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-[#334155]">Nom</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-[#334155]">Prénom</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-[#334155]">Rôle</th>
                      <th className="min-w-[280px] px-4 py-3 font-semibold text-[#334155]">Statut</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-[#334155]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {lignes.map((row) => {
                      const p = row.personnel;
                      if (!p || p.id == null) return null;
                      const id = Number(p.id);
                      const current = statusById[id] ?? "PRESENT";
                      const hasSaved = row.pointage != null;
                      const rowLocked = hasSaved && !unlockedIds.has(id);
                      const statusDisabled = Boolean(saving) || rowLocked;
                      const enAttente = !hasSaved;
                      return (
                        <tr
                          key={id}
                          className={[
                            "transition-colors",
                            enAttente ? "bg-[#fff7ed] hover:bg-[#ffedd5]" : "hover:bg-[#fafafa]",
                          ].join(" ")}
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-[#0f172a]">{p.nom || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#334155]">{p.prenom || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#64748b]">
                            {p.role_display || roleLabelFromOptions(p.role)}
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className={[
                                "flex flex-wrap gap-1.5",
                                rowLocked ? "opacity-60" : "",
                              ].join(" ")}
                            >
                              {STATUTS.map((opt) => {
                                const selected = current === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setStatut(id, opt.value)}
                                    disabled={statusDisabled}
                                    className={[
                                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                                      statusBtnClass(opt.value, selected),
                                      statusDisabled ? "cursor-not-allowed opacity-60" : "",
                                    ].join(" ")}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {hasSaved ? (
                              <button
                                type="button"
                                onClick={() => unlockRow(id)}
                                disabled={Boolean(saving) || !rowLocked}
                                title={rowLocked ? "Modifier le pointage" : "Modification activée"}
                                className={[
                                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
                                  rowLocked
                                    ? "border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
                                    : "cursor-default border-transparent bg-[#f1f5f9] text-[#64748b]",
                                  saving ? "cursor-not-allowed opacity-60" : "",
                                ].join(" ")}
                              >
                                <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                Modifier
                              </button>
                            ) : (
                              <span className="text-xs text-[#94a3b8]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {lignes.length > 0 ? (
            <div className="flex justify-center">
              <button
                type="submit"
                disabled={Boolean(saving) || loading}
                className="inline-flex min-h-[48px] w-full max-w-md items-center justify-center rounded-xl bg-[#0f172a] px-6 text-base font-semibold text-white shadow-sm transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {saving || (hasExistingPointage ? "Mettre à jour le pointage" : "Enregistrer le pointage")}
              </button>
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}
