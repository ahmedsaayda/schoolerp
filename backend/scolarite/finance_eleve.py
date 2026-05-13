"""Calcul et mise à jour du solde financier annuel élève (acompte signé)."""

from __future__ import annotations

from decimal import Decimal

from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce

from .models import Eleve, Paiement

# Aligné sur serializers.ELEVES_MOIS_SCOLAIRES — année sept. → juin.
_ELEVES_MOIS_SCOLAIRES = Decimal("10")
_DEC2 = DecimalField(max_digits=14, decimal_places=2)


def compute_acompte_value(eleve: Eleve) -> Decimal:
    """
    Acompte (solde signé) = Σ montants payés − frais annuels dus (tarif mensuel total × 10).
    Positif : crédit (acompte) ; négatif : reste à payer sur l’année.
    """
    tp = Paiement.objects.filter(eleve=eleve).aggregate(
        s=Coalesce(Sum("montant_paye"), Value(Decimal("0"), output_field=_DEC2))
    )["s"]
    if tp is None:
        tp = Decimal("0")
    due = eleve.tarif_mensuel_total() * _ELEVES_MOIS_SCOLAIRES
    return (tp - due).quantize(Decimal("0.01"))


def refresh_eleve_acompte(eleve_id: int) -> None:
    """Recalcule et enregistre `Eleve.acompte` (update SQL, sans re-déclencher post_save)."""
    eleve = Eleve.objects.filter(pk=eleve_id).first()
    if eleve is None:
        return
    val = compute_acompte_value(eleve)
    Eleve.objects.filter(pk=eleve_id).update(acompte=val)
