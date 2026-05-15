"""
Permissions métier pour rapports financiers, journal d'audit et rôles ERP.
"""

from __future__ import annotations

from typing import Optional

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import User

PERM_FINANCIAL_REPORTS = "authentification.view_financial_reports"
PERM_AUDIT_LOGS = "authentification.view_audit_logs"


def can_view_financial_reports(user) -> bool:
    return bool(
        user
        and user.is_authenticated
        and user.has_perm(PERM_FINANCIAL_REPORTS)
    )


def can_view_audit_logs(user) -> bool:
    return bool(
        user
        and user.is_authenticated
        and user.has_perm(PERM_AUDIT_LOGS)
    )


def effective_role(user) -> Optional[str]:
    """Rôle métier effectif : les superusers sont traités comme ADMIN."""
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if getattr(user, "is_superuser", False):
        return User.Role.ADMIN
    return getattr(user, "role", None)


class IsSuperAdminRole(BasePermission):
    """
    Accès journal d'audit : superuser, permission view_audit_logs, ou rôle ADMIN.
    """

    def has_permission(self, request, view):
        u = request.user
        if not u or not getattr(u, "is_authenticated", False):
            return False
        if getattr(u, "is_superuser", False):
            return True
        if can_view_audit_logs(u):
            return True
        return getattr(u, "role", None) == User.Role.ADMIN


class IsAdminRole(BasePermission):
    """Création / modification / suppression réservées au rôle ADMIN (ou superuser)."""

    def has_permission(self, request, view):
        return effective_role(request.user) == User.Role.ADMIN


class IsAdminOrComptableFinancial(BasePermission):
    """Paiements, caisse, avances : uniquement ADMIN ou COMPTABLE (aucune lecture pour POINTAGE_AGENT)."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        r = effective_role(request.user)
        return r in (User.Role.ADMIN, User.Role.COMPTABLE)


class IsAdminOrPointageAgentWrite(BasePermission):
    """
    Pointages enseignants et pointage personnel : même rôle métier.
    Lecture : tout utilisateur authentifié.
    Écriture : ADMIN ou POINTAGE_AGENT (pages /pointage-quotidien et /pointage-personnel).
    """

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        r = effective_role(request.user)
        return r in (User.Role.ADMIN, User.Role.POINTAGE_AGENT)


class IsAdminComptableOrPointageEleveAccess(BasePermission):
    """
    Accès API Elève (hors suppression, hors action ``impayes``) :
    lecture GET pour ADMIN, COMPTABLE, POINTAGE_AGENT ;
    POST / PUT / PATCH pour ADMIN et POINTAGE_AGENT (agent de saisie inscriptions).
    """

    message = "Accès réservé à la direction ou à l'agent de saisie élèves."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        r = effective_role(request.user)
        if request.method in SAFE_METHODS:
            return r in (User.Role.ADMIN, User.Role.COMPTABLE, User.Role.POINTAGE_AGENT)
        return r in (User.Role.ADMIN, User.Role.POINTAGE_AGENT)


class IsAdminComptableOrPointageRead(BasePermission):
    """Lecture du référentiel classes (liste / détail) pour scolarité et saisie élèves."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        r = effective_role(request.user)
        return r in (User.Role.ADMIN, User.Role.COMPTABLE, User.Role.POINTAGE_AGENT)


class IsAdminOrComptable(BasePermission):
    """Actions métier comptabilité / paie (ex. salaires, dépenses) : ADMIN ou COMPTABLE."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        r = effective_role(request.user)
        return r in (User.Role.ADMIN, User.Role.COMPTABLE)


class IsPasswordOpsRoleOnly(BasePermission):
    """
    Création de comptes et réinitialisation forcée : uniquement le rôle PASSWORD_OPS
    (pas de dérogation superuser — réservé aux comptes techniques dédiés).
    """

    message = "Accès réservé au rôle opérations mot de passe."

    def has_permission(self, request, view) -> bool:
        u = request.user
        if not u or not getattr(u, "is_authenticated", False):
            return False
        return getattr(u, "role", None) == User.Role.PASSWORD_OPS


class CannotDeleteSelf(BasePermission):
    """Empêche un ADMIN de supprimer son propre compte.

    Two-layer guard:
    - has_permission  : catches URL-level self-targeting (pk in kwargs) early,
                        before the DB is hit.
    - has_object_permission : catches any remaining case once the object is
                        fetched, regardless of how pk was passed.
    """

    message = "Vous ne pouvez pas supprimer votre propre compte."

    def has_permission(self, request, view) -> bool:
        if request.method != "DELETE":
            return True
        pk = view.kwargs.get("pk")
        if pk is None:
            return True
        return str(request.user.pk) != str(pk)

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method != "DELETE":
            return True
        return request.user.pk != obj.pk
