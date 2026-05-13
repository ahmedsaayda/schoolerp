"""
Script temporaire de déploiement : récrée le superuser ``admin``.
À retirer quand vous avez un autre flux (Shell / SSO).
"""

import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402 — après django.setup()

User = get_user_model()

User.objects.filter(username="admin").delete()
User.objects.create_superuser(
    username="admin",
    email="admin@school.com",
    password="Samah2026!",
    role=User.Role.ADMIN,
)
print("ADMIN RECREATED SUCCESSFULLY WITH PASSWORD: Samah2026!")
