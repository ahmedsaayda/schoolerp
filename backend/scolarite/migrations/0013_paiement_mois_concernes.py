from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0012_classe_niveau_section"),
    ]

    operations = [
        migrations.AddField(
            model_name="paiement",
            name="mois_concernes",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
