# Generated manually — migrer montant → montant_du / montant_paye + type_frais

from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


def copier_montant_vers_nouveaux_champs(apps, schema_editor):
    Paiement = apps.get_model("scolarite", "Paiement")
    for p in Paiement.objects.all():
        m = p.montant
        p.montant_du = m
        p.montant_paye = m
        p.save(update_fields=["montant_du", "montant_paye"])


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0008_pointage_statut_presence"),
    ]

    operations = [
        migrations.AddField(
            model_name="paiement",
            name="type_frais",
            field=models.CharField(
                choices=[
                    ("SCOLARITE", "Scolarité"),
                    ("INSCRIPTION", "Inscription"),
                    ("ETUDES", "Études"),
                    ("TRANSPORT", "Transport"),
                    ("AUTRE", "Autre"),
                ],
                default="SCOLARITE",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="paiement",
            name="montant_du",
            field=models.DecimalField(
                decimal_places=2, max_digits=8, null=True
            ),
        ),
        migrations.AddField(
            model_name="paiement",
            name="montant_paye",
            field=models.DecimalField(
                decimal_places=2, max_digits=8, null=True
            ),
        ),
        migrations.AlterField(
            model_name="paiement",
            name="mois_concerne",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RunPython(copier_montant_vers_nouveaux_champs, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="paiement",
            name="montant",
        ),
        migrations.AlterField(
            model_name="paiement",
            name="montant_du",
            field=models.DecimalField(decimal_places=2, max_digits=8),
        ),
        migrations.AlterField(
            model_name="paiement",
            name="montant_paye",
            field=models.DecimalField(decimal_places=2, max_digits=8),
        ),
    ]
