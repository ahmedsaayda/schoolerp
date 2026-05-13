"""
Django settings for core project.
"""

import os
from pathlib import Path

import dj_database_url
import dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Loads variables from backend/.env into os.environ when the file exists.
# In production, real environment variables always take precedence over the file.
dotenv.load_dotenv(BASE_DIR / ".env")

# Never hard-code the secret key; raise at startup if the variable is missing in production.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-change-me-in-production")

# False by default — must be explicitly opt-in via the environment variable.
DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"

# Hosts acceptés : Render prod, local, wildcard pour éviter les blocages durant les tests.
# Sécurité : réduisez liste / retirez "*" une fois les domaines définitifs fixés.
ALLOWED_HOSTS: list[str] = [
    "samah-backend.onrender.com",
    "localhost",
    "127.0.0.1",
    "*",
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "core",
    "authentification",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "scolarite",
]

AUTH_USER_MODEL = "authentification.User"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.PasswordOpsApiRestrictionMiddleware",
    "core.middleware.ThreadLocalMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

_sqlite_default_url = "sqlite:///" + (BASE_DIR / "db.sqlite3").as_posix()
DATABASES = {
    "default": dj_database_url.config(
        default=_sqlite_default_url,
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr"

TIME_ZONE = "Africa/Tunis"

USE_I18N = True

USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Fichiers uploadés (justificatifs banque, etc.)
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        # IsAuthenticated: any ViewSet without explicit permission_classes is
        # closed by default — prevents accidental open endpoints.
        "rest_framework.permissions.IsAuthenticated",
    ],
}

# --- CORS / CSRF / cookies : frontend Vercel ↔ API Render (tests — CORS ouvert) ---
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    "https://schoolerp-ten.vercel.app",
    "http://localhost:5173",
]

CSRF_TRUSTED_ORIGINS = [
    "https://schoolerp-ten.vercel.app",
    "https://samah-backend.onrender.com",
]

SESSION_COOKIE_HTTPONLY = True   # JS cannot read the session cookie
# 8-hour session lifetime
SESSION_COOKIE_AGE = 8 * 60 * 60

CSRF_COOKIE_SAMESITE = 'None'
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = 'None'
SESSION_COOKIE_SECURE = True

# --- E-mail / réinitialisation mot de passe (SPA) ---
# URL du front (Vite) pour les liens dans les e-mails ; en prod : https://votredomaine.tld
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
# Durée de validité du jeton (secondes), défaut Django ~3 jours si non défini.
PASSWORD_RESET_TIMEOUT = int(os.environ.get("PASSWORD_RESET_TIMEOUT", "259200"))

if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "True") == "True"
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@localhost")

# ── Production-only HTTP security headers ──────────────────────────────────
if not DEBUG:
    SECURE_HSTS_SECONDS             = 31_536_000  # 1 year — enable only after HTTPS is confirmed
    SECURE_HSTS_INCLUDE_SUBDOMAINS  = True
    SECURE_HSTS_PRELOAD             = True
    SECURE_SSL_REDIRECT             = True
    SECURE_REFERRER_POLICY          = "strict-origin-when-cross-origin"
    SECURE_CONTENT_TYPE_NOSNIFF     = True

X_FRAME_OPTIONS = "DENY"
