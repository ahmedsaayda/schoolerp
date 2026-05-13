"""
Recopie `mois_concerne` (champ date historique) vers `mois_concernes` (liste de codes MM)
pour les paiements encore sans mois dans le nouveau format.

Usage : python manage.py migrate_legacy_payments [--dry-run]
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from scolarite.models import ACADEMIC_MONTHS, Paiement

_ACADEMIC_CODES = frozenset(code for code, _ in ACADEMIC_MONTHS)


def _month_code_from_legacy(mois_concerne) -> str | None:
    """Retourne « MM » (ex. '09', '04') ou None si non déductible."""
    if mois_concerne is None:
        return None
    if hasattr(mois_concerne, "month"):
        return f"{int(mois_concerne.month):02d}"
    s = str(mois_concerne).strip()
    if len(s) >= 7 and s[4] == "-":
        try:
            mm = int(s[5:7])
            if 1 <= mm <= 12:
                return f"{mm:02d}"
        except ValueError:
            return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            mm = int(s[5:7])
            if 1 <= mm <= 12:
                return f"{mm:02d}"
        except ValueError:
            return None
    return None


class Command(BaseCommand):
    help = (
        "Migre les paiements : remplit mois_concernes à partir de mois_concerne "
        "lorsque la liste JSON est vide et que la date historique est renseignée."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche les compteurs sans enregistrer en base.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        candidates = Paiement.objects.filter(mois_concerne__isnull=False).order_by("id")
        to_update: list[Paiement] = []
        skipped_already_new = 0
        skipped_no_academic_month = 0

        for p in candidates.iterator(chunk_size=500):
            raw_list = p.mois_concernes
            if raw_list is not None and len(raw_list) > 0:
                skipped_already_new += 1
                continue

            code = _month_code_from_legacy(p.mois_concerne)
            if code is None or code not in _ACADEMIC_CODES:
                skipped_no_academic_month += 1
                continue

            p.mois_concernes = [code]
            to_update.append(p)

        migrated = len(to_update)

        if not dry_run and to_update:
            with transaction.atomic():
                Paiement.objects.bulk_update(to_update, ["mois_concernes"], batch_size=500)

        self.stdout.write(
            self.style.SUCCESS(
                f"Migrés vers mois_concernes : {migrated} paiement(s) "
                f"(ignorés déjà renseignés : {skipped_already_new}, "
                f"hors mois scolaires sept.–juin : {skipped_no_academic_month})."
            )
        )
        if dry_run:
            self.stdout.write(self.style.WARNING("Mode --dry-run : aucune écriture en base."))
