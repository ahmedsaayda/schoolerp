import { useEffect, useLayoutEffect, useRef } from "react";

import { PRINT_DOUBLE_RECEIPT_STYLES, ReceiptTemplate } from "./PaymentDoubleReceiptShared.jsx";

/**
 * Monte le gabarit double reçu hors écran, injecte les styles impression, déclenche window.print().
 * À utiliser après fermeture du modal de paiement (payload fourni par le parent).
 */
export default function PaymentReceiptPrintHost({ payload, onDone }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!payload) {
      firedRef.current = false;
      return undefined;
    }
    const el = document.createElement("style");
    el.setAttribute("data-payment-receipt-print", "1");
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
        <ReceiptTemplate {...payload} />
      </div>
    </div>
  );
}
