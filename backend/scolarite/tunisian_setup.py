"""
Logique partagée : niveaux / sections tunisiens, libellés de classes, inférence legacy.
Utilisé par la commande init_tunisian_system et le seed de démonstration.
"""

from __future__ import annotations

import unicodedata

from django.db import transaction

from .models import Classe, Eleve, NIVEAU_CHOICES, SECONDARY_SECTION_CHOICES, TRONC_NIVEAU_CODES

CAPACITE_CLASSE_DEFAUT = 30


def _normalize_for_match(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text)
    without_marks = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return without_marks.lower()


def infer_niveau_code_from_classe_nom(nom_classe: str) -> str:
    """Déduit un code NIVEAU_CHOICES à partir d’un ancien libellé de classe."""
    if not nom_classe or not str(nom_classe).strip():
        return "7BASE"
    n = _normalize_for_match(str(nom_classe))

    if (
        "bac" in n
        or "baccalaureat" in n
        or "terminale" in n
        or ("4eme" in n and "second" in n)
    ):
        return "4SEC"
    if "3eme" in n and "second" in n:
        return "3SEC"
    if ("2eme" in n and "second" in n) or ("deuxieme" in n and "second" in n):
        return "2SEC"
    if ("1ere" in n and "second" in n) or ("premiere" in n and "second" in n):
        return "1SEC"
    if "9eme" in n or "neuvieme" in n:
        return "9BASE"
    if "8eme" in n or "huitieme" in n:
        return "8BASE"
    if "7eme" in n or "septieme" in n:
        return "7BASE"
    if "troisieme" in n or "3eme" in n:
        return "9BASE"
    if "seconde" in n:
        return "2SEC"
    if "premiere" in n or "1ere" in n:
        return "3SEC"
    return "7BASE"


def normalize_eleve_section_for_niveau(niveau: str, section: str) -> str:
    """Section stockée sur Élève / Classe : '' = tronc commun."""
    s = (section or "").strip()
    if niveau in TRONC_NIVEAU_CODES:
        return ""
    allowed = {code for code, _ in SECONDARY_SECTION_CHOICES}
    if s in allowed:
        return s
    legacy = {
        "MATH": "MATH",
        "SC": "SCI_EXP",
        "ECO": "ECO_GEST",
        "LETTRE": "LETTRES",
        "SPORT": "TECH",
        "BASE": "",
    }
    mapped = legacy.get(s, s)
    if mapped in allowed:
        return mapped
    return "MATH"


def format_classe_nom(niveau: str, section: str, ordinal: int) -> str:
    niv_label = dict(NIVEAU_CHOICES)[niveau]
    if not section:
        return f"{niv_label} — {ordinal}"
    sec_label = dict(SECONDARY_SECTION_CHOICES)[section]
    return f"{niv_label} — {sec_label} — {ordinal}"


def iter_niveau_section_pairs():
    """Couples (niveau, section) pour créer au moins une classe de chaque type."""
    for code, _ in NIVEAU_CHOICES:
        if code in TRONC_NIVEAU_CODES:
            yield code, ""
        else:
            for sec, _ in SECONDARY_SECTION_CHOICES:
                yield code, sec


def create_bootstrap_classes(capacity: int = CAPACITE_CLASSE_DEFAUT) -> None:
    """Crée une classe « — 1 » pour chaque couple (niveau, section) tunisien."""
    for niveau, section in iter_niveau_section_pairs():
        nom = format_classe_nom(niveau, section, 1)
        Classe.objects.create(
            nom=nom,
            niveau=niveau,
            section=section,
            capacite_max=capacity,
        )


def redistribute_all_eleves(capacity: int = CAPACITE_CLASSE_DEFAUT) -> None:
    """
    Réassigne chaque élève à une classe existante ou nouvelle, en respectant `capacity`.
    Met à jour niveau, section (tronc = ''), et classe (nom).
    """
    by_bucket: dict[tuple[str, str], list[int]] = {}
    for e in Eleve.objects.order_by("id").values("id", "niveau", "section", "classe"):
        nid = e["id"]
        niv = (e.get("niveau") or "").strip() or infer_niveau_code_from_classe_nom(e.get("classe") or "")
        sec = normalize_eleve_section_for_niveau(niv, e.get("section") or "")
        key = (niv, sec)
        by_bucket.setdefault(key, []).append(nid)

    with transaction.atomic():
        for (niv, sec), ids in by_bucket.items():
            classes_list = list(Classe.objects.filter(niveau=niv, section=sec).order_by("id"))

            def count_in_classe(c: Classe) -> int:
                return Eleve.objects.filter(classe=c.nom, section=c.section).count()

            for eleve_id in ids:
                chosen: Classe | None = None
                for c in classes_list:
                    if count_in_classe(c) < (c.capacite_max or capacity):
                        chosen = c
                        break
                if chosen is None:
                    idx = len(classes_list) + 1
                    nom = format_classe_nom(niv, sec, idx)
                    chosen = Classe.objects.create(
                        nom=nom,
                        niveau=niv,
                        section=sec,
                        capacite_max=capacity,
                    )
                    classes_list.append(chosen)
                Eleve.objects.filter(pk=eleve_id).update(classe=chosen.nom, section=sec, niveau=niv)


def clear_emploi_classe_links() -> None:
    from .models import EmploiDuTemps

    EmploiDuTemps.objects.update(classe=None)
