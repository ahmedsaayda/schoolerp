from __future__ import annotations

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import DisallowedHost
from django.db import transaction
from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .finance_eleve import compute_acompte_value
from .rapport_auteur import auteur_rapport_payload
from .models import (
    ACADEMIC_MONTHS,
    AvanceSalaire,
    CalendrierScolaire,
    Classe,
    Depense,
    Eleve,
    EmploiDuTemps,
    MouvementBanque,
    Paiement,
    PaiementSalaire,
    Personnel,
    PointagePersonnel,
    Pointage,
    Professeur,
    SessionCaisse,
    TRONC_NIVEAU_CODES,
    academic_months_elapsed_since_sept,
    session_caisse_ouverte,
)

_ACADEMIC_MONTH_ORDER = [code for code, _ in ACADEMIC_MONTHS]
_ACADEMIC_MONTH_INDEX = {c: i for i, c in enumerate(_ACADEMIC_MONTH_ORDER)}
# Dette élève vs scolarité : 10 mois (sept. → juin).
ELEVES_MOIS_SCOLAIRES = Decimal("10")


def compute_mois_repartition_valeur(total_paye, tarif_mensuel) -> list[dict]:
    """
    Répartition séquentielle des encaissements sur les 10 mois (chacun = tarif_mensuel).
    Retourne une entrée par mois : PAID, PARTIAL (reliquat = reste à payer pour ce mois), UNPAID.
    """
    tp = total_paye if isinstance(total_paye, Decimal) else Decimal(str(total_paye))
    tm = tarif_mensuel if isinstance(tarif_mensuel, Decimal) else Decimal(str(tarif_mensuel))
    tp = max(tp, Decimal("0"))
    if tm <= 0:
        return [
            {
                "code": code,
                "label": label,
                "status": "UNPAID",
                "reliquat": "0.00",
                "montant_applique": "0.00",
            }
            for code, label in ACADEMIC_MONTHS
        ]

    remaining = tp
    out: list[dict] = []
    q = Decimal("0.01")
    for code, label in ACADEMIC_MONTHS:
        need = tm
        if remaining >= need:
            out.append(
                {
                    "code": code,
                    "label": label,
                    "status": "PAID",
                    "reliquat": "0.00",
                    "montant_applique": str(need.quantize(q)),
                }
            )
            remaining -= need
        elif remaining > 0:
            applied = remaining
            reliquat = (need - applied).quantize(q)
            out.append(
                {
                    "code": code,
                    "label": label,
                    "status": "PARTIAL",
                    "reliquat": str(reliquat),
                    "montant_applique": str(applied.quantize(q)),
                }
            )
            remaining = Decimal("0")
        else:
            out.append(
                {
                    "code": code,
                    "label": label,
                    "status": "UNPAID",
                    "reliquat": str(need.quantize(q)),
                    "montant_applique": "0.00",
                }
            )
    return out


def _total_paye_eleve_excluant_paiement(eleve_pk: int, exclude_paiement_id: int | None) -> Decimal:
    qs = Paiement.objects.filter(eleve_id=eleve_pk)
    if exclude_paiement_id is not None:
        qs = qs.exclude(pk=exclude_paiement_id)
    dec = DecimalField(max_digits=14, decimal_places=2)
    tp = qs.aggregate(
        s=Coalesce(Sum("montant_paye"), Value(Decimal("0"), output_field=dec))
    )["s"]
    return tp if tp is not None else Decimal("0")


def credit_eleve_from_totals(total_paye, tarif_mensuel) -> Decimal:
    """Surplus d’encaissements sur l’année (tarif × 10) : toujours ≥ 0."""
    tp = total_paye if isinstance(total_paye, Decimal) else Decimal(str(total_paye))
    tm = tarif_mensuel if isinstance(tarif_mensuel, Decimal) else Decimal(str(tarif_mensuel))
    total_annuel = tm * ELEVES_MOIS_SCOLAIRES
    diff = total_annuel - tp
    if diff < 0:
        return abs(diff).quantize(Decimal("0.01"))
    return Decimal("0.00")


def expected_montant_du_for_mois(eleve: Eleve, mois_codes: list[str], exclude_paiement_id: int | None = None) -> Decimal:
    """
    Montant dû « séquentiel strict » : reliquats de tous les mois non soldés *avant* le premier mois
    sélectionné (ordre sept. → juin), plus les reliquats des mois sélectionnés,
    diminué de l’acompte annuel (surpaiement tarif × 10) le cas échéant — plancher 0.
    """
    tp = _total_paye_eleve_excluant_paiement(eleve.pk, exclude_paiement_id)
    rep = compute_mois_repartition_valeur(tp, eleve.tarif_mensuel_total())
    by_code = {str(r["code"]).zfill(2): r for r in rep}
    order = _ACADEMIC_MONTH_ORDER
    sorted_m = sorted(
        [str(c).strip().zfill(2) for c in mois_codes],
        key=lambda c: order.index(c),
    )
    if not sorted_m:
        return Decimal("0.00")
    first_sel_idx = order.index(sorted_m[0])
    total = Decimal("0")
    q = Decimal("0.01")
    for i in range(0, first_sel_idx):
        c = order[i]
        row = by_code.get(c)
        if not row or row["status"] == "PAID":
            continue
        total += Decimal(str(row["reliquat"]))
    for c in sorted_m:
        row = by_code.get(c)
        if row:
            total += Decimal(str(row["reliquat"]))
    cred = credit_eleve_from_totals(tp, eleve.tarif_mensuel_total())
    adjusted = total - cred
    if adjusted < Decimal("0"):
        adjusted = Decimal("0")
    return adjusted.quantize(q)


def fifo_mois_concernes_for_payment(
    eleve: Eleve,
    montant_paye: Decimal,
    exclude_paiement_id: int | None,
) -> list[str]:
    """
    Mois touchés par ce versement selon l’allocation FIFO (complète d’abord le PARTIAL,
    puis les UNPAID dans l’ordre scolaire). Retourne les codes « MM » dans l’ordre chronologique.
    """
    tp = _total_paye_eleve_excluant_paiement(eleve.pk, exclude_paiement_id)
    rep = compute_mois_repartition_valeur(tp, eleve.tarif_mensuel_total())
    remaining = montant_paye if isinstance(montant_paye, Decimal) else Decimal(str(montant_paye))
    remaining = remaining.quantize(Decimal("0.01"))
    out: list[str] = []
    for row in rep:
        owed = Decimal(str(row["reliquat"]))
        if owed <= 0:
            continue
        take = min(remaining, owed)
        if take > 0:
            code = str(row["code"]).zfill(2)
            out.append(code)
            remaining -= take
        if remaining <= 0:
            break
    return out


