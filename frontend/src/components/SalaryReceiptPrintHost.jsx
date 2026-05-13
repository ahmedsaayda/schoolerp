import { useEffect, useLayoutEffect, useRef } from "react";

import { PRINT_DOUBLE_RECEIPT_STYLES, SalaryReceiptTemplate } from "./SalaryDoubleReceiptShared.jsx";

/**
 * Monte le double reçu salaire hors écran, injecte les styles @media print, déclenche window.print().
 */
export default function SalaryReceiptPrintHost({ payload, onDone }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!payload) {
      firedRef.current = false;
      return undefined;
    }
    const el = document.createElement("style");
    el.setAttribute("data-salary-receipt-print", "1");
    el.textContent = PRINT_DOUBLE_RECEIPT_STYLES;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [payload]);

  useLayoutEffect(() => {
    if (!payload) return undefined;
    firedRef.current = true;
    const runPrint = () => {
      window.print();
    };
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(runPrint);
    });
    return () => cancelAnimationFrame(id);
  }, [payload]);

  useEffect(() => {
    function onAfterPrint() {
      if (!firedRef.current) return;
      firedRef.current = false;
      onDone?.();
    }
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [onDone]);

  if (!payload) return null;

  return (
    <div className="print-section" aria-hidden="true">
      <div className="print-container print-only-receipt-root">
        <SalaryReceiptTemplate {...payload} />
      </div>
    </div>
  );
}
