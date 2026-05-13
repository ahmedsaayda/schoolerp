/**
 * Jauge de progression annuelle (total payé / (tarif mensuel × 10)) — 0–100+ %.
 * @param {string} [label] — si défini (ex. « Gratuit »), remplace l’affichage du pourcentage.
 */
export default function AnnualProgressCell({ value, label }) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  const pct = Number.isFinite(n) ? n : 0;
  const barWidth = Math.min(100, Math.max(0, pct));
  const isComplete = pct >= 100;
  return (
    <div className="flex min-w-[7.5rem] max-w-[12rem] flex-col gap-1.5 py-0.5">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-2.5 min-w-0 rounded-full ${isComplete ? "bg-emerald-500" : "bg-blue-600"}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {label ? (
        <span className="text-xs font-semibold tabular-nums text-emerald-700">{label}</span>
      ) : (
        <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
      )}
    </div>
  );
}
