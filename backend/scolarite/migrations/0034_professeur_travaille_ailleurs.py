from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0033_eleve_tarification_speciale"),
    ]

    operations = [
        migrations.AddField(
            model_name="professeur",
            name="travaille_ailleurs",
            field=models.BooleanField(
                default=False,
                verbose_name="travaille dans un autre établissement",
            ),
        ),
        migrations.AddField(
            model_name="professeur",
            name="autre_etablissement",
            field=models.CharField(
                blank=True,
                default="",
                max_length=255,
                verbose_name="nom de l'autre établissement",
            ),
        ),
    ]
