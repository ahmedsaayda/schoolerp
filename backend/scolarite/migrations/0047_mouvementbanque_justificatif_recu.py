# Réintroduit justificatif_recu pour suivre les versements en attente de justificatif.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0046_sessioncaisse_promesse_justificatif"),
    ]

    operations = [
        migrations.AddField(
            model_name="mouvementbanque",
            name="justificatif_recu",
            field=models.BooleanField(
                default=True,
                help_text="False pour un versement en attente (promesse) ; True une fois le fichier validé.",
                verbose_name="justificatif reçu",
            ),
        ),
    ]
