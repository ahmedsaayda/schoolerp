# Refonte du modèle Eleve (champs ERP + classe en texte)

from decimal import Decimal

from django.db import migrations, models


def vider_eleves(apps, schema_editor):
    Eleve = apps.get_model("scolarite", "Eleve")
    Eleve.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(vider_eleves, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="eleve",
            name="classe",
        ),
        migrations.RemoveField(
            model_name="eleve",
            name="email",
        ),
        migrations.RemoveField(
            model_name="eleve",
            name="statut",
        ),
        migrations.AddField(
            model_name="eleve",
            name="adresse",
            field=models.TextField(default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="classe",
            field=models.CharField(default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="date_inscription",
            field=models.DateField(auto_now_add=True),
        ),
        migrations.AddField(
            model_name="eleve",
            name="date_naissance",
            field=models.DateField(default="2000-01-01"),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="nom_parent",
            field=models.CharField(default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="tarif_mensuel",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                max_digits=8,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="telephone_1",
            field=models.CharField(default="", max_length=30),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="eleve",
            name="telephone_2",
            field=models.CharField(blank=True, max_length=30, null=True),
        ),
        migrations.AlterField(
            model_name="eleve",
            name="section",
            field=models.CharField(
                choices=[
                    ("MATH", "Math"),
                    ("SC", "Sciences"),
                    ("ECO", "Economie"),
                    ("LETTRE", "Lettre"),
                    ("SPORT", "Sport"),
                    ("BASE", "Tronc Commun / Base"),
                ],
                max_length=10,
            ),
        ),
    ]
