"""
Trimestres, vacances et génération d'emplois du temps (2025-2026 calendrier officiel).

Périodes d'enseignement actives :
  T1 : 2025-09-15 → 2025-12-21
  T2 : 2026-01-05 → 2026-03-15
  T3 : 2026-03-30 → 2026-06-30

Vacances (aucune séance) :
  vacance_mi_t1, vacance_hiver, vacance_mi_t2, vacance_printemps

Les séances ne sont jamais générées en dehors de [premier jour T1, dernier jour T3]
ni en vacances. Le **dimanche** ne porte jamais de cours. Le **samedi (matin)** peut porter
un emploi du temps, voir `trimestre_for_date` (hors dimanche et vacances). Les flux qui
décomptent uniquement les jours **lun–ven** utilisent `is_school_session_day`.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Final, Iterable

TRIMESTRE_CHOICES: Final = [
    ("T1", "Trimestre 1 (15 sept. 2025 – 21 déc. 2025)"),
    ("T2", "Trimestre 2 (5 janv. – 15 mars 2026)"),
    ("T3", "Trimestre 3 (30 mars – 30 juin 2026)"),
]

TRIMESTRE_LABEL: Final = dict(TRIMESTRE_CHOICES)

# Année scolaire de référence pour le calendrier détaillé ci-dessous
ANNEE_SCOLAIRE_OFFICIELLE_DEBUT: Final = 2025

# Bornes absolues de l'année scolaire (premier / dernier jour pouvant porter un cours)
SCHOOL_YEAR_FIRST_DAY: Final = date(2025, 9, 15)
SCHOOL_YEAR_LAST_DAY: Final = date(2026, 6, 30)

# Trimestres (périodes officielles, extrêmes inclus)
_TRIM_OFFICIEL_2025_26: Final[dict[str, tuple[date, date]]] = {
    "T1": (date(2025, 9, 15), date(2025, 12, 21)),
    "T2": (date(2026, 1, 5), date(2026, 3, 15)),
    "T3": (date(2026, 3, 30), date(2026, 6, 30)),
}

# Vacances scolaires (incluses) — aucun cours
VACATION_RANGES_2025_26: Final[list[tuple[date, date]]] = [
    (date(2025, 10, 27), date(2025, 11, 2)),  # vacance_mi_t1
    (date(2025, 12, 22), date(2026, 1, 4)),  # vacance_hiver
    (date(2026, 2, 2), date(2026, 2, 8)),  # vacance_mi_t2
    (date(2026, 3, 16), date(2026, 3, 29)),  # vacance_printemps
]


def _in_range_inclusive(d: date, start: date, end: date) -> bool:
    return start <= d <= end


def date_in_any_vacation(d: date) -> bool:
    """True si `d` tombe dans une période de vacances (liste 2025-2026)."""
    for a, b in VACATION_RANGES_2025_26:
        if _in_range_inclusive(d, a, b):
            return True
    return False


def is_school_session_day(d: date) -> bool:
    """
    True si un cours peut avoir lieu ce jour : dans l'année scolaire, jour ouvré (lun–ven),
    pas en vacances.
    """
    if d < SCHOOL_YEAR_FIRST_DAY or d > SCHOOL_YEAR_LAST_DAY:
        return False
    if d.weekday() >= 5:
        return False
    if date_in_any_vacation(d):
        return False
    return True


def trimestre_date_range(trimestre: str, annee_scolaire_debut: int) -> tuple[date, date]:
    """
    Bornes **officielles** du trimestre pour la période d'enseignement.

    Pour `annee_scolaire_debut == 2025` (2025-2026), utilise le calendrier officiel ci-dessus.
    Pour les autres années, conserve une approximation par mois civils (rétrocompatibilité).
    """
    if annee_scolaire_debut == ANNEE_SCOLAIRE_OFFICIELLE_DEBUT and trimestre in _TRIM_OFFICIEL_2025_26:
        return _TRIM_OFFICIEL_2025_26[trimestre]

    y0 = annee_scolaire_debut
    y1 = annee_scolaire_debut + 1
    if trimestre == "T1":
        return date(y0, 9, 1), date(y0, 11, 30)
    if trimestre == "T2":
        last = calendar.monthrange(y1, 2)[1]
        return date(y0, 12, 1), date(y1, 2, last)
    if trimestre == "T3":
        return date(y1, 3, 1), date(y1, 6, 30)
    raise ValueError(f"Trimestre inconnu : {trimestre!r}")


def trimestre_for_date(d: date) -> str | None:
    """
    Trimestre (T1/T2/T3) pour une date d’**emploi du temps** valide, sinon None.

    Retourne None si : hors année scolaire, **dimanche**, vacances, ou jour entre deux périodes.
    Le **samedi** (matin) est autorisé s’il tombe dans une période de trimestre (hors vacances).
    """
    if not _in_range_inclusive(d, SCHOOL_YEAR_FIRST_DAY, SCHOOL_YEAR_LAST_DAY):
        return None
    if d.weekday() == 6:
        return None
    if date_in_any_vacation(d):
        return None
    if _in_range_inclusive(d, *_TRIM_OFFICIEL_2025_26["T1"]):
        return "T1"
    if _in_range_inclusive(d, *_TRIM_OFFICIEL_2025_26["T2"]):
        return "T2"
    if _in_range_inclusive(d, *_TRIM_OFFICIEL_2025_26["T3"]):
        return "T3"
    return None


def daterange_inclusive(start: date, end: date) -> Iterable[date]:
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def trimestre_period_containing_date(d: date) -> tuple[str, date, date] | None:
    """
    Trimestre **calendaire** (bornes officielles T1/T2/T3, jours civils inclus),
    sans exiger un jour d'école : utile pour le tableau de bord (objectif journalier).

    Retourne None si la date est hors année scolaire (15 sept. – 30 juin) ou dans un
    trou entre deux trimestres (ex. vacances d'hiver, entre T2 et T3).
    """
    if not _in_range_inclusive(d, SCHOOL_YEAR_FIRST_DAY, SCHOOL_YEAR_LAST_DAY):
        return None
    for tri in ("T1", "T2", "T3"):
        a, b = _TRIM_OFFICIEL_2025_26[tri]
        if _in_range_inclusive(d, a, b):
            return (tri, a, b)
    return None


def count_school_session_days_in_range(d0: date, d1: date) -> int:
    """
    Nombre de jours où un cours peut avoir lieu (lun–ven, hors vacances, dans l'année scolaire),
    entre `d0` et `d1` inclus. Si d0 > d1, retourne 0.
    """
    if d0 > d1:
        return 0
    n = 0
    for d in daterange_inclusive(d0, d1):
        if is_school_session_day(d):
            n += 1
    return n


def generate_seances_for_trimestre(
    classe_id: int,
    trimestre: str,
    annee_scolaire_debut: int,
    creneaux: list[dict],
) -> list:
    """
    `creneaux` : liste de dicts professeur_id, jour_semaine (0–6), heure_debut, heure_fin (time).
    Retourne une liste d'instances EmploiDuTemps non sauvegardées (jours ouvrés uniquement,
    hors vacances, dans les bornes du trimestre et de l'année scolaire).
    """
    from scolarite.models import EmploiDuTemps

    t_start, t_end = trimestre_date_range(trimestre, annee_scolaire_debut)
    out: list = []
    for d in daterange_inclusive(t_start, t_end):
        if not is_school_session_day(d):
            continue
        for c in creneaux:
            j = int(c["jour_semaine"])
            if j != d.weekday():
                continue
            mat = str(c.get("matiere") or "").strip()[:255]
            salle = str(c.get("salle") or "").strip()[:64]
            out.append(
                EmploiDuTemps(
                    professeur_id=c["professeur_id"],
                    classe_id=classe_id,
                    date_seance=d,
                    jour_semaine=j,
                    heure_debut=c["heure_debut"],
                    heure_fin=c["heure_fin"],
                    trimestre=trimestre,
                    matiere=mat,
                    salle=salle,
                )
            )
    return out
