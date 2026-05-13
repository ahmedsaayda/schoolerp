"""
Données financières de démonstration (6 mois glissants jusqu'à aujourd'hui).

- Paiements : mois passés 85–90 % des élèves à jour ; mois courant ~40 %.
- Dépenses : 5 mois précédents (loyer + factures) ; mois courant : Internet seulement.
- Pointages : mois passés marqués payés ; mois courant non payés (salaires profs « dus »).

Usage :
  python manage.py seed_financials
  python manage.py seed_financials --clear
  python manage.py seed_financials --seed 42 --no-payroll
"""

from __future__ import annotations

import calendar
import random
from datetime import date, datetime, time as dt_time
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from scolarite.models import Depense, Eleve, Paiement, Pointage


SEED_MARK = "[seed_financials]"


def _months_window_six(today: date) -> list[tuple[int, int]]:
    """Six mois calendaires, du plus ancien au plus récent (inclut le mois courant)."""
    y, m = today.year, today.month
    ordered: list[tuple[int, int]] = []
    for _ in range(6):
        ordered.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    ordered.reverse()
    return ordered


def _month_bill_months(months_six: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Cinq mois pleins avant le mois courant (pour loyer / factures)."""
    if len(months_six) < 2:
        return []
    prior = months_six[:-1]
    return prior[-5:] if len(prior) > 5 else prior


def _random_day_in_month(year: int, month: int, rng: random.Random) -> int:
    _, last = calendar.monthrange(year, month)
    return rng.randint(1, min(28, last))


class Command(BaseCommand):
    help = (
        "Génère paiements, dépenses et état de paie des pointages pour visualiser le tableau de bord."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help=f"Affiche le nombre d'enregistrements seed supprimés avant régénération (la commande est toujours idempotente).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Graine RNG pour des données reproductibles.",
        )
        parser.add_argument(
            "--no-payroll",
            action="store_true",
            help="Ne pas modifier Pointage.est_paye (personnel sans modèle de paie : inchangé).",
        )

    def handle(self, *args, **options):
        clear = options["clear"]
        seed = options["seed"]
        no_payroll = options["no_payroll"]

        rng = random.Random(seed) if seed is not None else random.Random()

        today = timezone.localdate()
        tz = timezone.get_current_timezone()
        months_six = _months_window_six(today)
        current_key = (today.year, today.month)
        eleves = list(Eleve.objects.all())
        if not eleves:
            self.stderr.write(self.style.WARNING("Aucun élève en base : aucun paiement créé."))

        with transaction.atomic():
            n_p = Paiement.objects.filter(remarque=SEED_MARK).delete()[0]
            n_d = Depense.objects.filter(note__icontains=SEED_MARK).delete()[0]
            if clear and (n_p or n_d):
                self.stdout.write(
                    self.style.NOTICE(f"Ancienne donnée seed retirée : {n_p} paiements, {n_d} dépenses.")
                )

            payments_created = 0

            for y, m in months_six:
                is_current = (y, m) == current_key
                if is_current:
                    ratio = 0.40
                else:
                    ratio = rng.uniform(0.85, 0.90)

                n_pay = int(round(len(eleves) * ratio))
                pay_set = set(rng.sample(range(len(eleves)), min(n_pay, len(eleves)))) if eleves else set()

                for idx in pay_set:
                    e = eleves[idx]
                    due = e.tarif_mensuel_total()
                    if due <= 0:
                        continue
                    day = _random_day_in_month(y, m, rng)
                    enc = timezone.make_aware(
                        datetime.combine(date(y, m, day), dt_time(10, 30, 0)),
                        tz,
                    )
                    code = f"{m:02d}"
                    p = Paiement.objects.create(
                        eleve=e,
                        type_frais="SCOLARITE",
                        montant_du=due,
                        montant_paye=due,
                        mois_concerne=date(y, m, day),
                        mois_concernes=[code],
                        methode="ESPECE",
                        remarque=SEED_MARK,
                    )
                    Paiement.objects.filter(pk=p.pk).update(date_encaissement=enc)
                    payments_created += 1

            dep_to_create: list[Depense] = []
            note_suffix = f" — {SEED_MARK}"

            for y, m in _month_bill_months(months_six):
                dep_to_create.append(
                    Depense(
                        titre=f"Loyer {m:02d}/{y}",
                        categorie=Depense.Categorie.LOYER,
                        montant=Decimal("1500.00"),
                        date_depense=date(y, m, 5),
                        note=f"Loyer mensuel{note_suffix}",
                    )
                )
                dep_to_create.append(
                    Depense(
                        titre=f"STEG {m:02d}/{y}",
                        categorie=Depense.Categorie.FACTURES,
                        montant=Decimal("350.00"),
                        date_depense=date(y, m, 8),
                        note=f"Électricité STEG{note_suffix}",
                    )
                )
                dep_to_create.append(
                    Depense(
                        titre=f"SONEDE {m:02d}/{y}",
                        categorie=Depense.Categorie.FACTURES,
                        montant=Decimal("80.00"),
                        date_depense=date(y, m, 10),
                        note=f"Eau SONEDE{note_suffix}",
                    )
                )
                dep_to_create.append(
                    Depense(
                        titre=f"Internet {m:02d}/{y}",
                        categorie=Depense.Categorie.FACTURES,
                        montant=Decimal("50.00"),
                        date_depense=date(y, m, 12),
                        note=f"Fournisseur Internet{note_suffix}",
                    )
                )

            cy, cm = current_key
            dep_to_create.append(
                Depense(
                    titre=f"Internet {cm:02d}/{cy}",
                    categorie=Depense.Categorie.FACTURES,
                    montant=Decimal("50.00"),
                    date_depense=date(cy, cm, min(today.day, 28)),
                    note=f"Internet (mois en cours){note_suffix}",
                )
            )

            Depense.objects.bulk_create(dep_to_create)

            if not no_payroll:
                debut_mois = today.replace(day=1)
                Pointage.objects.filter(date_cours__gte=debut_mois).update(est_paye=False)
                Pointage.objects.filter(
                    date_cours__lt=debut_mois,
                    statut_presence="PRESENTE",
                ).update(est_paye=True)
                Pointage.objects.filter(date_cours__lt=debut_mois).exclude(
                    statut_presence="PRESENTE"
                ).update(est_paye=False)
                self.stdout.write(
                    self.style.NOTICE(
                        "Pointages : mois passés PRESENTE marqués payés ; absences / mois courant non payés "
                        "(personnel : pas de modèle de versement, inchangé)."
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"OK — {payments_created} paiements, {len(dep_to_create)} dépenses "
                f"(mois facturation : {len(_month_bill_months(months_six))} mois complets + internet courant)."
            )
        )
