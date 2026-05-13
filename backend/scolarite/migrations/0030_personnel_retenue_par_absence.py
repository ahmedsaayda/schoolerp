from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0029_depense_note_required"),
    ]

    operations = [
        migrations.AlterField(
            model_name="personnel",
            name="salaire_mensuel",
            field=models.DecimalField(
                decimal_places=2,
                help_text="Salaire mensuel de base (contrat), avant retenues d’absence.",
                max_digits=10,
            ),
        ),
        migrations.AddField(
            model_name="personnel",
            name="retenue_par_absence",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Montant déduit par jour marqué « Absent » dans le pointage personnel du mois.",
                max_digits=10,
            ),
        ),
    ]
