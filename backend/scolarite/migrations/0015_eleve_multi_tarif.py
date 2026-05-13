from decimal import Decimal

from django.db import migrations, models


def copy_tarif_mensuel_to_scolarite(apps, schema_editor):
    Eleve = apps.get_model("scolarite", "Eleve")
    for e in Eleve.objects.all():
        old = getattr(e, "tarif_mensuel", None)
        if old is not None:
            e.tarif_scolarite = old
        else:
            e.tarif_scolarite = Decimal("0.00")
        e.save(update_fields=["tarif_scolarite"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("scolarite", "0014_eleve_tarif_mensuel_default"),
    ]

    operations = [
        migrations.AddField(
            model_name="eleve",
            name="tarif_scolarite",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=8),
        ),
        migrations.AddField(
            model_name="eleve",
            name="tarif_transport",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=8),
        ),
        migrations.AddField(
            model_name="eleve",
            name="tarif_etudes",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=8),
        ),
        migrations.AddField(
            model_name="eleve",
            name="tarif_autre",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=8),
        ),
        migrations.AddField(
            model_name="eleve",
            name="description_autre",
            field=models.CharField(blank=True, default="", help_text="Libellé du poste « Autre » (si tarif_autre > 0).", max_length=255),
        ),
        migrations.RunPython(copy_tarif_mensuel_to_scolarite, noop_reverse),
        migrations.RemoveField(
            model_name="eleve",
            name="tarif_mensuel",
        ),
    ]
