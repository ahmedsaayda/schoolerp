import { useEffect, useId, useState } from "react";
import { Printer } from "lucide-react";

import { API_PROFESSEURS, apiFetch } from "../config.js";
import { formatTnd, formatTnNumber } from "../utils/tunisianMoney.js";
import { mapFichePaieApiToSalaryReceiptProps } from "./SalaryDoubleReceiptShared.jsx";
import SalaryReceiptPrintHost from "./SalaryReceiptPrintHost.jsx";
import Loading from "./ui/Loading.jsx";

function monthLabelFr(mois, annee) {
  if (!mois || !annee) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(Number(annee), Number(mois) - 1, 1));
  } catch {
    return "—";
  }
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
    return "—";
  }
}

/**
 * Historique des fiches de paie enregistrées + réimpression du double reçu.
 */
export default function HistoriqueFichesModal({ open, onClose, professeur, onToast }) {
  const titleId = useId();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printingId, setPrintingId] = useState(null);
  const [salaryReceiptPrintPayload, setSalaryReceiptPrintPayload] = useState(null);

  useEffect(() => {
    if (!open || !professeur?.id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setRows([]);
      try {
        const res = await apiFetch(`${API_PROFESSEURS}${professeur.id}/historique_fiches_paie/`);
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
        const json = await res.json();
        if (!cancelled) setRows(Array.isArray(json) ? json : []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Chargement impossible.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, professeur?.id]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handlePrint(row) {
    if (!professeur?.id || !row?.id) return;
    setPrintingId(row.id);
    try {
      const res = await apiFetch(
        `${API_PROFESSEURS}${professeur.id}/fiche_paie_salaire/${row.id}/`,
      );
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
      const data = await res.json();
      const merged = { ...data, professeur: data.professeur ?? professeur };
      const props = mapFichePaieApiToSalaryReceiptProps(merged);
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

  const name =
    professeur != null
      ? [professeur.prenom, professeur.nom].filter(Boolean).join(" ").trim() || "—"
      : "—";

  return (
    <>
      <SalaryReceiptPrintHost payload={salaryReceiptPrintPayload} onDone={() => setSalaryReceiptPrintPayload(null)} />
      {open && professeur ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
              Historique des fiches de paie
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">{name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
            aria-label="Fermer"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <Loading message="Chargement de l’historique…" className="min-h-[160px] py-8" />
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-center text-sm text-[#64748b]">Aucun paiement enregistré pour ce professeur.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                    <th className="px-3 py-3">Mois</th>
                    <th className="px-3 py-3">Année</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">Salaire de base</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">Primes</th>
                    <th className="min-w-[10rem] px-3 py-3">Remarque (prime)</th>
                    <th className="min-w-[9rem] px-3 py-3">Rattrapage (h × tarif)</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">Total payé</th>
                    <th className="whitespace-nowrap px-3 py-3">Date du paiement</th>
                    <th className="w-12 px-2 py-3 text-right">
                      <span className="sr-only">Imprimer</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f6] text-[#0f172a]">
                  {rows.map((row, index) => {
                    const base = row.salaire_base;
                    const primes = row.primes;
                    const rem = row.primes_remarque != null ? String(row.primes_remarque).trim() : "";
                    const nh = row.nb_heures_prime;
                    const tt = row.tarif_prime;
                    const rattrapageLbl =
                      nh != null &&
                      tt != null &&
                      Number(String(nh).replace(",", ".")) > 0 &&
                      Number(String(tt).replace(",", ".")) > 0
                        ? `${formatTnNumber(nh, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h × ${formatTnd(tt)}`
                        : "";
                    const m = row.mois;
                    const a = row.annee;
                    return (
                      <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                        <td className="px-3 py-2.5 capitalize">{monthLabelFr(m, a)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{a ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {base != null && base !== "" ? formatTnd(base) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {primes != null && Number(primes) > 0 ? formatTnd(primes) : "—"}
                        </td>
                        <td className="max-w-[220px] px-3 py-2.5 text-xs leading-snug text-[#475569]">
                          {rem || "—"}
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5 text-xs leading-snug text-[#475569]">
                          {rattrapageLbl || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#15803d]">
                          {formatTnd(row.montant)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#475569]">
                          {formatDatePaiement(row.date_paiement)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            title="Imprimer cette fiche"
                            disabled={printingId != null}
                            onClick={() => void handlePrint(row)}
                            className="inline-flex items-center justify-center rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#1d4ed8] transition hover:bg-[#eff6ff] disabled:cursor-wait disabled:opacity-50"
                            aria-label="Imprimer cette fiche de paie"
                          >
                            <Printer
                              className={`h-4 w-4 ${printingId === row.id ? "animate-pulse" : ""}`}
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
        </div>

        <div className="border-t border-[#e2e8f0] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
      ) : null}
    </>
  );
}
