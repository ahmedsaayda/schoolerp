# Generated manually for role redesign

from django.db import migrations, models


def forwards_migrate_roles(apps, schema_editor):
    User = apps.get_model("authentification", "User")
    for u in User.objects.all():
        r = getattr(u, "role", "") or ""
        if r == "SUPERADMIN":
            u.role = "ADMIN"
        elif r == "ADMIN_USER":
            u.role = "COMPTABLE"
        elif r not in ("ADMIN", "POINTAGE_AGENT", "COMPTABLE"):
            u.role = "COMPTABLE"
        u.save(update_fields=["role"])


class Migration(migrations.Migration):

    dependencies = [
        ("authentification", "0002_auditlog_details"),
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
                ],
                default="COMPTABLE",
                max_length=20,
            ),
        ),
        migrations.RunPython(forwards_migrate_roles, migrations.RunPython.noop),
    ]
