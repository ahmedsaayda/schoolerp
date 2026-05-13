"""Libellés auteur pour rapports caisse (impressions, journal API)."""

from __future__ import annotations

from typing import Any


def auteur_rapport_payload(user: Any | None) -> dict[str, Any]:
    """
    Nom affiché + rôle pour les lignes Paiement / Dépense exposées au journal et impressions.

    Les superusers sont présentés comme « Administrateur » pour alignement avec la hiérarchie métier.
    """
    if user is None:
        return {
            "cree_par_id": None,
            "cree_par_nom": None,
            "cree_par_role": None,
        }
    nom = (getattr(user, "get_full_name", lambda: "")() or "").strip() or getattr(
        user, "username", ""
    )
    if getattr(user, "is_superuser", False):
        role_label = "Administrateur"
    elif hasattr(user, "get_role_display"):
        role_label = user.get_role_display()
    else:
        role_label = None
    return {
        "cree_par_id": user.pk,
        "cree_par_nom": nom,
        "cree_par_role": role_label,
    }
