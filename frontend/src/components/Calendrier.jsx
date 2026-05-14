import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import frLocale from "@fullcalendar/core/locales/fr.js";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { MapPin, User, X } from "lucide-react";

import Loading from "./ui/Loading.jsx";
import {
  GRID_JOUR_LABELS,
  matiereColorScheme,
  matiereLabelForSession,
  profDisplayNameFromList,
  timeToSlot,
} from "../utils/emploiDuTempsGrid.js";

function useViewportUnder768() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}

/** `Date#getDay()` : dimanche = 0 … samedi = 6 → API : lundi = 0 … dimanche = 6 */
function jsDateToJourSemaine(d) {
  const js = d.getDay();
  return js === 0 ? 6 : js - 1;
}

function expandSessionsToFcEvents(sessionsWithMeta, rangeStart, rangeEnd, professeurs) {
  const events = [];
  const start = new Date(rangeStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(23, 59, 59, 999);

  const cursor = new Date(start);
  while (cursor <= end) {
    const jour = jsDateToJourSemaine(cursor);
    if (jour <= 5) {
      for (const item of sessionsWithMeta) {
        if (Number(item.session.jour_semaine) !== jour) continue;
        const hd = timeToSlot(item.session.heure_debut);
        const hf = timeToSlot(item.session.heure_fin);
        const ds = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const [h1, m1] = hd.split(":").map(Number);
        ds.setHours(h1, m1 || 0, 0, 0);
        const de = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const [h2, m2] = hf.split(":").map(Number);
        de.setHours(h2, m2 || 0, 0, 0);
        const title = matiereLabelForSession(item.session, professeurs) || "Séance";
        events.push({
          id: item.cellKey,
          title,
          start: ds,
          end: de,
          extendedProps: item,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return events;
}

/**
 * Calendrier responsive pour le modèle hebdomadaire : mois (desktop) / liste (mobile).
 *
 * @param {object} props
 * @param {{ session: object, jour: number, row: object, cellKey: string }[]} props.sessionsWithMeta
 * @param {string} props.refreshKey — signature des données pour refetch FullCalendar
 */
export default function Calendrier({
  sessionsWithMeta,
  refreshKey,
  loading = false,
  isEditing = false,
  professeurs = [],
  onEditSession,
  onCreateFromDay,
}) {
  const isMobile = useViewportUnder768();
  const calendarRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const plugins = useMemo(() => [dayGridPlugin, listPlugin, interactionPlugin], []);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    queueMicrotask(() => {
      api.changeView(isMobile ? "listMonth" : "dayGridMonth");
    });
  }, [isMobile]);

  useEffect(() => {
    calendarRef.current?.getApi()?.refetchEvents();
  }, [refreshKey]);

  const handleEventClick = (info) => {
    info.jsEvent.preventDefault();
    const meta = info.event.extendedProps;
    if (!meta?.session) return;
    setPreview(meta);
  };

  const previewSession = preview?.session;
  const previewScheme = previewSession
    ? matiereColorScheme(matiereLabelForSession(previewSession, professeurs))
    : null;

  return (
    <div className="relative w-full min-w-0 max-w-full">
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-b-xl bg-white/85 backdrop-blur-[1px]">
          <Loading inline message="Chargement du calendrier…" />
        </div>
      ) : null}

      <div
        className={[
          "cal-host w-full min-w-0 max-w-full overflow-x-hidden pb-2",
          "[&_.fc]:max-w-full [&_.fc]:font-sans",
          "[&_.fc-toolbar]:flex-wrap [&_.fc-toolbar]:gap-2 [&_.fc-toolbar]:py-2",
          "[&_.fc-toolbar-chunk]:flex [&_.fc-toolbar-chunk]:flex-wrap [&_.fc-toolbar-chunk]:items-center [&_.fc-toolbar-chunk]:gap-1",
          "[&_.fc-button]:rounded-lg [&_.fc-button]:border-[#e2e8f0] [&_.fc-button]:bg-[#f8fafc] [&_.fc-button]:px-2 [&_.fc-button]:py-1 [&_.fc-button]:text-[11px] [&_.fc-button]:font-semibold [&_.fc-button]:text-[#334155] [&_.fc-button]:shadow-sm",
          "md:[&_.fc-button]:px-3 md:[&_.fc-button]:py-1.5 md:[&_.fc-button]:text-sm",
          "[&_.fc-button-primary:not(:disabled)]:border-[#2563eb] [&_.fc-button-primary:not(:disabled)]:bg-[#3b82f6] [&_.fc-button-primary:not(:disabled)]:text-white",
          "[&_.fc-toolbar-title]:text-sm [&_.fc-toolbar-title]:font-semibold [&_.fc-toolbar-title]:text-[#0f172a] md:[&_.fc-toolbar-title]:text-lg",
          "[&_.fc-list-event]:text-[11px] md:[&_.fc-list-event]:text-sm",
          "[&_.fc-daygrid-event]:text-[11px] md:[&_.fc-daygrid-event]:text-sm",
          "[&_.fc-list-table]:w-full",
          "[&_.fc-scrollgrid]:w-full [&_.fc-scrollgrid-section]:overflow-visible",
        ].join(" ")}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={plugins}
          initialView={isMobile ? "listMonth" : "dayGridMonth"}
          locale={frLocale}
          firstDay={1}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "",
          }}
          buttonText={{
            today: "Aujourd'hui",
          }}
          height="auto"
          events={(fetchInfo, successCallback, failureCallback) => {
            try {
              const ev = expandSessionsToFcEvents(
                sessionsWithMeta,
                fetchInfo.start,
                fetchInfo.end,
                professeurs,
              );
              successCallback(ev);
            } catch (e) {
              failureCallback(e);
            }
          }}
          eventClick={handleEventClick}
          dateClick={
            isEditing && onCreateFromDay
              ? (arg) => {
                  const jour = jsDateToJourSemaine(arg.date);
                  if (jour > 5) return;
                  onCreateFromDay(jour);
                }
              : undefined
          }
          navLinks={false}
          nowIndicator
          dayMaxEvents={4}
          eventDisplay="block"
          lazyFetching={false}
        />
      </div>

      {preview && previewSession ? (
        <div className="fixed inset-0 z-[60]" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-label="Fermer la fenêtre"
            onClick={() => setPreview(null)}
          />
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3 sm:items-center sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cal-preview-title"
              className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-2xl sm:max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    id="cal-preview-title"
                    className={`text-base font-bold leading-snug ${previewScheme?.text ?? "text-[#0f172a]"}`}
                  >
                    {matiereLabelForSession(previewSession, professeurs) || "Séance"}
                  </p>
                  <p className="mt-1 font-mono text-xs tabular-nums text-[#64748b]">
                    {GRID_JOUR_LABELS[preview.jour] ?? ""} · {timeToSlot(previewSession.heure_debut)} –{" "}
                    {timeToSlot(previewSession.heure_fin)}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-2 text-[#64748b] hover:bg-[#f1f5f9]"
                  aria-label="Fermer"
                  onClick={() => setPreview(null)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-3 flex items-start gap-2 text-sm text-[#334155]">
                <User className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 break-words">
                  {previewSession.professeur_name ||
                    profDisplayNameFromList(previewSession.professeur, professeurs) ||
                    "—"}
                </span>
              </p>
              {previewSession.salle && String(previewSession.salle).trim() ? (
                <p className="mt-2 flex items-center gap-2 text-xs font-medium text-[#475569]">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {String(previewSession.salle).trim()}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#f1f5f9] pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-[#e2e8f0] px-4 py-2 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc] md:text-sm"
                  onClick={() => setPreview(null)}
                >
                  Fermer
                </button>
                {isEditing ? (
                  <button
                    type="button"
                    className="rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2563eb] md:text-sm"
                    onClick={() => {
                      setPreview(null);
                      onEditSession?.(preview.session, preview.jour, preview.row);
                    }}
                  >
                    Modifier la séance
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
@media (max-width: 767px) {
  .cal-host .fc {
    font-size: 0.8rem !important;
  }
  .cal-host .fc .fc-toolbar {
    flex-direction: column;
    gap: 5px;
  }
  .cal-host .fc .fc-toolbar-title {
    font-size: 1.1rem !important;
  }
  .cal-host .fc .fc-view-harness {
    height: 400px !important;
  }
}
      `}</style>
    </div>
  );
}
