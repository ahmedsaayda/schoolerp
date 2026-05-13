# Generated manually — corrige les absences historiquement marquées payées.

from django.db import migrations


def fix_absent_est_paye(apps, schema_editor):
    Pointage = apps.get_model("scolarite", "Pointage")
    Pointage.objects.filter(statut_presence="ABSENTE", est_paye=True).update(est_paye=False)


class Migration(migrations.Migration):
    dependencies = [
        ("scolarite", "0019_pointage_classe_creneau"),
    ]

    operations = [
        migrations.RunPython(fix_absent_est_paye, migrations.RunPython.noop),
    ]