class ClasseSerializer(serializers.ModelSerializer):
    nombre_eleves = serializers.SerializerMethodField()

    class Meta:
        model = Classe
        fields = ("id", "nom", "niveau", "section", "capacite_max", "nombre_eleves")

    def get_nombre_eleves(self, obj):
        return getattr(obj, "nombre_eleves", 0)


class EleveSerializer(serializers.ModelSerializer):
    """
    Champs financiers :
    - Frais mensuels : scolarité, transport, études, autre (+ description si autre > 0).
    - `tarif_mensuel` (lecture seule) : somme des quatre frais mensuels.
    - `total_annuel_du` : tarif_mensuel × 10 (année sept. → juin).
    - `reste_a_payer` : max(0, total_annuel_du − total_paye) avec total_annuel_du = tarif_mensuel × 10
      et total_paye = somme des encaissements (Σ montant_paye) — toujours dérivé dynamiquement, pas stocké.
    - `acompte` : total_paye − total_annuel_du (signé), persisté en base et recalculé à chaque paiement.
    - `credit_eleve` : max(0, acompte) — crédit / acompte affichable.
    - `dette_prorata_echeance` : (tarif_mensuel × mois écoulés depuis sept.) − total_paye (plancher 0).
    - `reste_global` : cumul des restes sur les lignes de paiement (montant_du − montant_paye), distinct de la dette annuelle.
    - `pourcentage_paiement` : (total_paye / (tarif_mensuel × 10)) × 100 (fiche détail uniquement).
    - `mois_repartition_valeur` : statut PAID / PARTIAL / UNPAID par mois selon répartition séquentielle des montants.
    """

    tarif_mensuel = serializers.SerializerMethodField(read_only=True)
    reste_global = serializers.SerializerMethodField()
    total_paye = serializers.SerializerMethodField()
    reste_a_payer = serializers.SerializerMethodField()
    credit_eleve = serializers.SerializerMethodField()
    acompte = serializers.SerializerMethodField()
    total_annuel_du = serializers.SerializerMethodField()
    dette_prorata_echeance = serializers.SerializerMethodField()
    statut_reglement = serializers.SerializerMethodField()
    section_display = serializers.CharField(source="get_section_display", read_only=True)
    coordonnees = serializers.SerializerMethodField()
    mois_payes_annuel = serializers.SerializerMethodField()
    historique_paiements = serializers.SerializerMethodField()
    pourcentage_paiement = serializers.SerializerMethodField()
    mois_repartition_valeur = serializers.SerializerMethodField()
    progression_annuelle = serializers.SerializerMethodField()

    class Meta:
        model = Eleve
        fields = (
            "id",
            "nom",
            "prenom",
            "nom_parent",
            "telephone_1",
            "telephone_2",
            "date_naissance",
            "niveau",
            "classe",
            "section",
            "section_display",
            "adresse",
            "is_gratuit",
            "is_convention",
            "montant_exoneration_reference_annuel",
            "tarif_scolarite",
            "tarif_transport",
            "tarif_etudes",
            "tarif_autre",
            "description_autre",
            "tarif_mensuel",
            "progression_annuelle",
            "date_inscription",
            "reste_global",
            "total_paye",
            "total_annuel_du",
            "reste_a_payer",
            "credit_eleve",
            "acompte",
            "dette_prorata_echeance",
            "statut_reglement",
            "pourcentage_paiement",
            "mois_repartition_valeur",
            "coordonnees",
            "mois_payes_annuel",
            "historique_paiements",
        )

    def get_reste_global(self, obj):
        return getattr(obj, "reste_global", None)

    def get_tarif_mensuel(self, obj):
        return str(obj.tarif_mensuel_total())

    def get_progression_annuelle(self, obj):
        """
        Part des frais annuels théoriques (tarif_mensuel × 10) couverte par l’ensemble des encaissements
        de l’élève — entier, comme la jauge Paiement / fiche détail. S’appuie sur l’annotation `total_paye`
        du `EleveViewSet` (Somme `paiements__montant_paye`, sans requêtes N+1).
        """
        if getattr(obj, "is_gratuit", False):
            return 100
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        denom = tm * ELEVES_MOIS_SCOLAIRES
        if denom <= 0:
            return 0
        pct = (tp / denom) * Decimal("100")
        return int(pct.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    def get_total_paye(self, obj):
        v = getattr(obj, "total_paye", None)
        if v is not None:
            return v
        return Decimal("0")

    def get_reste_a_payer(self, obj):
        if getattr(obj, "is_gratuit", False):
            return Decimal("0.00")
        # Paiement par organisme ; pas de « dette famille » exposée comme pour un impayé classique.
        if getattr(obj, "is_convention", False):
            return Decimal("0.00")
        v = getattr(obj, "reste_a_payer", None)
        if v is not None:
            return v if v >= Decimal("0") else Decimal("0")
        ac = getattr(obj, "acompte", None)
        if ac is not None:
            acd = ac if isinstance(ac, Decimal) else Decimal(str(ac))
            if acd < Decimal("0"):
                return abs(acd).quantize(Decimal("0.01"))
            return Decimal("0.00")
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        total_annuel = tm * ELEVES_MOIS_SCOLAIRES
        diff = total_annuel - tp
        return diff if diff > Decimal("0") else Decimal("0")

    def get_acompte(self, obj):
        """Solde annuel signé persisté (`Eleve.acompte`) — toujours exposé en chaîne pour le JSON liste / détail."""
        v = getattr(obj, "acompte", None)
        if v is None:
            return str(Decimal("0.00"))
        d = v if isinstance(v, Decimal) else Decimal(str(v))
        return str(d.quantize(Decimal("0.01")))

    def get_credit_eleve(self, obj):
        if getattr(obj, "is_gratuit", False):
            return Decimal("0.00")
        v = getattr(obj, "credit_eleve", None)
        if v is not None:
            return v if v >= Decimal("0") else Decimal("0")
        ac = getattr(obj, "acompte", None)
        if ac is not None:
            acd = ac if isinstance(ac, Decimal) else Decimal(str(ac))
            if acd > Decimal("0"):
                return acd.quantize(Decimal("0.01"))
            return Decimal("0.00")
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        total_annuel = tm * ELEVES_MOIS_SCOLAIRES
        diff = total_annuel - tp
        return abs(diff) if diff < Decimal("0") else Decimal("0")

    def get_total_annuel_du(self, obj):
        if getattr(obj, "is_gratuit", False):
            return Decimal("0.00")
        return obj.tarif_mensuel_total() * ELEVES_MOIS_SCOLAIRES

    def get_dette_prorata_echeance(self, obj):
        """Dette « à date » : échéances cumulées depuis septembre vs encaissements."""
        if getattr(obj, "is_gratuit", False):
            return Decimal("0.00")
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        n = academic_months_elapsed_since_sept(timezone.localdate())
        due_a_date = tm * Decimal(n)
        d = due_a_date - tp
        return d if d > Decimal("0") else Decimal("0")

    def _collect_mois_payes_codes(self, obj) -> set[str]:
        codes: set[str] = set()
        for p in obj.paiements.all():
            for m in p.mois_concernes or []:
                s = str(m).strip().zfill(2)
                if s in _ACADEMIC_MONTH_INDEX:
                    codes.add(s)
            mc = getattr(p, "mois_concerne", None)
            if mc is not None:
                s = f"{mc.month:02d}"
                if s in _ACADEMIC_MONTH_INDEX:
                    codes.add(s)
        return codes

    def get_statut_reglement(self, obj):
        """
        vert : année entièrement payée (total_paye ≥ tarif × 10).
        orange : mois calendaire courant couvert par un paiement, mais pas l'année complète.
        rouge : mois scolaire courant non couvert (ou juil./août avec solde annuel non nul).
        """
        if getattr(obj, "is_gratuit", False):
            return "vert"
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        total_annuel = tm * ELEVES_MOIS_SCOLAIRES
        if tp >= total_annuel:
            return "vert"
        codes = self._collect_mois_payes_codes(obj)
        today = timezone.localdate()
        mois_cal = f"{today.month:02d}"
        if mois_cal in _ACADEMIC_MONTH_INDEX:
            if mois_cal in codes:
                return "orange"
            return "rouge"
        # Juillet / août : pas de mois « scolaire » courant — retard si solde annuel non soldé.
        return "orange" if self.get_reste_a_payer(obj) > Decimal("0") else "vert"

    def _fee_decimal(self, attrs: dict, field: str, instance: Eleve | None) -> Decimal:
        if field in attrs:
            v = attrs[field]
            return v if isinstance(v, Decimal) else Decimal(str(v))
        if instance is not None:
            v = getattr(instance, field)
            return v if isinstance(v, Decimal) else Decimal(str(v))
        return Decimal("0")

    def validate(self, attrs):
        inst = self.instance
        is_grat = attrs.get("is_gratuit", inst.is_gratuit if inst is not None else False)
        is_grat = bool(is_grat)
        is_conv = attrs.get("is_convention", inst.is_convention if inst is not None else False)
        is_conv = bool(is_conv)
        if is_grat and is_conv:
            raise serializers.ValidationError(
                "Un élève ne peut pas être à la fois exonéré (gratuit) et conventionné."
            )

        s = self._fee_decimal(attrs, "tarif_scolarite", inst)
        t = self._fee_decimal(attrs, "tarif_transport", inst)
        e = self._fee_decimal(attrs, "tarif_etudes", inst)
        a = self._fee_decimal(attrs, "tarif_autre", inst)
        total_m = (s + t + e + a).quantize(Decimal("0.01"))
        if is_grat:
            attrs["is_gratuit"] = True
            attrs["is_convention"] = False
            attrs["tarif_scolarite"] = Decimal("0.00")
            attrs["tarif_transport"] = Decimal("0.00")
            attrs["tarif_etudes"] = Decimal("0.00")
            attrs["tarif_autre"] = Decimal("0.00")
            attrs["description_autre"] = ""
        else:
            attrs["is_gratuit"] = False
            attrs["is_convention"] = is_conv
            if total_m <= Decimal("0"):
                raise serializers.ValidationError(
                    {
                        "tarif_scolarite": "La somme des frais mensuels (scolarité + transport + études + autre) doit être strictement positive."
                    }
                )
        desc = attrs.get("description_autre")
        if desc is None:
            desc = (inst.description_autre if inst is not None else "") or ""
        a_eff = Decimal("0.00") if is_grat else a
        if a_eff > Decimal("0") and not str(desc).strip():
            raise serializers.ValidationError(
                {"description_autre": "Indiquez un libellé pour le poste « Autre » lorsque son montant est supérieur à 0."}
            )

        niv = attrs.get("niveau")
        if niv is None and inst is not None:
            niv = inst.niveau
        if not niv:
            niv = "7BASE"
            attrs["niveau"] = niv

        sec = attrs.get("section")
        if sec is None and inst is not None:
            sec = inst.section
        sec = (sec or "").strip()

        if niv in TRONC_NIVEAU_CODES:
            attrs["section"] = ""
        else:
            if not sec:
                raise serializers.ValidationError(
                    {
                        "section": "La section est obligatoire à partir de la 2ème année secondaire.",
                    }
                )
            attrs["section"] = sec

        return attrs

    def get_coordonnees(self, obj):
        return {
            "telephone_1": obj.telephone_1,
            "telephone_2": obj.telephone_2 or "",
            "adresse": obj.adresse,
            "nom_parent": obj.nom_parent,
        }

    def _is_retrieve_context(self):
        view = self.context.get("view")
        return getattr(view, "action", None) == "retrieve"

    def _include_mois_payes_annuel(self):
        view = self.context.get("view")
        act = getattr(view, "action", None) if view is not None else None
        return act in ("retrieve", "list", "impayes")

    def get_mois_payes_annuel(self, obj):
        if not self._include_mois_payes_annuel():
            return []
        codes = self._collect_mois_payes_codes(obj)
        return sorted(codes, key=lambda c: _ACADEMIC_MONTH_INDEX[c])

    def get_historique_paiements(self, obj):
        if not self._is_retrieve_context():
            return []
        qs = obj.paiements.all().order_by("-date_encaissement", "-id")
        return PaiementHistoriqueSerializer(qs, many=True).data

    def get_pourcentage_paiement(self, obj):
        """(total_paye / (tarif × 10)) × 100 — peut dépasser 100 % en cas de surpaiement."""
        if not self._is_retrieve_context():
            return None
        if getattr(obj, "is_gratuit", False):
            return 100.0
        tp = self.get_total_paye(obj)
        if not isinstance(tp, Decimal):
            tp = Decimal(str(tp))
        tm = obj.tarif_mensuel_total()
        denom = tm * ELEVES_MOIS_SCOLAIRES
        if denom <= 0:
            return 0.0
        pct = (tp / denom) * Decimal("100")
        return float(pct.quantize(Decimal("0.1")))

    def get_mois_repartition_valeur(self, obj):
        """Statut de chaque mois scolaire selon la répartition séquentielle des montants payés."""
        if not self._is_retrieve_context():
            return []
        if getattr(obj, "is_gratuit", False):
            return [
                {
                    "code": code,
                    "label": label,
                    "status": "PAID",
                    "reliquat": "0.00",
                    "montant_applique": "0.00",
                }
                for code, label in ACADEMIC_MONTHS
            ]
        return compute_mois_repartition_valeur(self.get_total_paye(obj), obj.tarif_mensuel_total())

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._is_retrieve_context():
            data.pop("historique_paiements", None)
            data.pop("pourcentage_paiement", None)
            data.pop("mois_repartition_valeur", None)
        if not self._include_mois_payes_annuel():
            data.pop("mois_payes_annuel", None)
        return data


class PaiementHistoriqueSerializer(serializers.ModelSerializer):
    """Paiements imbriqués dans la fiche élève (sans champs élève redondants)."""

    reste_a_payer = serializers.ReadOnlyField()

    class Meta:
        model = Paiement
        fields = (
            "id",
            "type_frais",
            "montant_du",
            "montant_paye",
            "reste_a_payer",
            "date_encaissement",
            "mois_concerne",
            "mois_concernes",
            "methode",
            "remarque",
        )


class PaiementSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.ReadOnlyField(source="eleve.nom")
    eleve_prenom = serializers.ReadOnlyField(source="eleve.prenom")
    eleve_classe = serializers.ReadOnlyField(source="eleve.classe")
    reste_a_payer = serializers.ReadOnlyField()
    cree_par_nom = serializers.SerializerMethodField()
    cree_par_role = serializers.SerializerMethodField()
    # Solde annuel global (élève) : max(0, tarif×10 − Σ montant_paye), voir aussi eleve_snapshot.
    eleve_reste_a_payer_annuel = serializers.SerializerMethodField()
    eleve_snapshot = serializers.SerializerMethodField()
    progression_annuelle = serializers.SerializerMethodField()

    class Meta:
        model = Paiement
        fields = (
            "id",
            "eleve",
            "eleve_nom",
            "eleve_prenom",
            "eleve_classe",
            "type_frais",
            "montant_du",
            "montant_paye",
            "reste_a_payer",
            "eleve_reste_a_payer_annuel",
            "eleve_snapshot",
            "date_encaissement",
            "mois_concerne",
            "mois_concernes",
            "methode",
            "remarque",
            "progression_annuelle",
            "session_caisse",
            "cree_par_nom",
            "cree_par_role",
        )
        read_only_fields = ("session_caisse", "cree_par_nom", "cree_par_role")

    def get_cree_par_nom(self, obj):
        return auteur_rapport_payload(getattr(obj, "cree_par", None))["cree_par_nom"]

    def get_cree_par_role(self, obj):
        return auteur_rapport_payload(getattr(obj, "cree_par", None))["cree_par_role"]

    def get_eleve_reste_a_payer_annuel(self, obj):
        if getattr(obj.eleve, "is_gratuit", False):
            return str(Decimal("0.00").quantize(Decimal("0.01")))
        v = getattr(obj, "_reste_a_payer_annuel_eleve", None)
        if v is not None:
            d = v if isinstance(v, Decimal) else Decimal(str(v))
            out = d if d > Decimal("0") else Decimal("0")
            return str(out.quantize(Decimal("0.01")))
        tp = _total_paye_eleve_excluant_paiement(obj.eleve_id, None)
        tm = obj.eleve.tarif_mensuel_total()
        total_annuel = tm * ELEVES_MOIS_SCOLAIRES
        diff = total_annuel - tp
        r = diff if diff > Decimal("0") else Decimal("0")
        return str(r.quantize(Decimal("0.01")))

    def get_eleve_snapshot(self, obj):
        ac = compute_acompte_value(obj.eleve)
        return {
            "id": obj.eleve_id,
            "reste_a_payer_annuel": self.get_eleve_reste_a_payer_annuel(obj),
            "acompte": str(ac),
        }

    def get_progression_annuelle(self, obj):
        """
        Part des frais annuels théoriques (tarif mensuel × 10) couverte par l'ensemble
        des encaissements de l'élève — entier, typiquement 0–100 (surpaiement possible au-delà de 100).
        Même règle que le pourcentage de la fiche élève (total payé / (tarif × 10) × 100).
        """
        if getattr(obj.eleve, "is_gratuit", False):
            return 100
        tp = getattr(obj, "_total_paye_eleve", None)
        if tp is None:
            tp = _total_paye_eleve_excluant_paiement(obj.eleve_id, None)
        else:
            if not isinstance(tp, Decimal):
                tp = Decimal(str(tp))
        denom = getattr(obj, "_denom_annual", None)
        if denom is None:
            tm = obj.eleve.tarif_mensuel_total()
            denom = tm * ELEVES_MOIS_SCOLAIRES
        else:
            if not isinstance(denom, Decimal):
                denom = Decimal(str(denom))
        if denom <= 0:
            return 0
        pct = (tp / denom) * Decimal("100")
        return int(pct.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    def validate_mois_concernes(self, value):
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Attendu : une liste de codes mois (ex. [\"09\", \"10\"]).")
        allowed = set(_ACADEMIC_MONTH_ORDER)
        out = []
        seen = set()
        for item in value:
            s = str(item).strip().zfill(2)
            if s not in allowed:
                raise serializers.ValidationError(f"Mois non reconnu pour l'année scolaire : {item!r}.")
            if s not in seen:
                seen.add(s)
                out.append(s)
        return out

    def validate(self, attrs):
        mois = attrs.get("mois_concernes")
        if self.instance is None:
            if not mois:
                raise serializers.ValidationError(
                    {"mois_concernes": "Indiquez au moins un mois couvert par cet encaissement."}
                )
        elif "mois_concernes" in attrs and not mois:
            raise serializers.ValidationError(
                {"mois_concernes": "La liste des mois ne peut pas être vide."}
            )

        eleve = attrs.get("eleve")
        if eleve is None and self.instance is not None:
            eleve = self.instance.eleve
        montant_du = attrs.get("montant_du")
        if montant_du is None and self.instance is not None:
            montant_du = self.instance.montant_du
        if mois is None and self.instance is not None:
            mois = self.instance.mois_concernes or []

        if eleve is not None and mois and montant_du is not None:
            exclude_id = self.instance.pk if self.instance else None
            exp = expected_montant_du_for_mois(eleve, mois, exclude_paiement_id=exclude_id)
            md = montant_du if isinstance(montant_du, Decimal) else Decimal(str(montant_du))
            if (md - exp).copy_abs() > Decimal("0.02"):
                raise serializers.ValidationError(
                    {
                        "montant_du": (
                            f"Pour les mois sélectionnés, le reste à payer attendu sur l’échéance est {exp} DT "
                            f"(selon la répartition actuelle des encaissements)."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        sess = session_caisse_ouverte()
        if sess is None:
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'enregistrer un paiement."
                    ]
                }
            )
        validated_data["session_caisse"] = sess
        req = self.context.get("request")
        if req is not None and getattr(req.user, "is_authenticated", False):
            validated_data.setdefault("cree_par", req.user)
        instance = super().create(validated_data)
        codes = fifo_mois_concernes_for_payment(
            instance.eleve, instance.montant_paye, exclude_paiement_id=instance.pk
        )
        if codes != instance.mois_concernes:
            instance.mois_concernes = codes
            instance.save(update_fields=["mois_concernes"])
        return instance

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        codes = fifo_mois_concernes_for_payment(
            instance.eleve, instance.montant_paye, exclude_paiement_id=instance.pk
        )
        if codes != instance.mois_concernes:
            instance.mois_concernes = codes
            instance.save(update_fields=["mois_concernes"])
        return instance


class ProfesseurSerializer(serializers.ModelSerializer):
    is_paid_current_month = serializers.BooleanField(read_only=True)
    travaille_ailleurs = serializers.BooleanField(required=False, default=False)
    nom_autre_etablissement = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        default="",
    )

    class Meta:
        model = Professeur
        fields = (
            "id",
            "nom",
            "prenom",
            "matiere",
            "telephone",
            "tarif_horaire",
            "date_embauche",
            "travaille_ailleurs",
            "nom_autre_etablissement",
            "is_paid_current_month",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if data.get("travaille_ailleurs") is None:
            data["travaille_ailleurs"] = False
        if data.get("nom_autre_etablissement") is None:
            data["nom_autre_etablissement"] = ""
        return data


class PersonnelSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    is_paid_current_month = serializers.BooleanField(read_only=True)

    class Meta:
        model = Personnel
        fields = (
            "id",
            "nom",
            "prenom",
            "telephone",
            "adresse",
            "role",
            "role_display",
            "salaire_mensuel",
            "retenue_par_absence",
            "date_embauche",
            "is_paid_current_month",
        )


class PaiementSalaireListSerializer(serializers.ModelSerializer):
    """Historique (fiche détail personnel) ou liste des paiements."""

    class Meta:
        model = PaiementSalaire
        fields = (
            "id",
            "personnel",
            "professeur",
            "date_paiement",
            "montant",
            "mois_concerne",
            "heures_liquidees",
            "heures_reliquat_m_precedent",
            "reliquat_anticipatif_heures",
            "salaire_base",
            "primes",
            "primes_remarque",
            "nb_heures_prime",
            "tarif_prime",
            "avances_deduites",
            "tarif_horaire_snapshot",
        )


class PaiementSalaireProfHistoriqueSerializer(serializers.ModelSerializer):
    """Ligne d’historique de fiche de paie (professeur) pour le tableau côté client."""

    mois = serializers.SerializerMethodField()
    annee = serializers.SerializerMethodField()

    class Meta:
        model = PaiementSalaire
        fields = (
            "id",
            "date_paiement",
            "mois",
            "annee",
            "mois_concerne",
            "montant",
            "salaire_base",
            "primes",
            "primes_remarque",
            "nb_heures_prime",
            "tarif_prime",
            "avances_deduites",
            "heures_liquidees",
            "heures_reliquat_m_precedent",
            "reliquat_anticipatif_heures",
        )

    def get_mois(self, obj) -> int | None:
        return obj.mois_concerne.month if obj.mois_concerne else None

    def get_annee(self, obj) -> int | None:
        return obj.mois_concerne.year if obj.mois_concerne else None


class PointagePersonnelListSerializer(serializers.ModelSerializer):
    statut_display = serializers.CharField(source="get_statut_display", read_only=True)

    class Meta:
        model = PointagePersonnel
        fields = ("id", "date", "statut", "statut_display")


class PersonnelDetailSerializer(PersonnelSerializer):
    """Fiche : historiques de paiements de salaire et de pointage (lecture seule)."""

    historique_paiements_salaire = PaiementSalaireListSerializer(
        many=True, read_only=True, source="paiements_salaire"
    )
    historique_pointage = PointagePersonnelListSerializer(
        many=True, read_only=True, source="pointages_personnel"
    )

    class Meta:
        model = Personnel
        fields = PersonnelSerializer.Meta.fields + (
            "historique_paiements_salaire",
            "historique_pointage",
        )


class PaiementSalaireWriteSerializer(serializers.ModelSerializer):
    """Création d’un paiement de salaire + écriture d’une `Depense` catégorie SALAIRE."""

    class Meta:
        model = PaiementSalaire
        fields = ("id", "personnel", "montant", "mois_concerne")
        read_only_fields = ("id",)

    def validate_mois_concerne(self, value):
        if value is None:
            raise serializers.ValidationError("Indiquez le mois concerné.")
        from datetime import date

        return date(value.year, value.month, 1)

    @transaction.atomic
    def create(self, validated_data):
        from django.utils import timezone

        personnel = validated_data["personnel"]
        montant = validated_data["montant"]
        mois = validated_data["mois_concerne"]
        now = timezone.now()
        sess = session_caisse_ouverte()
        if sess is None:
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'enregistrer ce paiement."
                    ]
                }
            )
        req = self.context.get("request")
        cree_u = req.user if req is not None and getattr(req.user, "is_authenticated", False) else None
        d = Depense.objects.create(
            titre=f"Salaire — {personnel.prenom} {personnel.nom}",
            categorie=Depense.Categorie.SALAIRE,
            montant=montant,
            date_depense=now.date(),
            note=f"Paiement salaire — {mois.year:04d}-{mois.month:02d}",
            session_caisse=sess,
            cree_par=cree_u,
        )
        return PaiementSalaire.objects.create(
            personnel=personnel,
            montant=montant,
            mois_concerne=mois,
            depense=d,
            date_paiement=now,
        )

    def to_representation(self, instance):
        return PaiementSalaireListSerializer(instance, context=self.context).data


