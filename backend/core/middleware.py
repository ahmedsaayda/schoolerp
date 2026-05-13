import threading

from django.http import HttpResponseForbidden, JsonResponse
from django.utils.deprecation import MiddlewareMixin

_tls = threading.local()


def get_current_user():
    """Retourne l’utilisateur de la requête HTTP en cours, ou None (hors requête / anonyme)."""
    return getattr(_tls, "user", None)


def _set_thread_local_user(request):
    """Force la résolution de request.user (LazyObject) puis enregistre l’utilisateur authentifié."""
    user = getattr(request, "user", None)
    if user is not None:
        try:
            user = user if user.is_authenticated else None
        except (TypeError, AttributeError):
            user = None
    _tls.user = user


class ThreadLocalMiddleware(MiddlewareMixin):
    """
    Stocke request.user (tout utilisateur authentifié, quel que soit le rôle métier)
    dans un thread-local pour le code hors vue (signaux, tâches synchrones dans la requête).

    process_view() re-synchronise l’utilisateur juste avant la vue :
    certaines piles résolvent request.user plus tard que le premier accès.
    """

    def process_request(self, request):
        _set_thread_local_user(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        _set_thread_local_user(request)

    def process_response(self, request, response):
        _tls.user = None
        return response

    def process_exception(self, request, exception):
        _tls.user = None
        return None


class PasswordOpsApiRestrictionMiddleware(MiddlewareMixin):
    """
    Comptes PASSWORD_OPS (hors superuser) : uniquement /api/auth/* (connexion, mots de passe)
    et /api/auth/password-ops/* — pas de scolarité ni d'admin Django.
    """

    _AUTH_API_PREFIXES = (
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/me",
        "/api/auth/password-reset",
        "/api/auth/password/change",
        "/api/auth/password-ops",
    )

    def process_request(self, request):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        u = getattr(request, "user", None)
        if u is None:
            return None
        try:
            authed = u.is_authenticated
        except (TypeError, AttributeError):
            return None
        if not authed:
            return None
        if getattr(u, "is_superuser", False):
            return None
        if getattr(u, "role", None) != User.Role.PASSWORD_OPS:
            return None

        path = request.path_info
        if path.startswith("/admin"):
            return HttpResponseForbidden("Accès refusé.")

        if path.startswith("/api/"):
            if any(path.startswith(p) for p in self._AUTH_API_PREFIXES):
                return None
            return JsonResponse({"detail": "Accès refusé."}, status=403)

        return None
