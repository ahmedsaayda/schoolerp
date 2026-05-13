import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReactToPrint } from "react-to-print";
import { Printer } from "lucide-react";

import { ACADEMIC_MONTHS, ACADEMIC_MONTH_LABEL_BY_CODE } from "../constants/academicMonths.js";
import { formatSectionCell } from "../constants/tunisianAcademic.js";
import { API_ELEVES, apiFetch } from "../config.js";
import { schoolLogoPrintPublicUrl } from "../branding.js";
import { eleveTarifMensuelTotal } from "../utils/eleveFees.js";
import { PRINT_DOUBLE_RECEIPT_STYLES, ReceiptTemplate, formatDt } from "./PaymentDoubleReceiptShared.jsx";
import RegistrationFormPrint from "./RegistrationFormPrint.jsx";
import Loading from "./ui/Loading.jsx";

const ACADEMIC_MONTHS_COUNT = 10;

const TYPE_FRAIS_LABELS = {
  SCOLARITE: "Scolarité",
  INSCRIPTION: "Inscription",
  ETUDES: "Études",
  TRANSPORT: "Transport",
  AUTRE: "Autre",
};

const METHODE_LABELS = {
  ESPECE: "Espèce",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
};

function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Reliquat et trop-perçu sur une ligne d’encaissement (montant dû vs payé pour cette ligne). */
function transactionResteEtAcompteLigne(montantDu, montantPaye) {
  const frais = toNumber(montantDu);
  const paye = toNumber(montantPaye);
  const reste = Math.max(0, Math.round((frais - paye) * 100) / 100);
  const acompteLigne = Math.max(0, Math.round((paye - frais) * 100) / 100);
  return { frais, paye, reste, acompteLigne };
}

function formatDate(iso) {
  if (!iso) return "—";
  const s = String(iso);
  const d = s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
  try {
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(y, m - 1, day));
  } catch {
    return d;
  }
}

function formatDateTime(iso) {
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

function badgeLabelsFromCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return null;
  return codes
    .map((c) => ACADEMIC_MONTH_LABEL_BY_CODE[String(c).padStart(2, "0")] ?? c)
    .filter(Boolean);
}

/** Libellé statut mensuel pour impression. */
function moisStatutLabel(status) {
  if (status === "PAID") return "Payé";
  if (status === "PARTIAL") return "Partiel";
  return "Non payé";
}

/**
 * Fiche de scolarité annuelle (impression).
 */
