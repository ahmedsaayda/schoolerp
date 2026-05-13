"""
Efface EmploiDuTemps et Pointage, régénère un emploi du temps cohérent (classes ↔ profs)
et ~60 jours de pointages alignés sur les créneaux.

Usage :
  python manage.py seed_emplois
  python manage.py seed_emplois --seed 42
"""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from scolarite.models import Classe, EmploiDuTemps, Pointage, Professeur

# Lundi (0) … samedi (5) — pas de créneau le dimanche.
JOURS_OUVRE = (0, 1, 2, 3, 4, 5)

# Horaires réalistes (début, fin).
MODELES_HORAIRES: list[tuple[time, time]] = [
    (time(8, 0), time(10, 0)),
    (time(10, 0), time(12, 0)),
    (time(14, 0), time(16, 0)),
    (time(8, 0), time(9, 0)),
    (time(9, 0), time(10, 0)),
    (time(10, 0), time(11, 0)),
    (time(11, 0), time(12, 0)),
    (time(14, 0), time(15, 0)),
    (time(15, 0), time(16, 0)),
    (time(16, 0), time(17, 0)),
]


def _nb_profs_par_classe(nb_total: int) -> int:
    """Entre 3 et 5 profs par classe, sans dépasser l’effectif disponible."""
    low = min(3, nb_total)
    high = min(5, nb_total)
    return random.randint(low, high)


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


class Command(BaseCommand):
    help = (
        "Supprime EmploiDuTemps et Pointage, recree des creneaux (classes / profs) "
        "et des pointages sur les 60 derniers jours, alignes sur l'emploi du temps."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Graine aléatoire (reproductibilité).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["seed"] is not None:
            random.seed(options["seed"])

        profs = list(Professeur.objects.all())
        classes = list(Classe.objects.all())

        if not profs:
            self.stdout.write(
                self.style.ERROR("Aucun professeur en base -- arret (rien n'a ete supprime).")
            )
            return
        if not classes:
            self.stdout.write(
                self.style.ERROR("Aucune classe en base -- arret (rien n'a ete supprime).")
            )
            return

        deleted_pt = Pointage.objects.all().delete()[0]
        deleted_edt = EmploiDuTemps.objects.all().delete()[0]
        self.stdout.write(
            self.style.NOTICE(
                f"Nettoyage : {deleted_edt} creneau(x), {deleted_pt} pointage(s) supprimes."
            )
        )

        pool_creneaux = [
            (jour, h0, h1)
            for jour in JOURS_OUVRE
            for h0, h1 in MODELES_HORAIRES
        ]

        today = timezone.localdate()
        horizon_start = today - timedelta(days=59)
        week_mon = _monday_of(horizon_start)
        emplois: list[EmploiDuTemps] = []
        while week_mon <= today:
            for classe in classes:
                k = _nb_profs_par_classe(len(profs))
                assignes = random.sample(profs, k=k)
                for prof in assignes:
                    n_slots = random.randint(1, 2)
                    n_slots = min(n_slots, len(pool_creneaux))
                    for jour, h_debut, h_fin in random.sample(pool_creneaux, k=n_slots):
                        ds = week_mon + timedelta(days=jour)
                        emplois.append(
                            EmploiDuTemps(
                                professeur=prof,
                                classe=classe,
                                date_seance=ds,
                                jour_semaine=jour,
                                heure_debut=h_debut,
                                heure_fin=h_fin,
                            )
                        )
            week_mon += timedelta(days=7)

        EmploiDuTemps.objects.bulk_create(emplois, batch_size=500)
        self.stdout.write(self.style.SUCCESS(f"EmploiDuTemps crees : {len(emplois)}"))

        by_date: dict[date, list[EmploiDuTemps]] = defaultdict(list)
        for edt in EmploiDuTemps.objects.select_related("professeur", "classe"):
            by_date[edt.date_seance].append(edt)

        pointages: list[Pointage] = []
        for offset in range(60):
            d: date = today - timedelta(days=offset)
            if d.weekday() == 6:
                continue
            mois_courant = (today.year, today.month)
            mois_cours = (d.year, d.month)
            mois_passe = mois_cours < mois_courant

            for edt in by_date.get(d, []):
                duree = round(float(edt.duree_heures), 2)
                statut = random.choices(
                    ("PRESENTE", "ABSENTE"),
                    weights=(0.85, 0.15),
                    k=1,
                )[0]
                est_paye = mois_passe and statut == "PRESENTE"
                pointages.append(
                    Pointage(
                        professeur=edt.professeur,
                        classe=edt.classe,
                        emploi_du_temps=edt,
                        date_cours=d,
                        nombre_heures=Decimal(str(duree)),
                        statut_presence=statut,
                        est_paye=est_paye,
                        remarque=None,
                    )
                )

        Pointage.objects.bulk_create(pointages, batch_size=1000)
        self.stdout.write(
            self.style.SUCCESS(f"Pointages crees : {len(pointages)} (60 jours, lun-sam).")
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Periode : {(today - timedelta(days=59)).isoformat()} -> {today.isoformat()} ; "
                f"est_paye=True uniquement pour mois passes et seances PRESENTE ; "
                f"ABSENTE jamais paye."
            )
        )
