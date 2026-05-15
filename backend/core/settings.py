"""
Django settings for core project.

Variables : fichier backend/.env (django-environ) + variables d'environnement Render en prod.
"""

from pathlib import Path

import dj_database_url
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()

# Charge backend/.env si présent ; sur Render les secrets viennent du tableau « Environment ».
environ.Env.read_env(BASE_DIR / ".env")


def _env_truthy(name: str, alias: str | None = None) -> bool:
    raw = env.str(name, default="").strip().lower()
    if raw in ("true", "1", "yes", "on"):
        return True
    if alias:
        raw_alias = env.str(alias, default="").strip().lower()
        return raw_alias in ("true", "1", "yes", "on")
    return False


DEBUG = _env_truthy("DEBUG", "DJANGO_DEBUG")

SECRET_KEY = env.str(
    "SECRET_KEY",
    default=env.str("DJANGO_SECRET_KEY", default="django-insecure-change-me-in-production"),
)

if DEBUG:
    ALLOWED_HOSTS = ["*"]
else:
    ALLOWED_HOSTS = env.list(
        "ALLOWED_HOSTS",
        default=[
            "samah-backend.onrender.com",
            "localhost",
            "127.0.0.1",
        ],
    )

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

# WhiteNoise uniquement en production (DEBUG=False).
_whitenoise_mw = [] if DEBUG else ["whitenoise.middleware.WhiteNoiseMiddleware"]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    *_whitenoise_mw,
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

_sqlite_fallback = "sqlite:///" + (BASE_DIR / "db.sqlite3").as_posix()

if DEBUG:
    DATABASES = {
        "default": dj_database_url.config(
            env="DATABASE_URL",
            default=_sqlite_fallback,
            conn_max_age=0,
        )
    }
    db_conf = DATABASES["default"]
    engine = (db_conf.get("ENGINE") or "").lower()
    if "postgresql" in engine:
        opts = db_conf.setdefault("OPTIONS", {})
        # PostgreSQL local : pas de TLS (évite les erreurs sslmode avec un serveur sans SSL)
        opts.setdefault("sslmode", "disable")
else:
    DATABASES = {
        "default": dj_database_url.config(
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
        "BACKEND": (
            "whitenoise.storage.CompressedStaticFilesStorage"
            if not DEBUG
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        ),
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "authentification.session_auth.SessionAuthenticationWithoutCSRF",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

# --- CORS / CSRF / cookies ---
if DEBUG:
    # django-cors-headers : avec CREDENTIALS=True, l’Origin du navigateur est renvoyé tel quel
    # (pas de « * »), ce qui est compatible session cookie + Vite sur un autre port.
    CORS_ALLOW_ALL_ORIGINS = True
    CORS_ALLOW_CREDENTIALS = True
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SECURE = False
    CSRF_COOKIE_SAMESITE = "Lax"
else:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOW_CREDENTIALS = True
    CORS_ALLOWED_ORIGINS = ["https://schoolerp-ten.vercel.app"]
    CSRF_TRUSTED_ORIGINS = ["https://schoolerp-ten.vercel.app", "https://samah-backend.onrender.com"]
    SESSION_COOKIE_SAMESITE = "None"
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SAMESITE = "None"
    CSRF_COOKIE_SECURE = True

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = 8 * 60 * 60  # 8 h

FRONTEND_BASE_URL = env.str("FRONTEND_BASE_URL", default="http://localhost:5173")
PASSWORD_RESET_TIMEOUT = int(env.str("PASSWORD_RESET_TIMEOUT", default="259200"))

if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

EMAIL_HOST = env.str("EMAIL_HOST", default="")
EMAIL_PORT = int(env.str("EMAIL_PORT", default="587"))
EMAIL_HOST_USER = env.str("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env.str("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.str("EMAIL_USE_TLS", default="True") == "True"
DEFAULT_FROM_EMAIL = env.str("DEFAULT_FROM_EMAIL", default="noreply@localhost")

if not DEBUG:
    SECURE_HSTS_SECONDS = 31_536_000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_SSL_REDIRECT = True
    SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
    SECURE_CONTENT_TYPE_NOSNIFF = True

X_FRAME_OPTIONS = "DENY"
