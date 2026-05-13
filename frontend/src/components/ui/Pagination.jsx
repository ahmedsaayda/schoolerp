import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * @param {object} props
 * @param {number} props.totalItems
 * @param {number} props.itemsPerPage
 * @param {number} props.currentPage — 1-based
 * @param {(page: number) => void} props.paginate
 * @param {string} [props.itemLabel]
 */
function buildPageList(currentPage, totalPages) {
  if (totalPages <= 1) return totalPages === 1 ? [1] : [];
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const siblings = 1;
  const boundary = 1;
  const start = Math.max(boundary + 1, currentPage - siblings);
  const end = Math.min(totalPages - boundary, currentPage + siblings);

  /** @type {(number | "ellipsis")[]} */
  const items = [1];
  if (start > boundary + 1) items.push("ellipsis");
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < totalPages - boundary) items.push("ellipsis");
  items.push(totalPages);
  return items;
}

export default function Pagination({
  totalItems,
  itemsPerPage,
  currentPage,
  paginate,
  itemLabel = "éléments",
  className = "",
}) {
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const indexOfFirstItem = (safePage - 1) * itemsPerPage + 1;
  const indexOfLastItem = Math.min(safePage * itemsPerPage, totalItems);
  const pageItems = buildPageList(safePage, totalPages);

  const btnBase =
    "inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40";
  const btnIdle = "border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50";
  const btnActive = "border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800";

  return (
    <div
      className={[
        "flex w-full min-w-0 flex-col items-stretch justify-between gap-3 border-t border-slate-200 bg-slate-50/40 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center",
        className,
      ].join(" ")}
    >
      <p className="tabular-nums text-slate-600">
        Affichage{" "}
        <span className="font-semibold text-slate-900">
          {indexOfFirstItem} à {indexOfLastItem}
        </span>{" "}
        sur <span className="font-semibold text-slate-900">{totalItems}</span> {itemLabel}
      </p>

      <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        <button
          type="button"
          onClick={() => paginate(safePage - 1)}
          disabled={safePage <= 1}
          className={`${btnBase} ${btnIdle} gap-1 px-3`}
          aria-label="Page précédente"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          Précédent
        </button>

        <div className="flex flex-wrap items-center justify-center gap-1">
          {pageItems.map((p, idx) =>
            p === "ellipsis" ? (
              <span
                key={`e-${idx}`}
                className="inline-flex h-9 w-9 items-center justify-center text-slate-400"
                aria-hidden
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => paginate(p)}
                className={`${btnBase} px-3 ${p === safePage ? btnActive : btnIdle}`}
                aria-label={`Page ${p}`}
                aria-current={p === safePage ? "page" : undefined}
              >
                {p}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          onClick={() => paginate(safePage + 1)}
          disabled={safePage >= totalPages}
          className={`${btnBase} ${btnIdle} gap-1 px-3`}
          aria-label="Page suivante"
        >
          Suivant
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </div>
    </div>
  );
}
