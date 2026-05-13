import { useEffect, useState } from "react";

import { Printer, X } from "lucide-react";

import { API_PERSONNEL, apiFetch } from "../config.js";
import { formatTnd } from "../utils/tunisianMoney.js";
import { PERSONNEL_ROLE_OPTIONS } from "./PersonnelModal.jsx";
import { mapFichePaieApiToSalaryReceiptProps } from "./SalaryDoubleReceiptShared.jsx";
import SalaryReceiptPrintHost from "./SalaryReceiptPrintHost.jsx";
import Loading from "./ui/Loading.jsx";

function formatMoneyTnd(value) {
  return formatTnd(value, { minFractionDigits: 0, maxFractionDigits: 2 });
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

function formatMoisConcerne(isoDate) {
  if (!isoDate) return "—";
  const s = String(isoDate).slice(0, 10);
  const [y, m] = s.split("-");
  if (y && m) {
    const dt = new Date(Number(y), Number(m) - 1, 1);
    return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(dt);
  }
  return s;
}

function formatDatePaiement(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(iso);
  }
}

function roleLabel(code) {
  const o = PERSONNEL_ROLE_OPTIONS.find((x) => x.value === code);
  return o ? o.label : code || "—";
}

/**
 * Fiche détail personnel : rôle, salaire, embauche, historique paiements & pointage.
 */
