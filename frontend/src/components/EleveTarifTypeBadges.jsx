/**
 * Badges de régime de tarification (gratuit / convention) pour les listes d’élèves.
 * @param {{ is_gratuit?: boolean, is_convention?: boolean }} props
 */
export default function EleveTarifTypeBadges({ is_gratuit, is_convention, className = "" }) {
  if (!is_gratuit && !is_convention) return null;
  return (
    <span className={`ms-1.5 inline-flex flex-wrap items-center gap-1 ${className}`.trim()}>
      {is_gratuit ? (
        <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-emerald-800">
          Gratuit
        </span>
      ) : null}
      {is_convention ? (
        <span className="inline-flex rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-blue-800">
          Convention
        </span>
      ) : null}
    </span>
  );
}

/** Options du filtre « Type de tarif » (param API `tarif_type`). */
export const TARIF_TYPE_FILTER_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "standard", label: "Standard" },
  { value: "gratuit", label: "Gratuit" },
  { value: "convention", label: "Conventionné" },
];
