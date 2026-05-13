import { Loader2 } from "lucide-react";

/**
 * État de chargement global (pages, panneaux). Utiliser `inline` pour les champs
 * de formulaire ou les emplacements étroits.
 */
export default function Loading({
  message = "Chargement des données…",
  className = "",
  inline = false,
  id,
}) {
  return (
    <div
      id={id}
      className={[
        "flex text-slate-500",
        inline
          ? "min-h-0 flex-row items-center justify-start gap-2 py-1"
          : "min-h-[200px] flex-col items-center justify-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className={[
          "shrink-0 text-blue-600 animate-spin",
          inline ? "h-4 w-4" : "h-8 w-8",
        ].join(" ")}
        aria-hidden
      />
      <p className={inline ? "min-w-0 text-xs animate-pulse" : "mt-3 text-sm animate-pulse"}>
        {message}
      </p>
    </div>
  );
}
