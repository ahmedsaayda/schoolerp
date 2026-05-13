# Generated manually for initial scolarite schema

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Classe",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nom", models.CharField(max_length=255)),
            ],
            options={
                "verbose_name": "classe",
                "verbose_name_plural": "classes",
            },
        ),
        migrations.CreateModel(
            name="Eleve",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("nom", models.CharField(max_length=255)),
                ("prenom", models.CharField(max_length=255)),
                ("email", models.EmailField(max_length=254)),
                ("section", models.CharField(max_length=100)),
                ("statut", models.CharField(max_length=50)),
                (
                    "classe",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="eleves",
                        to="scolarite.classe",
                    ),
                ),
            ],
            options={
                "verbose_name": "élève",
                "verbose_name_plural": "élèves",
            },
        ),
    ]
