# Generated manually — report vers banque différé (sans justificatif) vers la session suivante.

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0044_mouvement_banque_justificatif_required"),
    ]

    operations = [
        migrations.AddField(
            model_name="sessioncaisse",
            name="montant_report_versement_banque",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text="Versement banque non effectué faute de justificatif ; ajouté au solde initial de la prochaine session.",
                max_digits=10,
            ),
        ),
    ]
