import { useCallback, useEffect, useId, useState } from "react";

import { API_PROFESSEURS, apiFetch } from "../config.js";
import { formatTnd } from "../utils/tunisianMoney.js";

function formatMoisc(isoDate) {
  if (!isoDate) return "—";
  const s = String(isoDate).slice(0, 10);
  const [y, m] = s.split("-");
  if (!y || !m) return s;
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(dt);
}

function formatDp(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(d);
  } catch {
    return String(iso);
  }
}

/**
 * Lecture seule — fiche professeur (situation professionnelle + salaires déjà enregistrés).
 */
export default function ProfesseurDetailsModal({ open, prof, onClose }) {
  const titleId = useId();
  const [hist, setHist] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadHist = useCallback(async () => {
    if (!prof?.id) {
      setHist([]);
      return;
    }
    setHistLoading(true);
    try {
      const res = await apiFetch(`${API_PROFESSEURS}${prof.id}/historique_fiches_paie/`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setHist([]);
        return;
      }
      const data = await res.json();
      setHist(Array.isArray(data) ? data : []);
    } catch {
      setHist([]);
    } finally {
      setHistLoading(false);
    }
  }, [prof?.id]);

  useEffect(() => {
    if (!open || !prof?.id) {
      setHist([]);
      return;
    }
    void loadHist();
  }, [open, prof?.id, loadHist]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !prof) return null;

  const travailleAilleurs = prof.travaille_ailleurs === true;
  const nomAutre = String(prof.nom_autre_etablissement ?? prof.autre_etablissement ?? "").trim();

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
        className="max-h-[min(92vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
            {prof.prenom} {prof.nom}
          </h2>
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

        <div className="space-y-4 px-5 py-5 text-sm text-[#0f172a]">
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">Situation professionnelle</p>
            {travailleAilleurs ? (
              <p className="font-medium text-[#0f172a]">
                <span aria-hidden>🛑 </span>
                Travaille à : {nomAutre || "—"}
              </p>
            ) : (
              <p className="font-medium text-[#0f172a]">
                <span aria-hidden>✅ </span>
                Exclusif à notre établissement
              </p>
            )}
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Matière</dt>
              <dd className="mt-0.5">{prof.matiere || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Téléphone</dt>
              <dd className="mt-0.5 font-mono text-xs">{prof.telephone || "—"}</dd>
            </div>
          </dl>

          <div className="rounded-xl border border-[#e2e8f0] bg-[#fafbfc] px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">Salaires enregistrés</p>
            {histLoading ? (
              <p className="text-xs text-[#64748b]">Chargement…</p>
            ) : hist.length === 0 ? (
              <p className="text-xs text-[#64748b]">Aucun paiement de salaire enregistré.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[280px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] text-[#64748b]">
                      <th className="py-2 pr-2 font-semibold">Mois</th>
                      <th className="py-2 pr-2 font-semibold">Montant</th>
                      <th className="py-2 font-semibold">Date paiement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f5f9]">
                    {hist.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-2">{formatMoisc(row.mois_concerne)}</td>
                        <td className="py-2 pr-2 tabular-nums font-medium">{formatTnd(row.montant)} DT</td>
                        <td className="py-2 text-[#64748b]">{formatDp(row.date_paiement)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-[#e2e8f0] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8]"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
