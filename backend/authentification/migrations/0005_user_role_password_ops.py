from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("authentification", "0004_user_must_change_password_audit_password_actions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("ADMIN", "Administrateur"),
                    ("POINTAGE_AGENT", "Agent de pointage"),
                    ("COMPTABLE", "Comptable"),
                    (
                        "PASSWORD_OPS",
                        "Opérations mot de passe (technique)",
                    ),
                ],
                default="COMPTABLE",
                max_length=20,
            ),
        ),
    ]
