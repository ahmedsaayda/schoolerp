import { SCHOOL_NAME, schoolLogoPrintPublicUrl } from "../branding.js";
import { formatTnd, formatTnNumber } from "../utils/tunisianMoney.js";

import { PRINT_DOUBLE_RECEIPT_STYLES } from "./PaymentDoubleReceiptShared.jsx";

export { PRINT_DOUBLE_RECEIPT_STYLES };

function formatHeuresReceipt(v) {
  return formatTnNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDateTimeOperation(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(iso);
  }
}

function moisNomPourNote(periodeLibelle) {
  if (!periodeLibelle || typeof periodeLibelle !== "string") return "";
  const first = periodeLibelle.trim().split(/\s+/)[0];
  return first || "";
}

/** « d'avril » vs « de mars » selon la première lettre du mois. */
function prepEdtMois(moisNom) {
  if (!moisNom) return "";
  const m = moisNom.trim();
  const first = m.charAt(0).toLowerCase();
  const vowels = "aeiouàâäéèêëïîôùûœ";
  return vowels.includes(first) ? `d'${m}` : `de ${m}`;
}

/**
 * Réponse GET fiche personnel (non enseignant) — même gabarit paysage, lignes « fixe / primes / avances ».
 */
export function mapFichePersonnelPaiementToSalaryReceiptProps(api) {
  const pr = api?.personnel ?? {};
  const prenom = pr.prenom ?? "";
  const nom = pr.nom ?? "";
  const nomComplet = [prenom, nom].filter(Boolean).join(" ").trim() || "—";
  const poste = (pr.poste ?? "").trim() || "—";
  const periodeLabel = api?.periode_libelle ?? "—";
  const net = api?.net_a_payer ?? api?.salaire_net ?? "";
  const dateOp = api?.date_paiement ?? api?.date_reference;
  return {
    variant: "personnel",
    nomComplet,
    poste,
    periodeLabel,
    salaireMensuelFixe: api?.salaire_mensuel_fixe,
    primesMontant: api?.primes_affichees ?? api?.primes,
    primesRemarque: (api?.primes_remarque ?? "").trim(),
    avancesMontant: api?.avances_non_soldees ?? api?.total_avances,
    netMontant: net,
    dateOperation: formatDateTimeOperation(dateOp),
  };
}

/**
 * Normalise la réponse GET …/fiche_paie_salaire/:id/ pour le gabarit double reçu.
 */
export function mapFichePaieApiToSalaryReceiptProps(api) {
  if (api?.fiche_type === "personnel" || api?.personnel) {
    return mapFichePersonnelPaiementToSalaryReceiptProps(api);
  }
  const prenom = api?.professeur?.prenom ?? "";
  const nom = api?.professeur?.nom ?? "";
  const nomComplet = [prenom, nom].filter(Boolean).join(" ").trim() || "—";
  const matiere = (api?.professeur?.matiere ?? "").trim() || "—";
  const periodeLabel = api?.periode_libelle ?? "—";
  const heuresMois =
    api?.heures_effectuees_mois != null && api?.heures_effectuees_mois !== ""
      ? api.heures_effectuees_mois
      : null;
  const reliquatH =
    api?.heures_reliquat_mois_precedent != null && api?.heures_reliquat_mois_precedent !== ""
      ? api.heures_reliquat_mois_precedent
      : null;
  const totalH =
    api?.total_heures_payees != null && api?.total_heures_payees !== ""
      ? api.total_heures_payees
      : api?.heures_non_payees;
  const tarif = api?.tarif_horaire ?? "";
  const net = api?.net_a_payer ?? api?.salaire_net ?? "";
  const relAnt =
    api?.reliquat_anticipatif_heures != null && api?.reliquat_anticipatif_heures !== ""
      ? Number(String(api.reliquat_anticipatif_heures).replace(",", "."))
      : 0;
  const dateOp = api?.date_paiement ?? api?.date_reference;

  const moisPourNote = moisNomPourNote(periodeLabel);
  const primesM = api?.primes_affichees ?? api?.primes;
  return {
    variant: "prof",
    nomComplet,
    matiere,
    periodeLabel,
    heuresMois,
    reliquatH,
    totalH,
    tarif,
    primesMontant: primesM,
    primesRemarque: (api?.primes_remarque ?? "").trim(),
    primeRattrapageHeures: api?.nb_heures_prime,
    primeRattrapageTarif: api?.tarif_prime,
    netMontant: net,
    reliquatAnticipatif: Number.isFinite(relAnt) ? relAnt : 0,
    moisNomPourNote: moisPourNote,
    prepEdtMoisPhrase: prepEdtMois(moisPourNote),
    dateOperation: formatDateTimeOperation(dateOp),
  };
}

