from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0035_alter_paiementsalaire_primes"),
    ]

    operations = [
        migrations.RenameField(
            model_name="professeur",
            old_name="autre_etablissement",
            new_name="nom_autre_etablissement",
        ),
    ]
