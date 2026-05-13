from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("authentification", "0003_user_roles_admin_pointage_comptable"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="must_change_password",
            field=models.BooleanField(
                default=False,
                help_text="Si vrai, l'utilisateur doit changer son mot de passe avant d'accéder à l'application.",
            ),
        ),
        migrations.AlterField(
            model_name="auditlog",
            name="action",
            field=models.CharField(
                choices=[
                    ("CREATION", "Création"),
                    ("MODIFICATION", "Modification"),
                    ("SUPPRESSION", "Suppression"),
                    (
                        "RESET_PASSWORD_REQUESTED",
                        "Demande réinitialisation mot de passe",
                    ),
                    (
                        "RESET_PASSWORD_COMPLETED",
                        "Réinitialisation mot de passe effectuée",
                    ),
                    ("PASSWORD_CHANGED", "Mot de passe modifié"),
                ],
                max_length=32,
            ),
        ),
    ]