function FullHistoryTemplate({ eleve, monthRows, totalAnnuelDu, totalPaye, resteAnnuel, sectionLabel }) {
  return (
    <div className="print-root-full print-fiche-scale bg-white text-slate-900">
      <header className="mb-8 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center justify-between gap-4">
          <img
            src={schoolLogoPrintPublicUrl()}
            alt="SAMAH SCHOOL Logo"
            className="h-16 w-auto shrink-0 object-contain"
          />
          <div className="min-w-0 flex-1 text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Établissement scolaire</p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight">Fiche de scolarité</h1>
            <p className="text-[11px] leading-tight text-slate-600">Suivi annuel des mensualités (septembre → juin)</p>
          </div>
        </div>
        <div className="mt-2 grid gap-0.5 text-sm sm:grid-cols-2">
          <p className="leading-snug">
            <span className="font-semibold text-slate-600">Élève : </span>
            {eleve.prenom} {eleve.nom}
          </p>
          <p className="leading-snug">
            <span className="font-semibold text-slate-600">N° dossier : </span>
            {eleve.id}
          </p>
          <p className="leading-snug">
            <span className="font-semibold text-slate-600">Classe : </span>
            {eleve.classe || "—"}
          </p>
          <p className="leading-snug">
            <span className="font-semibold text-slate-600">Section : </span>
            {sectionLabel}
          </p>
        </div>
      </header>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-900 bg-slate-100">
            <th className="px-2 py-1 text-left text-[13px] font-bold">Mois</th>
            <th className="px-2 py-1 text-left text-[13px] font-bold">Statut</th>
            <th className="px-2 py-1 text-right text-[13px] font-bold tabular-nums">Montant (DT)</th>
          </tr>
        </thead>
        <tbody>
          {monthRows.map(({ code, label, status, montantAffiche }) => (
            <tr key={code} className="border-b border-slate-200">
              <td className="px-2 py-1 leading-snug">
                {label} <span className="text-slate-500">({code})</span>
              </td>
              <td className="px-2 py-1 text-[13px] font-medium leading-snug">{moisStatutLabel(status)}</td>
              <td className="px-2 py-1 text-right text-[13px] tabular-nums leading-snug">{formatDt(montantAffiche)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fiche-print-footer mt-3 border-t-2 border-slate-900 pt-2 text-sm">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="text-[13px] text-slate-600">Total annuel dû (× {ACADEMIC_MONTHS_COUNT} mois)</p>
            <p className="text-base font-bold tabular-nums leading-tight">{formatDt(totalAnnuelDu)} DT</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] text-slate-600">Total payé (encaissements)</p>
            <p className="text-base font-bold tabular-nums leading-tight text-emerald-800">{formatDt(totalPaye)} DT</p>
          </div>
        </div>
        <div className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
          <p className="text-[13px] font-semibold text-slate-800">Reste à payer annuel</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight text-slate-900">{formatDt(resteAnnuel)} DT</p>
        </div>
        <p className="mt-2 text-center text-[10px] leading-tight text-slate-500">
          Document émis le{" "}
          {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}
        </p>
      </div>
    </div>
  );
}

/**
 * Dossier élève 360° : identité, coordonnées, synthèse financière, suivi mensuel, historique des paiements.
 */
export default function EleveDetailsModal({
  open,
  eleveId,
  onClose,
  /** Si défini, affiche « Encaisser un mois » (ex. page Paiements) — reçoit l’objet élève GET /api/eleves/:id/ */
  onEncaissementMois,
}) {
  const titleId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eleve, setEleve] = useState(null);
  const printFicheRef = useRef(null);
  /** Conteneur DOM réservé à l’impression du reçu (présent avant `window.print()`). */
  const printOnlyReceiptRef = useRef(null);
  const [fichePrintedAtLabel, setFichePrintedAtLabel] = useState("");
  const [printPayload, setPrintPayload] = useState(null);
  const windowPrintActiveRef = useRef(false);

  const handlePrintFiche = useReactToPrint({
    contentRef: printFicheRef,
    documentTitle: eleve ? `fiche-inscription-${eleve.id}` : "fiche-inscription",
    ignoreGlobalStyles: true,
    fonts: [
      {
        family: "Inter",
        source: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
      },
    ],
    pageStyle: `
      @page { size: A4 portrait; margin: 10mm; }
      @media print {
        html, body {
          width: 100%;
          margin: 0;
          padding: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
    onAfterPrint: () => setFichePrintedAtLabel(""),
  });

  useEffect(() => {
    if (!open || eleveId == null) return;
    const ac = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setEleve(null);
      try {
        const resE = await apiFetch(`${API_ELEVES}${eleveId}/`, { signal: ac.signal, cache: "no-store" });
        if (!resE.ok) throw new Error(`élève HTTP ${resE.status}`);
        const e = await resE.json();
        if (!cancelled) setEleve(e);
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!cancelled) {
          setError("Impossible de charger le dossier élève.");
          setEleve(null);
        }
      } finally {
        if (!cancelled && !ac.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [open, eleveId]);

  useEffect(() => {
    if (!open || eleveId == null) return;
    async function onFinancesChanged(ev) {
      if (ev.detail?.eleveId == null || Number(ev.detail.eleveId) !== Number(eleveId)) return;
      try {
        const resE = await apiFetch(`${API_ELEVES}${eleveId}/`, { cache: "no-store" });
        if (!resE.ok) return;
        const e = await resE.json();
        setEleve(e);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("school-eleve-finances-changed", onFinancesChanged);
    return () => window.removeEventListener("school-eleve-finances-changed", onFinancesChanged);
  }, [open, eleveId]);

  useEffect(() => {
    if (!open) return;
    const el = document.createElement("style");
    el.setAttribute("data-eleve-details-modal-print", "1");
    el.textContent = PRINT_DOUBLE_RECEIPT_STYLES;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [open]);

  const repartitionByCode = useMemo(() => {
    const raw = eleve?.mois_repartition_valeur;
    if (!Array.isArray(raw)) return new Map();
    const m = new Map();
    for (const row of raw) {
      if (row?.code) m.set(String(row.code).padStart(2, "0"), row);
    }
    return m;
  }, [eleve?.mois_repartition_valeur]);

  const historiquePaiements = useMemo(() => {
    const h = eleve?.historique_paiements;
    if (!Array.isArray(h)) return [];
    return [...h].sort((a, b) => String(b.date_encaissement).localeCompare(String(a.date_encaissement)));
  }, [eleve?.historique_paiements]);

  /** Mois entièrement payés (répartition annuelle) — une ligne par mois pour impression ciblée. */
  const moisPayesRows = useMemo(() => {
    return ACADEMIC_MONTHS.map(([code, label]) => {
      const row = repartitionByCode.get(code);
      if (row?.status !== "PAID") return null;
      return { code, label, row };
    }).filter(Boolean);
  }, [repartitionByCode]);

  const handlePrintReceipt = (paymentId) => {
    if (!eleve) return;
    const dash = paymentId.indexOf("-");
    if (dash < 0) return;
    const sid = paymentId.slice(0, dash);
    const codeMois = paymentId.slice(dash + 1).padStart(2, "0");
    if (String(eleve.id) !== String(sid)) return;
    const raw = eleve.mois_repartition_valeur;
    const row = Array.isArray(raw)
      ? raw.find((r) => String(r?.code).padStart(2, "0") === codeMois)
      : null;
    if (!row || row.status !== "PAID") return;
    const monthLabel = row.label ?? ACADEMIC_MONTH_LABEL_BY_CODE[codeMois] ?? codeMois;
    const dateEmission = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date());
    flushSync(() => {
      setPrintPayload({
        type: "receipt",
        eleve,
        row,
        monthLabel,
        codeMois,
        dateEmission,
      });
    });
  };

  const handlePrintFullHistory = (studentId) => {
    if (!eleve || String(eleve.id) !== String(studentId)) return;
    const monthRows = ACADEMIC_MONTHS.map(([code, label]) => {
      const r = repartitionByCode.get(code);
      const status = r?.status ?? "UNPAID";
      let montantAffiche = 0;
      if (status === "PAID" || status === "PARTIAL") montantAffiche = toNumber(r?.montant_applique);
      else montantAffiche = toNumber(r?.reliquat);
      return { code, label, status, montantAffiche };
    });
    const tarifMensuel = toNumber(eleveTarifMensuelTotal(eleve));
    const totalAnnuelDu = tarifMensuel * ACADEMIC_MONTHS_COUNT;
    flushSync(() => {
      setPrintPayload({
        type: "full",
        eleve,
        monthRows,
        totalAnnuelDu,
        totalPaye: toNumber(eleve.total_paye),
        resteAnnuel: toNumber(eleve.reste_a_payer),
        sectionLabel: formatSectionCell(eleve.niveau, eleve.section, eleve.section_display),
      });
    });
  };

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!printPayload) return;
    const runPrint = () => {
      windowPrintActiveRef.current = true;
      window.print();
    };
    if (printPayload.type === "receipt") {
      requestAnimationFrame(() => {
        requestAnimationFrame(runPrint);
      });
      return;
    }
    runPrint();
  }, [printPayload]);

  useEffect(() => {
    function onAfterPrint() {
      if (!windowPrintActiveRef.current) return;
      windowPrintActiveRef.current = false;
      setPrintPayload(null);
    }
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  if (!open || eleveId == null) return null;

  const reste = toNumber(eleve?.reste_a_payer);
  const credit = toNumber(eleve?.credit_eleve);
  const acompteSigned =
    eleve?.acompte != null && eleve.acompte !== ""
      ? toNumber(eleve.acompte)
      : credit > 0.005
        ? credit
        : reste > 0.005
          ? -reste
          : 0;
  const payeComplet = reste <= 0;
  const tarifMensuel = toNumber(eleve ? eleveTarifMensuelTotal(eleve) : 0);
  const totalAnnuelDu = tarifMensuel * ACADEMIC_MONTHS_COUNT;
  const progressPct =
    eleve?.pourcentage_paiement != null && Number.isFinite(Number(eleve.pourcentage_paiement))
      ? Number(eleve.pourcentage_paiement)
      : totalAnnuelDu > 0
        ? Math.round((toNumber(eleve?.total_paye) / totalAnnuelDu) * 1000) / 10
        : 0;

  return (
    <>
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(92vh,920px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_25px_80px_-12px_rgba(15,23,42,0.45)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-[#e2e8f0] bg-gradient-to-br from-[#f8fafc] via-white to-emerald-50/30 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {loading ? (
                <h2 id={titleId} className="text-lg font-semibold text-[#64748b]">
                  Dossier élève
                </h2>
              ) : eleve ? (
                <>
                  <h2 id={titleId} className="text-2xl font-bold tracking-tight text-[#0f172a]">
                    {eleve.prenom} {eleve.nom}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {eleve.classe ? (
                      <span className="inline-flex items-center rounded-full bg-[#e0e7ff] px-3 py-1 text-xs font-semibold text-[#3730a3] ring-1 ring-[#a5b4fc]/60">
                        Classe : {eleve.classe}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full bg-[#cffafe] px-3 py-1 text-xs font-semibold text-[#0e7490] ring-1 ring-[#67e8f9]/60">
                      Section : {formatSectionCell(eleve.niveau, eleve.section, eleve.section_display)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-medium text-[#475569]">
                      N° {eleve.id}
                    </span>
                  </div>
                </>
              ) : (
                <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
                  Dossier élève
                </h2>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loading || !eleve}
                onClick={() => {
                  if (!eleve) return;
                  flushSync(() => {
                    setFichePrintedAtLabel(
                      new Intl.DateTimeFormat("fr-FR", {
                        dateStyle: "long",
                        timeStyle: "short",
                      }).format(new Date()),
                    );
                  });
                  void handlePrintFiche();
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Imprimer Fiche 📝
              </button>
              {typeof onEncaissementMois === "function" ? (
                <button
                  type="button"
                  disabled={loading || !eleve}
                  onClick={() => {
                    if (!eleve) return;
                    onEncaissementMois(eleve);
                  }}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Encaisser un mois
                </button>
              ) : null}
              <button
                type="button"
                disabled={loading || !eleve}
                onClick={() => eleve && handlePrintFullHistory(eleve.id)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Imprimer l&apos;historique complet
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] shadow-sm transition hover:bg-[#f8fafc]"
              >
                Fermer
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              {error}
            </p>
          ) : loading ? (
            <Loading message="Chargement du dossier…" className="min-h-[240px] py-10" />
          ) : eleve ? (
            <div className="space-y-8">
              <section className="rounded-2xl border border-[#e2e8f0] bg-[#fafbfc] p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Informations générales &amp; coordonnées
                </h3>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold text-[#94a3b8]">Parent / tuteur</dt>
                    <dd className="mt-1 font-medium text-[#0f172a]">{eleve.nom_parent || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-[#94a3b8]">Date de naissance</dt>
                    <dd className="mt-1 font-medium text-[#0f172a]">{formatDate(eleve.date_naissance)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-[#94a3b8]">Téléphones</dt>
                    <dd className="mt-1 font-mono text-sm text-[#0f172a]">
                      {[eleve.telephone_1, eleve.telephone_2].filter(Boolean).join(" · ") || "—"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-[#94a3b8]">Adresse</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[#0f172a]">{eleve.adresse || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-[#94a3b8]">Inscrit le</dt>
                    <dd className="mt-1 text-[#0f172a]">{formatDate(eleve.date_inscription)}</dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b]">
                    État financier
                  </h3>
                  {payeComplet && credit <= 0.005 ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">
                      Payé en totalité
                    </span>
                  ) : null}
                  {reste > 0.005 ? (
                    <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-950 ring-1 ring-orange-200">
                      Reste à payer : {formatDt(reste)}
                    </span>
                  ) : null}
                  {credit > 0.005 ? (
                    <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-950 ring-1 ring-teal-200">
                      Acompte (crédit) : {formatDt(credit)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Solde annuel (acompte)</p>
                  <p className="mt-1 text-sm text-slate-700">
                    <span className="font-semibold tabular-nums text-[#0f172a]">{formatDt(acompteSigned)}</span>
                    <span className="text-slate-600">
                      {" "}
                      DT — encaissements cumulés moins frais annuels dus (× {ACADEMIC_MONTHS_COUNT} mois). Positif :
                      acompte ; négatif : reste à payer.
                    </span>
                  </p>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 sm:col-span-2">
                    <p className="text-xs font-semibold text-[#64748b]">Détail des frais mensuels (DT)</p>
                    <ul className="mt-3 space-y-2 text-sm">
                      <li className="flex justify-between gap-2 border-b border-[#e2e8f0]/80 pb-2">
                        <span className="text-[#475569]">Scolarité</span>
                        <span className="tabular-nums font-semibold text-[#0f172a]">{formatDt(eleve.tarif_scolarite)}</span>
                      </li>
                      <li className="flex justify-between gap-2 border-b border-[#e2e8f0]/80 pb-2">
                        <span className="text-[#475569]">Transport</span>
                        <span className="tabular-nums font-semibold text-[#0f172a]">{formatDt(eleve.tarif_transport)}</span>
                      </li>
                      <li className="flex justify-between gap-2 border-b border-[#e2e8f0]/80 pb-2">
                        <span className="text-[#475569]">Études</span>
                        <span className="tabular-nums font-semibold text-[#0f172a]">{formatDt(eleve.tarif_etudes)}</span>
                      </li>
                      <li className="flex justify-between gap-2 border-b border-[#e2e8f0]/80 pb-2">
                        <span className="text-[#475569]">Autre</span>
                        <span className="tabular-nums font-semibold text-[#0f172a]">{formatDt(eleve.tarif_autre)}</span>
                      </li>
                      {toNumber(eleve.tarif_autre) > 0 && eleve.description_autre ? (
                        <li className="text-xs text-[#64748b]">
                          <span className="font-medium text-[#475569]">Précision « Autre » : </span>
                          {eleve.description_autre}
                        </li>
                      ) : null}
                    </ul>
                    <p className="mt-3 border-t border-[#cbd5e1] pt-3 text-xs font-bold uppercase tracking-wide text-[#64748b]">
                      Total mensuel
                    </p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-[#0f172a]">{formatDt(tarifMensuel)}</p>
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                    <p className="text-xs font-semibold text-indigo-900">Total annuel dû (× {ACADEMIC_MONTHS_COUNT} mois)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-indigo-950">{formatDt(totalAnnuelDu)}</p>
                    <p className="mt-1 text-[11px] text-indigo-800/90">Septembre → juin (scolarité)</p>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-4">
                    <p className="text-xs font-semibold text-emerald-800">Total payé (encaissements)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-emerald-800">{formatDt(eleve.total_paye)}</p>
                  </div>
                  {reste > 0 ? (
                    <div className="rounded-xl border border-red-200 bg-red-50/90 p-4 sm:col-span-2">
                      <p className="text-xs font-semibold text-red-900">Reste à payer</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-red-950">{formatDt(reste)}</p>
                      <p className="mt-1 text-[11px] text-red-900/85">
                        {formatDt(totalAnnuelDu)} − {formatDt(eleve.total_paye)}
                      </p>
                    </div>
                  ) : null}
                  {credit > 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/95 p-4 sm:col-span-2">
                      <p className="text-xs font-semibold text-emerald-900">Acompte (crédit)</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-emerald-950">{formatDt(credit)}</p>
                      <p className="mt-1 text-[11px] text-emerald-900/85">
                        Encaissements au-delà du total annuel ({formatDt(totalAnnuelDu)}).
                      </p>
                    </div>
                  ) : null}
                </div>
                {toNumber(eleve.reste_global) > 0 ? (
                  <p className="mt-4 text-xs text-[#64748b]">
                    Reliquat cumulé sur toutes les lignes d’échéances :{" "}
                    <span className="font-semibold text-[#0f172a]">{formatDt(eleve.reste_global)}</span>
                  </p>
                ) : null}
              </section>

              <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/90 via-white to-[#f0fdf4] p-5 shadow-[0_12px_40px_-20px_rgba(16,185,129,0.45)]">
                <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-200/40 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-10 left-1/4 h-24 w-40 rounded-full bg-teal-200/30 blur-2xl" />
                <div className="relative flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900/80">
                      Année scolaire — suivi des mensualités
                    </h3>
                    <p className="mt-1 text-sm text-emerald-950/80">
                      Répartition selon les montants encaissés : chaque mois vaut le tarif mensuel, dans l’ordre sept. → juin.
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black tabular-nums text-emerald-800">{progressPct}%</p>
                    <p className="text-xs font-medium text-emerald-800/80">
                      du total annuel (encaissements / tarif × 10)
                    </p>
                  </div>
                </div>
                <div
                  className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3"
                  aria-label="Grille des mois de l’année scolaire"
                >
                  {ACADEMIC_MONTHS.map(([code, label]) => {
                    const row = repartitionByCode.get(code);
                    const status = row?.status ?? "UNPAID";
                    const reliquat = toNumber(row?.reliquat);
                    const dejaPaye = toNumber(row?.montant_applique);
                    const isPaid = status === "PAID";
                    const isPartial = status === "PARTIAL";
                    return (
                      <div
                        key={code}
                        className={[
                          "flex min-h-[5rem] flex-col justify-center rounded-xl border-2 px-2 py-2 text-center transition",
                          isPaid
                            ? "border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/25"
                            : isPartial
                              ? "border-amber-400 bg-[repeating-linear-gradient(-45deg,#fff7ed_0px,#fff7ed_6px,#ffedd5_6px,#ffedd5_12px)] text-amber-950 shadow-sm"
                              : "border-dashed border-[#cbd5e1] bg-white/80 text-[#64748b]",
                        ].join(" ")}
                      >
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide ${
                            isPaid ? "text-emerald-100" : isPartial ? "text-amber-800" : "text-[#94a3b8]"
                          }`}
                        >
                          {code}
                        </span>
                        <span
                          className={`mt-0.5 text-xs font-semibold leading-tight ${
                            isPaid ? "text-white" : isPartial ? "text-amber-950" : "text-[#475569]"
                          }`}
                        >
                          {label}
                        </span>
                        {isPaid ? (
                          <span className="mt-1 text-[10px] font-bold text-emerald-100">Payé</span>
                        ) : isPartial ? (
                          <span className="mt-1 text-[9px] font-bold leading-tight text-amber-900">
                            Déjà payé : {formatDt(dejaPaye)} | Reste : {formatDt(reliquat)}
                          </span>
                        ) : (
                          <span className="mt-1 text-[10px] font-medium text-[#94a3b8]">À régler</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Historique des paiements
                </h3>
                {moisPayesRows.length === 0 ? (
                  <p className="mt-4 text-sm text-[#64748b]">Aucun mois entièrement soldé pour l&apos;instant.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-[#e8eef5]">
                    <table className="w-full min-w-[320px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#e8eef5] bg-[#f8fafc] text-[11px] font-bold uppercase tracking-wide text-[#64748b]">
                          <th className="px-4 py-3">Mois</th>
                          <th className="px-4 py-3 tabular-nums">Montant</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moisPayesRows.map(({ code: codeMois, label, row }) => {
                          return (
                            <tr key={codeMois} className="border-b border-[#f1f5f9] last:border-0">
                              <td className="px-4 py-3">
                                <span className="font-semibold text-[#0f172a]">{label}</span>
                                <span className="ml-2 text-xs text-[#94a3b8]">({codeMois})</span>
                              </td>
                              <td className="px-4 py-3 tabular-nums font-medium text-[#0f172a]">
                                {formatDt(row.montant_applique)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handlePrintReceipt(`${eleve.id}-${codeMois}`)}
                                  className="inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                  title={`Imprimer le reçu — ${label}`}
                                  aria-label={`Imprimer le reçu pour ${label}`}
                                >
                                  <Printer className="h-4 w-4" strokeWidth={2} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {historiquePaiements.length === 0 ? (
                  <p className="mt-6 text-sm text-[#64748b]">Aucun encaissement enregistré pour cet élève.</p>
                ) : (
                  <>
                    <h4 className="mt-8 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">
                      Détail des encaissements
                    </h4>
                  <ol className="relative mt-4 space-y-0 pl-2 before:absolute before:left-[19px] before:top-2 before:h-[calc(100%-12px)] before:w-px before:bg-gradient-to-b before:from-[#3b82f6] before:via-[#94a3b8]/40 before:to-transparent sm:pl-3">
                    {historiquePaiements.map((p, idx) => {
                      const moisBadges = badgeLabelsFromCodes(p.mois_concernes);
                      return (
                        <li key={p.id} className="relative pb-8 last:pb-2">
                          <span
                            className="absolute left-0 top-1.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-[11px] font-bold text-white shadow-md ring-2 ring-[#bfdbfe]/80"
                            aria-hidden
                          >
                            {historiquePaiements.length - idx}
                          </span>
                          <div className="ml-12 rounded-2xl border border-[#e8eef5] bg-gradient-to-br from-[#fafbfc] to-white p-4 shadow-sm ring-1 ring-[#f1f5f9]">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#0f172a]">
                                  {TYPE_FRAIS_LABELS[p.type_frais] ?? p.type_frais}
                                </p>
                                <p className="mt-1 text-xs text-[#64748b]">{formatDateTime(p.date_encaissement)}</p>
                                {moisBadges?.length ? (
                                  <p className="mt-2">
                                    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
                                      Payé pour : {moisBadges.join(", ")}
                                    </span>
                                  </p>
                                ) : p.mois_concerne ? (
                                  <p className="mt-2 text-xs text-[#64748b]">
                                    Mois (ancien format) : {formatDate(p.mois_concerne)}
                                  </p>
                                ) : null}
                              </div>
                              <div className="text-right">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                                  Montant payé
                                </p>
                                <p className="text-base font-bold tabular-nums text-emerald-700">
                                  {formatDt(p.montant_paye)}
                                </p>
                                {(() => {
                                  const { reste, acompteLigne } = transactionResteEtAcompteLigne(
                                    p.montant_du,
                                    p.montant_paye,
                                  );
                                  return (
                                    <ul className="mt-2 space-y-0.5 text-left text-xs leading-snug sm:text-right">
                                      <li className="text-[#64748b]">
                                        Frais exigés :{" "}
                                        <span className="font-medium tabular-nums text-[#0f172a]">
                                          {formatDt(p.montant_du)}
                                        </span>
                                      </li>
                                      <li className="text-[#64748b]">
                                        Reste à payer :{" "}
                                        <span
                                          className={`font-semibold tabular-nums ${
                                            reste > 0.005 ? "text-[#b91c1c]" : "text-[#64748b]"
                                          }`}
                                        >
                                          {formatDt(reste)}
                                        </span>
                                      </li>
                                      <li className="text-[#64748b]">
                                        Acompte (ligne) :{" "}
                                        {acompteLigne > 0.005 ? (
                                          <span className="font-semibold tabular-nums text-emerald-700">
                                            {formatDt(acompteLigne)}
                                          </span>
                                        ) : (
                                          <span className="font-semibold tabular-nums text-[#64748b]">
                                            {formatDt(0)}
                                          </span>
                                        )}
                                      </li>
                                    </ul>
                                  );
                                })()}
                              </div>
                            </div>
                            <p className="mt-3 border-t border-[#eef2f6] pt-3 text-xs text-[#475569]">
                              <span className="font-medium text-[#64748b]">{METHODE_LABELS[p.methode] ?? p.methode}</span>
                              {p.remarque ? ` · ${p.remarque}` : null}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  </>
                )}
              </section>
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={loading || !eleve}
              onClick={() => {
                if (!eleve) return;
                flushSync(() => {
                  setFichePrintedAtLabel(
                    new Intl.DateTimeFormat("fr-FR", {
                      dateStyle: "long",
                      timeStyle: "short",
                    }).format(new Date()),
                  );
                });
                void handlePrintFiche();
              }}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6"
            >
              Imprimer Fiche 📝
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-[#e2e8f0] bg-white py-3 text-sm font-semibold text-[#475569] shadow-sm transition hover:bg-[#f1f5f9] sm:w-auto sm:px-6"
            >
              Fermer
            </button>
            <button
              type="button"
              disabled={loading || !eleve}
              onClick={() => eleve && handlePrintFullHistory(eleve.id)}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
            >
              Imprimer l&apos;historique complet
            </button>
          </div>
        </footer>
      </div>
    </div>
    <div className="no-print">
      <RegistrationFormPrint ref={printFicheRef} eleve={eleve} printedAtLabel={fichePrintedAtLabel} />
    </div>
    <div className="print-section" aria-hidden="true">
      {printPayload?.type === "receipt" ? (
        <div
          id="print-only-receipt"
          ref={printOnlyReceiptRef}
          className="print-container print-only-receipt-root"
        >
          <ReceiptTemplate
            eleve={printPayload.eleve}
            monthLabel={printPayload.monthLabel}
            monthCode={printPayload.codeMois}
            montantApplique={printPayload.row.montant_applique}
            dateEmission={printPayload.dateEmission}
          />
        </div>
      ) : null}
      {printPayload?.type === "full" ? (
        <div className="print-container print-page">
          <FullHistoryTemplate
            eleve={printPayload.eleve}
            monthRows={printPayload.monthRows}
            totalAnnuelDu={printPayload.totalAnnuelDu}
            totalPaye={printPayload.totalPaye}
            resteAnnuel={printPayload.resteAnnuel}
            sectionLabel={printPayload.sectionLabel}
          />
        </div>
      ) : null}
    </div>
    </>
  );
}
