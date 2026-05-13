import { forwardRef } from "react";

import { SCHOOL_NAME, schoolLogoPrintPublicUrl } from "../branding.js";

/** Aligné avec les documents Emploi du temps du projet. */
const ANNEE_SCOLAIRE_LABEL = "Année scolaire 2025-2026";

/**
 * Liste d’élèves par classe — gabarit A4 portrait pour react-to-print.
 * Rendu hors écran (`liste-eleves-classe-print-root` dans index.css).
 */
const ListeElevesClassePrint = forwardRef(function ListeElevesClassePrintInner(
  { classe = null, eleves = [] },
  ref,
) {
  if (!classe) {
    return (
      <div
        ref={ref}
        className="liste-eleves-classe-print-root"
        style={{ display: "none" }}
        aria-hidden
      />
    );
  }

  const classeNom = String(classe.nom ?? "").trim() || "—";
  const rows = Array.isArray(eleves) ? eleves : [];
  const count = rows.length;
  const effectifLabel = `${count} élève${count !== 1 ? "s" : ""}`;

  const cellBase = {
    border: "1px solid #000",
    padding: "10px 8px",
    verticalAlign: "middle",
    fontSize: "11pt",
  };

  return (
    <div ref={ref} className="liste-eleves-classe-print-root lecp-root">
      <style>
        {`
          .lecp-root {
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
            font-size: 11pt;
            line-height: 1.35;
            color: #000;
            background: #fff;
            width: 100%;
            max-width: 100%;
            padding: 0;
            margin: 0;
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .lecp-root * { box-sizing: border-box; }
          .lecp-meta-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 2rem;
            font-size: 10pt;
            color: #000;
          }
          .lecp-brand-block {
            display: flex;
            align-items: center;
            gap: 1rem;
            min-width: 0;
          }
          .lecp-brand-block img {
            height: 4rem;
            width: auto;
            max-width: 200px;
            object-fit: contain;
            flex-shrink: 0;
          }
          .lecp-title {
            text-align: center;
            font-size: 18pt;
            font-weight: 700;
            margin: 0 0 1.25rem 0;
            color: #000;
          }
          .lecp-effectif {
            font-size: 11pt;
            margin-bottom: 1.5rem;
            font-weight: 600;
          }
          .lecp-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          .lecp-table th,
          .lecp-table td {
            border: 1px solid #000;
            padding: 10px 8px;
            font-size: 11pt;
            vertical-align: middle;
            color: #000;
            background: #fff;
          }
          .lecp-table thead th {
            font-weight: 700;
            text-align: center;
          }
          .lecp-col-idx { width: 5%; text-align: center; }
          .lecp-col-id { width: 10%; text-align: center; }
          .lecp-col-name { width: 22%; text-align: left; }
          .lecp-col-blank { width: 15.75%; text-align: center; min-height: 14mm; }
          .lecp-name-cell { font-weight: 600; }
          @media print {
            .lecp-table tbody tr { min-height: 14mm; }
            .lecp-table td { padding-top: 10px; padding-bottom: 10px; }
          }
        `}
      </style>

      <div className="lecp-meta-row">
        <div className="lecp-brand-block">
          <img src={schoolLogoPrintPublicUrl()} alt="SAMAH SCHOOL Logo" className="h-16 w-auto object-contain" />
          <strong>{SCHOOL_NAME}</strong>
        </div>
        <span>{ANNEE_SCOLAIRE_LABEL}</span>
      </div>

      <h1 className="lecp-title">Liste des élèves : {classeNom}</h1>

      <p className="lecp-effectif">Effectif total : {effectifLabel}</p>

      <table className="lecp-table" role="table">
        <thead>
          <tr>
            <th className="lecp-col-idx" scope="col">
              N°
            </th>
            <th className="lecp-col-id" scope="col">
              N° élève
            </th>
            <th className="lecp-col-name" scope="col">
              Nom &amp; prénom
            </th>
            <th className="lecp-col-blank" scope="col">
              Présence / date
            </th>
            <th className="lecp-col-blank" scope="col">
              Note
            </th>
            <th className="lecp-col-blank" scope="col">
              &nbsp;
            </th>
            <th className="lecp-col-blank" scope="col">
              Observations
            </th>
          </tr>
        </thead>
        <tbody>
          {count === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...cellBase, textAlign: "center" }}>
                Aucun élève dans cette classe.
              </td>
            </tr>
          ) : (
            rows.map((e, i) => (
              <tr key={e.id ?? i}>
                <td style={{ ...cellBase, textAlign: "center" }}>{i + 1}</td>
                <td style={{ ...cellBase, textAlign: "center" }}>{e.id ?? "—"}</td>
                <td className="lecp-name-cell" style={{ ...cellBase, textAlign: "left" }}>
                  {[e.prenom, e.nom].filter(Boolean).join(" ").trim() || "—"}
                </td>
                <td style={cellBase} />
                <td style={cellBase} />
                <td style={cellBase} />
                <td style={cellBase} />
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

export default ListeElevesClassePrint;
