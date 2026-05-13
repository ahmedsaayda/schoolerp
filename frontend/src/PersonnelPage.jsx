import { useCallback, useEffect, useMemo, useState } from "react";

import { Banknote, Eye, HandCoins, Pencil, Search } from "lucide-react";

import PersonnelDetailsModal from "./components/PersonnelDetailsModal.jsx";
import PersonnelModal, { PERSONNEL_ROLE_OPTIONS } from "./components/PersonnelModal.jsx";
import PayerPersonnelModal from "./components/PayerPersonnelModal.jsx";
import AvanceSalaireModal from "./components/AvanceSalaireModal.jsx";
import SalaryReceiptPrintHost from "./components/SalaryReceiptPrintHost.jsx";
import Loading from "./components/ui/Loading.jsx";
import Pagination from "./components/ui/Pagination.jsx";
import { useSettings } from "./context/SettingsContext.jsx";
import { TABLE_LONG_TEXT_WRAP } from "./constants/tableCells.js";
import { API_PERSONNEL, apiFetch } from "./config.js";
import { formatTnd } from "./utils/tunisianMoney.js";
import { useAuth } from "./AuthContext.jsx";
import { isAdminUser, isComptable } from "./authRoles.js";

function formatMoneyTnd(value) {
  return formatTnd(value, { minFractionDigits: 0, maxFractionDigits: 2 });
}

function roleLabel(code) {
  const o = PERSONNEL_ROLE_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code || "—";
}

const iconBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#475569] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-1";

/**
 * RH — personnel administratif et de soutien (hors enseignement).
 * Liste et paiement : direction ou comptable ; création / modification : administration uniquement.
 */
