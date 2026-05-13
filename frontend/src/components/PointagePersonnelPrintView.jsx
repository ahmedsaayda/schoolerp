import { forwardRef } from "react";

import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "../branding.js";

/**
 * Rapport imprimable pointage personnel — pleine largeur, styles embarqués pour react-to-print.
 */
const PointagePersonnelPrintView = forwardRef(function PointagePersonnelPrintView(
  { printRows = [], printSummary = { present: 0, absent: 0, retard: 0, total: 0 }, titleDateEn = "", printedAtLabel = "" },
  ref,
) {
  return (
    <div ref={ref} className="pointage-personnel-print-root pp-print-root" aria-hidden>
      <style>
        {`
          .pp-print-root {
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
            color: #0f172a;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .pp-print-root * { box-sizing: border-box; }
          .pp-header {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            padding-bottom: 1rem;
            margin-bottom: 2rem;
            border-bottom: 2px solid #0f172a;
            width: 100%;
          }
          .pp-brand { display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 0; }
          .pp-brand img {
            height: 4rem;
            width: auto;
            max-width: 200px;
            object-fit: contain;
            flex-shrink: 0;
          }
          .pp-school { font-size: 13pt; font-weight: 700; margin: 0; letter-spacing: 0.02em; }
          .pp-sub { font-size: 10pt; color: #475569; margin: 0.2rem 0 0 0; }
          .pp-kicker { text-align: right; font-size: 9pt; color: #64748b; }
          .pp-title {
            text-align: center;
            font-size: 14pt;
            font-weight: 700;
            margin: 0 0 0.25rem 0;
            width: 100%;
          }
          .pp-subtitle {
            text-align: center;
            font-size: 11pt;
            color: #334155;
            margin: 0 0 1.25rem 0;
            width: 100%;
          }
          .pp-table-wrap {
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 0;
            overflow: visible;
          }
          .pp-table {
            width: 100%;
            max-width: none;
            border-collapse: collapse;
            table-layout: fixed;
            border: 1px solid #0f172a;
          }
          .pp-table thead th {
            background: #1e293b;
            color: #fff;
            font-size: 10pt;
            font-weight: 600;
            padding: 0.5rem 0.6rem;
            border: 1px solid #0f172a;
            text-align: left;
          }
          .pp-th-num { width: 5%; text-align: center; }
          .pp-th-nom { width: 40%; }
          .pp-th-fn { width: 30%; }
          .pp-th-stat { width: 25%; }
          .pp-table tbody td {
            font-size: 12pt;
            line-height: 1.35;
            padding: 0.5rem 0.65rem;
            border: 1px solid #64748b;
            vertical-align: top;
            word-wrap: break-word;
          }
          .pp-table tbody tr.pp-row-even td { background: #ffffff; }
          .pp-table tbody tr.pp-row-odd td { background: #f3f4f6; }
          .pp-td-num { text-align: center; font-variant-numeric: tabular-nums; }
          .pp-td-fn { color: #1e293b; }
          /* Absent : fond gris sur toute la largeur de la cellule Statut */
          .pp-td-stat.pp-absent {
            background-color: #d1d5db !important;
            color: #0f172a;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.02em;
          }
          .pp-td-stat.pp-retard { font-weight: 600; color: #0f172a; }
          .pp-summary {
            margin-top: 1.25rem;
            padding: 0.75rem 1rem;
            border: 2px solid #0f172a;
            background: #f1f5f9;
            font-size: 10pt;
            width: 100%;
            max-width: none;
          }
          .pp-summary h2 { margin: 0 0 0.5rem 0; font-size: 10pt; }
          .pp-summary ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.35rem; }
          .pp-summary li { margin: 0; }
          .pp-footer { margin-top: 2rem; font-size: 10pt; width: 100%; }
          .pp-footer-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2rem; }
        `}
      </style>

      <header className="pp-header">
        <div className="pp-brand">
          <img src={schoolLogoPrintPublicUrl()} alt="SAMAH SCHOOL Logo" className="h-16 w-auto object-contain" />
          <div>
            <p className="pp-school">{SCHOOL_NAME}</p>
            <p className="pp-sub">{SCHOOL_TAGLINE}</p>
          </div>
        </div>
        <div className="pp-kicker">
          <p style={{ fontWeight: 600, color: "#334155", margin: 0 }}>Rapport de pointage</p>
          <p style={{ margin: "0.15rem 0 0 0" }}>Personnel</p>
        </div>
      </header>

      <h1 className="pp-title">Rapport de Pointage du Personnel</h1>
      <p className="pp-subtitle">
        Journée du : <strong>{titleDateEn}</strong>
      </p>

      <div className="pp-table-wrap">
        <table className="pp-table">
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "25%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pp-th-num">#</th>
              <th className="pp-th-nom">Nom &amp; Prénom</th>
              <th className="pp-th-fn">Fonction</th>
              <th className="pp-th-stat">Statut</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((r, idx) => {
              const rowZ = idx % 2 === 0 ? "pp-row-even" : "pp-row-odd";
              const statClass =
                r.statut === "ABSENT" ? "pp-absent" : r.statut === "RETARD" ? "pp-retard" : "";
              return (
                <tr key={r.id} className={rowZ}>
                  <td className="pp-td-num">{idx + 1}</td>
                  <td className="pp-td-nom">{r.nomPrenom}</td>
                  <td className="pp-td-fn">{r.fonction}</td>
                  <td className={`pp-td-stat ${statClass}`}>{r.statutLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="pp-summary" aria-label="Synthèse">
        <h2>Synthèse</h2>
        <ul>
          <li>
            <span style={{ color: "#64748b" }}>Total Présents : </span>
            <strong>{printSummary.present}</strong>
          </li>
          <li>
            <span style={{ color: "#64748b" }}>Total Absents : </span>
            <strong>{printSummary.absent}</strong>
          </li>
          <li>
            <span style={{ color: "#64748b" }}>Total Retards : </span>
            <strong>{printSummary.retard}</strong>
          </li>
        </ul>
        <p style={{ margin: "0.5rem 0 0 0", fontSize: "9pt", color: "#64748b" }}>
          Effectif total : {printSummary.total}
        </p>
      </section>

      <footer className="pp-footer">
        <div className="pp-footer-row">
          <div style={{ flex: "1", minWidth: "45%" }}>
            <p style={{ margin: "0 0 2rem 0", paddingBottom: "0.25rem", borderBottom: "1px solid #64748b", fontWeight: 500 }}>
              Signature et cachet — Direction
            </p>
            <p style={{ margin: 0, fontSize: "9pt", color: "#64748b" }}>Nom et signature de la directrice ou du directeur</p>
          </div>
          <div style={{ textAlign: "right", fontSize: "9pt", color: "#64748b" }}>
            <p style={{ margin: 0 }}>Document généré le</p>
            <p style={{ margin: "0.25rem 0 0 0", fontWeight: 600, color: "#0f172a" }}>{printedAtLabel}</p>
          </div>
        </div>
      </footer>
    </div>
  );
});

export default PointagePersonnelPrintView;
