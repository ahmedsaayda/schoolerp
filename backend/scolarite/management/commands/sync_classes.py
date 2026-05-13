from django.core.management.base import BaseCommand
from django.db import transaction

from scolarite.models import Classe, Eleve
from scolarite.tunisian_setup import infer_niveau_code_from_classe_nom, normalize_eleve_section_for_niveau


class Command(BaseCommand):
    help = (
        "Crée ou met à jour les enregistrements Classe à partir des couples distincts "
        "(classe, section, niveau déduit) des élèves."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche ce qui serait fait sans écrire en base.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        distinct_qs = Eleve.objects.values("classe", "section", "niveau").distinct().order_by("classe", "section")

        created_count = 0
        updated_count = 0
        skipped = 0
        planned = []

        for item in distinct_qs:
            nom_classe = item.get("classe")
            if nom_classe is None:
                skipped += 1
                continue
            nom_classe = str(nom_classe).strip()
            if not nom_classe:
                skipped += 1
                continue

            niv_raw = item.get("niveau")
            niveau = (str(niv_raw).strip() if niv_raw else "") or infer_niveau_code_from_classe_nom(nom_classe)
            section_eleve = normalize_eleve_section_for_niveau(niveau, item.get("section"))

            planned.append((nom_classe, section_eleve, niveau))

            if dry_run:
                self.stdout.write(f"  [dry-run] {nom_classe!r} | section={section_eleve!r} | niveau={niveau!r}")
                continue

            with transaction.atomic():
                _, created = Classe.objects.update_or_create(
                    nom=nom_classe,
                    section=section_eleve,
                    defaults={"niveau": niveau},
                )
            if created:
                created_count += 1
            else:
                updated_count += 1

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"Mode dry-run : {len(planned)} classe(s) distincte(s) "
                    f"(lignes élèves ignorées sans nom de classe : {skipped})."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Synchro terminée : {created_count} classe(s) créée(s), "
                f"{updated_count} mise(s) à jour, {skipped} ligne(s) élève ignorée(s) (classe vide)."
            )
        )
