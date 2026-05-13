"""Catalogue des modèles pour le filtre du journal d'audit (classes Django + valeurs déjà journalisées)."""

from __future__ import annotations

import re

from django.apps import apps

from .models import AuditLog

_AUDIT_MODEL_SOURCE_APPS = ("scolarite", "authentification")

# Segments CamelCase (clé en minuscules) — libellé avec accents, capitalisation appliquée ensuite.
_TOKEN_LABELS = {
    "eleve": "élève",
    "depense": "dépense",
    "inscription": "inscription",
    "paiement": "paiement",
    "personnel": "personnel",
    "pointage": "pointage",
    "professeur": "professeur",
    "classe": "classe",
    "user": "utilisateur",
    "parametres": "paramètres",
    "session": "session",
    "caisse": "caisse",
    "salaire": "salaire",
    "avances": "avances",
    "avance": "avance",
    "emploi": "emploi",
    "temps": "temps",
    "du": "du",
}


def _sentence_case_fr(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return s
    return s[0].upper() + s[1:]


def _split_class_identifier(name: str) -> list[str]:
    if not name or not str(name).strip():
        return []
    raw = str(name).strip()
    if "_" in raw:
        return [p for p in raw.split("_") if p]
    if " " in raw:
        return [p for p in raw.split() if p]
    parts = re.findall(r"[A-Z][a-z]+|[a-z]+|\d+|[A-Z]+(?=[A-Z][a-z]|\b)", raw)
    return parts if parts else [raw]


def _humanize_model_name(name: str) -> str:
    parts = _split_class_identifier(name)
    if not parts:
        return name
    out: list[str] = []
    for p in parts:
        key = p.lower()
        base = _TOKEN_LABELS.get(key, p.lower())
        out.append(_sentence_case_fr(base))
    return " ".join(out)


def _label_for_model(name: str, model_class: type | None) -> str:
    if model_class is not None and model_class.__name__ != "AuditLog":
        vn = getattr(model_class._meta, "verbose_name", None)
        if isinstance(vn, str) and vn.strip():
            return _sentence_case_fr(vn.strip())
    return _humanize_model_name(name)


def _class_by_name_for_audit() -> dict[str, type]:
    out: dict[str, type] = {}
    for app_label in _AUDIT_MODEL_SOURCE_APPS:
        for model in apps.get_app_config(app_label).get_models():
            if model.__name__ == "AuditLog":
                continue
            out[model.__name__] = model
    return out


def build_audit_model_catalog() -> tuple[list[dict[str, str]], frozenset[str]]:
    """
    Retourne (liste [{ "id", "label" }] triée, ensemble des `id` autorisés pour ?model_name=).

    `id` est la valeur stockée dans AuditLog.modele_concerne (filtre en iexact).
    """
    class_by_name = _class_by_name_for_audit()
    names: set[str] = set(class_by_name.keys())

    logged = (
        AuditLog.objects.exclude(modele_concerne__isnull=True)
        .exclude(modele_concerne="")
        .values_list("modele_concerne", flat=True)
        .distinct()
    )
    for v in logged.iterator():
        if v and str(v).strip():
            names.add(str(v).strip())

    catalog: list[dict[str, str]] = []
    for name in sorted(names, key=str.casefold):
        mc = class_by_name.get(name)
        catalog.append({"id": name, "label": _label_for_model(name, mc)})
    return catalog, frozenset(names)
