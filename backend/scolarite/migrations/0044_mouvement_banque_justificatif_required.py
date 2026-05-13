# Supprime justificatif_recu, impose un fichier sur tout mouvement, et
# aligne le solde banque pour les mouvements « promesse » historiques (VERSEMENT).

import scolarite.models
from decimal import Decimal

from django.db import migrations, models, transaction


def _reverse_false_promises(apps, schema_editor):
    MouvementBanque = apps.get_model("scolarite", "MouvementBanque")
    Banque = apps.get_model("scolarite", "Banque")
    q = Decimal("0.01")
    with transaction.atomic():
        banque = Banque.objects.select_for_update().filter(pk=1).first()
        for m in MouvementBanque.objects.filter(justificatif_recu=False).order_by("id"):
            if m.type == "versement" and banque is not None:
                banque.solde_actuel = (banque.solde_actuel - m.montant).quantize(q)
            m.delete()
        if banque is not None:
            banque.save(update_fields=["solde_actuel"])


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("scolarite", "0043_justificatif_banque"),
    ]

    operations = [
        migrations.RunPython(_reverse_false_promises, _noop),
        migrations.RemoveField(
            model_name="mouvementbanque",
            name="justificatif_recu",
        ),
        migrations.AlterField(
            model_name="mouvementbanque",
            name="justificatif_file",
            field=models.FileField(upload_to=scolarite.models._justificatif_banque_upload_to),
        ),
    ]
