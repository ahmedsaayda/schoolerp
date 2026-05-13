"""
Réinitialise le référentiel des classes selon le système tunisien, puis répartit les élèves
(jusqu’à 30 par classe, création automatique de groupes supplémentaires).

Les données élèves (hors affectation classe/niveau/section) sont conservées.
Les créneaux d’emploi du temps sont détachés des classes (FK mise à NULL) pour éviter les CASCADE.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from scolarite.models import Classe
from scolarite.tunisian_setup import (
    CAPACITE_CLASSE_DEFAUT,
    clear_emploi_classe_links,
    create_bootstrap_classes,
    redistribute_all_eleves,
)


class Command(BaseCommand):
    help = (
        "Supprime toutes les classes, recrée le squelette tunisien, répartit les élèves (max 30 / classe)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--capacity",
            type=int,
            default=CAPACITE_CLASSE_DEFAUT,
            help=f"Effectif max par classe (défaut : {CAPACITE_CLASSE_DEFAUT}).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche le plan sans écrire en base.",
        )

    def handle(self, *args, **options):
        cap = int(options["capacity"] or CAPACITE_CLASSE_DEFAUT)
        if cap < 1:
            self.stderr.write(self.style.ERROR("capacity doit être ≥ 1."))
            return
        dry = options["dry_run"]

        n_classes = Classe.objects.count()
        if dry:
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] Supprimerait {n_classes} classe(s), recréerait le squelette tunisien, "
                    f"répartirait les élèves (cap={cap})."
                )
            )
            return

        with transaction.atomic():
            clear_emploi_classe_links()
            Classe.objects.all().delete()
            create_bootstrap_classes(capacity=cap)
            redistribute_all_eleves(capacity=cap)

        self.stdout.write(
            self.style.SUCCESS(
                f"OK — référentiel tunisien appliqué, classes en base : {Classe.objects.count()}, "
                f"capacité {cap}."
            )
        )