class PointagePersonnelSerializer(serializers.ModelSerializer):
    statut_display = serializers.CharField(source="get_statut_display", read_only=True)

    class Meta:
        model = PointagePersonnel
        fields = (
            "id",
            "personnel",
            "date",
            "statut",
            "statut_display",
        )
        read_only_fields = ("id", "statut_display")


class PointagePersonnelBulkItemSerializer(serializers.Serializer):
    """Une ligne de saisie groupée (identique au schéma attendu par `bulk_enregistrer`)."""

    personnel_id = serializers.IntegerField(min_value=1)
    statut = serializers.ChoiceField(choices=PointagePersonnel.Statut.choices)


class PointagePersonnelBulkSerializer(serializers.Serializer):
    date = serializers.DateField()
    items = PointagePersonnelBulkItemSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Au moins une ligne de pointage est requise.")
        return value


class DepenseSerializer(serializers.ModelSerializer):
    categorie_display = serializers.CharField(source="get_categorie_display", read_only=True)
    note = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)
    piece_jointe = serializers.FileField(required=True, allow_empty_file=False)
    cree_par_nom = serializers.SerializerMethodField()
    cree_par_role = serializers.SerializerMethodField()

    class Meta:
        model = Depense
        fields = (
            "id",
            "titre",
            "categorie",
            "categorie_display",
            "montant",
            "date_depense",
            "note",
            "piece_jointe",
            "session_caisse",
            "cree_par_nom",
            "cree_par_role",
        )
        read_only_fields = ("session_caisse", "cree_par_nom", "cree_par_role")

    def get_cree_par_nom(self, obj):
        return auteur_rapport_payload(getattr(obj, "cree_par", None))["cree_par_nom"]

    def get_cree_par_role(self, obj):
        return auteur_rapport_payload(getattr(obj, "cree_par", None))["cree_par_role"]

    def create(self, validated_data):
        sess = session_caisse_ouverte()
        if sess is None:
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'enregistrer une dépense."
                    ]
                }
            )
        validated_data["session_caisse"] = sess
        req = self.context.get("request")
        if req is not None and getattr(req.user, "is_authenticated", False):
            validated_data.setdefault("cree_par", req.user)
        return super().create(validated_data)


