from django.apps import AppConfig


class ScolariteConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "scolarite"
    verbose_name = "Scolarité"

    def ready(self) -> None:
        from . import signals  # noqa: F401 — enregistre les signaux
