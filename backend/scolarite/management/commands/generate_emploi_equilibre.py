"""
Génère un emploi du temps complet (modèle `EmploiDuTemps` — l’UI « calendrier » s’en sert)
pour toutes les classes, avec distribution équilibrée des heures entre les `Professeur`.

Règles pédagogiques
-------------------
- Lundi–vendredi : matin 08:00–12:00, après-midi 14:00–18:00, créneaux de **2 h** (4 matin + 2 soir = 6 / jour).
- Samedi : **matin seulement** (2 créneaux de 2 h).
- Dimanche : pas de cours.

Note: ce projet relie les enseignants via `Professeur`, pas `Personnel` (pas de rôle
« Enseignant » sur le modèle actuel) ; cette commande travaille donc sur `Professeur`.

Avant exécution, les lignes `EmploiDuTemps` du trimestre cible sont supprimées (évite doublons).

Usage
-----
  python manage.py generate_emploi_equilibre
  python manage.py generate_emploi_equilibre --trimestre T2
  python manage.py generate_emploi_equilibre --dry-run
"""

from __future__ import annotations

from datetime import time
from typing import Iterable

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from scolarite.academic_trimesters import (
    ANNEE_SCOLAIRE_OFFICIELLE_DEBUT,
    daterange_inclusive,
    trimestre_date_range,
    trimestre_for_date,
    trimestre_period_containing_date,
)
from scolarite.models import Classe, EmploiDuTemps, Professeur

# Matières tournantes (libellés affichés) — les profs sont affectés d’abord sur la correspondance
# avec `Professeur.matiere`, sinon charge horaire la plus basse.
DEFAULT_SUBJECTS: tuple[str, ...] = (
    "Mathématiques",
    "Arabe",
    "Français",
    "Anglais",
    "Sciences de la vie et de la Terre",
    "Physique-Chimie",
    "Histoire-Géographie",
    "Éducation physique",
    "Informatique",
    "Arts plastiques",
    "Sciences islamiques",
    "Philosophie",
)

MORNING_2H: tuple[tuple[time, time], ...] = (
    (time(8, 0), time(10, 0)),
    (time(10, 0), time(12, 0)),
)
AFTERNOON_2H: tuple[tuple[time, time], ...] = (
    (time(14, 0), time(16, 0)),
    (time(16, 0), time(18, 0)),
)


def _norm_label(s: str) -> str:
    t = (s or "").lower().strip()
    for a, b in (("é", "e"), ("è", "e"), ("ê", "e"), ("à", "a"), ("ù", "u"), ("ç", "c"), ("î", "i")):
        t = t.replace(a, b)
    return t


def _match_subject_matiere(prof: Professeur, matiere_affichee: str) -> bool:
    m = _norm_label(prof.matiere)
    s = _norm_label(matiere_affichee)
    if not s or not m:
        return False
    if s in m or m in s:
        return True
    return any(len(tok) > 2 and tok in m for tok in s.replace("-", " ").split())


def _iter_template_slots() -> Iterable[tuple[int, time, time]]:
    """(jour_semaine 0–5, heure_début, heure_fin). Samedi = matin uniquement."""
    for dow in (0, 1, 2, 3, 4):
        for t0, t1 in MORNING_2H + AFTERNOON_2H:
            yield (dow, t0, t1)
    for t0, t1 in MORNING_2H:
        yield (5, t0, t1)


def _default_trimestre_from_today() -> str:
    t = trimestre_period_containing_date(timezone.localdate())
    if t is not None:
        return t[0]
    return "T1"


def _build_weekly_grid(
    classes: list[Classe],
    profs: list[Professeur],
    subjects: tuple[str, ...],
) -> dict[tuple[int, int, time, time], tuple[Professeur, str]]:
    """
    Pour chaque créneau hebdo, affecte un prof par classe, sans conflit (un prof
    n’est pas sur deux classes au même moment).
    """
    n_c = len(classes)
    n_p = len(profs)
    if n_c == 0:
        raise CommandError("Aucune classe en base. Créez des classes d’abord.")
    if n_p == 0:
        raise CommandError("Aucun professeur en base. Créez des Professeur d’abord.")
    if n_c > n_p:
        raise CommandError(
            f"Contrainte: à chaque créneau, chaque classe a besoin d’un enseignant distinct "
            f"({n_c} classes, {n_p} professeurs). Ajoutez des profs ou supprimez des classes."
        )

    profs_sorted = sorted(profs, key=lambda p: p.pk)
    classes_sorted = sorted(classes, key=lambda c: c.pk)
    loads: dict[int, float] = {p.pk: 0.0 for p in profs_sorted}
    grid: dict[tuple[int, int, time, time], tuple[Professeur, str]] = {}
    slot_i = 0
    n_sub = max(1, len(subjects))

    for dow, t0, t1 in _iter_template_slots():
        used_ids: set[int] = set()
        for c in classes_sorted:
            subj = subjects[(c.pk * 5 + slot_i * 11) % n_sub]
            available = [p for p in profs_sorted if p.id not in used_ids]
            if not available:
                raise CommandError("Échec affectation: créneau saturé (bug interne).")
            # Priorité: équilibrage de charge (heures), puis correspondance matière, puis id stable.
            def sort_key(p: Professeur) -> tuple[float, int, int]:
                match = 0 if _match_subject_matiere(p, subj) else 1
                return (loads[p.id], match, p.pk)

            available.sort(key=sort_key)
            choice = available[0]
            loads[choice.id] += 2.0
            used_ids.add(choice.id)
            grid[(c.pk, dow, t0, t1)] = (choice, subj)
        slot_i += 1
    return grid


