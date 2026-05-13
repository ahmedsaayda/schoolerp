import { forwardRef } from "react";

import { SCHOOL_NAME, SCHOOL_TAGLINE, schoolLogoPrintPublicUrl } from "../branding.js";
import { formatTnd } from "../utils/tunisianMoney.js";

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatSessionDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(d);
  } catch {
    return iso;
  }
}

function num(s) {
  if (s == null || s === "") return 0;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bilan imprimable A4 (document officiel unique) — session fermée ou ouverte :
 * barre comptable après clôture, ou Journal financier (« Imprimer le rapport »).
 */
const BilanClotureSessionPrint = forwardRef(function BilanClotureSessionPrint(
  { payload = null, printedAtLabel = "" },
  ref,
) {
  if (!payload?.session_caisse || !payload?.bilan) {
    return (
      <div ref={ref} className="bilan-print-root" style={{ display: "none" }} aria-hidden />
    );
  }

  const sess = payload.session_caisse;
  const b = payload.bilan;
  const mouvements = Array.isArray(payload.mouvements_banque) ? payload.mouvements_banque : [];
  const entriesRaw = Array.isArray(payload.entries) ? payload.entries : [];
  const entries = [...entriesRaw].sort((a, b) =>
    String(a.date_time ?? "").localeCompare(String(b.date_time ?? "")),
  );

  const sessionEnCours =
    b.session_en_cours === true || sess.statut === "ouvert";

  const si = num(b.solde_initial);
  const ent = num(b.total_entrees);
  const sor = num(b.total_sorties);
  const retr = num(b.total_retraits_banque);
  const vers = num(b.total_versements_banque);
  const theor = num(b.solde_theorique);
  const reel = b.solde_reel_declare != null ? num(b.solde_reel_declare) : null;
  const ecart = b.ecart != null ? num(b.ecart) : reel != null ? reel - theor : null;
  const attendreCloture = sessionEnCours || reel == null;

  const responsible =
    (sess.ouvert_par_nom && String(sess.ouvert_par_nom).trim()) ||
    sess.ouvert_par_username ||
    "—";

  const retraits = mouvements.filter((m) => m.type === "retrait");
  const versements = mouvements.filter((m) => m.type === "versement");

  return (
    <div ref={ref} className="bilan-print-root bc-root">
      <style>
        {`
          .bc-root {
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
            font-size: 9.5pt;
            line-height: 1.4;
            color: #0f172a;
            background: #fff;
            width: 100%;
            max-width: 100%;
            padding: 0;
            margin: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .bc-root * { box-sizing: border-box; }
          .bc-header {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1rem;
            padding-bottom: 1rem;
            margin-bottom: 2rem;
            border-bottom: 2px solid #0f172a;
          }
          .bc-brand { display: flex; align-items: center; gap: 1rem; min-width: 0; flex: 1; }
          .bc-brand img {
            height: 4rem;
            width: auto;
            max-width: 200px;
            object-fit: contain;
            flex-shrink: 0;
          }
          .bc-school { font-size: 12pt; font-weight: 700; color: #0f172a; margin: 0; letter-spacing: 0.02em; }
          .bc-sub { font-size: 8.5pt; font-weight: 500; color: #475569; margin: 0.15rem 0 0 0; }
          .bc-title {
            text-align: center;
            font-size: 14pt;
            font-weight: 800;
            letter-spacing: 0.06em;
            color: #0f172a;
            margin: 0.25rem 0 0.5rem 0;
          }
          .bc-meta {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 0.65rem 0.85rem;
            background: #f8fafc;
            font-size: 9pt;
            color: #334155;
          }
          .bc-meta dl { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 1rem; }
          .bc-meta dt { font-weight: 600; color: #475569; margin: 0; }
          .bc-meta dd { margin: 0; color: #0f172a; }
          .bc-block {
            margin-top: 0.85rem;
            border: 1px solid #64748b;
            border-radius: 6px;
            overflow: hidden;
            break-inside: avoid;
          }
          .bc-block-h {
            background: #1e293b;
            color: #fff;
            font-size: 8.5pt;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            padding: 0.45rem 0.65rem;
            margin: 0;
          }
          .bc-block-b { padding: 0.65rem 0.75rem; background: #fff; }
          .bc-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 0.75rem;
            padding: 0.25rem 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .bc-row:last-child { border-bottom: none; }
          .bc-row .k { color: #475569; }
          .bc-row .v { font-variant-numeric: tabular-nums; font-weight: 600; }
          .bc-in { color: #047857 !important; }
          .bc-out { color: #b91c1c !important; }
          .bc-muted { color: #64748b; font-size: 8.5pt; font-weight: 500; }
          .bc-formula {
            margin-top: 0.5rem;
            padding: 0.55rem 0.65rem;
            background: #f1f5f9;
            border-left: 4px solid #0f172a;
            font-size: 9pt;
            font-variant-numeric: tabular-nums;
            color: #0f172a;
            line-height: 1.5;
          }
          .bc-highlight {
            margin-top: 0.45rem;
            padding: 0.5rem 0.65rem;
            background: #ecfdf5;
            border: 1px solid #047857;
            border-radius: 4px;
          }
          .bc-ecart-ok { color: #047857; }
          .bc-ecart-warn { color: #b45309; font-weight: 700; }
          .bc-table-wrap { margin-top: 0.65rem; overflow: visible; }
          .bc-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #0f172a;
          }
          .bc-table th {
            background: #334155;
            color: #fff;
            font-size: 8pt;
            font-weight: 600;
            text-align: left;
            padding: 0.4rem 0.45rem;
            border: 1px solid #0f172a;
          }
          .bc-table th.bc-num { text-align: right; }
          .bc-table td {
            font-size: 8.5pt;
            padding: 0.38rem 0.45rem;
            border: 1px solid #94a3b8;
            vertical-align: top;
          }
          .bc-table td.bc-num { text-align: right; font-variant-numeric: tabular-nums; }
          .bc-table td.bc-solde-prog {
            font-weight: 700;
            color: #0f172a;
            border-left: 3px solid #0f172a !important;
            background: #fff !important;
          }
          .bc-zebra-even { background: #ffffff; }
          .bc-zebra-odd { background: #f8fafc; }
          .bc-desc-main { font-weight: 600; display: block; }
          .bc-desc-sub { font-size: 7.5pt; color: #64748b; display: block; margin-top: 0.12rem; }
          .bc-footer { margin-top: 1.25rem; font-size: 8.5pt; color: #334155; }
          .bc-edition { margin-bottom: 0.85rem; color: #64748b; }
          .bc-sigs { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2rem; margin-top: 1.5rem; }
          .bc-sig { flex: 1; min-width: 42%; }
          .bc-sig-title {
            font-weight: 700;
            color: #0f172a;
            margin: 0 0 2.75rem 0;
            padding-bottom: 0.25rem;
            border-bottom: 1px solid #64748b;
            font-size: 9.5pt;
          }
          .bc-sig-hint { font-size: 8pt; color: #64748b; margin: 0; }
          .bc-block-detail { break-inside: auto; }
          .bc-block-detail .bc-block-h { break-inside: avoid; page-break-after: avoid; }
          @media print {
            .bc-root { padding: 0; }
            .bc-block { break-inside: avoid; }
            .bc-block-detail { break-inside: auto; page-break-before: auto; }
            .bc-table-wrap { break-inside: auto; }
            .bc-table tr { break-inside: avoid; page-break-inside: avoid; }
            .bc-sigs { break-inside: avoid; }
          }
        `}
      </style>

      <header className="bc-header">
        <div className="bc-brand">
          <img src={schoolLogoPrintPublicUrl()} alt="SAMAH SCHOOL Logo" className="h-16 w-auto object-contain" />
          <div>
            <p className="bc-school">{SCHOOL_NAME}</p>
            <p className="bc-sub">{SCHOOL_TAGLINE}</p>
          </div>
        </div>
      </header>

      <h1 className="bc-title">BILAN DE CLÔTURE DE CAISSE</h1>
      {sessionEnCours ? (
        <p
          style={{
            textAlign: "center",
            fontSize: "10pt",
            fontWeight: 600,
            color: "#92400e",
            margin: "0 0 0.65rem 0",
          }}
        >
          Session en cours — bilan provisoire (comptage physique à la clôture)
        </p>
      ) : null}

      <div className="bc-meta">
        <dl>
          <dt>Date de la session</dt>
          <dd>{formatSessionDate(sess.date_ouverture)}</dd>
          <dt>Heure d&apos;ouverture</dt>
          <dd>{formatDateTime(sess.date_ouverture)}</dd>
          <dt>Heure de fermeture</dt>
          <dd>
            {sess.date_fermeture
              ? formatDateTime(sess.date_fermeture)
              : sessionEnCours
                ? "Session en cours"
                : "—"}
          </dd>
          <dt>Personne responsable (ouverture)</dt>
          <dd>{responsible}</dd>
        </dl>
      </div>

      <section className="bc-block" aria-label="Point de départ">
        <h2 className="bc-block-h">1 — Point de départ (solde initial)</h2>
        <div className="bc-block-b">
          <div className="bc-row">
            <span className="k">Reste en caisse (report / veille)</span>
            <span className="v">{formatTnd(si)}</span>
          </div>
        </div>
      </section>

      <section className="bc-block" aria-label="Flux de caisse">
        <h2 className="bc-block-h">2 — Flux de caisse (espèces)</h2>
        <div className="bc-block-b">
          <div className="bc-row">
            <span className="k">Total des entrées (paiements élèves)</span>
            <span className="v bc-in">{formatTnd(ent)}</span>
          </div>
          <div className="bc-row">
            <span className="k">Total des sorties (dépenses, salaires payés en caisse, charges)</span>
            <span className="v bc-out">{formatTnd(sor)}</span>
          </div>
        </div>
      </section>

      <section className="bc-block" aria-label="Mouvements bancaires">
        <h2 className="bc-block-h">3 — Mouvements bancaires (transferts)</h2>
        <div className="bc-block-b">
          <p className="bc-muted" style={{ margin: "0 0 0.5rem 0" }}>
            Alimentation de caisse (retrait banque) : somme des montants ayant renfloué le tiroir.
          </p>
          {retraits.length === 0 ? (
            <div className="bc-row">
              <span className="k">Alimentation caisse (retrait banque)</span>
              <span className="v">{formatTnd(0)}</span>
            </div>
          ) : (
            retraits.map((m) => (
              <div key={`r-${m.id}`} className="bc-row">
                <span className="k">
                  Retrait banque · {m.date}{" "}
                  <span className="bc-muted">(crédité en caisse)</span>
                </span>
                <span className="v bc-in">{formatTnd(num(m.montant))}</span>
              </div>
            ))
          )}
          <p className="bc-muted" style={{ margin: "0.75rem 0 0.5rem 0" }}>
            Versement vers la banque : fonds sortis du tiroir vers le compte banque interne.
          </p>
          {versements.length === 0 ? (
            <div className="bc-row">
              <span className="k">Versement vers la banque</span>
              <span className="v">{formatTnd(0)}</span>
            </div>
          ) : (
            versements.map((m) => (
              <div key={`v-${m.id}`} className="bc-row">
                <span className="k">
                  Versement banque · {m.date}{" "}
                  <span className="bc-muted">
                    ({m.justificatif_recu ? "avec justificatif" : "en attente de justificatif"})
                  </span>
                </span>
                <span className="v bc-out">{formatTnd(num(m.montant))}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bc-block" aria-label="Récapitulatif">
        <h2 className="bc-block-h">4 — Récapitulatif</h2>
        <div className="bc-block-b">
          <div className="bc-formula">
            Solde initial + Entrées − Sorties + Alimentations banque − Versements banque ={" "}
            <strong>SOLDE THÉORIQUE</strong>
            <br />
            {formatTnd(si)} + {formatTnd(ent)} − {formatTnd(sor)} + {formatTnd(retr)} − {formatTnd(vers)} ={" "}
            <strong>{formatTnd(theor)}</strong>
          </div>
          {attendreCloture ? (
            <div
              style={{
                marginTop: "0.65rem",
                padding: "0.55rem 0.65rem",
                background: "#fffbeb",
                border: "1px solid #f59e0b",
                borderRadius: "4px",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: "#92400e" }}>
                Solde réel et écart : en attente de clôture
              </p>
              <p className="bc-muted" style={{ margin: "0.35rem 0 0 0" }}>
                Le décompte physique dans le tiroir sera saisi lors de la clôture officielle ; le solde
                théorique ci-dessus reflète la situation au moment de l&apos;édition.
              </p>
            </div>
          ) : (
            <>
              <div className="bc-row" style={{ marginTop: "0.65rem" }}>
                <span className="k">Solde réel (déclaré dans le tiroir)</span>
                <span className="v">{formatTnd(reel)}</span>
              </div>
              <div className="bc-highlight">
                <div className="bc-row" style={{ border: "none", padding: 0 }}>
                  <span className="k">Écart (réel − théorique)</span>
                  <span
                    className={`v ${
                      ecart != null && Math.abs(ecart) < 0.005 ? "bc-ecart-ok" : "bc-ecart-warn"
                    }`}
                  >
                    {ecart != null ? (
                      <>
                        {ecart > 0 ? "+" : ""}
                        {formatTnd(ecart)}
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <p className="bc-muted" style={{ margin: "0.4rem 0 0 0" }}>
                  Un écart de 0,00 DT indique que le décompte correspond au solde théorique.
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bc-block bc-block-detail" aria-label="Détail des opérations">
        <h2 className="bc-block-h">5 — Détail des opérations (justificatif des flux espèces)</h2>
        <div className="bc-block-b" style={{ padding: "0.5rem" }}>
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  <th style={{ width: "14%" }}>Heure / date</th>
                  <th style={{ width: "30%" }}>Description</th>
                  <th className="bc-num" style={{ width: "11%" }}>
                    Entrée (+)
                  </th>
                  <th className="bc-num" style={{ width: "11%" }}>
                    Sortie (−)
                  </th>
                  <th style={{ width: "14%" }}>Auteur</th>
                  <th className="bc-num" style={{ width: "14%" }}>
                    Solde progressif
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#64748b" }}>
                      Aucune opération de caisse sur cette session.
                    </td>
                  </tr>
                ) : (
                  entries.map((row, idx) => {
                    const hasEntree =
                      row.type === "ENTRÉE" ||
                      (row.entree != null && Number(row.entree) > 0);
                    const hasSortie = row.sortie != null && Number(row.sortie) > 0;
                    const zebra = idx % 2 === 0 ? "bc-zebra-even" : "bc-zebra-odd";
                    const prog =
                      row.solde_progressif != null ? row.solde_progressif : row.solde;
                    const auteurRole =
                      row.cree_par_role != null && String(row.cree_par_role).trim() !== ""
                        ? String(row.cree_par_role).trim()
                        : null;
                    const auteurNom =
                      row.cree_par_nom != null && String(row.cree_par_nom).trim() !== ""
                        ? String(row.cree_par_nom).trim()
                        : null;
                    const auteurCell =
                      auteurNom || auteurRole ? (
                        <>
                          {auteurNom ? (
                            <span className="bc-desc-main">{auteurNom}</span>
                          ) : null}
                          {auteurRole ? (
                            <span className={auteurNom ? "bc-desc-sub" : "bc-desc-main"}>
                              {auteurRole}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="bc-muted">—</span>
                      );
                    return (
                      <tr key={row.id ?? idx} className={zebra}>
                        <td>{formatDateTime(row.date_time)}</td>
                        <td>
                          <span className="bc-desc-main">
                            {row.libelle || "—"}
                            {auteurRole ? (
                              <span style={{ fontWeight: 600, color: "#334155" }}>
                                {" "}
                                ({auteurRole})
                              </span>
                            ) : null}
                          </span>
                          {row.source ? <span className="bc-desc-sub">{row.source}</span> : null}
                        </td>
                        <td className={`bc-num ${hasEntree ? "bc-in" : ""}`}>
                          {hasEntree ? formatTnd(row.entree) : "—"}
                        </td>
                        <td className={`bc-num ${hasSortie ? "bc-out" : ""}`}>
                          {hasSortie ? formatTnd(row.sortie) : "—"}
                        </td>
                        <td>{auteurCell}</td>
                        <td className="bc-num bc-solde-prog">{formatTnd(prog)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer className="bc-footer">
        <p className="bc-edition">
          Document édité le <strong style={{ color: "#0f172a" }}>{printedAtLabel}</strong>
        </p>
        <div className="bc-sigs">
          <div className="bc-sig">
            <p className="bc-sig-title">Signature de la Comptable</p>
            <p className="bc-sig-hint">Nom, signature et cachet</p>
          </div>
          <div className="bc-sig">
            <p className="bc-sig-title">Signature de la Direction</p>
            <p className="bc-sig-hint">Nom, signature et cachet</p>
          </div>
        </div>
      </footer>
    </div>
  );
});

export default BilanClotureSessionPrint;
