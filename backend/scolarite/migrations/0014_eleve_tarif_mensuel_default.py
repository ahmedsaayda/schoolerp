from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0013_paiement_mois_concernes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="eleve",
            name="tarif_mensuel",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                max_digits=8,
            ),
        ),
    ]
