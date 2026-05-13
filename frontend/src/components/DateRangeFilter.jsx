import { useCallback } from "react";
import { endOfDay, format, parse, startOfDay } from "date-fns";

import DateRangePickerCustom from "./common/DateRangePickerCustom.jsx";

/**
 * @param {object} props
 * @param {{ startDate: Date, endDate: Date }} props.value
 * @param {(next: { startDate: Date, endDate: Date }) => void} props.onApply
 * @param {boolean} [props.allowFutureRanges] — période future autorisée (ex. feuille de présence)
 */
export default function DateRangeFilter({
  value,
  onApply,
  disabled = false,
  className = "",
  allowFutureRanges = false,
}) {
  const startStr = value.startDate ? format(value.startDate, "yyyy-MM-dd") : "";
  const endStr = value.endDate ? format(value.endDate, "yyyy-MM-dd") : "";

  const onChange = useCallback(
    ({ startDate: s, endDate: e }) => {
      if (!s || !e) return;
      const sd = startOfDay(parse(s, "yyyy-MM-dd", new Date()));
      const ed = endOfDay(parse(e, "yyyy-MM-dd", new Date()));
      onApply({ startDate: sd, endDate: ed });
    },
    [onApply],
  );

  return (
    <DateRangePickerCustom
      startDate={startStr}
      endDate={endStr}
      onChange={onChange}
      allowEmpty={false}
      allowFutureRanges={allowFutureRanges}
      disabled={disabled}
      className={className}
      label=""
    />
  );
}
