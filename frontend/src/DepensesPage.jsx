import { useCallback, useEffect, useMemo, useState } from "react";

import { Banknote, Box, FileText, Home, Paperclip, Printer, Tag, Wrench } from "lucide-react";

import DateRangePickerCustom from "./components/common/DateRangePickerCustom.jsx";
import DepenseModal, { DEPENSE_CATEGORIE_OPTIONS } from "./components/DepenseModal.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "./branding.js";
import { useSettings } from "./context/SettingsContext.jsx";
import { formatCurrency } from "./DashboardHome.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import { API_DEPENSES, apiFetch } from "./config.js";
import { localISODate } from "./utils/dateLocal.js";

function categorieLabel(code) {
  const o = DEPENSE_CATEGORIE_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code || "—";
}

/** Icône contextuelle par code `Depense.Categorie` (aligné sur l’API). */
function CategorieIcon({ code }) {
  const map = {
    LOYER: Home,
    FACTURES: FileText,
    FOURNITURES: Box,
    ENTRETIEN: Wrench,
    SALAIRE: Banknote,
    AUTRE: Tag,
  };
  const Icon = map[code] ?? Tag;
  return <Icon className="h-4 w-4 shrink-0 text-[#64748b]" strokeWidth={2} aria-hidden />;
}

function formatDateCourte(isoDate) {
  if (!isoDate) return "—";
  const s = String(isoDate).slice(0, 10);
  try {
    const [y, m, d] = s.split("-");
    if (y && m && d) {
      const dt = new Date(Number(y), Number(m) - 1, Number(d));
      return new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(dt);
    }
  } catch {
    /* ignore */
  }
  return s;
}