export default function PersonnelPage() {
  const { user } = useAuth();
  const admin = isAdminUser(user);
  const canFinanceRh = admin || isComptable(user);
  const { itemsPerPage } = useSettings();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payPersonnel, setPayPersonnel] = useState(null);
  const [avanceOpen, setAvanceOpen] = useState(false);
  const [avancePersonnel, setAvancePersonnel] = useState(null);
  const [pdfToast, setPdfToast] = useState(null);
  const [salaryReceiptPrintPayload, setSalaryReceiptPrintPayload] = useState(null);
  const clearSalaryReceiptPrint = useCallback(() => setSalaryReceiptPrintPayload(null), []);

  const idxLast = page * itemsPerPage;
  const idxFirst = idxLast - itemsPerPage;
  const pageRows = useMemo(() => rows.slice(idxFirst, idxLast), [rows, idxFirst, idxLast]);

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
      const q = search.trim();
      if (q) params.set("search", q);
      const qs = params.toString();
      const url = qs ? `${API_PERSONNEL}?${qs}` : API_PERSONNEL;
      const res = await apiFetch(url);
      if (!res.ok) {
        setLoadError(`Impossible de charger le personnel (${res.status}).`);
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
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (!pdfToast) return undefined;
    const t = setTimeout(() => setPdfToast(null), 4500);
    return () => clearTimeout(t);
  }, [pdfToast]);

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

  function afterSave() {
    closeModal();
    load();
  }

  function openDetails(id) {
    setDetailsId(id);
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsId(null);
  }

  function openPay(row) {
    setPayPersonnel(row);
    setPayOpen(true);
  }

  function closePay() {
    setPayOpen(false);
    setPayPersonnel(null);
  }

  function openAvance(row) {
    setAvancePersonnel(row);
    setAvanceOpen(true);
  }

  function closeAvance() {
    setAvanceOpen(false);
    setAvancePersonnel(null);
  }

  function genererFicheFromDetails(id) {
    setDetailsOpen(false);
    setDetailsId(null);
    const row = rows.find((r) => r.id === id);
    if (row) {
      setPayPersonnel(row);
    } else {
      setPayPersonnel({
        id,
        nom: "—",
        prenom: "—",
        role: "",
      });
    }
    setPayOpen(true);
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Personnel (non enseignant)</h1>
          <p className="mt-1 text-sm text-[#64748b]">
            Gestion du personnel administratif et de soutien : rôles, salaires et historiques.
          </p>
        </div>
        {admin ? (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8]"
          >
            Ajouter
          </button>
        ) : null}
      </div>

      {loadError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] p-3 sm:p-4">
          <h2 className="mb-1 text-sm font-semibold text-[#0f172a]">Liste du personnel</h2>
          <label htmlFor="personnel-search" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
            Recherche
          </label>
          <div className="relative min-w-0 max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <input
              id="personnel-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom, prénom, rôle…"
              autoComplete="off"
              className="w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-2.5 pl-10 pr-3 text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[#e2e8f0] text-left text-sm">
            <thead className="bg-[#f8fafc]">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-[#475569]">
                  Nom
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-[#475569]">
                  Prénom
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-[#475569]">
                  Rôle
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-left font-semibold text-[#475569]">
                  Salaire mensuel
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold text-[#475569]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <Loading message="Chargement des données…" className="min-h-[180px] py-8" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#64748b]">
                    Aucun enregistrement.
                    {admin ? (
                      <>
                        {" "}
                        Cliquez sur « Ajouter » pour créer une fiche personnel.
                      </>
                    ) : null}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#f8fafc]/80">
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 font-medium text-[#0f172a]`}>{row.nom}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-[#334155]`}>{row.prenom}</td>
                    <td className={`${TABLE_LONG_TEXT_WRAP} px-4 py-3 text-[#334155]`}>{roleLabel(row.role)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-[#0f172a]">
                      {formatMoneyTnd(row.salaire_mensuel)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {canFinanceRh ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openDetails(row.id)}
                              className={iconBtn}
                              title="Voir"
                              aria-label="Voir le détail"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openPay(row)}
                              className={iconBtn}
                              title="Payer le salaire"
                              aria-label="Payer le salaire"
                            >
                              <Banknote className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openAvance(row)}
                              className={iconBtn}
                              title="Accorder une avance"
                              aria-label="Accorder une avance"
                            >
                              <HandCoins className="h-4 w-4" />
                            </button>
                          </>
                        ) : null}
                        {admin ? (
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className={iconBtn}
                            title="Modifier"
                            aria-label="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && rows.length > 0 ? (
          <Pagination
            totalItems={rows.length}
            itemsPerPage={itemsPerPage}
            currentPage={page}
            paginate={setPage}
            itemLabel="fiches"
            className="border-[#e2e8f0] bg-[#fafbfc]/80"
          />
        ) : null}
      </div>

      {admin ? (
        <PersonnelModal
          open={modalOpen}
          mode={modalMode}
          personnel={selected}
          onClose={closeModal}
          onSuccess={afterSave}
        />
      ) : null}

      <PersonnelDetailsModal
        open={detailsOpen}
        personnelId={detailsId}
        onClose={closeDetails}
        onGenererFiche={genererFicheFromDetails}
        onToast={(t) => setPdfToast(t)}
      />

      <PayerPersonnelModal
        open={payOpen}
        personnel={payPersonnel}
        onClose={closePay}
        onSuccess={load}
        onToast={(t) => setPdfToast(t)}
        onSalaryReceiptPrint={setSalaryReceiptPrintPayload}
      />

      <AvanceSalaireModal
        open={avanceOpen}
        personnel={avancePersonnel}
        professeur={null}
        onClose={closeAvance}
        onSuccess={() => {
          setPdfToast({ type: "success", message: "Avance enregistrée." });
          load();
        }}
      />

      <SalaryReceiptPrintHost payload={salaryReceiptPrintPayload} onDone={clearSalaryReceiptPrint} />

      {pdfToast ? (
        <div
          className="fixed bottom-4 right-4 z-[110] max-w-sm rounded-lg border border-[#e2e8f0] bg-white px-4 py-3 text-sm font-medium text-[#0f172a] shadow-lg"
          role="status"
        >
          <span
            className={
              pdfToast.type === "success"
                ? "text-emerald-800"
                : pdfToast.type === "warning"
                  ? "text-amber-800"
                  : "text-red-800"
            }
          >
            {pdfToast.message}
          </span>
        </div>
      ) : null}
    </div>
  );
}
