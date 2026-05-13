import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0018_depense_model"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="pointage",
            options={
                "ordering": ["date_cours", "id"],
                "verbose_name": "pointage",
                "verbose_name_plural": "pointages",
            },
        ),
        migrations.AddField(
            model_name="pointage",
            name="classe",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pointages",
                to="scolarite.classe",
            ),
        ),
        migrations.AddField(
            model_name="pointage",
            name="emploi_du_temps",
            field=models.ForeignKey(
                blank=True,
                help_text="Créneau d’origine (emploi du temps), pour rattacher la séance à un slot précis.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pointages",
                to="scolarite.emploidutemps",
            ),
        ),
    ]
