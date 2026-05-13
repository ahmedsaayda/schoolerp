"""
Génère un emploi du temps réaliste (EmploiDuTemps) et des pointages historiques (avril–mai).

Efface tous les EmploiDuTemps et Pointage existants, puis recrée des données à partir des
Professeur et Classe déjà présents en base (aucun audit : créations en bulk / ORM direct).
"""

from __future__ import annotations

import random
from datetime import date, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand

from scolarite.models import Classe, EmploiDuTemps, Pointage, Professeur

# Lundi (0) à Samedi (5), aligné sur EmploiDuTemps.jour_semaine et date.weekday().
STANDARD_DAYS = [0, 1, 2, 3, 4, 5]

STANDARD_SLOTS: list[tuple[time, time]] = [
    (time(8, 0), time(9, 0)),
    (time(9, 0), time(10, 0)),
    (time(10, 0), time(11, 0)),
    (time(11, 0), time(12, 0)),
    (time(14, 0), time(15, 0)),
    (time(15, 0), time(16, 0)),
    (time(16, 0), time(17, 0)),
    (time(17, 0), time(18, 0)),
]

STATUT_WEIGHTS = ("PRESENTE", "ABSENTE", "RETARD")
STATUT_P = (0.85, 0.10, 0.05)

PERIOD_START = date(2026, 4, 1)
PERIOD_END = date(2026, 5, 31)


def _monday_on_or_after(d: date) -> date:
    return d - timedelta(days=d.weekday())


class Command(BaseCommand):
    help = (
        "Supprime EmploiDuTemps et Pointage, puis génère des créneaux par classe "
        "et des pointages pour avril–mai 2026."
    )

    def handle(self, *args, **options):
        profs = list(Professeur.objects.all())
        classes = list(Classe.objects.all())

        if not profs:
            self.stdout.write(self.style.WARNING("Aucun professeur en base -- arret."))
            return
        if not classes:
            self.stdout.write(self.style.WARNING("Aucune classe en base -- arret."))
            return

        deleted_pt = Pointage.objects.all().delete()[0]
        deleted_edt = EmploiDuTemps.objects.all().delete()[0]
        self.stdout.write(
            self.style.NOTICE(
                f"Nettoyage : {deleted_edt} emploi(s) du temps, {deleted_pt} pointage(s) supprimes."
            )
        )

        all_pairs: list[tuple[int, int]] = [
            (jour, slot_idx) for jour in STANDARD_DAYS for slot_idx in range(len(STANDARD_SLOTS))
        ]

        emplois: list[EmploiDuTemps] = []
        week_mon = _monday_on_or_after(PERIOD_START)
        while week_mon <= PERIOD_END:
            for classe in classes:
                n_sessions = random.randint(15, 20)
                n_sessions = min(n_sessions, len(all_pairs))
                for jour, slot_idx in random.sample(all_pairs, n_sessions):
                    h_debut, h_fin = STANDARD_SLOTS[slot_idx]
                    ds = week_mon + timedelta(days=jour)
                    if ds < PERIOD_START or ds > PERIOD_END:
                        continue
                    emplois.append(
                        EmploiDuTemps(
                            professeur=random.choice(profs),
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

        pointages: list[Pointage] = []
        for edt in EmploiDuTemps.objects.select_related("professeur", "classe"):
            d = edt.date_seance
            if d < PERIOD_START or d > PERIOD_END:
                continue
            statut = random.choices(STATUT_WEIGHTS, weights=STATUT_P, k=1)[0]
            nh = Decimal(str(round(edt.duree_heures, 2)))
            pointages.append(
                Pointage(
                    professeur=edt.professeur,
                    classe=edt.classe,
                    emploi_du_temps=edt,
                    date_cours=d,
                    nombre_heures=nh,
                    statut_presence=statut,
                    est_paye=False,
                    remarque=None,
                )
            )

        Pointage.objects.bulk_create(pointages, batch_size=1000)
        self.stdout.write(self.style.SUCCESS(f"Pointages crees : {len(pointages)}"))
        self.stdout.write(
            self.style.SUCCESS(
                f"OK -- periode pointages : {PERIOD_START.isoformat()} -> {PERIOD_END.isoformat()} "
                f"(dimanches exclus)."
            )
        )
