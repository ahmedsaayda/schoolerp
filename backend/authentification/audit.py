"""Création de journaux d'audit avec utilisateur explicite (préféré aux signaux sans requête)."""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest

from .models import AuditLog


def audit_user(request: HttpRequest | None) -> Any:
    """Utilisateur authentifié pour la requête, ou None (aucun filtre par rôle ni is_staff)."""
    if request is not None:
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            return user
    try:
        from core.middleware import get_current_user

        u = get_current_user()
        if u is not None and getattr(u, "is_authenticated", False):
            return u
    except ImportError:
        pass
    return None


def create_audit_log(
    *,
    utilisateur: Any,
    action: str,
    modele_concerne: str,
    details: dict | None = None,
) -> AuditLog:
    """Enregistre une entrée d'audit. `utilisateur` peut être None (hors requête)."""
    return AuditLog.objects.create(
        utilisateur=utilisateur if utilisateur is not None else None,
        action=action,
        modele_concerne=modele_concerne,
        details=details,
    )
