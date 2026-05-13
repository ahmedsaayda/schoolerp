from __future__ import annotations

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .finance_eleve import refresh_eleve_acompte
from .models import Depense, Eleve, Paiement, SessionCaisse


def _refresh_session_solde(session_pk):
    if not session_pk:
        return
    s = SessionCaisse.objects.filter(pk=session_pk).first()
    if s:
        s.refresh_solde_actuel()


@receiver(post_save, sender=Paiement)
def paiement_changed_refresh_acompte(sender, instance, **kwargs):
    refresh_eleve_acompte(instance.eleve_id)


@receiver(post_save, sender=Paiement)
def paiement_changed_refresh_session_solde(sender, instance, **kwargs):
    _refresh_session_solde(instance.session_caisse_id)


@receiver(post_delete, sender=Paiement)
def paiement_deleted_refresh_acompte(sender, instance, **kwargs):
    refresh_eleve_acompte(instance.eleve_id)


@receiver(post_delete, sender=Paiement)
def paiement_deleted_refresh_session_solde(sender, instance, **kwargs):
    _refresh_session_solde(instance.session_caisse_id)


@receiver(post_save, sender=Depense)
def depense_changed_refresh_session_solde(sender, instance, **kwargs):
    _refresh_session_solde(instance.session_caisse_id)


@receiver(post_delete, sender=Depense)
def depense_deleted_refresh_session_solde(sender, instance, **kwargs):
    _refresh_session_solde(instance.session_caisse_id)


@receiver(post_save, sender=Eleve)
def eleve_tarifs_changed_refresh_acompte(sender, instance, **kwargs):
    """Frais modifiés : le montant dû annuel change, le solde doit suivre."""
    refresh_eleve_acompte(instance.pk)
