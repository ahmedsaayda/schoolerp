"""
URL configuration for core project.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from authentification import views as auth_views

urlpatterns = [
    path("admin/", admin.site.urls),
    # Compat : anciennes URLs / erreur VITE_API_URL avec suffixe …/api (+ sans segment /auth/)
    path("api/login/", auth_views.login_api),
    path("api/check-auth/", auth_views.me_api),
    path("api/csrf/", auth_views.csrf_cookie_api),
    path("api/auth/", include("authentification.urls")),
    path("api/", include("authentification.api_urls")),
    path("api/", include("scolarite.urls")),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
