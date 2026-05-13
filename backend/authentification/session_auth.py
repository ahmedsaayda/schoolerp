"""
Session Django pour l’API sans contrôle CSRF.

Sur une SPA hébergée sur un domaine différent de l’API (ex. Vercel → Render), le jeton CSRF
dans un cookie défini pour l’API n’est généralement **pas lisible** par JavaScript (`document.cookie`)
sur l’origine du front ; DRF rejette alors les requêtes mutantes alors que la session existe.

À utiliser uniquement avec CORS restreint + HTTPS + cookies Secure/SameSite=None comme configuré pour la prod.
"""

from rest_framework.authentication import SessionAuthentication


class SessionAuthenticationWithoutCSRF(SessionAuthentication):
    def enforce_csrf(self, request):
        pass
