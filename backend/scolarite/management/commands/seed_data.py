"""
Jeu de donnees realiste pour l'annee scolaire 2025-2026 (cours : 2025-09-15 -> 2026-06-30, calendrier officiel).

- 12 classes, 150 eleves, emploi du temps dense (template hebdo instancie jour par jour,
  T1–T2–T3 + vacances — aligne `academic_trimesters`),
  profils de paiement desordonnes pour tester le tableau de bord.
- Paie : P1 retardataires (pas mars/avril), P2 partiels, P3a bons payeurs (sept-avril),
  P3b a jour jusqu'a mars seulement, P4 annuel ; reliquat FIFO avril cible >= 60 %.

Usage :
  python manage.py seed_data
  python manage.py seed_data --seed 42
"""

from __future__ import annotations

import calendar
import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from scolarite.academic_trimesters import (
    SCHOOL_YEAR_FIRST_DAY,
    SCHOOL_YEAR_LAST_DAY,
    daterange_inclusive,
    is_school_session_day,
    trimestre_for_date,
    VACATION_RANGES_2025_26,
)
from scolarite.models import (
    ACADEMIC_MONTHS,
    AvanceSalaire,
    Classe,
    Depense,
    Eleve,
    EmploiDuTemps,
    Paiement,
    Personnel,
    Pointage,
    Professeur,
)
from scolarite.serializers import ELEVES_MOIS_SCOLAIRES, compute_mois_repartition_valeur
from scolarite.tunisian_setup import format_classe_nom, normalize_eleve_section_for_niveau

User = get_user_model()

SEED_MARK = "[seed_school_year_2025_26]"

YEAR_START = SCHOOL_YEAR_FIRST_DAY
YEAR_END = SCHOOL_YEAR_LAST_DAY

# --- Calendrier 2025-2026 (bornes trimestres + vacances) — aligné sur `academic_trimesters` ---
RENTREE_T1 = date(2025, 9, 15)
FIN_T1 = date(2025, 12, 21)
DEBUT_T2 = date(2026, 1, 5)
FIN_T2 = date(2026, 3, 15)
DEBUT_T3 = date(2026, 3, 30)
FIN_T3 = date(2026, 6, 30)

vacances: list[tuple[date, date]] = [
    (date(2025, 10, 27), date(2025, 11, 2)),  # Mi-T1
    (date(2025, 12, 22), date(2026, 1, 4)),  # Hiver
    (date(2026, 2, 2), date(2026, 2, 8)),  # Mi-T2
    (date(2026, 3, 16), date(2026, 3, 29)),  # Printemps
]

# Garde-fou : les constantes doivent rester synchronisées avec le module (validation EmploiDuTemps, API).
assert (RENTREE_T1, FIN_T3) == (SCHOOL_YEAR_FIRST_DAY, SCHOOL_YEAR_LAST_DAY)
assert vacances == VACATION_RANGES_2025_26, (
    "Mettre a jour en parallele scolarite/academic_trimesters.py (VACATION_RANGES_2025_26)"
)

# Créneaux standardisés (2 h) — densité comparable à 25–30 h / semaine / classe.
SLOTS = [
    (time(8, 0), time(10, 0)),
    (time(10, 0), time(12, 0)),
    (time(14, 0), time(16, 0)),
    (time(16, 0), time(18, 0)),
]

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
]

CLASS_SPECS: list[tuple[str, str, int]] = [
    ("7BASE", "", 1),
    ("8BASE", "", 1),
    ("9BASE", "", 1),
    ("1SEC", "", 1),
    ("2SEC", "SCI_EXP", 1),
    ("2SEC", "MATH", 1),
    ("3SEC", "MATH", 1),
    ("3SEC", "ECO_GEST", 1),
    ("4SEC", "MATH", 1),
    ("4SEC", "SCI_EXP", 1),
    ("2SEC", "LETTRES", 1),
    ("3SEC", "LETTRES", 1),
]

ACADEMIC_MONTH_CODES_ORDER = [code for code, _ in ACADEMIC_MONTHS]
MONTHS_SEPT_FEB = ["09", "10", "11", "12", "01", "02"]
MONTHS_SEPT_APRIL = ["09", "10", "11", "12", "01", "02", "03", "04"]
MONTHS_SEPT_MARCH = ["09", "10", "11", "12", "01", "02", "03"]


