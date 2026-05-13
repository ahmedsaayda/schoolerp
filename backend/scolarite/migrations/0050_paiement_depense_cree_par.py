import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("scolarite", "0049_calendrier_scolaire"),
    ]

    operations = [
        migrations.AddField(
            model_name="paiement",
            name="cree_par",
            field=models.ForeignKey(
                blank=True,
                help_text="Utilisateur ayant enregistré l’encaissement (rapports caisse).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="paiements_enregistres",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="depense",
            name="cree_par",
            field=models.ForeignKey(
                blank=True,
                help_text="Utilisateur ayant enregistré la dépense (rapports caisse).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="depenses_enregistrees",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
