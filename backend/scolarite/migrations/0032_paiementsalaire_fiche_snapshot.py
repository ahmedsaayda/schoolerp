# Generated manually for PaiementSalaire fiche snapshot fields

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("scolarite", "0031_eleve_acompte"),
    ]

    operations = [
        migrations.AddField(
            model_name="paiementsalaire",
            name="heures_liquidees",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Total des heures des pointages couverts par ce versement.",
                max_digits=8,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="paiementsalaire",
            name="salaire_base",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Brut (heures × tarif) pour ce versement, au moment du paiement.",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="paiementsalaire",
            name="primes",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text="Primes ou bonus positifs (0 si non utilisé).",
                max_digits=12,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="paiementsalaire",
            name="avances_deduites",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Part du brut reprise sur les avances (brut + primes − net).",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="paiementsalaire",
            name="tarif_horaire_snapshot",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Tarif horaire du professeur au moment du versement (PDF archivage).",
                max_digits=10,
                null=True,
            ),
        ),
    ]