class CreneauModeleSerializer(serializers.Serializer):
    """Un créneau de la grille hebdo (sans date : répliqué sur chaque jour ouvré du trimestre)."""

    professeur = serializers.PrimaryKeyRelatedField(queryset=Professeur.objects.all())
    jour_semaine = serializers.IntegerField(min_value=0, max_value=6)
    heure_debut = serializers.TimeField()
    heure_fin = serializers.TimeField()
    matiere = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )
    salle = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["heure_fin"] <= attrs["heure_debut"]:
            raise serializers.ValidationError(
                {"heure_fin": "L’heure de fin doit être postérieure à l’heure de début."}
            )
        return attrs


class GenerateFromTemplateEmploiSerializer(serializers.Serializer):
    """Régénère les séances datées d’un trimestre à partir des séances déjà enregistrées (déduplication hebdo)."""

    classe = serializers.PrimaryKeyRelatedField(queryset=Classe.objects.all())
    trimestre = serializers.ChoiceField(choices=["T1", "T2", "T3"])
    annee_scolaire_debut = serializers.IntegerField(min_value=2000, max_value=2100, default=2025)


class RemplacerModeleTrimestreSerializer(serializers.Serializer):
    """Payload : remplacer toutes les séances datées du trimestre pour une classe."""

    classe = serializers.PrimaryKeyRelatedField(queryset=Classe.objects.all())
    trimestre = serializers.ChoiceField(choices=["T1", "T2", "T3"])
    annee_scolaire_debut = serializers.IntegerField(min_value=2000, max_value=2100, default=2025)
    creneaux = CreneauModeleSerializer(many=True)

    def validate_creneaux(self, value):
        if not value:
            raise serializers.ValidationError("Au moins un créneau est requis.")
        return value


