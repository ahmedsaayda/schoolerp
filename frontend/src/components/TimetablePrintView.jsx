import { forwardRef } from "react";

import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "../branding.js";
import {
  GRID_JOUR_LABELS,
  GRID_JOUR_PRINT_INDICES,
  GRID_ROWS,
  cellKey,
  matiereLabelForSession,
  matierePrintCellStyle,
  profDisplayNameFromList,
  timeToSlot,
} from "../utils/emploiDuTempsGrid.js";

/**
 * Gabarit d’impression (react-to-print) — en-tête, tableau Lundi–Samedi, bordures noires, fonds pour PDF.
 * Ne sort pas de `hidden` (display:none) : le parent applique un positionnement hors-écran pour le clone.
 */
const TimetablePrintView = forwardRef(function TimetablePrintViewInner(
  {
    gridData = {},
    coveredCellKeys = new Set(),
    professeurs = [],
    classeNom = "",
    classeId = "",
    /** @deprecated Préférer anneeScolaireLabel */
    trimestreRangeLabel = "",
    anneeScolaireLabel = "",
    weekRangeLabel = "",
    hasDimancheCreneau = false,
    /** 'classe' : affiche le prof en case ; 'prof' : affiche la classe en case */
    viewVariant = "classe",
    professeurNom = "",
    totalHeuresSemaine = null,
  },
  ref,
) {
  const logoSrc = schoolLogoPrintPublicUrl();
  const metaAnnee = (anneeScolaireLabel && String(anneeScolaireLabel).trim()) || trimestreRangeLabel;
  const headerName =
    viewVariant === "prof" && (professeurNom && String(professeurNom).trim())
      ? String(professeurNom).trim()
      : classeNom || `Classe #${classeId || "—"}`;

  return (
    <div
      ref={ref}
      className="timetable-print-surface timetable-print-surface--offscreen"
      data-testid="timetable-print-view"
    >
      <style type="text/css">
        {`
.timetable-print-surface, .timetable-print-surface * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  @page { size: landscape; margin: 10mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
  }
  .timetable-print-surface,
  .timetable-print-inner {
    width: 100% !important;
    max-width: none !important;
    padding: 0 !important;
    margin: 0 !important;
    box-sizing: border-box !important;
  }
  .timetable-print-table {
    width: 100% !important;
    max-width: none !important;
    table-layout: fixed !important;
  }
  .timetable-print-header {
    width: 100% !important;
    max-width: none !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    box-sizing: border-box !important;
  }
  .timetable-print-brand img {
    max-height: 64px !important;
    max-width: min(320px, 100%) !important;
  }
  .timetable-print-table thead th {
    font-size: 11pt !important;
    padding: 6px 5px !important;
  }
  .timetable-print-table tbody th[scope="row"] {
    font-size: 11pt !important;
    padding: 6px 5px !important;
    min-height: 15mm !important;
  }
  .timetable-print-table tbody td {
    font-size: 11pt !important;
    padding: 6px 5px !important;
    min-height: 15mm !important;
    vertical-align: top !important;
  }
  .timetable-print-table tbody tr {
    min-height: 15mm !important;
  }
}
`}
      </style>
      <div className="timetable-print-inner" style={innerWrapStyle}>
        <header className="timetable-print-header" style={headerStyle}>
          <div className="timetable-print-brand" style={brandBlockStyle}>
            <img
              src={logoSrc}
              alt="SAMAH SCHOOL Logo"
              className="h-16 w-auto object-contain"
              width={320}
              height={64}
              style={logoStyle}
            />
            <p style={schoolNameTitleStyle}>{SCHOOL_NAME}</p>
            {SCHOOL_TAGLINE ? <p style={schoolTaglineStyle}>{SCHOOL_TAGLINE}</p> : null}
          </div>
          <h1 style={titleStyle}>
            EMPLOI DU TEMPS — {headerName}
          </h1>
          <p style={metaLineStyle}>
            {metaAnnee} · {weekRangeLabel}
          </p>
        </header>

        <table className="timetable-print-table" style={tableStyle} role="table">
          <thead>
            <tr>
              <th scope="col" style={thCornerStyle}>
                Heure
              </th>
              {GRID_JOUR_PRINT_INDICES.map((j) => (
                <th key={j} scope="col" style={thDayStyle}>
                  {GRID_JOUR_LABELS[j]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID_ROWS.map((row) => (
              <tr key={`${row.start}-${row.end}`}>
                <th scope="row" style={thHourStyle}>
                  {row.start} – {row.end}
                </th>
                {GRID_JOUR_PRINT_INDICES.map((jour) => {
                  const k = cellKey(jour, row);
                  if (coveredCellKeys.has(k)) {
                    return null;
                  }
                  const cellSession = gridData[k];
                  const occupied = Boolean(cellSession);
                  const rowSpan = occupied ? Number(cellSession._rowSpan) || 1 : 1;
                  const mat = occupied ? matiereLabelForSession(cellSession, professeurs) : "";
                  const profName = occupied
                    ? (cellSession.professeur_name ?? profDisplayNameFromList(cellSession.professeur, professeurs))
                    : "";
                  const classeLine =
                    occupied && (cellSession.classe_nom && String(cellSession.classe_nom).trim())
                      ? String(cellSession.classe_nom).trim()
                      : occupied && cellSession.classe
                        ? `Classe #${cellSession.classe}`
                        : "";
                  const secondLine = viewVariant === "prof" ? classeLine : profName;
                  const salleP = occupied && (cellSession.salle && String(cellSession.salle).trim());
                  const hd = occupied ? timeToSlot(cellSession.heure_debut) : "";
                  const hf = occupied ? timeToSlot(cellSession.heure_fin) : "";
                  return (
                    <td
                      key={k}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      style={{
                        ...tdStyle,
                        ...(occupied ? matierePrintCellStyle(mat) : { backgroundColor: "#fff" }),
                      }}
                    >
                      {occupied ? (
                        <div>
                          <div style={subjectStyle}>{mat || "—"}</div>
                          {secondLine ? (
                            <div style={teacherStyle}>
                              {viewVariant === "prof" ? "Classe : " : ""}
                              {secondLine}
                            </div>
                          ) : null}
                          {salleP ? <div style={roomStyle}>Salle : {salleP}</div> : null}
                          {rowSpan > 1 ? (
                            <div style={timeRangeStyle}>
                              {hd} – {hf}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {totalHeuresSemaine != null && Number.isFinite(Number(totalHeuresSemaine)) ? (
            <tfoot>
              <tr>
                <th scope="row" colSpan={1 + GRID_JOUR_PRINT_INDICES.length} style={tfootThStyle}>
                  Total des heures par semaine :{" "}
                  <strong>
                    {Number(totalHeuresSemaine).toLocaleString("fr-FR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}{" "}
                    h
                  </strong>
                </th>
              </tr>
            </tfoot>
          ) : null}
        </table>
        {hasDimancheCreneau ? <p style={footNoteStyle}>Séances du dimanche : voir l’écran d’édition (non reprises ici).</p> : null}
      </div>
    </div>
  );
});

TimetablePrintView.displayName = "TimetablePrintView";

const innerWrapStyle = {
  backgroundColor: "#fff",
  color: "#000",
  fontSize: 11,
  fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "none",
  padding: 0,
  margin: 0,
};

const headerStyle = {
  textAlign: "center",
  borderBottom: "2px solid #000",
  marginBottom: 32,
  paddingBottom: 16,
  paddingLeft: 0,
  paddingRight: 0,
  width: "100%",
  maxWidth: "none",
};

const brandBlockStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  width: "100%",
  marginBottom: 20,
};

const logoStyle = {
  maxHeight: 64,
  maxWidth: 260,
  width: "auto",
  height: "auto",
  objectFit: "contain",
  display: "block",
  margin: "0 auto 8px",
};

const schoolNameTitleStyle = {
  margin: "2px 0 0 0",
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.15,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const schoolTaglineStyle = {
  margin: "4px 0 0 0",
  fontSize: 9,
  fontWeight: 500,
  color: "#333",
  letterSpacing: "0.02em",
};

const titleStyle = {
  margin: "6px 0 0 0",
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.2,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const metaLineStyle = {
  margin: "4px 0 0 0",
  fontSize: 9,
  color: "#333",
};

const tableStyle = {
  width: "100%",
  maxWidth: "none",
  borderCollapse: "collapse",
  tableLayout: "fixed",
  fontSize: 11,
  border: "1px solid #000",
  margin: 0,
};

const thCornerStyle = {
  border: "1px solid #000",
  padding: "5px 6px",
  width: "7%",
  backgroundColor: "#e8e8e8",
  fontWeight: 700,
  textAlign: "left",
  fontSize: 11,
};

const thDayStyle = {
  border: "1px solid #000",
  padding: "5px 4px",
  backgroundColor: "#e8e8e8",
  fontWeight: 700,
  textAlign: "center",
  fontSize: 11,
};

const thHourStyle = {
  border: "1px solid #000",
  padding: "5px 6px",
  backgroundColor: "#e8e8e8",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};

const tdStyle = {
  border: "1px solid #000",
  padding: "5px 6px",
  verticalAlign: "top",
  minHeight: 36,
};

const subjectStyle = { fontWeight: 700, fontSize: 11, lineHeight: 1.2 };

const teacherStyle = { fontSize: 8, lineHeight: 1.2, marginTop: 3 };

const roomStyle = { fontSize: 7, marginTop: 2, color: "#333" };

const timeRangeStyle = { fontSize: 7, marginTop: 3, color: "#444", fontVariantNumeric: "tabular-nums" };

const footNoteStyle = { marginTop: 6, textAlign: "center", fontSize: 8, color: "#444" };

const tfootThStyle = {
  border: "1px solid #000",
  padding: "6px 8px",
  backgroundColor: "#f0f0f0",
  textAlign: "right",
  fontSize: 10,
  fontWeight: 600,
};

export default TimetablePrintView;