function sumMontant(items) {
  return items.reduce((acc, r) => {
    const n = Number(r?.montant);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function formatPeriodeFiltre(start, end) {
  if (start && end) return `Du ${formatDateCourte(start)} au ${formatDateCourte(end)}`;
  if (start) return `À partir du ${formatDateCourte(start)}`;
  if (end) return `Jusqu’au ${formatDateCourte(end)}`;
  return "Toutes périodes";
}

/**
 * Dépenses d'exploitation — rôles administrateur ou comptable.
 */
export default function DepensesPage() {
  const { itemsPerPage } = useSettings();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  /** Période (YYYY-MM-DD) — filtre API sur la date de la dépense */
  const [startDate, setStartDate] = useState(() => localISODate());
  const [endDate, setEndDate] = useState(() => localISODate());

  const idxLast = page * itemsPerPage;
  const idxFirst = idxLast - itemsPerPage;
  const pageRows = useMemo(() => rows.slice(idxFirst, idxLast), [rows, idxFirst, idxLast]);

  /** En impression, afficher toutes les lignes filtrées pour cohérence avec le total. */
  const [forPrint, setForPrint] = useState(false);
  useEffect(() => {
    const onBefore = () => setForPrint(true);
    const onAfter = () => setForPrint(false);
    if (typeof window === "undefined") return undefined;
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const tableRows = forPrint ? rows : pageRows;

  const totalFiltered = useMemo(() => sumMontant(rows), [rows]);

  useEffect(() => {
    const total = rows.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (page > lastPage) setPage(lastPage);
  }, [rows.length, page, itemsPerPage]);

  const load = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      const qs = params.toString();
      const url = qs ? `${API_DEPENSES}?${qs}` : API_DEPENSES;
      const res = await apiFetch(url);
      if (!res.ok) {
        setLoadError(`Impossible de charger les dépenses (${res.status}).`);
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? data : data.results ?? []);
    } catch {
      setLoadError("Erreur réseau ou serveur indisponible.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  function clearDateFilters() {
    setStartDate("");
    setEndDate("");
  }

  function openCreate() {
    setModalMode("create");
    setSelected(null);
    setModalOpen(true);
  }

  function openEdit(row) {
    setModalMode("edit");
    setSelected(row);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
  }

  return (
    <div className="w-full min-w-0 space-y-6 print:max-w-none print:text-black">
      {/* En-tête écran (masqué à l’impression — voir bloc dédié ci-dessous) */}
      <div className="print:hidden">
        <div className="space-y-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Dépenses</h1>
              <p className="mt-1 text-sm text-[#64748b]">
                Charges fixes et variables : loyer, factures, fournitures, entretien. Utilisées dans le tableau de
                bord financier.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#475569] shadow-sm transition hover:border-[#cbd5e1] hover:bg-[#f8fafc]"
              >
                <Printer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Imprimer
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8]"
              >
                Ajouter une dépense
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-[#eef2f6] pt-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full min-w-0 sm:max-w-md sm:flex-1">
              <DateRangePickerCustom
                id="depenses-periode"
                label="Période (date de la dépense)"
                startDate={startDate}
                endDate={endDate}
                onChange={({ startDate: s, endDate: e }) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
                allowEmpty
              />
            </div>
            <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
              <button
                type="button"
                onClick={clearDateFilters}
                disabled={!startDate && !endDate}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 hidden w-full border-b-2 border-[#0f172a] pb-3 print:mb-8 print:flex print:items-center print:gap-4 print:border-slate-900">
        <img
          src={schoolLogoPrintPublicUrl()}
          alt="SAMAH SCHOOL Logo"
          width={64}
          height={64}
          className="h-16 w-auto shrink-0 object-contain print:h-16 print:max-h-16 print:w-auto"
        />
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-[#0f172a] print:text-base">{SCHOOL_NAME}</p>
          <p className="text-sm text-[#64748b] print:text-xs">{SCHOOL_TAGLINE}</p>
          <p className="mt-1 text-base font-semibold text-[#0f172a] print:mt-1.5">Liste des dépenses</p>
          <p className="text-sm text-[#64748b] print:text-xs print:text-slate-600">
            {formatPeriodeFiltre(startDate, endDate)} · Impression {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}
          </p>
        </div>
      </div>

      {loadError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      <div
        className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm print:w-full print:max-w-none print:border-slate-300 print:shadow-none"
      >
        <div className="overflow-x-auto print:overflow-visible">
          <table className="min-w-full w-full divide-y divide-[#e2e8f0] text-left text-sm print:w-full print:divide-slate-300 print:text-sm">
            <thead className="bg-[#f8fafc] print:bg-white">
              <tr>
                <th
                  scope="col"
                  className="w-[6.5rem] whitespace-nowrap px-4 py-3 text-left font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Titre
                </th>
                <th
                  scope="col"
                  className="w-[9.5rem] px-4 py-3 text-left font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Catégorie
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Remarque
                </th>
                <th
                  scope="col"
                  className="w-[7rem] whitespace-nowrap px-4 py-3 text-left font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Justificatif
                </th>
                <th
                  scope="col"
                  className="w-[6.5rem] whitespace-nowrap px-4 py-3 text-right font-semibold text-[#475569] print:border-b print:border-slate-300 print:py-2 print:text-xs print:font-bold print:text-slate-800"
                >
                  Montant
                </th>
                <th
                  scope="col"
                  className="print:hidden w-[5.5rem] whitespace-nowrap px-4 py-3 text-left font-semibold text-[#475569]"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0] print:divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-0 print:hidden">
                    <Loading message="Chargement des données…" className="min-h-[180px] py-8" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-[#64748b] print:border-slate-200 print:py-6 print:text-slate-600"
                  >
                    Aucune dépense enregistrée.
                  </td>
                </tr>
              ) : (
                tableRows.map((row) => {
                  const cat = row.categorie && String(row.categorie);
                  return (
                    <tr key={row.id} className="hover:bg-[#f8fafc] print:break-inside-avoid">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[#0f172a] print:py-2 print:text-sm">
                        {formatDateCourte(row.date_depense)}
                      </td>
                      <td
                        className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium text-[#0f172a] print:py-2 print:text-sm`}
                      >
                        {row.titre || "—"}
                      </td>
                      <td
                        className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-[#64748b] print:py-2 print:text-sm print:text-slate-800`}
                      >
                        <span className="inline-flex max-w-full items-center gap-2 align-middle">
                          <CategorieIcon code={cat} />
                          <span className="min-w-0">{row.categorie_display || categorieLabel(row.categorie)}</span>
                        </span>
                      </td>
                      <td
                        className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-[#64748b] print:py-2 print:text-sm print:text-slate-700`}
                      >
                        {row.note != null && String(row.note).trim() !== "" ? row.note : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#64748b] print:py-2 print:text-sm print:text-slate-700">
                        {row.piece_jointe ? (
                          <a
                            href={row.piece_jointe}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#2563eb] hover:underline"
                            title="Ouvrir le justificatif"
                          >
                            <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                            Voir
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-[#0f172a] print:py-2 print:text-sm">
                        {formatCurrency(row.montant)}
                      </td>
                      <td className="print:hidden whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="text-sm font-medium text-[#2563eb] hover:underline"
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-[#e2e8f0] bg-[#f8fafc] font-bold print:border-slate-900 print:bg-slate-50 print:break-inside-avoid">
                  <td
                    colSpan={5}
                    className="px-4 py-3 text-right text-[#0f172a] print:border-t print:border-slate-300 print:py-2.5 print:text-sm"
                  >
                    Total
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-[#0f172a] print:border-t print:border-slate-300 print:py-2.5 print:text-sm">
                    {formatCurrency(totalFiltered)}
                  </td>
                  <td className="print:hidden" aria-hidden />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {!loading && rows.length > 0 ? (
          <Pagination
            totalItems={rows.length}
            itemsPerPage={itemsPerPage}
            currentPage={page}
            paginate={setPage}
            itemLabel="dépenses"
            className="print:hidden border-[#e2e8f0] bg-[#fafbfc]/80"
          />
        ) : null}
      </div>

      <DepenseModal
        open={modalOpen}
        mode={modalMode}
        depense={selected}
        onClose={closeModal}
        onSuccess={() => {
          closeModal();
          load();
        }}
      />
    </div>
  );
}
