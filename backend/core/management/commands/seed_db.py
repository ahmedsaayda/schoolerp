"""
Remplissage de la base (classes, élèves, professeurs et emploi du temps de démonstration).
Efface pointages, avances, emplois du temps, professeurs, élèves et classes puis recrée les données.
Crée ou met à jour trois comptes de test : administrateur, agent de pointage, comptable.
"""

from __future__ import annotations

import random
from datetime import date, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.utils import timezone

from scolarite.models import (
    AvanceSalaire,
    Classe,
    Eleve,
    EmploiDuTemps,
    NIVEAU_CHOICES,
    SECONDARY_SECTION_CHOICES,
    TRONC_NIVEAU_CODES,
    Pointage,
    Professeur,
)
from scolarite.tunisian_setup import create_bootstrap_classes, redistribute_all_eleves

User = get_user_model()

PRENOMS = [
    "Marie",
    "Jean",
    "Pierre",
    "Sophie",
    "Lucas",
    "Emma",
    "Léa",
    "Hugo",
    "Chloé",
    "Nathan",
    "Manon",
    "Louis",
    "Camille",
    "Thomas",
    "Julie",
    "Antoine",
    "Sarah",
    "Maxime",
    "Clara",
    "Paul",
    "Inès",
    "Gabriel",
    "Élise",
    "Nicolas",
    "Laura",
    "Alexandre",
    "Julien",
    "Anaïs",
    "Romain",
    "Margot",
    "Valentin",
    "Élodie",
    "Benjamin",
    "Océane",
    "Florian",
    "Pauline",
]

NOMS = [
    "Martin",
    "Bernard",
    "Dubois",
    "Thomas",
    "Robert",
    "Richard",
    "Petit",
    "Durand",
    "Leroy",
    "Moreau",
    "Simon",
    "Laurent",
    "Lefebvre",
    "Michel",
    "Garcia",
    "David",
    "Bertrand",
    "Roux",
    "Vincent",
    "Fournier",
    "Girard",
    "Bonnet",
    "Dupont",
    "Lambert",
    "Fontaine",
    "Rousseau",
    "Blanc",
    "Guerin",
    "Muller",
    "Henry",
    "Roussel",
    "Nicolas",
    "Perrot",
    "Morin",
    "Mathieu",
    "Clement",
    "Gauthier",
    "Dumont",
    "Lopez",
]

MATIERES = [
    "Mathématiques",
    "Physique-Chimie",
    "SVT",
    "Français",
    "Anglais",
    "Espagnol",
    "Histoire-Géographie",
    "Philosophie",
    "Économie",
    "Arts plastiques",
    "Musique",
    "EPS",
    "Sciences de l'ingénieur",
    "Latin",
    "Allemand",
    "Informatique",
    "Sciences numériques",
    "Littérature",
    "Culture générale",
]

# Créneaux standardisés d’1 h (matin + soir) — duree_heures = 1.0 pour chaque paire.
CRENEAUX = [
    # Matin
    (time(8, 0), time(9, 0)),
    (time(9, 0), time(10, 0)),
    (time(10, 0), time(11, 0)),
    (time(11, 0), time(12, 0)),
    # Soir
    (time(14, 0), time(15, 0)),
    (time(15, 0), time(16, 0)),
    (time(16, 0), time(17, 0)),
    (time(17, 0), time(18, 0)),
]


