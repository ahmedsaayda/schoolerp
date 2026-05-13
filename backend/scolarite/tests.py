from datetime import date, time
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from django.utils import timezone

from authentification.models import AuditLog

from scolarite.models import (
    Classe,
    Depense,
    Eleve,
    EmploiDuTemps,
    MouvementBanque,
    Personnel,
    Pointage,
    PointagePersonnel,
    Professeur,
    SessionCaisse,
)


class ComptableDepenseAuditLogTests(TestCase):
    """Création d’une dépense par un comptable : le journal d’audit référence bien cet utilisateur."""

    def setUp(self):
        User = get_user_model()
        self.comptable = User.objects.create_user(
            username="comptable_audit",
            password="pass",
            role=User.Role.COMPTABLE,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.comptable)
        SessionCaisse.objects.create(ouvert_par=self.comptable)

    def test_depense_create_logs_comptable_as_utilisateur(self):
        r = self.client.post(
            "/api/depenses/",
            {
                "titre": "Test STEG",
                "categorie": "FACTURES",
                "montant": "55.00",
                "date_depense": "2026-04-28",
                "note": "Facture test audit",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(Depense.objects.filter(titre="Test STEG").exists())
        log = AuditLog.objects.filter(
            modele_concerne="Depense",
            action=AuditLog.Action.CREATION,
        ).latest("date")
        self.assertEqual(log.utilisateur_id, self.comptable.pk)


class PointageSearchFullNameTests(TestCase):
    """Recherche prof par nom complet : KPI heures programmées et lignes À venir (EDT futur)."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="tuser",
            password="pass",
            role=User.Role.ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.classe = Classe.objects.create(nom="1A", niveau="1SEC", section="")
        emb = date(2020, 1, 1)
        self.elise = Professeur.objects.create(
            nom="Mathieu",
            prenom="Élise",
            matiere="Math",
            telephone="12345678",
            tarif_horaire=Decimal("20.00"),
            date_embauche=emb,
        )
        self.other = Professeur.objects.create(
            nom="Dupont",
            prenom="Jean",
            matiere="Fr",
            telephone="87654321",
            tarif_horaire=Decimal("20.00"),
            date_embauche=emb,
        )
        # Une séance datée par lundi de mai 2026 (2 h chacune) — aligné avec le filtre plage mai 2026.
        for day in range(1, 32):
            wd = date(2026, 5, day)
            if wd.weekday() != 0:
                continue
            EmploiDuTemps.objects.create(
                professeur=self.elise,
                classe=self.classe,
                trimestre="T3",
                date_seance=wd,
                jour_semaine=wd.weekday(),
                heure_debut=time(8, 0),
                heure_fin=time(10, 0),
            )
            EmploiDuTemps.objects.create(
                professeur=self.other,
                classe=self.classe,
                trimestre="T3",
                date_seance=wd,
                jour_semaine=wd.weekday(),
                heure_debut=time(14, 0),
                heure_fin=time(15, 0),
            )

    def _mondays_in_may_2026(self) -> int:
        return sum(
            1
            for day in range(1, 32)
            if date(2026, 5, day).weekday() == date(2026, 5, 4).weekday()
        )

    @patch("scolarite.views.timezone.localdate")
    def test_full_name_search_future_range_heures_and_virtual_rows(self, mock_localdate):
        mock_localdate.return_value = date(2026, 4, 21)
        r = self.client.get(
            "/api/pointages/",
            {
                "start_date": "2026-05-01",
                "end_date": "2026-05-31",
                "search": "Élise Mathieu",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        ht = Decimal(body["summary"]["heures_theoriques"])
        self.assertGreater(ht, Decimal("0"))
        virtual = [
            row for row in body["results"] if row.get("statut_presence") == "A_VENIR"
        ]
        self.assertTrue(virtual)
        self.assertEqual(
            {row["professeur"] for row in virtual},
            {self.elise.id},
        )

    @patch("scolarite.views.timezone.localdate")
    def test_reverse_order_full_name_matches(self, mock_localdate):
        mock_localdate.return_value = date(2026, 4, 21)
        r = self.client.get(
            "/api/pointages/",
            {
                "start_date": "2026-05-01",
                "end_date": "2026-05-31",
                "search": "Mathieu Élise",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreater(Decimal(body["summary"]["heures_theoriques"]), Decimal("0"))

    @patch("scolarite.views.timezone.localdate")
    def test_search_elise_only_elise_kpi_and_virtual_rows(self, mock_localdate):
        """Un seul prénom : uniquement les heures / lignes EDT de cette prof."""
        mock_localdate.return_value = date(2026, 4, 21)
        r = self.client.get(
            "/api/pointages/",
            {
                "start_date": "2026-05-01",
                "end_date": "2026-05-31",
                "search": "Élise",
            },
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        mondays = self._mondays_in_may_2026()
        expect = (Decimal("2") * mondays).quantize(Decimal("0.01"))
        self.assertEqual(Decimal(body["summary"]["heures_theoriques"]), expect)
        virtual = [
            row for row in body["results"] if row.get("statut_presence") == "A_VENIR"
        ]
        self.assertTrue(virtual)
        self.assertTrue(all(row["professeur"] == self.elise.id for row in virtual))


class PointagePersonnelManquantsTests(TestCase):
    """GET pointage-personnel/pointage-manquants/ — fiches sans enregistrement le jour J."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="pagent2",
            password="pass",
            role=User.Role.POINTAGE_AGENT,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        emb = date(2020, 1, 1)
        self.p1 = Personnel.objects.create(
            nom="Fontaine",
            prenom="Hugo",
            telephone="12345678",
            salaire_mensuel=Decimal("1000.00"),
            date_embauche=emb,
        )
        self.p2 = Personnel.objects.create(
            nom="Matin",
            prenom="Léa",
            telephone="87654321",
            salaire_mensuel=Decimal("1000.00"),
            date_embauche=emb,
        )

    def test_pointage_manquants_only_sans_ligne(self):
        d = date(2026, 4, 24)
        PointagePersonnel.objects.create(
            personnel=self.p1,
            date=d,
            statut=PointagePersonnel.Statut.PRESENT,
        )
        r = self.client.get(
            f"/api/pointage-personnel/pointage-manquants/?date={d.isoformat()}"
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(len(body["manquants"]), 1)
        self.assertEqual(body["manquants"][0]["id"], self.p2.id)
        self.assertEqual(body["manquants"][0]["nom_complet"], "Léa Matin")


class ProfesseursPointageManquantsTests(TestCase):
    """GET pointages/professeurs-pointage-manquants/ — EDT du jour vs pointages."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="ptmanq",
            password="pass",
            role=User.Role.POINTAGE_AGENT,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        emb = date(2020, 1, 1)
        self.classe = Classe.objects.create(nom="T1A", niveau="1SEC", section="")
        self.prof = Professeur.objects.create(
            nom="Ben",
            prenom="Sami",
            matiere="Math",
            telephone="12345678",
            tarif_horaire=Decimal("20.00"),
            date_embauche=emb,
        )
        self.d = date(2026, 4, 24)
        self.edt = EmploiDuTemps.objects.create(
            professeur=self.prof,
            classe=self.classe,
            trimestre="T3",
            date_seance=self.d,
            jour_semaine=self.d.weekday(),
            heure_debut=time(8, 0),
            heure_fin=time(9, 30),
            matiere="",
        )

    def test_manquant_puis_pointe_creneau(self):
        r = self.client.get(
            f"/api/pointages/professeurs-pointage-manquants/?date={self.d.isoformat()}"
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["manquants"][0]["professeur_id"], self.prof.id)
        self.assertEqual(body["manquants"][0]["heure_debut"], "08:00")

        Pointage.objects.create(
            professeur=self.prof,
            date_cours=self.d,
            nombre_heures=Decimal("1.50"),
            statut_presence="PRESENTE",
            classe=self.classe,
            emploi_du_temps=self.edt,
        )
        r2 = self.client.get(
            f"/api/pointages/professeurs-pointage-manquants/?date={self.d.isoformat()}"
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["count"], 0)


class SessionCaisseSoldeInitialTests(TestCase):
    """Ouverture session : solde_initial = solde_final(session fermée précédente) − Σ versements banque."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="caisse_solde_user",
            password="pass",
            role=User.Role.ADMIN,
        )

    def test_first_session_solde_initial_zero(self):
        s = SessionCaisse(ouvert_par=self.user)
        s.save()
        self.assertEqual(s.solde_initial, Decimal("0.00"))

    def test_carry_full_when_no_versement(self):
        s1 = SessionCaisse(ouvert_par=self.user)
        s1.save()
        SessionCaisse.objects.filter(pk=s1.pk).update(
            statut=SessionCaisse.Statut.FERME,
            solde_final=Decimal("1000.00"),
            date_fermeture=timezone.now(),
        )
        s2 = SessionCaisse(ouvert_par=self.user)
        s2.save()
        self.assertEqual(s2.solde_initial, Decimal("1000.00"))

    def test_subtracts_versements_banque(self):
        s1 = SessionCaisse(ouvert_par=self.user)
        s1.save()
        SessionCaisse.objects.filter(pk=s1.pk).update(
            statut=SessionCaisse.Statut.FERME,
            solde_final=Decimal("1000.00"),
            date_fermeture=timezone.now(),
        )
        MouvementBanque.objects.create(
            type=MouvementBanque.Mouvement.VERSEMENT,
            montant=Decimal("800.00"),
            date=timezone.localdate(),
            session_caisse_id=s1.pk,
            justificatif_recu=False,
        )
        s2 = SessionCaisse(ouvert_par=self.user)
        s2.save()
        self.assertEqual(s2.solde_initial, Decimal("200.00"))

    def test_full_deposit_next_opens_at_zero(self):
        s1 = SessionCaisse(ouvert_par=self.user)
        s1.save()
        SessionCaisse.objects.filter(pk=s1.pk).update(
            statut=SessionCaisse.Statut.FERME,
            solde_final=Decimal("1000.00"),
            date_fermeture=timezone.now(),
        )
        MouvementBanque.objects.create(
            type=MouvementBanque.Mouvement.VERSEMENT,
            montant=Decimal("1000.00"),
            date=timezone.localdate(),
            session_caisse_id=s1.pk,
            justificatif_recu=True,
        )
        s2 = SessionCaisse(ouvert_par=self.user)
        s2.save()
        self.assertEqual(s2.solde_initial, Decimal("0.00"))

    def test_solde_initial_never_negative(self):
        s1 = SessionCaisse(ouvert_par=self.user)
        s1.save()
        SessionCaisse.objects.filter(pk=s1.pk).update(
            statut=SessionCaisse.Statut.FERME,
            solde_final=Decimal("100.00"),
            date_fermeture=timezone.now(),
        )
        MouvementBanque.objects.create(
            type=MouvementBanque.Mouvement.VERSEMENT,
            montant=Decimal("500.00"),
            date=timezone.localdate(),
            session_caisse_id=s1.pk,
            justificatif_recu=True,
        )
        s2 = SessionCaisse(ouvert_par=self.user)
        s2.save()
        self.assertEqual(s2.solde_initial, Decimal("0.00"))


class PointageAgentEleveApiTests(TestCase):
    """POINTAGE_AGENT : CRUD élève restreint (pas DELETE, pas impayes) ; classes en lecture seule."""

    def setUp(self):
        User = get_user_model()
        self.agent = User.objects.create_user(
            username="agent_ins",
            password="pass",
            role=User.Role.POINTAGE_AGENT,
        )
        Classe.objects.create(nom="1A", niveau="1SEC", section="")
        self.eleve = Eleve.objects.create(
            nom="Ben",
            prenom="Ali",
            nom_parent="Parent",
            telephone_1="12345678",
            date_naissance=date(2010, 1, 15),
            classe="1A",
            section="",
            adresse="Tunis",
            tarif_scolarite=Decimal("100.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.agent)

    def test_list_and_create_and_patch_eleve(self):
        r = self.client.get("/api/eleves/")
        self.assertEqual(r.status_code, 200, r.content)

        r = self.client.post(
            "/api/eleves/",
            {
                "nom": "Nouveau",
                "prenom": "Eleve",
                "nom_parent": "P",
                "telephone_1": "87654321",
                "date_naissance": "2011-03-20",
                "niveau": "1SEC",
                "classe": "1A",
                "section": "",
                "adresse": "Là",
                "tarif_scolarite": "50.00",
                "tarif_transport": "0",
                "tarif_etudes": "0",
                "tarif_autre": "0",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        new_id = r.json()["id"]

        r = self.client.patch(f"/api/eleves/{new_id}/", {"prenom": "Elève"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["prenom"], "Elève")

    def test_delete_eleve_forbidden(self):
        r = self.client.delete(f"/api/eleves/{self.eleve.pk}/")
        self.assertEqual(r.status_code, 403, r.content)

    def test_impayes_forbidden(self):
        r = self.client.get("/api/eleves/impayes/")
        self.assertEqual(r.status_code, 403, r.content)

    def test_classe_list_allowed(self):
        r = self.client.get("/api/classes/")
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(
            "/api/classes/",
            {"nom": "ZZ", "niveau": "7BASE", "section": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 403, r.content)
