from django.contrib.auth.models import AbstractUser
from django.db import models
from django.conf import settings


class User(AbstractUser):
    """Utilisateur ERP avec rôle métier (accès module)."""

    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Administrateur"
        POINTAGE_AGENT = "POINTAGE_AGENT", "Agent de pointage"
        COMPTABLE = "COMPTABLE", "Comptable"
        PASSWORD_OPS = "PASSWORD_OPS", "Opérations mot de passe (technique)"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.COMPTABLE,
    )
    must_change_password = models.BooleanField(
        default=False,
        help_text="Si vrai, l'utilisateur doit changer son mot de passe avant d'accéder à l'application.",
    )

    class Meta:
        verbose_name = "utilisateur"
        verbose_name_plural = "utilisateurs"
        permissions = [
            ("view_financial_reports", "Peut consulter les rapports financiers"),
            ("view_audit_logs", "Peut consulter les journaux d'audit"),
        ]

    def __str__(self) -> str:
        return self.username


class AuditLog(models.Model):
    """Trace des actions sensibles pour le journal d'audit."""

    class Action(models.TextChoices):
        CREATION = "CREATION", "Création"
        MODIFICATION = "MODIFICATION", "Modification"
        SUPPRESSION = "SUPPRESSION", "Suppression"
        RESET_PASSWORD_REQUESTED = (
            "RESET_PASSWORD_REQUESTED",
            "Demande réinitialisation mot de passe",
        )
        RESET_PASSWORD_COMPLETED = (
            "RESET_PASSWORD_COMPLETED",
            "Réinitialisation mot de passe effectuée",
        )
        PASSWORD_CHANGED = "PASSWORD_CHANGED", "Mot de passe modifié"

    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=32, choices=Action.choices)
    modele_concerne = models.CharField(
        max_length=255,
        help_text="Nom du modèle concerné (ex. Eleve, Classe).",
    )
    date = models.DateTimeField(auto_now_add=True)
    details = models.JSONField(
        null=True,
        blank=True,
        verbose_name="détails",
        help_text="Champs modifiés ou contexte (JSON).",
    )

    class Meta:
        ordering = ["-date"]
        verbose_name = "journal d'audit"
        verbose_name_plural = "journaux d'audit"

    def __str__(self) -> str:
        return f"{self.get_action_display()} — {self.modele_concerne} ({self.date})"
