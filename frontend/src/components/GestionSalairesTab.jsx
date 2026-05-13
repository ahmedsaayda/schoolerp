import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, startOfMonth } from "date-fns";

import AvanceSalaireModal from "./AvanceSalaireModal.jsx";
import { Infobulle } from "./ui/Infobulle.jsx";
import Loading from "./ui/Loading.jsx";
import Pagination from "./ui/Pagination.jsx";
import PaymentModal from "./PaymentModal.jsx";
import SalaryReceiptPrintHost from "./SalaryReceiptPrintHost.jsx";
import { TABLE_LONG_TEXT_WRAP } from "../constants/tableCells.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { API_POINTAGES, API_PROFESSEURS, apiFetch } from "../config.js";
import { normalizeNameSearch } from "../utils/nameSearch.js";
import { normalizeProfesseursListFromApi } from "../utils/professeurApi.js";
import { formatTnd, formatTnNumber } from "../utils/tunisianMoney.js";
import { generateSalaireRapportPdf } from "../utils/pdfGenerator.js";

function formatHeures(v) {
  return formatTnNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function HeuresImpayeesTooltip({ lignes }) {
  if (!lignes?.length) {
    return <p className="text-xs text-slate-600">Aucun détail (heures = 0 ou déjà payées).</p>;
  }
  return (
    <div className="max-h-52 w-[min(100vw-2rem,22rem)] space-y-1 overflow-y-auto text-left text-xs text-slate-800">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Séances en attente de paiement
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-[11px]">
        {lignes.map((l, i) => (
          <li key={`${l.date_cours}-${i}`}>
            <span className="font-medium text-slate-900">
              {l.date_cours
                ? new Date(`${l.date_cours}T12:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })
                : "—"}
            </span>
            {l.source_ligne === "reliquat_mois_precedent" ? (
              <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">
                Reliquat mois précédent
              </span>
            ) : null}
            {" — "}
            {l.nombre_heures} h
            {l.classe ? ` · ${l.classe}` : ""}
            {l.heure_debut && l.heure_fin ? ` (${l.heure_debut} – ${l.heure_fin})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Onglet admin : paie en temps réel, actions par professeur.
 */
export default function GestionSalairesTab({ refreshNonce = 0, onToast, onFinancialChange }) {
  const { itemsPerPage } = useSettings();
  const [professeurs, setProfesseurs] = useState([]);
  const [resumeById, setResumeById] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentProf, setPaymentProf] = useState(null);

  const [avanceOpen, setAvanceOpen] = useState(false);
  const [avanceProf, setAvanceProf] = useState(null);

  const isFirstLoad = useRef(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [prestationMonth, setPrestationMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [salaryReceiptPrintPayload, setSalaryReceiptPrintPayload] = useState(null);
  const clearSalaryReceiptPrint = useCallback(() => setSalaryReceiptPrintPayload(null), []);

  const filteredProfesseurs = useMemo(() => {
    const q = normalizeNameSearch(searchDebounced.trim());
    if (!q) return professeurs;
    return professeurs.filter((p) => {
      const nom = normalizeNameSearch(p.nom);
      const prenom = normalizeNameSearch(p.prenom);
      return nom.includes(q) || prenom.includes(q) || `${prenom} ${nom}`.trim().includes(q);
    });
  }, [professeurs, searchDebounced]);

  const idxLast = page * itemsPerPage;
  const idxFirst = idxLast - itemsPerPage;
  const currentProfs = useMemo(
    () => filteredProfesseurs.slice(idxFirst, idxLast),
    [filteredProfesseurs, idxFirst, idxLast],
  );

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [refreshNonce, searchDebounced]);

  useEffect(() => {
    const total = filteredProfesseurs.length;
    if (total === 0) return;
    const lastPage = Math.max(1, Math.ceil(total / itemsPerPage));
    if (page > lastPage) setPage(lastPage);
  }, [filteredProfesseurs.length, page, itemsPerPage]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setError("");
      if (isFirstLoad.current) {
        setLoading(true);
        isFirstLoad.current = false;
      } else {
        setRefreshing(true);
      }
      try {
        const resP = await apiFetch(API_PROFESSEURS);
        if (!resP.ok) throw new Error(`professeurs HTTP ${resP.status}`);
        const dataP = await resP.json();
        const raw = Array.isArray(dataP) ? dataP : dataP.results ?? [];
        const list = normalizeProfesseursListFromApi(raw);
        if (cancelled) return;
        setProfesseurs(list);

        const resumeUrl = (id) => {
          const [y, m] = prestationMonth.split("-");
          const mois = String(Number(m));
          const annee = String(Number(y));
          return `${API_PROFESSEURS}${id}/resume_paie/?mois=${encodeURIComponent(mois)}&annee=${encodeURIComponent(annee)}`;
        };
        const resumes = await Promise.all(
          list.map(async (p) => {
            const r = await apiFetch(resumeUrl(p.id));
            if (!r.ok) return [p.id, null];
            const j = await r.json();
            return [p.id, j];
          }),
        );
        if (cancelled) return;
        const map = {};
        for (const [id, r] of resumes) {
          map[id] = r;
        }
        setResumeById(map);
      } catch {
        if (!cancelled) {
          setProfesseurs([]);
          setResumeById({});
          setError("Impossible de charger les données de paie.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, prestationMonth]);

  const prestationLabel = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(prestationMonth)) return "—";
    const [y, m] = prestationMonth.split("-").map(Number);
    if (!m || !y) return "—";
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }, [prestationMonth]);

  async function handleRapport(prof) {
    const resume = resumeById[prof.id];
    const start = startOfMonth(new Date());
    const end = new Date();
    const qs = new URLSearchParams();
    qs.set("professeur", String(prof.id));
    qs.set("start_date", format(start, "yyyy-MM-dd"));
    qs.set("end_date", format(end, "yyyy-MM-dd"));
    try {
      const res = await apiFetch(`${API_POINTAGES}?${qs.toString()}`);
      if (!res.ok) throw new Error(`pointages ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data.results ?? [];
      await generateSalaireRapportPdf({
        professeur: prof,
        resume,
        pointages: rows,
        periodeLabel: `Du ${format(start, "dd/MM/yyyy")} au ${format(new Date(), "dd/MM/yyyy")}`,
      });
      onToast?.({ type: "success", message: "Rapport PDF téléchargé." });
    } catch {
      onToast?.({ type: "error", message: "Impossible de générer le rapport." });
    }
  }

  return (
    <>
      <section className="w-full min-w-0 space-y-4" aria-labelledby="salaires-title">
        <div className="flex flex-col gap-2 rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="salaires-title" className="text-base font-semibold text-[#0f172a]">
              Gestion des salaires
            </h2>
            <p className="mt-1 text-xs text-[#64748b]">
              Mois de prestation (M) : période du 1er au dernier jour du mois. Séances{" "}
              <strong>en attente de paiement</strong> uniquement ; reliquat M-1 ajouté automatiquement. Rapport
              : du début du mois civil courant à aujourd’hui.
            </p>
          </div>
          {refreshing ? (
            <span className="text-xs font-medium text-[#64748b]" aria-live="polite">
              Mise à jour…
            </span>
          ) : null}
        </div>

        <div
          className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          aria-label="Recherche et période salaires"
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <label
                htmlFor="salaires-mois-prestation"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]"
              >
                Mois de prestation (M)
              </label>
              <input
                id="salaires-mois-prestation"
                type="month"
                value={prestationMonth}
                onChange={(e) => setPrestationMonth(e.target.value)}
                disabled={loading || refreshing}
                className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] shadow-sm focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
              />
              <p className="mt-1 text-[11px] text-[#94a3b8]">Par défaut : mois civil en cours. {prestationLabel}</p>
            </div>
          </div>
          <label htmlFor="salaires-profs-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">
            Rechercher un enseignant
          </label>
          <input
            id="salaires-profs-search"
            type="search"
            autoComplete="off"
            placeholder="Filtrer par nom ou prénom…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            disabled={loading || refreshing}
            className="w-full max-w-md rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] shadow-sm placeholder:text-[#94a3b8] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
          />
        </div>

        <div
          className="w-full min-w-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          aria-labelledby="salaires-table-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] px-4 py-4">
            <h2 id="salaires-table-title" className="text-base font-semibold text-[#0f172a]">
              Personnel (
              {loading
                ? "…"
                : searchDebounced
                  ? `${filteredProfesseurs.length} sur ${professeurs.length}`
                  : professeurs.length}
              )
            </h2>
          </div>

          <div className={`overflow-x-auto ${refreshing ? "opacity-70 transition-opacity" : ""}`}>
            {error && !loading ? (
              <p className="px-4 py-10 text-center text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : loading && professeurs.length === 0 ? (
              <div className="px-4 py-4">
                <Loading message="Chargement des données…" className="min-h-[200px] py-6" />
              </div>
            ) : professeurs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64748b]">Aucun professeur enregistré.</p>
            ) : filteredProfesseurs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#64748b]" role="status">
                Aucun enseignant ne correspond à « {searchDebounced} ».
              </p>
            ) : (
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                    <th scope="col" className="px-3 py-3.5 text-left">
                      Nom
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left">
                      Prénom
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left">
                      Matière
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Tarif
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      M (h)
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Reliquat M-1
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Total h
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Total brut
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Avances
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      Net à payer
                    </th>
                    <th scope="col" className="whitespace-nowrap px-3 py-3.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                  {currentProfs.map((row, index) => {
                    const r = resumeById[row.id];
                    const hM = r?.heures_mois_prestation;
                    const hRel = r?.heures_reliquat_mois_precedent;
                    const h = r?.heures_non_payees ?? r?.total_heures;
                    const nonPayeLines = r?.pointages_non_payes_detail;
                    const brut = r?.total_brut ?? r?.salaire_brut;
                    const adv = r?.avances_non_soldees ?? r?.total_avances;
                    const net = r?.net_a_payer ?? r?.salaire_net;
                    const reste = r?.heures_restantes_mois;
                    return (
                      <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-3 py-3 font-medium`}>{row.nom}</td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-3 py-3`}>{row.prenom}</td>
                        <td className={`${TABLE_LONG_TEXT_WRAP} px-3 py-3`}>{row.matiere || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatTnd(row.tarif_horaire)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">
                          {hM != null && hM !== "" ? formatHeures(hM) : formatHeures(h)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-amber-900">
                          {hRel != null && Number(hRel) > 0 ? formatHeures(hRel) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[#0f172a]">
                          <Infobulle
                            content={<HeuresImpayeesTooltip lignes={nonPayeLines} />}
                            side="left"
                            touchStyle="plain"
                            className="cursor-help"
                            disabled={!r || Number(h) < 0.0005}
                          >
                            {formatHeures(h)}
                          </Infobulle>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatTnd(brut)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-amber-900">{formatTnd(adv)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums font-semibold text-[#15803d]">
                          {formatTnd(net)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Fiche de paie du mois en cours — calcul et validation"
                              onClick={() => {
                                setPaymentProf(row);
                                setPaymentOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#15803d] px-2 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#166534]"
                            >
                              <span aria-hidden>📋</span> Fiche de paie
                            </button>
                            <button
                              type="button"
                              title="Avance"
                              onClick={() => {
                                setAvanceProf(row);
                                setAvanceOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-100"
                            >
                              <span aria-hidden>💸</span> + Avance
                            </button>
                            <button
                              type="button"
                              title="Rapport détaillé"
                              onClick={() => handleRapport(row)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-[#f1f5f9] px-2 py-1.5 text-xs font-semibold text-[#475569] transition hover:bg-[#e2e8f0]"
                            >
                              <span aria-hidden>📊</span> Rapport
                            </button>
                          </div>
                          {reste != null && Number(reste) > 0 ? (
                            <p className="mt-1 max-w-[200px] text-right text-[10px] leading-tight text-[#94a3b8]">
                              Reste à travailler (mois) : {formatHeures(reste)} h
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {!loading && filteredProfesseurs.length > 0 ? (
            <Pagination
              totalItems={filteredProfesseurs.length}
              itemsPerPage={itemsPerPage}
              currentPage={page}
              paginate={setPage}
              itemLabel="professeurs"
              className="border-[#e2e8f0] bg-[#fafbfc]/80"
            />
          ) : null}
        </div>
      </section>

      <PaymentModal
        open={paymentOpen}
        professeur={paymentProf}
        resume={paymentProf ? resumeById[paymentProf.id] : null}
        onClose={() => {
          setPaymentOpen(false);
          setPaymentProf(null);
        }}
        onToast={onToast}
        onSalaryReceiptPrint={setSalaryReceiptPrintPayload}
        onSuccess={() => {
          onFinancialChange?.();
        }}
      />

      <SalaryReceiptPrintHost payload={salaryReceiptPrintPayload} onDone={clearSalaryReceiptPrint} />

      <AvanceSalaireModal
        open={avanceOpen}
        professeur={avanceProf}
        personnel={null}
        onClose={() => {
          setAvanceOpen(false);
          setAvanceProf(null);
        }}
        onSuccess={() => {
          setAvanceOpen(false);
          setAvanceProf(null);
          onToast?.({ type: "success", message: "Avance enregistrée." });
          onFinancialChange?.();
        }}
      />

    </>
  );
}
