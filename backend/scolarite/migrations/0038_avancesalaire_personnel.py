# Generated manually: avances sur salaire pour le personnel non enseignant (XOR professeur)

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0037_pointage_statut_paiement_reliquat"),
    ]

    operations = [
        migrations.AddField(
            model_name="avancesalaire",
            name="personnel",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="avances_salaire",
                to="scolarite.personnel",
            ),
        ),
        migrations.AlterField(
            model_name="avancesalaire",
            name="professeur",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="avances_salaire",
                to="scolarite.professeur",
            ),
        ),
        migrations.AddConstraint(
            model_name="avancesalaire",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(professeur__isnull=False, personnel__isnull=True)
                    | models.Q(professeur__isnull=True, personnel__isnull=False)
                ),
                name="scolarite_avance_prof_ou_personnel",
            ),
        ),
    ]
