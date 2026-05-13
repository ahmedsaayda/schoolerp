from datetime import timedelta

from django.db import migrations, models


def backfill_date_seance(apps, schema_editor):
    EmploiDuTemps = apps.get_model("scolarite", "EmploiDuTemps")
    from datetime import date

    anchor = date(2024, 1, 1)
    for row in EmploiDuTemps.objects.all().iterator():
        row.date_seance = anchor + timedelta(days=int(row.jour_semaine))
        row.save(update_fields=["date_seance"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("scolarite", "0021_avancesalaire_est_solde"),
    ]

    operations = [
        migrations.AddField(
            model_name="emploidutemps",
            name="date_seance",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_date_seance, noop_reverse),
        migrations.AlterField(
            model_name="emploidutemps",
            name="date_seance",
            field=models.DateField(
                help_text="Date calendaire de la séance (jour_semaine doit correspondre au jour civil).",
            ),
        ),
    ]