class RemplacerModeleAnneeSerializer(serializers.Serializer):
    """Même modèle hebdo appliqué sur toute l’année (T1+T2+T3) pour une classe."""

    classe = serializers.PrimaryKeyRelatedField(queryset=Classe.objects.all())
    annee_scolaire_debut = serializers.IntegerField(min_value=2000, max_value=2100, default=2025)
    creneaux = CreneauModeleSerializer(many=True)

    def validate_creneaux(self, value):
        if not value:
            raise serializers.ValidationError("Au moins un créneau est requis.")
        return value


class EmploiDuTempsSerializer(serializers.ModelSerializer):
    professeur_name = serializers.SerializerMethodField()
    classe_nom = serializers.SerializerMethodField()
    duree_heures = serializers.SerializerMethodField()
    trimestre_display = serializers.CharField(source="get_trimestre_display", read_only=True)

    class Meta:
        model = EmploiDuTemps
        fields = (
            "id",
            "professeur",
            "professeur_name",
            "classe",
            "classe_nom",
            "trimestre",
            "trimestre_display",
            "date_seance",
            "jour_semaine",
            "heure_debut",
            "heure_fin",
            "matiere",
            "salle",
            "duree_heures",
        )

    def get_professeur_name(self, obj):
        p = obj.professeur
        return f"{p.prenom} {p.nom}".strip()

    def get_classe_nom(self, obj):
        c = getattr(obj, "classe", None)
        return c.nom if c is not None else None

    def get_duree_heures(self, obj):
        return round(float(obj.duree_heures), 2)

    def validate(self, attrs):
        debut = attrs.get("heure_debut")
        fin = attrs.get("heure_fin")
        if debut is None and self.instance is not None:
            debut = self.instance.heure_debut
        if fin is None and self.instance is not None:
            fin = self.instance.heure_fin
        if debut is not None and fin is not None and fin <= debut:
            raise serializers.ValidationError(
                {"heure_fin": "L’heure de fin doit être postérieure à l’heure de début."}
            )
        ds = attrs.get("date_seance")
        j = attrs.get("jour_semaine")
        if ds is None and self.instance is not None:
            ds = self.instance.date_seance
        if j is None and self.instance is not None:
            j = self.instance.jour_semaine
        if ds is not None and j is not None:
            if int(ds.weekday()) != int(j):
                raise serializers.ValidationError(
                    {
                        "jour_semaine": "jour_semaine doit correspondre au jour de date_seance (0 = lundi … 6 = dimanche).",
                    }
                )
        tr = attrs.get("trimestre")
        if tr is None and self.instance is not None:
            tr = self.instance.trimestre
        if ds is not None and tr:
            from scolarite.academic_trimesters import trimestre_for_date

            attendu = trimestre_for_date(ds)
            if attendu is None:
                raise serializers.ValidationError(
                    {
                        "date_seance": "Date invalide pour un cours (hors périodes actives, week-end ou vacances scolaires).",
                    }
                )
            if tr != attendu:
                raise serializers.ValidationError(
                    {
                        "trimestre": f"Pour {ds}, le trimestre attendu est {attendu}.",
                    }
                )
        return attrs


