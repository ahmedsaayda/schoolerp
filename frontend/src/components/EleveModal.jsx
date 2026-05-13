import { useEffect, useId, useMemo, useState } from "react";

import {
  isTroncNiveau,
  NIVEAU_OPTIONS,
  SECONDARY_SECTION_OPTIONS,
} from "../constants/tunisianAcademic.js";
import { API_ELEVES, apiFetch } from "../config.js";
import { formatTnd } from "../utils/tunisianMoney.js";

function emptyForm() {
  return {
    nom: "",
    prenom: "",
    nom_parent: "",
    telephone_1: "",
    telephone_2: "",
    date_naissance: "",
    niveau: "7BASE",
    classe: "",
    section: "",
    adresse: "",
    tarif_scolarite: "",
    tarif_transport: "",
    tarif_etudes: "",
    tarif_autre: "",
    description_autre: "",
    montant_exoneration_reference_annuel: "",
  };
}

function digitsOnlyMax8(s) {
  return String(s ?? "").replace(/\D/g, "").slice(0, 8);
}

const ACADEMIC_MONTHS_COUNT = 10;

function formatDtPreview(value) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return formatTnd(n, { minFractionDigits: 0, maxFractionDigits: 2 });
}

function parseFeeInput(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** AAAA-MM-JJ selon le fuseau local (borne max « aujourd’hui » fiable). */
function formatISODateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eleveToForm(eleve) {
  if (!eleve) return emptyForm();
  const d = eleve.date_naissance;
  const dateStr =
    typeof d === "string" ? d.slice(0, 10) : d ? new Date(d).toISOString().slice(0, 10) : "";
  const niv = eleve.niveau ?? "7BASE";
  const exo = eleve.montant_exoneration_reference_annuel;
  return {
    nom: eleve.nom ?? "",
    prenom: eleve.prenom ?? "",
    nom_parent: eleve.nom_parent ?? "",
    telephone_1: digitsOnlyMax8(eleve.telephone_1),
    telephone_2: eleve.telephone_2 != null && eleve.telephone_2 !== "" ? digitsOnlyMax8(eleve.telephone_2) : "",
    date_naissance: dateStr,
    niveau: niv,
    classe: eleve.classe ?? "",
    section: isTroncNiveau(niv) ? "" : (eleve.section ?? ""),
    adresse: eleve.adresse ?? "",
    tarif_scolarite:
      eleve.tarif_scolarite != null && eleve.tarif_scolarite !== "" ? String(eleve.tarif_scolarite) : "",
    tarif_transport:
      eleve.tarif_transport != null && eleve.tarif_transport !== "" ? String(eleve.tarif_transport) : "",
    tarif_etudes: eleve.tarif_etudes != null && eleve.tarif_etudes !== "" ? String(eleve.tarif_etudes) : "",
    tarif_autre: eleve.tarif_autre != null && eleve.tarif_autre !== "" ? String(eleve.tarif_autre) : "",
    description_autre: eleve.description_autre ?? "",
    montant_exoneration_reference_annuel: exo != null && exo !== "" ? String(exo) : "",
  };
}

/**
 * Modale d’ajout ou de modification d’un élève (API Django REST).
 */
export default function EleveModal({
  open,
  mode,
  eleve,
  classeOptions = [],
  classeRecords = [],
  initialClasse,
  /** Objet classe API (nom, niveau, section) — prioritaire sur `initialClasse` seul. */
  initialClasseRecord = null,
  onClose,
  onSuccess,
}) {
  const titleId = useId();
  const [form, setForm] = useState(emptyForm);
  /** standard | gratuit | convention — exclusifs */
  const [tarifMode, setTarifMode] = useState("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (mode === "edit" && eleve) {
      setForm(eleveToForm(eleve));
      if (eleve.is_gratuit) setTarifMode("gratuit");
      else if (eleve.is_convention) setTarifMode("convention");
      else setTarifMode("standard");
    } else {
      const base = emptyForm();
      const rec = initialClasseRecord && typeof initialClasseRecord === "object" ? initialClasseRecord : null;
      if (rec?.niveau) {
        base.niveau = rec.niveau;
        base.section = isTroncNiveau(rec.niveau) ? "" : (rec.section || SECONDARY_SECTION_OPTIONS[0]?.value || "");
        if (rec.nom) base.classe = rec.nom;
      } else {
        const ic = typeof initialClasse === "string" ? initialClasse.trim() : "";
        if (ic) base.classe = ic;
      }
      setForm(base);
      setTarifMode("standard");
    }
  }, [open, mode, eleve, initialClasse, initialClasseRecord]);

  const useStructuredClasses = classeRecords.length > 0;

  const classesFiltrees = useMemo(() => {
    if (!useStructuredClasses) return [];
    const tronc = isTroncNiveau(form.niveau);
    const secEff = tronc ? "" : form.section;
    const classeSectionEmpty = (c) => String(c.section ?? "").trim() === "";
    return classeRecords.filter((c) => {
      if (c.niveau !== form.niveau) return false;
      if (tronc) return classeSectionEmpty(c);
      return c.section === secEff;
    });
  }, [useStructuredClasses, classeRecords, form.niveau, form.section]);

  useEffect(() => {
    if (!open || !useStructuredClasses) return;
    if (isTroncNiveau(form.niveau) && form.section !== "") {
      setForm((f) => ({ ...f, section: "" }));
    }
  }, [open, useStructuredClasses, form.niveau, form.section]);

  useEffect(() => {
    if (!open || !useStructuredClasses) return;
    const noms = classesFiltrees.map((c) => c.nom).filter(Boolean);
    if (noms.length === 0) {
      if (form.classe) setForm((f) => ({ ...f, classe: "" }));
      return;
    }
    if (!form.classe || !noms.includes(form.classe)) {
      setForm((f) => ({ ...f, classe: noms[0] }));
    }
  }, [open, useStructuredClasses, classesFiltrees, form.classe]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function update(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "niveau") {
        if (isTroncNiveau(value)) next.section = "";
        else if (!next.section && SECONDARY_SECTION_OPTIONS.length)
          next.section = SECONDARY_SECTION_OPTIONS[0].value;
      }
      return next;
    });
  }

  function updatePhone(field, raw) {
    const digits = String(raw).replace(/\D/g, "").slice(0, 8);
    update(field, digits);
  }

  const feesDisabled = submitting || tarifMode === "gratuit";

  function handleTarifModeChange(next) {
    if (next === "gratuit") {
      setForm((f) => {
        const totalM =
          parseFeeInput(f.tarif_scolarite) +
          parseFeeInput(f.tarif_transport) +
          parseFeeInput(f.tarif_etudes) +
          parseFeeInput(f.tarif_autre);
        const refAnn = totalM * ACADEMIC_MONTHS_COUNT;
        return {
          ...f,
          tarif_scolarite: "0",
          tarif_transport: "0",
          tarif_etudes: "0",
          tarif_autre: "0",
          description_autre: "",
          montant_exoneration_reference_annuel:
            refAnn > 0
              ? refAnn.toFixed(2)
              : (f.montant_exoneration_reference_annuel || "0.00").trim() || "0.00",
        };
      });
    } else if (tarifMode === "gratuit") {
      setForm((f) => ({ ...f, montant_exoneration_reference_annuel: "0" }));
    }
    setTarifMode(next);
  }

  const tel1Partial = form.telephone_1.length > 0 && form.telephone_1.length < 8;
  const tel2Raw = form.telephone_2.trim();
  const tel2Partial = tel2Raw.length > 0 && form.telephone_2.length < 8;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (form.telephone_1.length !== 8) {
        setError("Le téléphone 1 doit contenir exactement 8 chiffres.");
        setSubmitting(false);
        return;
      }
      if (tel2Raw !== "" && form.telephone_2.length !== 8) {
        setError("Le téléphone 2 doit être vide ou contenir exactement 8 chiffres.");
        setSubmitting(false);
        return;
      }

      const ts = parseFeeInput(form.tarif_scolarite);
      const tt = parseFeeInput(form.tarif_transport);
      const te = parseFeeInput(form.tarif_etudes);
      const ta = parseFeeInput(form.tarif_autre);
      const totalMensuel = ts + tt + te + ta;
      const isGratuit = tarifMode === "gratuit";
      const isConvention = tarifMode === "convention";
      if (!isGratuit && totalMensuel <= 0) {
        setError(
          "La somme des frais mensuels (scolarité + transport + études + autre) doit être strictement supérieure à 0.",
        );
        setSubmitting(false);
        return;
      }
      if (!isGratuit && ta > 0 && !String(form.description_autre ?? "").trim()) {
        setError("Précisez la description du poste « Autre » lorsque son montant est supérieur à 0.");
        setSubmitting(false);
        return;
      }

      const tronc = isTroncNiveau(form.niveau);
      const sectionPayload = tronc ? "" : form.section;
      if (!tronc && !String(sectionPayload || "").trim()) {
        setError("Choisissez une section (à partir de la 2ème année secondaire).");
        setSubmitting(false);
        return;
      }

      const exoRef = isGratuit ? parseFeeInput(form.montant_exoneration_reference_annuel) : 0;
      const formData = {
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        nom_parent: form.nom_parent.trim(),
        telephone_1: form.telephone_1,
        telephone_2: tel2Raw === "" ? null : form.telephone_2,
        date_naissance: form.date_naissance,
        niveau: form.niveau,
        classe: form.classe.trim(),
        section: sectionPayload,
        adresse: form.adresse.trim(),
        is_gratuit: isGratuit,
        is_convention: isConvention,
        montant_exoneration_reference_annuel: isGratuit ? exoRef.toFixed(2) : "0.00",
        tarif_scolarite: (isGratuit ? 0 : ts).toFixed(2),
        tarif_transport: (isGratuit ? 0 : tt).toFixed(2),
        tarif_etudes: (isGratuit ? 0 : te).toFixed(2),
        tarif_autre: (isGratuit ? 0 : ta).toFixed(2),
        description_autre: isGratuit ? "" : String(form.description_autre ?? "").trim(),
      };

      const isEdit = mode === "edit" && eleve?.id != null;
      const url = isEdit ? `${API_ELEVES}${eleve.id}/` : API_ELEVES;
      const method = isEdit ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        let msg = `Erreur ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
          else if (data && typeof data === "object") {
            const first = Object.entries(data).find(([, v]) => v != null);
            if (first) msg = `${first[0]} : ${Array.isArray(first[1]) ? first[1].join(", ") : String(first[1])}`;
          }
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }

      onSuccess?.();
    } catch {
      setError("Erreur réseau ou serveur indisponible.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const totalMensuelPreview =
    parseFeeInput(form.tarif_scolarite) +
    parseFeeInput(form.tarif_transport) +
    parseFeeInput(form.tarif_etudes) +
    parseFeeInput(form.tarif_autre);
  const totalAnnuelPreview =
    totalMensuelPreview > 0 ? formatDtPreview(totalMensuelPreview * ACADEMIC_MONTHS_COUNT) : null;
  const showDescAutre = parseFeeInput(form.tarif_autre) > 0;

  const inputClass =
    "w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#0f172a] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] disabled:opacity-60";
  const inputClassPhoneInvalid = `${inputClass} border-red-300 focus:border-red-500 focus:ring-red-500`;
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748b]";
  const maxDateNaissance = formatISODateLocal(new Date());
  const inputDateNaissanceClass = `${inputClass} min-h-[2.75rem] text-[#0f172a] [color-scheme:light] [&::-webkit-calendar-picker-indicator]:h-5 [&::-webkit-calendar-picker-indicator]:w-5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:[filter:invert(0.35)_sepia(1)_saturate(3)_hue-rotate(195deg)] hover:[&::-webkit-calendar-picker-indicator]:[filter:invert(0.2)_sepia(1)_saturate(4)_hue-rotate(200deg)]`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#0f172a]">
            {mode === "edit" ? "Modifier l’élève" : "Ajouter un élève"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#0f172a]"
            aria-label="Fermer"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label htmlFor="eleve-nom" className={labelClass}>
                Nom
              </label>
              <input
                id="eleve-nom"
                value={form.nom}
                onChange={(e) => update("nom", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="eleve-prenom" className={labelClass}>
                Prénom
              </label>
              <input
                id="eleve-prenom"
                value={form.prenom}
                onChange={(e) => update("prenom", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="eleve-parent" className={labelClass}>
              Parent
            </label>
            <input
              id="eleve-parent"
              value={form.nom_parent}
              onChange={(e) => update("nom_parent", e.target.value)}
              required
              disabled={submitting}
              className={inputClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="eleve-tel1" className={labelClass}>
                Téléphone 1
              </label>
              <input
                id="eleve-tel1"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                pattern="[0-9]{8}"
                maxLength={8}
                title="Veuillez entrer exactement 8 chiffres"
                value={form.telephone_1}
                onChange={(e) => updatePhone("telephone_1", e.target.value)}
                required
                disabled={submitting}
                className={tel1Partial ? inputClassPhoneInvalid : inputClass}
                aria-invalid={tel1Partial}
              />
              {tel1Partial ? (
                <p className="mt-1 text-xs text-red-600">8 chiffres requis ({form.telephone_1.length}/8).</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="eleve-tel2" className={labelClass}>
                Téléphone 2
              </label>
              <input
                id="eleve-tel2"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={8}
                value={form.telephone_2}
                onChange={(e) => updatePhone("telephone_2", e.target.value)}
                disabled={submitting}
                className={tel2Partial ? inputClassPhoneInvalid : inputClass}
                placeholder="Optionnel"
                aria-invalid={tel2Partial}
              />
              {tel2Partial ? (
                <p className="mt-1 text-xs text-red-600">8 chiffres ou laissez vide ({form.telephone_2.length}/8).</p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="eleve-naissance" className={labelClass}>
              Date de naissance
            </label>
            <input
              id="eleve-naissance"
              type="date"
              min="2000-01-01"
              max={maxDateNaissance}
              value={form.date_naissance}
              onChange={(e) => update("date_naissance", e.target.value)}
              required
              disabled={submitting}
              className={inputDateNaissanceClass}
            />
          </div>

          <div className="flex flex-wrap gap-4 items-center mb-4" role="radiogroup" aria-label="Régime de tarification">
            <span className="w-full text-xs font-semibold uppercase tracking-wide text-[#64748b] sm:w-auto sm:me-1">
              Tarification
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
              <input
                type="radio"
                name="eleve-tarif-mode"
                className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                checked={tarifMode === "standard"}
                onChange={() => handleTarifModeChange("standard")}
                disabled={submitting}
              />
              Standard
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
              <input
                type="radio"
                name="eleve-tarif-mode"
                className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                checked={tarifMode === "gratuit"}
                onChange={() => handleTarifModeChange("gratuit")}
                disabled={submitting}
              />
              <span>Gratuit (exonéré de frais)</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#0f172a]">
              <input
                type="radio"
                name="eleve-tarif-mode"
                className="h-4 w-4 border-[#cbd5e1] text-[#2563eb] focus:ring-[#3b82f6]"
                checked={tarifMode === "convention"}
                onChange={() => handleTarifModeChange("convention")}
                disabled={submitting}
              />
              <span>Conventionné (paiement différé / fin d&apos;année)</span>
            </label>
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <h3 className={labelClass}>Configuration des frais mensuels (DT)</h3>
            <p className="mb-3 text-xs text-[#64748b]">
              Laissez à 0 les postes non concernés. La somme des quatre postes définit le tarif mensuel total ; il est
              multiplié par {ACADEMIC_MONTHS_COUNT} pour la dette annuelle (septembre → juin).
            </p>
            {tarifMode === "gratuit" ? (
              <p className="mb-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-[#475569]">
                Cet élève ne générera aucune dette comptable.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="eleve-tarif-sco" className={labelClass}>
                  Scolarité
                </label>
                <input
                  id="eleve-tarif-sco"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.tarif_scolarite}
                  onChange={(e) => update("tarif_scolarite", e.target.value)}
                  disabled={feesDisabled}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="eleve-tarif-trans" className={labelClass}>
                  Transport
                </label>
                <input
                  id="eleve-tarif-trans"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.tarif_transport}
                  onChange={(e) => update("tarif_transport", e.target.value)}
                  disabled={feesDisabled}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="eleve-tarif-etu" className={labelClass}>
                  Études
                </label>
                <input
                  id="eleve-tarif-etu"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.tarif_etudes}
                  onChange={(e) => update("tarif_etudes", e.target.value)}
                  disabled={feesDisabled}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="eleve-tarif-autre" className={labelClass}>
                  Autre
                </label>
                <input
                  id="eleve-tarif-autre"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.tarif_autre}
                  onChange={(e) => update("tarif_autre", e.target.value)}
                  disabled={feesDisabled}
                  className={inputClass}
                />
              </div>
            </div>
            {showDescAutre && !feesDisabled ? (
              <div className="mt-3">
                <label htmlFor="eleve-desc-autre" className={labelClass}>
                  Description « Autre » <span className="text-red-600">*</span>
                </label>
                <input
                  id="eleve-desc-autre"
                  type="text"
                  maxLength={255}
                  value={form.description_autre}
                  onChange={(e) => update("description_autre", e.target.value)}
                  disabled={feesDisabled}
                  className={inputClass}
                  placeholder="Ex. Cantine, atelier, fournitures…"
                />
              </div>
            ) : null}
            {tarifMode === "gratuit" ? (
              <div className="mt-3">
                <label htmlFor="eleve-exo-ref" className={labelClass}>
                  Réf. exonération annuelle (compta)
                </label>
                <input
                  id="eleve-exo-ref"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.montant_exoneration_reference_annuel}
                  onChange={(e) => update("montant_exoneration_reference_annuel", e.target.value)}
                  disabled={submitting}
                  className={inputClass}
                  title="Montant annuel théorique exonéré — pour rapports (manque à gagner / gratuités)"
                />
                <p className="mt-1 text-[11px] text-[#64748b]">
                  Renseigné automatiquement à partir des frais saisis avant passage en « Gratuit » ; ajustable pour les
                  rapports d&apos;exploitation.
                </p>
              </div>
            ) : null}
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
              <p className="text-xs font-semibold text-emerald-900">Total mensuel (aperçu)</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-950">
                {totalMensuelPreview > 0 ? formatDtPreview(totalMensuelPreview) : tarifMode === "gratuit" ? formatDtPreview(0) : "—"}
              </p>
              {totalAnnuelPreview || tarifMode === "gratuit" ? (
                <p className="mt-1 text-xs font-medium text-emerald-900/90" aria-live="polite">
                  Total annuel (× {ACADEMIC_MONTHS_COUNT}) :{" "}
                  {totalAnnuelPreview || (tarifMode === "gratuit" ? formatDtPreview(0) : "—")}
                </p>
              ) : (
                <p className="mt-1 text-xs text-emerald-800/80">Indiquez au moins un montant &gt; 0.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="eleve-niveau" className={labelClass}>
                Niveau
              </label>
              <select
                id="eleve-niveau"
                value={form.niveau}
                onChange={(e) => update("niveau", e.target.value)}
                required
                disabled={submitting}
                className={inputClass}
              >
                {NIVEAU_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={isTroncNiveau(form.niveau) ? "sm:col-span-2" : undefined}>
              <label htmlFor="eleve-classe" className={labelClass}>
                Classe
              </label>
              {useStructuredClasses ? (
                <select
                  id="eleve-classe"
                  value={form.classe}
                  onChange={(e) => update("classe", e.target.value)}
                  required
                  disabled={submitting || classesFiltrees.length === 0}
                  className={inputClass}
                >
                  {classesFiltrees.length === 0 ? (
                    <option value="">
                      {isTroncNiveau(form.niveau)
                        ? "Aucune classe (tronc commun) pour ce niveau"
                        : "Aucune classe pour ce niveau et cette section"}
                    </option>
                  ) : (
                    classesFiltrees.map((c) => (
                      <option key={c.id ?? c.nom} value={c.nom}>
                        {c.nom}
                        {c.nombre_eleves != null ? ` (${c.nombre_eleves}/${c.capacite_max ?? 30})` : ""}
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <>
                  <input
                    id="eleve-classe"
                    list="eleve-classe-list"
                    value={form.classe}
                    onChange={(e) => update("classe", e.target.value)}
                    required
                    disabled={submitting}
                    className={inputClass}
                    placeholder="Saisir ou choisir une classe"
                  />
                  <datalist id="eleve-classe-list">
                    {classeOptions.map((nom) => (
                      <option key={nom} value={nom} />
                    ))}
                  </datalist>
                </>
              )}
            </div>
            {!isTroncNiveau(form.niveau) ? (
              <div>
                <label htmlFor="eleve-section" className={labelClass}>
                  Section
                </label>
                <select
                  id="eleve-section"
                  value={form.section}
                  onChange={(e) => update("section", e.target.value)}
                  required
                  disabled={submitting}
                  className={inputClass}
                >
                  {SECONDARY_SECTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="eleve-adresse" className={labelClass}>
              Adresse
            </label>
            <textarea
              id="eleve-adresse"
              value={form.adresse}
              onChange={(e) => update("adresse", e.target.value)}
              required
              disabled={submitting}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-[#e2e8f0] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] transition hover:bg-[#f8fafc] disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
            >
              {submitting ? "Enregistrement…" : mode === "edit" ? "Enregistrer" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
