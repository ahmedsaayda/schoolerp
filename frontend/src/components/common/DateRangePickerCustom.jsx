import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DateRangePicker, createStaticRanges } from "react-date-range";
import {
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";

/**
 * @typedef {{ startDate: string, endDate: string }} DateRangeStringValue
 * `startDate` / `endDate` are `YYYY-MM-DD` or `""` when `allowEmpty` and cleared.
 */

function toIsoDate(d) {
  return format(d, "yyyy-MM-dd");
}

function parseIsoLocal(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return parse(t, "yyyy-MM-dd", new Date());
}

function capMonthFragment(formatted) {
  const [day, month] = formatted.split(" ");
  if (!month) return formatted;
  return `${day} ${month.charAt(0).toUpperCase() + month.slice(1)}`;
}

function formatButtonRange(startStr, endStr) {
  if (!startStr && !endStr) {
    return "Toutes les dates";
  }
  const a = startStr ? parseIsoLocal(startStr) : null;
  const b = endStr ? parseIsoLocal(endStr) : null;
  if (a && b) {
    const left = capMonthFragment(format(a, "dd MMM", { locale: fr }));
    const right = capMonthFragment(format(b, "dd MMM", { locale: fr }));
    return `📅 ${left} - ${right}`;
  }
  if (a) {
    return `À partir du ${capMonthFragment(format(a, "dd MMM yyyy", { locale: fr }))}`;
  }
  if (b) {
    return `Jusqu’au ${capMonthFragment(format(b, "dd MMM yyyy", { locale: fr }))}`;
  }
  return "Période";
}

function buildFrenchStaticRanges() {
  return createStaticRanges([
    {
      label: "Aujourd'hui",
      range: () => {
        const anchor = new Date();
        return { startDate: startOfDay(anchor), endDate: endOfDay(anchor) };
      },
    },
    {
      label: "Hier",
      range: () => {
        const anchor = new Date();
        const d = subDays(startOfDay(anchor), 1);
        return { startDate: d, endDate: endOfDay(d) };
      },
    },
    {
      label: "Cette semaine",
      range: () => {
        const anchor = new Date();
        return {
          startDate: startOfWeek(anchor, { weekStartsOn: 1 }),
          endDate: endOfWeek(anchor, { weekStartsOn: 1 }),
        };
      },
    },
    {
      label: "7 derniers jours",
      range: () => {
        const anchor = new Date();
        const today0 = startOfDay(anchor);
        return { startDate: subDays(today0, 6), endDate: endOfDay(anchor) };
      },
    },
    {
      label: "30 derniers jours",
      range: () => {
        const anchor = new Date();
        const today0 = startOfDay(anchor);
        return { startDate: subDays(today0, 29), endDate: endOfDay(anchor) };
      },
    },
    {
      label: "Ce mois-ci",
      range: () => {
        const anchor = new Date();
        return { startDate: startOfMonth(anchor), endDate: endOfDay(anchor) };
      },
    },
    {
      label: "Mois dernier",
      range: () => {
        const anchor = new Date();
        const ref = subMonths(anchor, 1);
        return { startDate: startOfMonth(ref), endDate: endOfMonth(ref) };
      },
    },
    {
      label: "Ce trimestre",
      range: () => {
        const anchor = new Date();
        const m = anchor.getMonth();
        const qStart = Math.floor(m / 3) * 3;
        const start = new Date(anchor.getFullYear(), qStart, 1);
        return { startDate: startOfDay(start), endDate: endOfDay(anchor) };
      },
    },
  ]);
}

/**
 * Sélecteur de plage (react-date-range) avec préréglages à gauche, dans une popover.
 *
 * @param {object} props
 * @param {string} props.startDate — `YYYY-MM-DD` ou `""`
 * @param {string} props.endDate
 * @param {(r: DateRangeStringValue) => void} props.onChange — appelé à **Appliquer** (ou Effacer)
 * @param {boolean} [props.allowEmpty=true]
 * @param {boolean} [props.allowFutureRanges=false]
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className]
 * @param {string} [props.label] — légende du champ (hors bouton)
 * @param {string} [props.id] — id optionnel (aria-labelledby)
 * @param {"left"|"right"|"center"} [props.popoverAlign="left"] — `center` ancre le popover au milieu du bouton (sélecteur centré type tableau de bord)
 * @param {boolean} [props.compactButton=false] — si true, le bouton ne s’étire pas en pleine largeur (aligné à gauche, largeur contenu)
 */
export default function DateRangePickerCustom({
  startDate: startDateProp = "",
  endDate: endDateProp = "",
  onChange,
  allowEmpty = true,
  allowFutureRanges = false,
  disabled = false,
  className = "",
  label = "Période",
  id: idProp,
  popoverAlign = "left",
  compactButton = false,
}) {
  const autoId = useId();
  const labelId = idProp ? `${idProp}-label` : `drp-label-${autoId}`;
  const menuId = idProp ? `${idProp}-menu` : `drp-menu-${autoId}`;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const staticRanges = useMemo(() => buildFrenchStaticRanges(), []);

  const [draft, setDraft] = useState(() => {
    const today = new Date();
    const start0 = startOfDay(today);
    const end0 = endOfDay(today);
    return {
      startDate: parseIsoLocal(startDateProp) ?? start0,
      endDate: parseIsoLocal(endDateProp) ?? end0,
      key: "selection",
    };
  });

  function computeDraftFromProps() {
    const a = parseIsoLocal(startDateProp);
    const b = parseIsoLocal(endDateProp);
    if (a && b) {
      return { startDate: a, endDate: b, key: "selection" };
    }
    if (a && !b) {
      return { startDate: a, endDate: a, key: "selection" };
    }
    if (!a && b) {
      return { startDate: b, endDate: b, key: "selection" };
    }
    const t = new Date();
    const startToday = startOfDay(t);
    const endToday = endOfDay(t);
    return { startDate: startToday, endDate: endToday, key: "selection" };
  }

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setDraft(computeDraftFromProps());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const maxSelectableDate = allowFutureRanges
    ? endOfDay(addMonths(new Date(), 60))
    : endOfDay(new Date());

  const buttonLabel = formatButtonRange(startDateProp, endDateProp);

  const ranges = [
    {
      startDate: draft.startDate,
      endDate: draft.endDate,
      key: "selection",
      color: "#2563eb",
    },
  ];

  function handlePickerChange(patch) {
    const sel = patch.selection;
    if (!sel?.startDate || !sel?.endDate) return;
    setDraft({
      startDate: sel.startDate,
      endDate: sel.endDate,
      key: "selection",
    });
  }

  function handleApply() {
    if (!draft.startDate || !draft.endDate) return;
    const s0 = startOfDay(draft.startDate);
    const t0 = startOfDay(draft.endDate);
    const [lo, hi] = s0 <= t0 ? [s0, t0] : [t0, s0];
    onChange({ startDate: toIsoDate(lo), endDate: toIsoDate(hi) });
    setOpen(false);
  }

  function handleClearPeriod() {
    if (!allowEmpty) return;
    onChange({ startDate: "", endDate: "" });
    setOpen(false);
  }

  const popoverAlignClass =
    popoverAlign === "right" ? "right-0" : popoverAlign === "center" ? "left-1/2 -translate-x-1/2" : "left-0";

  return (
    <div className={`relative z-[1200] ${className}`} ref={wrapRef}>
      {label ? (
        <p id={labelId} className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
          {label}
        </p>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-labelledby={label ? labelId : undefined}
        onClick={toggleOpen}
        className={
          compactButton
            ? "inline-flex w-auto min-w-[220px] max-w-full items-center justify-between gap-2 rounded-lg border border-slate-200/95 bg-white px-3.5 py-2.5 text-left text-sm font-medium text-slate-900 shadow-sm ring-slate-300/30 outline-none transition hover:border-slate-300 hover:bg-slate-50/80 focus:ring-2 focus:ring-slate-400/40 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex w-full max-w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200/95 bg-white px-3.5 py-2.5 text-left text-sm font-medium text-slate-900 shadow-sm ring-slate-300/30 outline-none transition hover:border-slate-300 hover:bg-slate-50/80 focus:ring-2 focus:ring-slate-400/40 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[240px]"
        }
      >
        <span className="min-w-0 flex-1 truncate font-medium">{buttonLabel}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0 text-slate-500"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Choisir une période"
          className={`date-range-popover absolute z-[1300] mt-2 w-[min(100vw-1.5rem,820px)] overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_10px_40px_-10px_rgba(15,23,42,0.25)] ring-1 ring-slate-900/5 ${popoverAlignClass}`}
        >
          <div className="rdr-tailwind-scope max-h-[min(88vh,580px)] overflow-auto bg-white p-0">
            <DateRangePicker
              ranges={ranges}
              onChange={handlePickerChange}
              staticRanges={staticRanges}
              inputRanges={[]}
              months={2}
              direction="horizontal"
              showDateDisplay={false}
              locale={fr}
              minDate={new Date(2000, 0, 1)}
              maxDate={maxSelectableDate}
              rangeColors={["#2563eb", "#1d4ed8"]}
              className="!flex w-full min-w-0 flex-col !rounded-none bg-white sm:!inline-flex sm:w-auto sm:flex-row"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-3 py-2.5">
            {allowEmpty ? (
              <button
                type="button"
                onClick={handleClearPeriod}
                className="mr-auto rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/50"
              >
                Effacer la période
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Appliquer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