class PointageSerializer(serializers.ModelSerializer):
    professeur_nom = serializers.ReadOnlyField(source="professeur.nom")
    professeur_prenom = serializers.ReadOnlyField(source="professeur.prenom")
    classe_nom = serializers.SerializerMethodField()
    recu_paiement = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Pointage
        fields = (
            "id",
            "professeur",
            "professeur_nom",
            "professeur_prenom",
            "classe",
            "classe_nom",
            "emploi_du_temps",
            "date_cours",
            "nombre_heures",
            "statut_presence",
            "est_paye",
            "statut_paiement",
            "recu_paiement",
            "remarque",
        )
        read_only_fields = ("est_paye", "statut_paiement", "recu_paiement")

    def get_classe_nom(self, obj):
        c = getattr(obj, "classe", None)
        return c.nom if c is not None else None

    def validate(self, attrs):
        if self.instance is not None:
            if self.instance.statut_paiement == Pointage.StatutPaiement.PAYE:
                raise serializers.ValidationError(
                    "Une séance pointée payée (liée à un reçu) ne peut plus être modifiée."
                )
        prof = attrs.get("professeur")
        if prof is None and self.instance is not None:
            prof = self.instance.professeur

        edt = attrs.get("emploi_du_temps")
        if edt is None and self.instance is not None and "emploi_du_temps" not in attrs:
            edt = self.instance.emploi_du_temps
        elif "emploi_du_temps" in attrs:
            edt = attrs["emploi_du_temps"]

        date_cours = attrs.get("date_cours")
        if date_cours is None and self.instance is not None:
            date_cours = self.instance.date_cours
        if date_cours is not None and date_cours > timezone.localdate():
            raise ValidationError(
                "Impossible d'enregistrer un pointage pour une date future."
            )

        if edt is not None:
            if prof is not None and edt.professeur_id != prof.id:
                raise serializers.ValidationError(
                    {"emploi_du_temps": "Ce créneau n’appartient pas à ce professeur."}
                )
            if date_cours is not None and int(date_cours.weekday()) != int(edt.jour_semaine):
                raise serializers.ValidationError(
                    {
                        "emploi_du_temps": "Le jour de ce créneau ne correspond pas à la date du cours."
                    }
                )
            slot_classe = edt.classe
            if "classe" in attrs:
                incoming_classe = attrs.get("classe")
            elif self.instance is not None:
                incoming_classe = self.instance.classe
            else:
                incoming_classe = None
            slot_classe_id = getattr(slot_classe, "id", None)
            if slot_classe_id:
                if incoming_classe is None:
                    attrs["classe"] = slot_classe
                elif getattr(incoming_classe, "id", None) != slot_classe_id:
                    raise serializers.ValidationError(
                        {"classe": "La classe ne correspond pas au créneau sélectionné."}
                    )
        return attrs