def _q(value: Decimal | str | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _academic_month_calendar_date(code: str) -> date:
    c = str(code).zfill(2)
    if c in ("09", "10", "11", "12"):
        y = 2025
    else:
        y = 2026
    return date(y, int(c), 15)


def _random_day_in_month(y: int, m: int, rng: random.Random) -> int:
    _, last = calendar.monthrange(y, m)
    return rng.randint(1, last)


def _encaissement_dt(y: int, m: int, rng: random.Random) -> datetime:
    tz = timezone.get_current_timezone()
    d = _random_day_in_month(y, m, rng)
    h, mi = rng.randint(8, 16), rng.choice([0, 15, 30, 45])
    return timezone.make_aware(datetime(y, m, d, h, mi, 0), tz)


def build_weekly_template(
    classes: list[Classe],
    profs: list[Professeur],
    rng: random.Random,
) -> list[tuple[int, int, int, int]]:
    """
    (jour 0-4, slot 0-3, classe_id, professeur_id). 13–15 h(×2h) / classe / semaine,
    sans double affectation d’un même prof sur le même créneau.
    """
    positions = [(day, si) for day in range(5) for si in range(len(SLOTS))]
    teacher_slot: set[tuple[int, int, int]] = set()
    rows: list[tuple[int, int, int, int]] = []

    class_order = classes[:]
    rng.shuffle(class_order)

    for classe in class_order:
        n_slots = rng.randint(13, 15)
        chosen = rng.sample(positions, n_slots)
        rng.shuffle(chosen)
        for (day, si) in chosen:
            busy_pids = {pid for (pid, dd, ss) in teacher_slot if dd == day and ss == si}
            candidates = [p for p in profs if p.pk not in busy_pids]
            if not candidates:
                candidates = profs[:]
            prof = rng.choice(candidates)
            teacher_slot.add((prof.pk, day, si))
            rows.append((day, si, classe.pk, prof.pk))

    return rows


def expand_templates_to_emplois_by_school_day(
    templates_by_tri: dict[str, list[tuple[int, int, int, int]]],
) -> tuple[list[EmploiDuTemps], int]:
    """
    Pour chaque date du calendrier (RENTREE_T1 -> FIN_T3) :
    - ignore samedi / dimanche (config école : week-end) ;
    - ignore toute plage de `vacances` (délegué à `is_school_session_day`, même source que l’API) ;
    - attache le trimestre T1 / T2 / T3 d’après `trimestre_for_date` (bornes RENTREE_T1…FIN_T3) ;
    - duplique le template hebdo du trimestre sur ce jour (jour_semaine = date).
    """
    emplois: list[EmploiDuTemps] = []
    n_school_days = 0
    for d in daterange_inclusive(RENTREE_T1, FIN_T3):
        if not is_school_session_day(d):
            continue
        tri = trimestre_for_date(d)
        if tri is None:
            continue
        n_school_days += 1
        template = templates_by_tri[tri]
        for day, si, cid, pid in template:
            if int(day) != d.weekday():
                continue
            h0, h1 = SLOTS[si]
            emplois.append(
                EmploiDuTemps(
                    professeur_id=pid,
                    classe_id=cid,
                    trimestre=tri,
                    date_seance=d,
                    jour_semaine=int(day),
                    heure_debut=h0,
                    heure_fin=h1,
                )
            )
    return emplois, n_school_days


def prof_hours_distribution(
    template: list[tuple[int, int, int, int]],
) -> tuple[dict[int, list[float]], dict[int, float]]:
    """
    Heures / jour (lun–ven) par professeur sur la template (one week).
    """
    hours_per_day: dict[int, list[float]] = defaultdict(lambda: [0.0] * 5)
    weekly_total: dict[int, float] = defaultdict(float)
    for day, si, _cid, pid in template:
        h = 2.0
        hours_per_day[pid][day] += h
        weekly_total[pid] += h
    return hours_per_day, weekly_total


def _seed_users() -> None:
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


def _financial_summary(eleves_qs):
    """
    Agrégats après insertion des paiements : dette annuelle, mois 04 (avril), reste global sur lignes.
    """
    total_tm = Decimal("0")
    total_paye = Decimal("0")
    april_face = Decimal("0")
    april_reliquat = Decimal("0")
    total_annuel_du = Decimal("0")
    reste_global_lignes = Decimal("0")
    march_reliquat = Decimal("0")

    for e in eleves_qs.iterator():
        tm = e.tarif_mensuel_total()
        total_tm += tm
        tp = (
            Paiement.objects.filter(eleve=e).aggregate(s=Sum("montant_paye"))["s"] or Decimal("0")
        )
        total_paye += tp
        total_annuel_du += tm * ELEVES_MOIS_SCOLAIRES

        rep = compute_mois_repartition_valeur(tp, tm)
        row04 = next(r for r in rep if r["code"] == "04")
        row03 = next(r for r in rep if r["code"] == "03")
        april_face += tm
        april_reliquat += Decimal(str(row04["reliquat"]))
        march_reliquat += Decimal(str(row03["reliquat"]))

        for p in Paiement.objects.filter(eleve=e):
            reste_global_lignes += p.montant_du - p.montant_paye

    dette_annuelle = (total_annuel_du - total_paye).quantize(Decimal("0.01"))
    if dette_annuelle < 0:
        dette_annuelle = Decimal("0.00")

    ratio_april = (
        (april_reliquat / april_face) if april_face > 0 else Decimal("0")
    )

    return {
        "total_eleves": eleves_qs.count(),
        "tarif_mensuel_somme": total_tm.quantize(Decimal("0.01")),
        "total_paye": total_paye.quantize(Decimal("0.01")),
        "dette_annuelle_estimee": dette_annuelle,
        "avril_potentiel": april_face.quantize(Decimal("0.01")),
        "avril_reliquat_fifo": april_reliquat.quantize(Decimal("0.01")),
        "ratio_avril_impaye": ratio_april,
        "mars_reliquat_fifo": march_reliquat.quantize(Decimal("0.01")),
        "reste_global_sur_lignes": reste_global_lignes.quantize(Decimal("0.01")),
    }


class Command(BaseCommand):
    help = (
        "Données de démo « chaotiques » : EDT dense par template hebdo, paiements multi-profils, "
        "dette scolaire visible sur le tableau de bord."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Graine RNG pour des données reproductibles.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        seed = options["seed"]
        rng = random.Random(seed) if seed is not None else random.Random()

        Pointage.objects.all().delete()
        AvanceSalaire.objects.all().delete()
        Paiement.objects.all().delete()
        EmploiDuTemps.objects.all().delete()
        Eleve.objects.all().delete()
        Professeur.objects.all().delete()
        Personnel.objects.all().delete()
        Depense.objects.all().delete()
        Classe.objects.all().delete()

        # --- Classes ---
        classes: list[Classe] = []
        for niv, sec, ordinal in CLASS_SPECS:
            nom = format_classe_nom(niv, sec, ordinal)
            classes.append(
                Classe(
                    nom=nom,
                    niveau=niv,
                    section=sec,
                    capacite_max=30,
                )
            )
        Classe.objects.bulk_create(classes, batch_size=50)
        classes = list(Classe.objects.order_by("id"))

        # --- Élèves (150) ---
        counts = [13] * 6 + [12] * 6
        rng.shuffle(counts)

        eleves: list[Eleve] = []
        student_idx = 0
        for classe, n_places in zip(classes, counts):
            for _ in range(n_places):
                student_idx += 1
                prenom = rng.choice(PRENOMS)
                nom = rng.choice(NOMS)
                naissance = date.fromordinal(date(2006, 1, 1).toordinal() + (student_idx * 7) % 2800)
                niv = classe.niveau
                sec = normalize_eleve_section_for_niveau(niv, classe.section or "")
                base_phone = 20000000 + student_idx
                tarif_scol = Decimal(f"{280 + (student_idx % 18) * 10}.00")
                tarif_trans = (
                    Decimal(f"{25 + (student_idx % 4) * 5}.00") if student_idx % 3 == 0 else Decimal("0.00")
                )
                tarif_et = (
                    Decimal(f"{15 + (student_idx % 3) * 5}.00") if student_idx % 4 == 0 else Decimal("0.00")
                )
                eleves.append(
                    Eleve(
                        nom=nom,
                        prenom=prenom,
                        nom_parent=f"Parent de {prenom}",
                        telephone_1=f"{base_phone % 100000000:08d}",
                        telephone_2=rng.choice([None, f"{(base_phone + 17) % 100000000:08d}"]),
                        date_naissance=naissance,
                        niveau=niv,
                        classe=classe.nom,
                        section=sec,
                        adresse=f"{rng.randint(1, 120)} rue de la République, Tunis",
                        tarif_scolarite=tarif_scol,
                        tarif_transport=tarif_trans,
                        tarif_etudes=tarif_et,
                        tarif_autre=Decimal("0.00"),
                        description_autre="",
                    )
                )

        Eleve.objects.bulk_create(eleves, batch_size=200)
        Eleve.objects.all().update(date_inscription=YEAR_START)
        eleves = list(Eleve.objects.order_by("id"))

        # --- Professeurs (avant EDT) ---
        embauche_base = date(2017, 9, 1)
        profs: list[Professeur] = []
        for i in range(20):
            profs.append(
                Professeur(
                    nom=rng.choice(NOMS),
                    prenom=rng.choice(PRENOMS),
                    matiere=rng.choice(MATIERES),
                    telephone=f"{(30000000 + i * 137) % 100000000:08d}",
                    tarif_horaire=_q(Decimal(f"{22 + rng.randint(0, 40)}.{rng.randint(0, 99):02d}")),
                    date_embauche=date.fromordinal(embauche_base.toordinal() + (i * 19) % 2400),
                )
            )
        Professeur.objects.bulk_create(profs, batch_size=50)
        profs = list(Professeur.objects.order_by("id"))

        # --- Emploi du temps : 3 templates hebdo (T1/T2/T3), instanciés jour par jour sur l'année ---
        template_t1 = build_weekly_template(classes, profs, rng)
        rng_seed = seed if seed is not None else 0
        template_t2 = build_weekly_template(classes, profs, random.Random(rng_seed + 11))
        template_t3 = build_weekly_template(classes, profs, random.Random(rng_seed + 37))
        templates_by_tri = {"T1": template_t1, "T2": template_t2, "T3": template_t3}
        emplois, n_school_days = expand_templates_to_emplois_by_school_day(templates_by_tri)
        EmploiDuTemps.objects.bulk_create(emplois, batch_size=1500)

        hours_per_day, weekly_total = prof_hours_distribution(template_t1)
        sample_prof_ids = [p.pk for p in profs[:3]]

        # --- Répartition des profils de paiement ---
        shuffled = eleves[:]
        rng.shuffle(shuffled)
        # Cible ~60 %+ du potentiel avril en reliquat FIFO : 46 retardataires + 30 partiels + 15 sans avril,
        # puis 44 bons payeurs avec avril, 15 annuels (= 150).
        p1_retard = shuffled[:46]
        p2_partiel = shuffled[46:76]
        p3_ok_avril = shuffled[76:120]
        p3_sauf_avril = shuffled[120:135]
        p4_annuel = shuffled[135:150]

        methodes = ["ESPECE", "CHEQUE", "VIREMENT"]
        payments_batch: list[Paiement] = []
        enc_dates: list[datetime] = []

        def schedule_payment(
            eleve: Eleve,
            mois_codes: list[str],
            montant_du: Decimal,
            montant_paye: Decimal,
            enc_dt: datetime,
            profil_tag: str,
        ) -> None:
            mois_codes = [str(c).zfill(2) for c in mois_codes]
            mois_concerne = _academic_month_calendar_date(mois_codes[0])
            note = f"{SEED_MARK} profil={profil_tag}"
            payments_batch.append(
                Paiement(
                    eleve=eleve,
                    type_frais="SCOLARITE",
                    montant_du=_q(montant_du),
                    montant_paye=_q(montant_paye),
                    mois_concerne=mois_concerne,
                    mois_concernes=mois_codes,
                    methode=rng.choice(methodes),
                    remarque=note,
                )
            )
            enc_dates.append(enc_dt)

        # P1 — Retardataires : sept–fév payés ; mars et avril sans écriture
        for e in p1_retard:
            T = e.tarif_mensuel_total()
            if T <= 0:
                continue
            for code in MONTHS_SEPT_FEB:
                y, m = (2025, int(code)) if code in ("09", "10", "11", "12") else (2026, int(code))
                enc = _encaissement_dt(y, m, rng)
                schedule_payment(e, [code], T, T, enc, "P1_Retardataire")

        # P2 — Paiements partiels : plusieurs lignes sous-payées, pas d’avril
        for e in p2_partiel:
            T = e.tarif_mensuel_total()
            if T <= 0:
                continue
            ratio_historique = [0.62, 0.71, 0.58, 0.80, 0.55, 0.66]
            for idx, code in enumerate(["09", "10", "11", "12", "01", "02"]):
                r = ratio_historique[idx % len(ratio_historique)]
                du = T
                pay = _q(T * Decimal(str(r)))
                y, m = (2025, int(code)) if code in ("09", "10", "11", "12") else (2026, int(code))
                enc = _encaissement_dt(y, m, rng)
                schedule_payment(e, [code], du, pay, enc, "P2_Partiel")
            enc = _encaissement_dt(2026, 3, rng)
            du = T
            pay = _q(T * Decimal("0.48"))
            schedule_payment(e, ["03"], du, pay, enc, "P2_Partiel")

        # P3a — Bons payeurs : sept–avril inclus (pas mai–juin dans le jeu)
        for e in p3_ok_avril:
            T = e.tarif_mensuel_total()
            if T <= 0:
                continue
            for code in MONTHS_SEPT_APRIL:
                y, m = (2025, int(code)) if code in ("09", "10", "11", "12") else (2026, int(code))
                enc = _encaissement_dt(y, m, rng)
                schedule_payment(e, [code], T, T, enc, "P3_Bon_Payeur_Avril")

        # P3b — « Bons » jusqu’à mars : oublie volontaire d’avril (et au-delà) pour le dashboard
        for e in p3_sauf_avril:
            T = e.tarif_mensuel_total()
            if T <= 0:
                continue
            for code in MONTHS_SEPT_MARCH:
                y, m = (2025, int(code)) if code in ("09", "10", "11", "12") else (2026, int(code))
                enc = _encaissement_dt(y, m, rng)
                schedule_payment(e, [code], T, T, enc, "P3_Sans_Avril")

        # P4 — Annuel : une ligne en septembre (10 mois)
        for e in p4_annuel:
            T = e.tarif_mensuel_total()
            if T <= 0:
                continue
            total_y = _q(T * Decimal("10"))
            codes = [c for c, _ in ACADEMIC_MONTHS]
            enc = _encaissement_dt(2025, 9, rng)
            schedule_payment(e, codes, total_y, total_y, enc, "P4_Annuel")

        created_payments = len(payments_batch)
        for p, enc in zip(payments_batch, enc_dates):
            p.save()
            Paiement.objects.filter(pk=p.pk).update(date_encaissement=enc)

        # --- Personnel & dépenses ---
        roles = [r for r, _ in Personnel.Role.choices]
        personnels: list[Personnel] = []
        for i in range(10):
            personnels.append(
                Personnel(
                    nom=rng.choice(NOMS),
                    prenom=rng.choice(PRENOMS),
                    telephone=f"{(40000000 + i * 211) % 100000000:08d}",
                    adresse=f"{rng.randint(1, 99)} avenue Habib Bourguiba, Tunis",
                    role=rng.choice(roles),
                    salaire_mensuel=_q(Decimal(f"{900 + rng.randint(0, 1200)}.{rng.randint(0, 99):02d}")),
                    date_embauche=date.fromordinal(date(2019, 1, 1).toordinal() + (i * 101) % 2000),
                )
            )
        Personnel.objects.bulk_create(personnels, batch_size=20)

        dep_templates = [
            ("Électricité STEG", Depense.Categorie.FACTURES, (120, 480)),
            ("Eau SONEDE", Depense.Categorie.FACTURES, (40, 120)),
            ("Fournitures scolaires", Depense.Categorie.FOURNITURES, (80, 650)),
            ("Internet / télécom", Depense.Categorie.FACTURES, (45, 95)),
            ("Entretien locaux", Depense.Categorie.ENTRETIEN, (150, 900)),
            ("Loyer local annexe", Depense.Categorie.LOYER, (400, 1200)),
            ("Charges diverses", Depense.Categorie.AUTRE, (30, 400)),
        ]
        depenses: list[Depense] = []
        delta_days = (YEAR_END - YEAR_START).days
        for _ in range(50):
            titre_base, cat, (lo, hi) = rng.choice(dep_templates)
            d0 = YEAR_START + timedelta(days=rng.randint(0, max(delta_days, 1)))
            depenses.append(
                Depense(
                    titre=f"{titre_base} ({d0:%Y-%m-%d})",
                    categorie=cat,
                    montant=_q(Decimal(rng.randint(lo, hi))),
                    date_depense=d0,
                    note=f"{SEED_MARK} {cat}",
                )
            )
        Depense.objects.bulk_create(depenses, batch_size=100)

        _seed_users()

        fin = _financial_summary(Eleve.objects.all())

        self.stdout.write("")
        self.stdout.write(self.style.NOTICE("=== Emploi du temps (3 trimestres x template hebdo) ==="))
        self.stdout.write(
            f"  Calendrier : T1 {RENTREE_T1}–{FIN_T1} | T2 {DEBUT_T2}–{FIN_T2} | T3 {DEBUT_T3}–{FIN_T3}"
        )
        self.stdout.write(
            f"  Plage generation : {RENTREE_T1} -> {FIN_T3} (lun-ven hors {len(vacances)} pauses vacances)"
        )
        self.stdout.write(
            f"  Jours scolaires couverts (hors week-end et vacances) : {n_school_days}"
        )
        self.stdout.write("  Modele par trimestre : 13-15 creneaux x 2 h / classe / semaine (varie T1/T2/T3)")
        self.stdout.write(f"  Lignes EmploiDuTemps generees : {len(emplois)}")
        self.stdout.write("  Exemple charge prof. (heures / jour, lun-ven), sur UNE semaine type :")
        for pid in sample_prof_ids:
            hh = hours_per_day.get(pid, [0.0] * 5)
            total_w = weekly_total.get(pid, 0.0)
            self.stdout.write(
                f"    prof_id={pid} : "
                f"{hh[0]:.0f}h {hh[1]:.0f}h {hh[2]:.0f}h {hh[3]:.0f}h {hh[4]:.0f}h  - total ~ {total_w:.0f} h"
            )

        self.stdout.write("")
        self.stdout.write(self.style.NOTICE("=== Scolarite - profils (150 eleves) ==="))
        self.stdout.write(
            f"  P1 Retardataires (pas mars/avr)     : {len(p1_retard):3d}  (~ 31 %)"
        )
        self.stdout.write(
            f"  P2 Partiels (lignes sous-payees)    : {len(p2_partiel):3d}  (~ 20 %)"
        )
        self.stdout.write(
            f"  P3a Bons payeurs sept-avril          : {len(p3_ok_avril):3d}  (~ 29 %)"
        )
        self.stdout.write(
            f"  P3b A jour jusqu'a mars (avril oubli): {len(p3_sauf_avril):3d}  (~ 10 %)"
        )
        self.stdout.write(
            f"  P4 Annuel (sept., 10 mois)           : {len(p4_annuel):3d}  (~ 10 %)"
        )
        self.stdout.write(
            "  (P3a+P3b: cible ~60 % du potentiel avril en reliquat FIFO, tout en gardant\n"
            "   une masse d'eleves a jour jusqu'a avril pour le realisme.)"
        )

        self.stdout.write("")
        self.stdout.write(
            self.style.NOTICE("=== Dette / dashboard (FIFO mensuel, mois 04 = avril 2026) ===")
        )
        self.stdout.write(f"  Somme des tarifs mensuels (base avril) : {fin['avril_potentiel']} DT")
        self.stdout.write(
            f"  Reliquat avril 2026 (somme reliquats FIFO mois 04) : {fin['avril_reliquat_fifo']} DT"
        )
        self.stdout.write(
            "  Part du potentiel avril encore a recouvrer (FIFO) : "
            f"{(fin['ratio_avril_impaye'] * 100).quantize(Decimal('0.1'))} %"
        )
        self.stdout.write(
            f"  Reliquat mars (mois 03) : {fin['mars_reliquat_fifo']} DT"
        )
        self.stdout.write(
            f"  Dette annuelle estimee (max(0, 10*T - encaissements)) : {fin['dette_annuelle_estimee']} DT"
        )
        self.stdout.write(
            f"  Somme (montant_du - montant_paye) sur les lignes : {fin['reste_global_sur_lignes']} DT"
        )
        self.stdout.write(
            f"  Total encaissements enregistres : {fin['total_paye']} DT"
        )

        ratio_pc = fin["ratio_avril_impaye"] * 100
        if ratio_pc + Decimal("0.0001") < Decimal("60"):
            self.stdout.write(
                self.style.WARNING(
                    "  ATTENTION : part avril a recouvrer < 60 % (FIFO) - verifier les profils."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"  Objectif avril (>= 60 % du potentiel en reliquat FIFO) : OK ({ratio_pc.quantize(Decimal('0.1'))} %)."
                )
            )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"OK - {len(classes)} classes, {fin['total_eleves']} eleves, {len(profs)} professeurs, "
                f"{len(emplois)} seances EDT, {len(personnels)} personnel, {len(depenses)} depenses, "
                f"{created_payments} paiements. Comptes : directrice/directrice123, "
                "pointage/pointage123, comptable/comptable123."
            )
        )