export default function PersonnelDetailsModal({
  open,
  personnelId,
  onClose,
  onGenererFiche,
  onToast,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printingId, setPrintingId] = useState(null);
  const [salaryReceiptPrintPayload, setSalaryReceiptPrintPayload] = useState(null);

  useEffect(() => {
    if (!open || !personnelId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch(`${API_PERSONNEL}${personnelId}/`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError(`Impossible de charger la fiche (${res.status}).`);
          if (!cancelled) setData(null);
          return;
        }
        const j = await res.json();
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) {
          setError("Erreur réseau ou serveur indisponible.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, personnelId]);

  async function handlePrintFiche(row) {
    if (!personnelId || !row?.id) return;
    setPrintingId(row.id);
    try {
      const res = await apiFetch(`${API_PERSONNEL}${personnelId}/fiche_paie_salaire/${row.id}/`);
      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body.detail === "string") msg = body.detail;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const payload = await res.json();
      const props = mapFichePaieApiToSalaryReceiptProps(payload);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSalaryReceiptPrintPayload(props));
      });
      onToast?.({ type: "success", message: "Boîte de dialogue d’impression ouverte." });
    } catch (e) {
      onToast?.({
        type: "error",
        message: e instanceof Error ? e.message : "Impossible de préparer l’impression.",
      });
    } finally {
      setPrintingId(null);
    }
  }

  if (!open) return null;

  const paiements = Array.isArray(data?.historique_paiements_salaire)
    ? data.historique_paiements_salaire
    : [];
  const pointages = Array.isArray(data?.historique_pointage) ? data.historique_pointage : [];
  const moisCourantDejaPaye = data?.is_paid_current_month === true;

  return (
    <>
      <SalaryReceiptPrintHost
        payload={salaryReceiptPrintPayload}
        onDone={() => setSalaryReceiptPrintPayload(null)}
      />
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personnel-details-title"
      >
        <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="personnel-details-title" className="text-lg font-semibold text-[#0f172a]">
                {loading || !data ? "Chargement…" : `${data.prenom} ${data.nom}`.trim()}
              </h2>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
              {data && !loading ? (
                <button
                  type="button"
                  disabled={moisCourantDejaPaye}
                  title={
                    moisCourantDejaPaye
                      ? "Le mois en cours est déjà payé pour ce membre du personnel."
                      : undefined
                  }
                  onClick={() => onGenererFiche?.(data.id)}
                  className="rounded-lg bg-[#15803d] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:bg-[#94a3b8] disabled:hover:bg-[#94a3b8]"
                >
                  Générer la fiche de paie du mois
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-[#64748b] transition hover:bg-[#e2e8f0] hover:text-[#0f172a]"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="max-h-[min(70vh,720px)] overflow-y-auto px-5 py-4">
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            {loading && !data ? (
              <Loading message="Chargement de la fiche…" className="min-h-[120px] py-6" />
            ) : !data && !error ? null : !loading && data ? (
              <div className="space-y-8">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    Informations personnelles
                  </h3>
                  <dl className="grid max-w-md gap-2 text-sm text-[#334155] sm:grid-cols-[8rem_1fr] sm:gap-x-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">Nom</dt>
                    <dd className="font-medium text-[#0f172a]">
                      {data.nom} {data.prenom}
                    </dd>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">Poste</dt>
                    <dd>{roleLabel(data.role)}</dd>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                      Salaire de base
                    </dt>
                    <dd className="tabular-nums font-semibold text-[#0f172a]">
                      {formatMoneyTnd(data.salaire_mensuel)} / mois
                    </dd>
                    {data.retenue_par_absence != null && Number(data.retenue_par_absence) > 0 ? (
                      <>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                          Retenue / jour d&apos;absence
                        </dt>
                        <dd className="tabular-nums">{formatMoneyTnd(data.retenue_par_absence)}</dd>
                      </>
                    ) : null}
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">Embauche</dt>
                    <dd>{formatDateCourte(data.date_embauche)}</dd>
                  </dl>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    Historique des Paiements
                  </h3>
                  {paiements.length === 0 ? (
                    <p className="text-sm text-[#64748b]">Aucun paiement enregistré.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                      <table className="w-full min-w-0 text-left text-sm">
                        <thead className="bg-[#f8fafc] text-xs font-semibold uppercase text-[#64748b]">
                          <tr>
                            <th className="px-3 py-2">Mois de prestation</th>
                            <th className="px-3 py-2">Date de paiement</th>
                            <th className="px-3 py-2 text-right">Primes</th>
                            <th className="min-w-[8rem] px-3 py-2">Remarque</th>
                            <th className="px-3 py-2 text-right">Montant net</th>
                            <th className="w-12 px-2 py-2 text-right">
                              <span className="sr-only">Action</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eef2f6]">
                          {paiements.map((p) => {
                            const rem =
                              p.primes_remarque != null ? String(p.primes_remarque).trim() : "";
                            const pr = p.primes;
                            return (
                              <tr key={p.id} className="hover:bg-[#fafbfc]">
                                <td className="px-3 py-2 capitalize text-[#334155]">
                                  {formatMoisConcerne(p.mois_concerne)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs text-[#334155]">
                                  {formatDatePaiement(p.date_paiement)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-[#334155]">
                                  {pr != null && Number(pr) > 0 ? formatMoneyTnd(pr) : "—"}
                                </td>
                                <td className="max-w-[200px] px-3 py-2 text-xs leading-snug text-[#64748b]">
                                  {rem || "—"}
                                </td>
                                <td className="px-3 py-2 text-right font-medium tabular-nums text-[#0f172a]">
                                  {formatMoneyTnd(p.montant)}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <button
                                    type="button"
                                    title="Voir / imprimer le double reçu (A4 paysage)"
                                    disabled={printingId != null}
                                    onClick={() => void handlePrintFiche(p)}
                                    className="inline-flex items-center justify-center rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#1d4ed8] transition hover:bg-[#eff6ff] disabled:cursor-wait disabled:opacity-50"
                                    aria-label="Voir ou imprimer cette fiche de paie"
                                  >
                                    <Printer
                                      className={`h-4 w-4 ${printingId === p.id ? "animate-pulse" : ""}`}
                                      aria-hidden
                                    />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    Historique de pointage
                  </h3>
                  {pointages.length === 0 ? (
                    <p className="text-sm text-[#64748b]">Aucun pointage enregistré.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                      <table className="w-full min-w-0 text-left text-sm">
                        <thead className="bg-[#f8fafc] text-xs font-semibold uppercase text-[#64748b]">
                          <tr>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Statut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eef2f6]">
                          {pointages.map((p) => (
                            <tr key={p.id} className="hover:bg-[#fafbfc]">
                              <td className="px-3 py-2 tabular-nums text-[#334155]">
                                {formatDateCourte(p.date)}
                              </td>
                              <td className="px-3 py-2 text-[#334155]">
                                {p.statut_display || p.statut}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