class AvanceSalaireSerializer(serializers.ModelSerializer):
    professeur_nom = serializers.ReadOnlyField(source="professeur.nom")
    professeur_prenom = serializers.ReadOnlyField(source="professeur.prenom")
    personnel_nom = serializers.ReadOnlyField(source="personnel.nom")
    personnel_prenom = serializers.ReadOnlyField(source="personnel.prenom")

    class Meta:
        model = AvanceSalaire
        fields = (
            "id",
            "professeur",
            "professeur_nom",
            "professeur_prenom",
            "personnel",
            "personnel_nom",
            "personnel_prenom",
            "montant",
            "date",
            "remarque",
            "est_solde",
        )
        extra_kwargs = {
            "professeur": {"required": False, "allow_null": True},
            "personnel": {"required": False, "allow_null": True},
        }

    def validate(self, attrs):
        if self.instance is not None:
            return attrs
        prof = attrs.get("professeur")
        pers = attrs.get("personnel")
        if (prof is None) == (pers is None):
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "Indiquez soit un professeur soit un membre du personnel (un seul des deux)."
                    ]
                }
            )
        return attrs


MSG_OUVERTURE_BLOQUEE_JUSTIFICATIF = (
    "Impossible d'ouvrir une nouvelle session. Un justificatif de versement bancaire est manquant pour la session précédente."
)


class EmptyPayloadSerializer(serializers.Serializer):
    """Requêtes POST sans corps (actions métier)."""