/**
 * Un exemplaire du reçu de salaire (même contenu sur les deux colonnes).
 */
export function SalaryReceiptExemplaire({
  copyLabel,
  variant = "prof",
  nomComplet,
  matiere,
  poste,
  periodeLabel,
  heuresMois,
  reliquatH,
  totalH,
  tarif,
  salaireMensuelFixe,
  primesMontant,
  primesRemarque = "",
  primeRattrapageHeures = null,
  primeRattrapageTarif = null,
  avancesMontant,
  netMontant,
  reliquatAnticipatif,
  moisNomPourNote,
  prepEdtMoisPhrase,
  dateOperation,
}) {
  const netStr = formatTnd(netMontant);
  const tarifStr = formatTnd(tarif);
  const fixeStr = formatTnd(salaireMensuelFixe);
  const primesStr = formatTnd(primesMontant);
  const advStr = formatTnd(avancesMontant);
  const remPr = (primesRemarque || "").trim();
  const showReliquat = reliquatH != null && Number(String(reliquatH).replace(",", ".")) > 0;
  const edtMois = prepEdtMoisPhrase ?? prepEdtMois(moisNomPourNote);
  const showNoteAnticipatif =
    variant !== "personnel" && reliquatAnticipatif > 0 && edtMois;
  const showPrimes = Number(String(primesMontant ?? 0).replace(",", ".")) > 0;
  const showAdv = Number(String(avancesMontant ?? 0).replace(",", ".")) > 0;
  const ph = primeRattrapageHeures != null && primeRattrapageHeures !== "" ? Number(String(primeRattrapageHeures).replace(",", ".")) : null;
  const pt = primeRattrapageTarif != null && primeRattrapageTarif !== "" ? Number(String(primeRattrapageTarif).replace(",", ".")) : null;
  const showPrimesRattrapage =
    showPrimes && ph != null && Number.isFinite(ph) && ph > 0 && pt != null && Number.isFinite(pt) && pt > 0;
  const primesLinePersonnel = showPrimes
    ? `Primes : ${primesStr} DT${remPr ? ` (${remPr})` : ""}`
    : "";

  if (variant === "personnel") {
    return (
      <div className="receipt-a5 flex h-full min-h-0 min-w-0 w-full flex-1 flex-col text-slate-900">
        <p className="receipt-print-label-top mb-1.5 shrink-0 text-center text-xs font-bold uppercase text-slate-500">
          {copyLabel}
        </p>
        <div className="receipt-a5-card flex min-h-0 flex-1 flex-col border-2 border-slate-900 bg-white p-2 text-sm leading-normal sm:p-3">
          <div className="mb-6 flex shrink-0 items-center justify-between gap-4 border-b-2 border-slate-900 pb-3">
            <img
              src={schoolLogoPrintPublicUrl()}
              alt="SAMAH SCHOOL Logo"
              className="h-16 w-auto shrink-0 object-contain"
            />
            <div className="min-w-0 text-right">
              <p className="receipt-print-sub text-[10px] font-semibold uppercase tracking-widest text-slate-600 sm:text-xs">
                {SCHOOL_NAME}
              </p>
              <h1 className="receipt-print-h1 mt-0.5 text-base font-bold uppercase tracking-tight sm:text-lg">
                REÇU DE PAIEMENT DE SALAIRE
              </h1>
            </div>
          </div>

          <div className="receipt-print-text mt-2 min-h-0 flex-1 space-y-2 sm:mt-3 sm:space-y-2">
            <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 gap-y-0.5 sm:grid-cols-[6.5rem_1fr]">
              <span className="font-semibold text-slate-600">Salarié</span>
              <span className="min-w-0 break-words font-bold leading-tight">{nomComplet}</span>
            </div>
            <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
              <span className="font-semibold text-slate-600">Poste</span>
              <span className="leading-tight">{poste || "—"}</span>
            </div>
            <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
              <span className="font-semibold text-slate-600">Période</span>
              <span className="leading-tight font-medium text-slate-800">{periodeLabel}</span>
            </div>

            <div className="mt-1 border border-slate-300">
              <table className="w-full border-collapse text-left text-[11px] sm:text-xs">
                <tbody className="divide-y divide-slate-200">
                  <tr>
                    <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                      Salaire mensuel fixe
                    </th>
                    <td className="px-2 py-1.5 tabular-nums font-medium">{fixeStr} DT</td>
                  </tr>
                  {showPrimes ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="bg-white px-2 py-1.5 text-left text-[11px] font-medium leading-snug text-slate-800 sm:text-xs"
                      >
                        {primesLinePersonnel}
                      </td>
                    </tr>
                  ) : null}
                  {showAdv ? (
                    <tr>
                      <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                        Avances déduites
                      </th>
                      <td className="px-2 py-1.5 tabular-nums text-amber-900">− {advStr} DT</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-slate-900 bg-slate-50 px-2 py-2 sm:px-3">
              <p className="receipt-print-label-top mb-0 text-[10px] font-semibold uppercase text-slate-600">
                Total net
              </p>
              <p className="receipt-print-amount text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                {netStr} DT
              </p>
            </div>

            <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 border-t border-dashed border-slate-300 pt-2 sm:grid-cols-[6.5rem_1fr]">
              <span className="font-semibold text-slate-600">Opération</span>
              <span className="break-words leading-tight">{dateOperation}</span>
            </div>
          </div>

          <div className="receipt-sig-sticky mt-auto w-full pt-2">
            <p className="receipt-print-foot mb-2 shrink-0 text-center text-[9px] leading-tight text-slate-500 sm:mb-3 sm:text-[10px]">
              Document généré à titre de reçu — sans valeur fiscale contractuelle.
            </p>
            <div className="receipt-sig-columns flex w-full flex-row gap-2 border-t border-slate-300 pt-2 sm:gap-3 sm:pt-3">
              <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
                <p>Signature du salarié</p>
                <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
              </div>
              <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
                <p>Cachet et Signature Direction</p>
                <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="receipt-a5 flex h-full min-h-0 min-w-0 w-full flex-1 flex-col text-slate-900">
      <p className="receipt-print-label-top mb-1.5 shrink-0 text-center text-xs font-bold uppercase text-slate-500">
        {copyLabel}
      </p>
      <div className="receipt-a5-card flex min-h-0 flex-1 flex-col border-2 border-slate-900 bg-white p-2 text-sm leading-normal sm:p-3">
        <div className="mb-6 flex shrink-0 items-center justify-between gap-4 border-b-2 border-slate-900 pb-3">
          <img
            src={schoolLogoPrintPublicUrl()}
            alt="SAMAH SCHOOL Logo"
            className="h-16 w-auto shrink-0 object-contain"
          />
          <div className="min-w-0 text-right">
            <p className="receipt-print-sub text-[10px] font-semibold uppercase tracking-widest text-slate-600 sm:text-xs">
              {SCHOOL_NAME}
            </p>
            <h1 className="receipt-print-h1 mt-0.5 text-base font-bold uppercase tracking-tight sm:text-lg">
              REÇU DE PAIEMENT DE SALAIRE
            </h1>
          </div>
        </div>

        <div className="receipt-print-text mt-2 min-h-0 flex-1 space-y-2 sm:mt-3 sm:space-y-2">
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 gap-y-0.5 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Enseignant</span>
            <span className="min-w-0 break-words font-bold leading-tight">{nomComplet}</span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Matière</span>
            <span className="leading-tight">{matiere}</span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Période</span>
            <span className="leading-tight">{periodeLabel}</span>
          </div>

          <div className="mt-1 border border-slate-300">
            <table className="w-full border-collapse text-left text-[11px] sm:text-xs">
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                    Heures effectuées ce mois
                  </th>
                  <td className="px-2 py-1.5 tabular-nums">{formatHeuresReceipt(heuresMois)} h</td>
                </tr>
                {showReliquat ? (
                  <tr>
                    <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                      Reliquat mois précédent (M-1)
                    </th>
                    <td className="px-2 py-1.5 tabular-nums">{formatHeuresReceipt(reliquatH)} h</td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                    Total heures payées
                  </th>
                  <td className="px-2 py-1.5 tabular-nums font-semibold">{formatHeuresReceipt(totalH)} h</td>
                </tr>
                <tr>
                  <th scope="row" className="bg-slate-50 px-2 py-1.5 font-semibold text-slate-700">
                    Taux horaire
                  </th>
                  <td className="px-2 py-1.5 tabular-nums">
                    {tarifStr} DT
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {showPrimes ? (
            <p className="text-[11px] font-medium leading-snug text-slate-800 sm:text-xs">
              {showPrimesRattrapage ? (
                <>
                  Primes : {primesStr} DT (Rattrapage : {formatHeuresReceipt(ph)}h × {formatTnd(pt)})
                </>
              ) : (
                <>
                  Primes : {primesStr} DT{remPr ? ` (${remPr})` : ""}
                </>
              )}
            </p>
          ) : null}

          <div className="rounded border border-slate-900 bg-slate-50 px-2 py-2 sm:px-3">
            <p className="receipt-print-label-top mb-0 text-[10px] font-semibold uppercase text-slate-600">
              Total net
            </p>
            <p className="receipt-print-amount text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
              {netStr} DT
            </p>
          </div>

          {showNoteAnticipatif ? (
            <div className="rounded border border-amber-400 bg-amber-50 px-2 py-2 text-[10px] leading-snug text-amber-950 sm:text-[11px]">
              <strong>Note :</strong> {formatHeuresReceipt(reliquatAnticipatif)} h restantes sur l&apos;emploi du temps{" "}
              {edtMois} seront reportées sur le mois prochain.
            </div>
          ) : null}

          <div className="grid grid-cols-[5.5rem_1fr] gap-x-1 border-t border-dashed border-slate-300 pt-2 sm:grid-cols-[6.5rem_1fr]">
            <span className="font-semibold text-slate-600">Opération</span>
            <span className="break-words leading-tight">{dateOperation}</span>
          </div>
        </div>

        <div className="receipt-sig-sticky mt-auto w-full pt-2">
          <p className="receipt-print-foot mb-2 shrink-0 text-center text-[9px] leading-tight text-slate-500 sm:mb-3 sm:text-[10px]">
            Document généré à titre de reçu — sans valeur fiscale contractuelle.
          </p>
          <div className="receipt-sig-columns flex w-full flex-row gap-2 border-t border-slate-300 pt-2 sm:gap-3 sm:pt-3">
            <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
              <p>Signature de l&apos;Enseignant</p>
              <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
            </div>
            <div className="receipt-print-sig min-w-0 flex-1 text-slate-600">
              <p>Cachet et Signature Direction</p>
              <div className="mt-2 min-h-[1.5rem] border-b-2 border-slate-900 sm:min-h-8" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reçu paysage : deux exemplaires (École / Professeur ou Salarié). */
export function SalaryReceiptTemplate(props) {
  const v = props.variant ?? "prof";
  const right = v === "personnel" ? "COPIE SALARIÉ" : "COPIE PROFESSEUR";
  return (
    <div className="print-receipt-landscape-root">
      <div className="print-receipt-sheet-grid w-full max-w-full sm:max-w-[280mm]">
        <div className="print-receipt-cell min-h-0">
          <SalaryReceiptExemplaire copyLabel="COPIE ÉCOLE" {...props} />
        </div>
        <div className="print-receipt-cell min-h-0">
          <SalaryReceiptExemplaire copyLabel={right} {...props} />
        </div>
      </div>
    </div>
  );
}
