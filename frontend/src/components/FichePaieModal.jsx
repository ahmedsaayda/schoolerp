import { useEffect, useId, useState } from "react";

import { API_PROFESSEURS, apiFetch } from "../config.js";
import { formatTnd, formatTnNumber } from "../utils/tunisianMoney.js";
import { generateFichePaie } from "../utils/pdfGenerator.js";

function formatHeures(v) {
  return formatTnNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Aperçu + PDF fiche de paie (GET /api/professeurs/:id/resume_paie/).
 */
export default function FichePaieModal({ open, onClose, professeur, refreshKey = 0, onPdfGenerated }) {
  const titleId = useId();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !professeur?.id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setData(null);
      try {
        const url = `${API_PROFESSEURS}${professeur.id}/resume_paie/`;
        const res = await apiFetch(url);
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
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Chargement impossible.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, professeur?.id, refreshKey]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !professeur) return null;

  const labelClass = "text-xs font-semibold uppercase tracking-wide text-[#64748b]";
  const rowClass = "flex justify-between gap-4 border-b border-[#f1f5f9] py-2.5 text-sm last:border-0";

  const heures = data?.heures_non_payees ?? data?.total_heures;
  const brut = data?.total_brut ?? data?.salaire_brut;
  const avances = data?.avances_non_soldees ?? data?.total_avances;
  const net = data?.net_a_payer ?? data?.salaire_net;
  const periode = data?.periode_libelle ?? data?.periodeLabel ?? "—";

  return (
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
        className="w-full max-w-md overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
              Fiche de paie
            </h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              {professeur.prenom} {professeur.nom}
              <span className="text-[#94a3b8]"> · </span>
              {periode}
            </p>
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

        <div className="px-5 py-5">
          {loading ? (
            <p className="text-center text-sm text-[#64748b]" role="status">
              Calcul en cours…
            </p>
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : data ? (
            <div className="space-y-1">
              <p className={`${labelClass} mb-2`}>Détail du calcul</p>
              <div className={rowClass}>
                <span className="text-[#475569]">Heures non payées (jusqu’à ce jour)</span>
                <span className="tabular-nums font-medium text-[#0f172a]">{formatHeures(heures)} h</span>
              </div>
              <div className={rowClass}>
                <span className="text-[#475569]">Tarif horaire</span>
                <span className="tabular-nums font-medium text-[#0f172a]">{formatTnd(data.tarif_horaire)}</span>
              </div>
              <div className={`${rowClass} border-[#e2e8f0] bg-[#f8fafc] px-2`}>
                <span className="font-medium text-[#0f172a]">Salaire brut</span>
                <span className="tabular-nums font-semibold text-[#0f172a]">{formatTnd(brut)}</span>
              </div>
              <div className={rowClass}>
                <span className="text-[#475569]">Avances à déduire (non soldées)</span>
                <span className="tabular-nums font-medium text-amber-900">− {formatTnd(avances)}</span>
              </div>
              <div className="mt-3 rounded-lg border border-[#2563eb]/20 bg-[#eff6ff] px-3 py-3">
                <div className="flex justify-between gap-4 text-sm">
                  <span className="font-semibold text-[#1e3a8a]">Net à payer</span>
                  <span className="text-lg font-bold tabular-nums text-[#1d4ed8]">{formatTnd(net)}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b]">
                  Référence : {data.date_reference ?? "—"} — (Heures × Tarif) − Avances = Net
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-[#e2e8f0] pt-4 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
            >
              Fermer
            </button>
            <button
              type="button"
              disabled={!data || loading || Boolean(error)}
              onClick={() => {
                if (!data) return;
                void generateFichePaie({
                  ...data,
                  professeur,
                  periodeLabel: data.periode_libelle,
                }).finally(() => onPdfGenerated?.());
              }}
              className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Imprimer la fiche de paie
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