class SessionCaisseSerializer(serializers.ModelSerializer):
    ouvert_par_username = serializers.ReadOnlyField(source="ouvert_par.username")
    ouvert_par_nom = serializers.SerializerMethodField()
    total_entrees = serializers.SerializerMethodField()
    total_sorties = serializers.SerializerMethodField()
    total_alimentations_banque = serializers.SerializerMethodField()
    total_versements_banque = serializers.SerializerMethodField()

    class Meta:
        model = SessionCaisse
        fields = (
            "id",
            "ouvert_par",
            "ouvert_par_username",
            "ouvert_par_nom",
            "date_ouverture",
            "date_fermeture",
            "solde_initial",
            "solde_actuel",
            "solde_final",
            "montant_report_versement_banque",
            "versement_promesse_en_attente",
            "statut",
            "total_entrees",
            "total_sorties",
            "total_alimentations_banque",
            "total_versements_banque",
        )
        read_only_fields = (
            "id",
            "ouvert_par",
            "ouvert_par_username",
            "ouvert_par_nom",
            "date_ouverture",
            "date_fermeture",
            "solde_initial",
            "solde_actuel",
            "solde_final",
            "montant_report_versement_banque",
            "versement_promesse_en_attente",
            "statut",
            "total_entrees",
            "total_sorties",
            "total_alimentations_banque",
            "total_versements_banque",
        )

    def get_ouvert_par_nom(self, obj):
        u = obj.ouvert_par
        if not u:
            return ""
        full = (u.get_full_name() or "").strip()
        return full or u.username

    def get_total_entrees(self, obj):
        v = (
            obj.paiements.aggregate(s=Sum("montant_paye"))["s"] or Decimal("0")
        ).quantize(Decimal("0.01"))
        return str(v)

    def get_total_sorties(self, obj):
        v = (obj.depenses.aggregate(s=Sum("montant"))["s"] or Decimal("0")).quantize(
            Decimal("0.01")
        )
        return str(v)

    def _sum_mouvements_banque(self, obj, mouvement_type: str) -> Decimal:
        q = Decimal("0.01")
        total = Decimal("0")
        for m in obj.mouvements_banque.all():
            if m.type == mouvement_type:
                total += Decimal(m.montant).quantize(q)
        return total.quantize(q)

    def get_total_alimentations_banque(self, obj):
        """Retraits banque → caisse (MouvementBanque.RETRAIT)."""
        return str(self._sum_mouvements_banque(obj, MouvementBanque.Mouvement.RETRAIT))

    def get_total_versements_banque(self, obj):
        """Dépôts caisse → banque (MouvementBanque.VERSEMENT)."""
        return str(self._sum_mouvements_banque(obj, MouvementBanque.Mouvement.VERSEMENT))

    def validate(self, attrs):
        if self.instance is None and SessionCaisse.objects.filter(
            statut=SessionCaisse.Statut.OUVERT
        ).exists():
            raise serializers.ValidationError(
                {"non_field_errors": ["Une session de caisse est déjà ouverte."]}
            )
        if self.instance is None and SessionCaisse.objects.filter(
            versement_promesse_en_attente=True
        ).exists():
            raise serializers.ValidationError(
                {"non_field_errors": [MSG_OUVERTURE_BLOQUEE_JUSTIFICATIF]}
            )
        return attrs


class SessionCaissePromesseJustificatifSerializer(serializers.ModelSerializer):
    """Session fermée avec promesse de justificatif (versement banque) en attente."""

    ouvert_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = SessionCaisse
        fields = (
            "id",
            "date_fermeture",
            "solde_final",
            "montant_report_versement_banque",
            "ouvert_par_nom",
        )
        read_only_fields = fields

    def get_ouvert_par_nom(self, obj):
        u = obj.ouvert_par
        if not u:
            return ""
        full = (u.get_full_name() or "").strip()
        return full or u.username


class MouvementBanqueListeSerializer(serializers.ModelSerializer):
    """Liste complète des mouvements bancaires (GET /api/mouvements-banque/)."""

    montant = serializers.DecimalField(max_digits=12, decimal_places=2, coerce_to_string=True)
    session_caisse_id = serializers.IntegerField(read_only=True)
    justificatif_fichier_url = serializers.SerializerMethodField()
    date_heure_iso = serializers.SerializerMethodField()

    class Meta:
        model = MouvementBanque
        fields = (
            "id",
            "type",
            "montant",
            "date",
            "justificatif_recu",
            "justificatif_fichier_url",
            "session_caisse_id",
            "date_heure_iso",
        )
        read_only_fields = fields

    def get_justificatif_fichier_url(self, obj):
        f = obj.justificatif_file
        if not f:
            return None
        try:
            name = f.name
        except (ValueError, AttributeError):
            return None
        if not name or str(name).strip() == "":
            return None
        request = self.context.get("request")
        url = f.url
        if request:
            try:
                return request.build_absolute_uri(url)
            except DisallowedHost:
                return url
        return url

    def get_date_heure_iso(self, obj):
        d = getattr(obj, "date", None)
        if not d:
            return None
        tz = timezone.get_current_timezone()
        dt_naive = datetime.combine(d, datetime.min.time())
        dt = timezone.make_aware(dt_naive, tz)
        return dt.isoformat()


class MouvementBanquePromesseSerializer(serializers.ModelSerializer):
    """MouvementBanque en attente de justificatif (justificatif_recu=False) avec infos session."""

    date_fermeture = serializers.DateTimeField(
        source="session_caisse.date_fermeture", read_only=True
    )
    solde_final = serializers.DecimalField(
        source="session_caisse.solde_final",
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    montant_report_versement_banque = serializers.DecimalField(
        source="montant",
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    ouvert_par_nom = serializers.SerializerMethodField()

    class Meta:
        model = MouvementBanque
        fields = (
            "id",
            "montant",
            "date_fermeture",
            "solde_final",
            "montant_report_versement_banque",
            "ouvert_par_nom",
        )
        read_only_fields = fields

    def get_ouvert_par_nom(self, obj):
        session = obj.session_caisse
        u = session.ouvert_par if session else None
        if not u:
            return ""
        full = (u.get_full_name() or "").strip()
        return full or u.username


class CalendrierScolaireSerializer(serializers.ModelSerializer):
    type_evenement_label = serializers.CharField(
        source="get_type_evenement_display", read_only=True
    )

    class Meta:
        model = CalendrierScolaire
        fields = (
            "id",
            "nom",
            "date_debut",
            "date_fin",
            "type_evenement",
            "type_evenement_label",
        )
        read_only_fields = ("type_evenement_label",)

    def validate(self, attrs):
        debut = attrs.get("date_debut")
        fin = attrs.get("date_fin")
        if debut is None and self.instance:
            debut = self.instance.date_debut
        if fin is None and self.instance:
            fin = self.instance.date_fin
        if debut and fin and fin < debut:
            raise serializers.ValidationError(
                {"date_fin": "La date de fin doit être postérieure ou égale à la date de début."}
            )
        return attrs
