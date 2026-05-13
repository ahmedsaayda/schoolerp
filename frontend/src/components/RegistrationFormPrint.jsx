import { forwardRef } from "react";

import { formatSectionCell } from "../constants/tunisianAcademic.js";
import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "../branding.js";
import { eleveTarifMensuelTotal } from "../utils/eleveFees.js";
import { formatTnd } from "../utils/tunisianMoney.js";

const MOIS_SCOLARITE_ANNUEL = 10;

function formatDateNaissance(iso) {
  if (!iso) return "—";
  const s = String(iso);
  const d = s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
  try {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(y, m - 1, day));
  } catch {
    return d;
  }
}

function formatPhones(e) {
  if (!e) return "—";
  const parts = [e.telephone_1, e.telephone_2].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function genreLabel(e) {
  const g = e?.genre ?? e?.sexe;
  if (!g) return "—";
  const s = String(g).toUpperCase();
  if (s === "M" || s === "MASCULIN" || s === "MALE") return "Masculin";
  if (s === "F" || s === "FÉMININ" || s === "FEMININ" || s === "FEMALE") return "Féminin";
  return String(g);
}

/**
 * Fiche d'inscription — impression A4 portrait (react-to-print).
 */
const RegistrationFormPrint = forwardRef(function RegistrationFormPrint({ eleve = null, printedAtLabel = "" }, ref) {
  const sectionDisplay = eleve
    ? formatSectionCell(eleve.niveau, eleve.section, eleve.section_display)
    : "—";

  const tarifM = eleve ? eleveTarifMensuelTotal(eleve) : NaN;
  const totalAnnuel =
    eleve && Number.isFinite(tarifM) ? Math.round(tarifM * MOIS_SCOLARITE_ANNUEL * 100) / 100 : null;
  const totalPayeRaw = eleve?.total_paye;
  const totalPaye =
    totalPayeRaw != null && totalPayeRaw !== ""
      ? Number(String(totalPayeRaw).replace(",", "."))
      : null;
  const acompteSigned =
    eleve?.acompte != null && eleve.acompte !== ""
      ? Number(String(eleve.acompte).replace(",", "."))
      : totalAnnuel != null && totalPaye != null && Number.isFinite(totalPaye)
        ? Math.round((totalPaye - totalAnnuel) * 100) / 100
        : null;

  return (
    <div ref={ref} className="registration-form-print-root rf-print-root" aria-hidden>
      <style>
        {`
          .rf-print-root {
            width: 100%;
            max-width: none;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
            font-size: 9.5pt;
            line-height: 1.35;
            color: #0f172a;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .rf-print-root * { box-sizing: border-box; }
          .rf-top {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid #0f172a;
          }
          .rf-top img {
            height: 4rem;
            width: auto;
            max-width: min(260px, 100%);
            object-fit: contain;
          }
          .rf-brand-name {
            margin: 0.35rem 0 0 0;
            font-size: 10pt;
            font-weight: 700;
            letter-spacing: 0.06em;
            color: #0f172a;
          }
          .rf-brand-sub {
            margin: 0.1rem 0 0 0;
            font-size: 8pt;
            color: #64748b;
          }
          .rf-doc-title {
            margin: 0.75rem 0 0.85rem 0;
            text-align: center;
            font-size: 13pt;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #0f172a;
          }
          .rf-section-title {
            margin: 0.5rem 0 0.35rem 0;
            font-size: 9pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #334155;
            border-left: 3px solid #0f172a;
            padding-left: 0.45rem;
          }
          .rf-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0 0 0.5rem 0;
            table-layout: fixed;
            border: 1px solid #334155;
          }
          .rf-table th,
          .rf-table td {
            border: 1px solid #64748b;
            padding: 0.35rem 0.5rem;
            vertical-align: top;
            word-wrap: break-word;
          }
          .rf-table th {
            width: 32%;
            background: #f1f5f9;
            font-size: 8.5pt;
            font-weight: 600;
            color: #475569;
            text-align: left;
          }
          .rf-table td {
            font-size: 9.5pt;
            font-weight: 500;
            color: #0f172a;
          }
          .rf-terms {
            margin-top: 0.45rem;
            padding: 0.45rem 0.55rem;
            border: 1px dashed #94a3b8;
            background: #f8fafc;
            font-size: 7.5pt;
            line-height: 1.4;
            color: #475569;
          }
          .rf-terms h3 {
            margin: 0 0 0.25rem 0;
            font-size: 8pt;
            font-weight: 700;
            color: #0f172a;
          }
          .rf-terms p { margin: 0.2rem 0 0 0; }
          .rf-sigs {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.25rem;
            margin-top: 0.85rem;
            page-break-inside: avoid;
          }
          .rf-sig {
            border: 1px solid #334155;
            padding: 0.5rem 0.55rem 2.5rem 0.55rem;
            min-height: 5.5rem;
          }
          .rf-sig p {
            margin: 0;
            font-size: 8.5pt;
            font-weight: 700;
            color: #0f172a;
          }
          .rf-sig span {
            display: block;
            margin-top: 0.25rem;
            font-size: 7pt;
            font-weight: 400;
            color: #64748b;
          }
          .rf-footer {
            margin-top: 0.5rem;
            font-size: 7pt;
            color: #94a3b8;
            text-align: right;
          }
        `}
      </style>

      <div className="rf-top">
        <img src={schoolLogoPrintPublicUrl()} alt="SAMAH SCHOOL Logo" className="h-16 w-auto object-contain" />
        <p className="rf-brand-name">{SCHOOL_NAME}</p>
        <p className="rf-brand-sub">{SCHOOL_TAGLINE}</p>
      </div>

      <h1 className="rf-doc-title">{"FICHE D'INSCRIPTION SCOLAIRE"}</h1>

      <h2 className="rf-section-title">Informations de l&apos;élève</h2>
      <table className="rf-table">
        <tbody>
          <tr>
            <th scope="row">Nom</th>
            <td>{eleve?.nom?.trim() || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Prénom</th>
            <td>{eleve?.prenom?.trim() || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Date de naissance</th>
            <td>{formatDateNaissance(eleve?.date_naissance)}</td>
          </tr>
          <tr>
            <th scope="row">Genre</th>
            <td>{genreLabel(eleve)}</td>
          </tr>
          <tr>
            <th scope="row">Classe</th>
            <td>{eleve?.classe?.trim() || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Niveau / section</th>
            <td>{sectionDisplay}</td>
          </tr>
        </tbody>
      </table>

      {eleve && totalAnnuel != null && Number.isFinite(totalAnnuel) ? (
        <>
          <h2 className="rf-section-title">Synthèse financière (scolarité)</h2>
          <table className="rf-table">
            <tbody>
              <tr>
                <th scope="row">Frais annuels dus (× {MOIS_SCOLARITE_ANNUEL} mois)</th>
                <td>{formatTnd(totalAnnuel)}</td>
              </tr>
              <tr>
                <th scope="row">Total encaissé</th>
                <td>{totalPaye != null && Number.isFinite(totalPaye) ? formatTnd(totalPaye) : "—"}</td>
              </tr>
              <tr>
                <th scope="row">Solde (acompte)</th>
                <td>
                  {acompteSigned != null && Number.isFinite(acompteSigned) ? (
                    <>
                      {formatTnd(acompteSigned)} DT
                      {acompteSigned > 0.005
                        ? " — acompte (crédit)"
                        : acompteSigned < -0.005
                          ? " — reste à payer"
                          : " — compte à jour"}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <h2 className="rf-section-title">Informations des parents</h2>
      <table className="rf-table">
        <tbody>
          <tr>
            <th scope="row">Nom du père</th>
            <td>—</td>
          </tr>
          <tr>
            <th scope="row">Nom de la mère</th>
            <td>—</td>
          </tr>
          <tr>
            <th scope="row">Représentant légal / tuteur</th>
            <td>{eleve?.nom_parent?.trim() || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Téléphone(s)</th>
            <td>{formatPhones(eleve)}</td>
          </tr>
          <tr>
            <th scope="row">Adresse</th>
            <td>{eleve?.adresse?.trim() || "—"}</td>
          </tr>
        </tbody>
      </table>

      <div className="rf-terms">
        <h3>Règlement intérieur</h3>
        <p>
          Les parents ou tuteurs reconnaissent avoir pris connaissance du règlement intérieur de l&apos;établissement
          (horaires, assiduité, tenue, respect du personnel et des autres élèves). Toute fausse déclaration pourra
          entraîner des mesures disciplinaires ou la résiliation de l&apos;inscription.
        </p>
        <p>
          [Espace réservé : conditions de paiement, assurance, autorisation de sortie, droit à l&apos;image,
          traitement des données personnelles — texte définitif à compléter par l&apos;administration.]
        </p>
      </div>

      <div className="rf-sigs">
        <div className="rf-sig">
          <p>Signature des parents</p>
          <span>Date et signature</span>
        </div>
        <div className="rf-sig">
          <p>Cachet de l&apos;école</p>
          <span>Visa de la direction</span>
        </div>
      </div>

      {printedAtLabel ? <p className="rf-footer">Document imprimé le {printedAtLabel}</p> : null}
    </div>
  );
});

export default RegistrationFormPrint;
