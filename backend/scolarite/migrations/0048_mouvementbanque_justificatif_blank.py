import datetime
import scolarite.models
from decimal import Decimal
from django.db import migrations, models


def _backfill_pending_mouvements(apps, schema_editor):
    """
    For sessions closed with versement_promesse_en_attente=True but no pending MouvementBanque,
    create a MouvementBanque(justificatif_recu=False) as a tracking record.
    Bank balance is NOT credited here — it will be credited when completer_justificatif is called.
    """
    SessionCaisse = apps.get_model("scolarite", "SessionCaisse")
    MouvementBanque = apps.get_model("scolarite", "MouvementBanque")
    for session in SessionCaisse.objects.filter(
        versement_promesse_en_attente=True,
        statut="ferme",
    ):
        if MouvementBanque.objects.filter(
            session_caisse=session, justificatif_recu=False
        ).exists():
            continue
        close_date = (
            session.date_fermeture.date()
            if session.date_fermeture
            else datetime.date.today()
        )
        MouvementBanque.objects.create(
            type="versement",
            montant=session.montant_report_versement_banque,
            date=close_date,
            justificatif_file="",
            session_caisse=session,
            justificatif_recu=False,
        )


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("scolarite", "0047_mouvementbanque_justificatif_recu"),
    ]

    operations = [
        migrations.AlterField(
            model_name="mouvementbanque",
            name="justificatif_file",
            field=models.FileField(
                blank=True,
                default="",
                upload_to=scolarite.models._justificatif_banque_upload_to,
            ),
        ),
        migrations.AlterField(
            model_name="sessioncaisse",
            name="solde_initial",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text=(
                    "Montant en caisse \xe0 l'ouverture : solde final + report de versement "
                    "banque diff\xe9r\xe9 de la derni\xe8re session ferm\xe9e (ou 0)."
                ),
                max_digits=10,
            ),
        ),
        migrations.RunPython(_backfill_pending_mouvements, _noop),
    ]