class Command(BaseCommand):
    help = (
        "Efface élèves, classes, professeurs et données associées ; recrée la démo et les comptes test."
    )

    def handle(self, *args, **kwargs):
        random.seed()

        def seed_users() -> None:
            """Comptes de test : ADMIN (tout), POINTAGE_AGENT, COMPTABLE."""
            ct = ContentType.objects.get_for_model(User)
            fin = Permission.objects.get(content_type=ct, codename="view_financial_reports")
            audit = Permission.objects.get(content_type=ct, codename="view_audit_logs")

            admin_user, _ = User.objects.update_or_create(
                username="directrice",
                defaults={
                    "email": "directrice@erp.local",
                    "first_name": "Claire",
                    "last_name": "Administrateur",
                    "role": User.Role.ADMIN,
                    "is_staff": True,
                    "is_superuser": False,
                },
            )
            admin_user.set_password("directrice123")
            admin_user.save()
            admin_user.user_permissions.add(fin, audit)

            pointage, _ = User.objects.update_or_create(
                username="pointage",
                defaults={
                    "email": "pointage@erp.local",
                    "first_name": "Samir",
                    "last_name": "Pointage",
                    "role": User.Role.POINTAGE_AGENT,
                    "is_staff": True,
                    "is_superuser": False,
                },
            )
            pointage.set_password("pointage123")
            pointage.save()
            pointage.user_permissions.remove(fin, audit)

            comptable, _ = User.objects.update_or_create(
                username="comptable",
                defaults={
                    "email": "comptable@erp.local",
                    "first_name": "Nadia",
                    "last_name": "Compta",
                    "role": User.Role.COMPTABLE,
                    "is_staff": True,
                    "is_superuser": False,
                },
            )
            comptable.set_password("comptable123")
            comptable.save()
            comptable.user_permissions.add(fin)
            comptable.user_permissions.remove(audit)

        Pointage.objects.all().delete()
        AvanceSalaire.objects.all().delete()
        EmploiDuTemps.objects.all().delete()
        Professeur.objects.all().delete()

        Eleve.objects.all().delete()
        Classe.objects.all().delete()

        create_bootstrap_classes()
        classes = list(Classe.objects.order_by("id"))
        secondary_sections = [c for c, _ in SECONDARY_SECTION_CHOICES]
        niveau_codes = [c for c, _ in NIVEAU_CHOICES]

        eleves: list[Eleve] = []
        for i in range(650):
            prenom = random.choice(PRENOMS)
            nom = random.choice(NOMS)
            naissance = date.fromordinal(date(2006, 1, 1).toordinal() + (i % 3000))
            niv = random.choice(niveau_codes)
            sec = "" if niv in TRONC_NIVEAU_CODES else random.choice(secondary_sections)
            eleves.append(
                Eleve(
                    nom=nom,
                    prenom=prenom,
                    nom_parent=f"Parent de {prenom}",
                    telephone_1=f"{random.randint(10000000, 99999999):08d}",
                    telephone_2=random.choice([None, f"{random.randint(10000000, 99999999):08d}"]),
                    date_naissance=naissance,
                    niveau=niv,
                    classe="—",
                    section=sec,
                    adresse=f"{random.randint(1, 120)} rue Démonstration, 7500{i % 10} Paris",
                    tarif_scolarite=Decimal(f"{320 + (i % 15) * 10}.00"),
                    tarif_transport=Decimal(f"{20 + (i % 3) * 5}.00") if i % 4 == 0 else Decimal("0.00"),
                    tarif_etudes=Decimal(f"{10 + (i % 2) * 5}.00") if i % 5 == 0 else Decimal("0.00"),
                    tarif_autre=Decimal("0.00"),
                    description_autre="",
                    date_inscription=timezone.now().date(),
                )
            )

        Eleve.objects.bulk_create(eleves, batch_size=200)
        redistribute_all_eleves()
        classes = list(Classe.objects.order_by("id"))

        professeurs: list[Professeur] = []
        embauche_base = date(2018, 9, 1)
        for i in range(30):
            prenom = random.choice(PRENOMS)
            nom = random.choice(NOMS)
            professeurs.append(
                Professeur(
                    nom=nom,
                    prenom=prenom,
                    matiere=random.choice(MATIERES),
                    telephone=f"{random.randint(10000000, 99999999):08d}",
                    tarif_horaire=Decimal(f"{25 + random.randint(0, 35)}.{random.randint(0, 99):02d}"),
                    date_embauche=date.fromordinal(embauche_base.toordinal() + (i * 17) % 2000),
                )
            )
        Professeur.objects.bulk_create(professeurs, batch_size=50)

        created_profs = list(Professeur.objects.order_by("id"))
        emplois: list[EmploiDuTemps] = []
        anchor_lundi = date(2024, 9, 2)
        for prof in created_profs:
            n_slots = random.randint(2, 4)
            jours = random.sample(range(7), k=n_slots)
            for jour in jours:
                h_debut, h_fin = random.choice(CRENEAUX)
                emplois.append(
                    EmploiDuTemps(
                        professeur=prof,
                        classe=random.choice(classes),
                        date_seance=anchor_lundi + timedelta(days=jour),
                        jour_semaine=jour,
                        heure_debut=h_debut,
                        heure_fin=h_fin,
                    )
                )
        EmploiDuTemps.objects.bulk_create(emplois, batch_size=100)

        seed_users()

        self.stdout.write(
            self.style.SUCCESS(
                f"OK — {len(classes)} classes, {len(eleves)} élèves, {len(created_profs)} professeurs "
                f"({len(emplois)} créneaux emploi du temps). "
                "Comptes : directrice / directrice123 (ADMIN), pointage / pointage123 (POINTAGE_AGENT), "
                "comptable / comptable123 (COMPTABLE)."
            )
        )