class Command(BaseCommand):
    help = "Génère l’EDT (EmploiDuTemps) équilibré pour toutes les classes et un trimestre."

    def add_arguments(self, parser):
        parser.add_argument(
            "--trimestre",
            type=str,
            default=None,
            choices=["T1", "T2", "T3"],
            help="Trimestre cible. Par défaut: trimestre contenant aujourd’hui s’il existe, sinon T1.",
        )
        parser.add_argument(
            "--annee",
            type=int,
            default=ANNEE_SCOLAIRE_OFFICIELLE_DEBUT,
            help="Année de début d’année scolaire (bornes trimestre), défaut 2025 (2025-2026).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Analyse seule (aucun DELETE ni INSERT).",
        )

    def handle(self, *args, **options):
        tri = (options.get("trimestre") or "").strip().upper() or None
        if not tri:
            tri = _default_trimestre_from_today()
        annee = int(options["annee"])
        dry = options["dry_run"]

        classes = list(Classe.objects.all().order_by("id"))
        profs = list(Professeur.objects.all().order_by("id"))

        t_start, t_end = trimestre_date_range(tri, annee)
        self.stdout.write(
            f"Trimestre: {tri}  Plage: {t_start} -> {t_end}  (annee {annee})\n"
            f"Classes: {len(classes)}  Professeurs: {len(profs)}"
        )

        grid = _build_weekly_grid(classes, profs, DEFAULT_SUBJECTS)

        # Index (classe_id, jour 0-6) → créneaux du modèle hebdo
        by_class_dow: dict[tuple[int, int], list[tuple[time, time, Professeur, str]]] = {}
        for (cl_id, d_w, t0, t1), (prof, mat) in grid.items():
            by_class_dow.setdefault((cl_id, d_w), []).append((t0, t1, prof, mat))

        rows: list[EmploiDuTemps] = []
        for d in daterange_inclusive(t_start, t_end):
            d_tri = trimestre_for_date(d)
            if d_tri != tri:
                continue
            wd = d.weekday()
            for c in classes:
                for t0, t1, prof, mat in by_class_dow.get((c.pk, wd), []):
                    rows.append(
                        EmploiDuTemps(
                            professeur=prof,
                            classe=c,
                            trimestre=tri,
                            date_seance=d,
                            jour_semaine=wd,
                            heure_debut=t0,
                            heure_fin=t1,
                            matiere=mat,
                            salle="",
                        )
                    )

        n_rows = len(rows)
        n_slots_w = len(classes) * len(list(_iter_template_slots()))
        if n_slots_w > 0 and n_rows > 0:
            weeks_equiv = n_rows / n_slots_w
        else:
            weeks_equiv = 0.0
        by_prof: dict[int, int] = {}
        for r in rows:
            by_prof[r.professeur_id] = by_prof.get(r.professeur_id, 0) + 1
        hours_by_prof: list[float] = [float(v) * 2.0 for v in by_prof.values()]
        h_min = int(min(hours_by_prof)) if hours_by_prof else 0
        h_max = int(max(hours_by_prof)) if hours_by_prof else 0
        total_h = float(sum(hours_by_prof)) if hours_by_prof else 0.0
        h_avg = total_h / max(1, len(profs))
        self.stdout.write(
            f"Creneaux hebdo (toutes classes): {n_slots_w}  ->  {n_rows} seances inserees "
            f"({weeks_equiv:.1f} sem. de volume calendaire dans le trimestre)\n"
            f"Par prof (heures sur le trimestre, 2 h par seance) : min={h_min} h, max={h_max} h, moy.~{h_avg:.1f} h."
        )
        if hours_by_prof:
            self.stdout.write(
                f"Ecart (max-min) sur le trimestre : {h_max - h_min} h (plus c'est bas, plus l'equilibrage est serre)."
            )

        if dry:
            self.stdout.write(self.style.WARNING("--dry-run : aucun DELETE ni INSERT en base."))
            return

        with transaction.atomic():
            del_count, _ = EmploiDuTemps.objects.filter(trimestre=tri).delete()
            if del_count:
                self.stdout.write(
                    f"Anciennes seances (trimestre {tri}) supprimees: {del_count} ligne(s)."
                )
            EmploiDuTemps.objects.bulk_create(rows, batch_size=800)

        self.stdout.write(
            self.style.SUCCESS(
                f"OK: {n_rows} seance(s) EmploiDuTemps inserees pour {tri}. "
                f"Filtrez le calendrier sur ce trimestre."
            )
        )
