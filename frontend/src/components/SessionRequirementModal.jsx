import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Landmark } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SessionRequirementContext = createContext(null);

export function useSessionRequirementOptional() {
  return useContext(SessionRequirementContext);
}

const MESSAGE =
  "Action impossible : Aucune session de caisse n'est ouverte pour aujourd'hui.";

/**
 * Alerte globale : session de caisse requise pour encaissement ou dépense.
 */
export default function SessionRequirementModal({ open, onClose, onGoToCaisse }) {
  const titleId = "session-requirement-title";

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900"
            aria-hidden
          >
            <Landmark className="h-6 w-6" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              Session de caisse
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{MESSAGE}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={onGoToCaisse}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Aller à la page Caisse pour ouvrir une session
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionRequirementProvider({ children }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const showSessionRequired = useCallback(() => {
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const goCaisse = useCallback(() => {
    setOpen(false);
    navigate("/caisse");
  }, [navigate]);

  const value = useMemo(() => ({ showSessionRequired }), [showSessionRequired]);

  return (
    <SessionRequirementContext.Provider value={value}>
      {children}
      <SessionRequirementModal open={open} onClose={close} onGoToCaisse={goCaisse} />
    </SessionRequirementContext.Provider>
  );
}
