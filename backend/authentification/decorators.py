from django.contrib.auth.decorators import permission_required

from .permissions import PERM_AUDIT_LOGS, PERM_FINANCIAL_REPORTS


def financial_reports_required(view_func):
    """Vue réservée aux utilisateurs avec la permission rapports financiers."""
    return permission_required(
        PERM_FINANCIAL_REPORTS,
        raise_exception=True,
    )(view_func)


def audit_logs_required(view_func):
    """Vue réservée aux utilisateurs avec la permission journaux d'audit."""
    return permission_required(PERM_AUDIT_LOGS, raise_exception=True)(view_func)
