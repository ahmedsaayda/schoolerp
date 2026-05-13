# Promesse de justificatif — blocage ouverture session.

from django.db import migrations, models


def forwards_set_promesses(apps, schema_editor):
    SessionCaisse = apps.get_model("scolarite", "SessionCaisse")
    SessionCaisse.objects.filter(
        statut="ferme",
        montant_report_versement_banque__gt=0,
    ).update(versement_promesse_en_attente=True)


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0045_sessioncaisse_report_versement_banque"),
    ]

    operations = [
        migrations.AddField(
            model_name="sessioncaisse",
            name="versement_promesse_en_attente",
            field=models.BooleanField(
                default=False,
                help_text="Promesse de justificatif non régularisée : bloque l’ouverture d’une nouvelle session jusqu’à action sur la page Justificatifs.",
            ),
        ),
        migrations.RunPython(forwards_set_promesses, migrations.RunPython.noop),
    ]
