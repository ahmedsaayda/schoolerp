import uuid
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone as django_timezone
from django.utils.deconstruct import deconstructible


def _default_depense_date():
    return django_timezone.localdate()

phone_regex = RegexValidator(
    regex=r"^\d{8}$",
    message="Le numéro doit contenir exactement 8 chiffres.",
)

# Système tunisien — niveaux (enseignement de base + secondaire jusqu’au bac).
NIVEAU_CHOICES = [
    ("7BASE", "7ème année de base"),
    ("8BASE", "8ème année de base"),
    ("9BASE", "9ème année de base"),
    ("1SEC", "1ère année secondaire"),
    ("2SEC", "2ème année secondaire"),
    ("3SEC", "3ème année secondaire"),
    ("4SEC", "4ème année secondaire (Baccalauréat)"),
]

# Sections à partir de la 2ème année secondaire ; tronc commun = chaîne vide.
SECONDARY_SECTION_CHOICES = [
    ("SCI_EXP", "Sciences expérimentales"),
    ("MATH", "Mathématiques"),
    ("ECO_GEST", "Économie et gestion"),
    ("LETTRES", "Lettres"),
    ("TECH", "Technique"),
    ("INFO", "Sciences de l'informatique"),
]

ELEVE_SECTION_CHOICES = [("", "Tronc commun")] + SECONDARY_SECTION_CHOICES
CLASSE_SECTION_CHOICES = ELEVE_SECTION_CHOICES

TRONC_NIVEAU_CODES = frozenset({"7BASE", "8BASE", "9BASE", "1SEC"})

# Année scolaire tunisienne : septembre → juin (codes mois calendaires « MM »).
ACADEMIC_MONTHS = (
    ("09", "Septembre"),
    ("10", "Octobre"),
    ("11", "Novembre"),
    ("12", "Décembre"),
    ("01", "Janvier"),
    ("02", "Février"),
    ("03", "Mars"),
    ("04", "Avril"),
    ("05", "Mai"),
    ("06", "Juin"),
)

ACADEMIC_MONTH_CODES = frozenset(code for code, _ in ACADEMIC_MONTHS)


def academic_months_elapsed_since_sept(d: date) -> int:
    """
    Mois de scolarité écoulés depuis septembre (inclus), plafonnés à 10.
    Sept–déc. : même année civile ; janv.–août : suite de la rentrée précédente.
    """
    m = d.month
    if m >= 9:
        elapsed = m - 9 + 1
    else:
        elapsed = (12 - 9 + 1) + m
    return min(max(elapsed, 0), 10)


@deconstructible
class Telephone2Validator:
    """Même règle que `phone_regex`, mais autorise vide / null (champ optionnel)."""

    message = "Le numéro doit contenir exactement 8 chiffres."

    def __call__(self, value):
        if value is None or value == "":
            return
        RegexValidator(regex=r"^\d{8}$", message=self.message)(value)

    def __eq__(self, other):
        return isinstance(other, Telephone2Validator)


class Classe(models.Model):
    nom = models.CharField(max_length=255)
    niveau = models.CharField(
        max_length=16,
        choices=NIVEAU_CHOICES,
        blank=True,
        default="",
        help_text="Niveau (référentiel tunisien).",
    )
    section = models.CharField(
        max_length=12,
        choices=CLASSE_SECTION_CHOICES,
        blank=True,
        default="",
        help_text="Filière (vide = tronc commun, 7ème à 1ère secondaire).",
    )
    capacite_max = models.PositiveSmallIntegerField(
        default=30,
        help_text="Effectif maximal réglementaire (30 par défaut).",
    )

    class Meta:
        verbose_name = "classe"
        verbose_name_plural = "classes"

    def __str__(self) -> str:
        return self.nom


class Eleve(models.Model):
    SECTION_CHOICES = ELEVE_SECTION_CHOICES

    nom = models.CharField(max_length=255)
    prenom = models.CharField(max_length=255)
    nom_parent = models.CharField(max_length=255)
    telephone_1 = models.CharField(max_length=8, validators=[phone_regex])
    telephone_2 = models.CharField(
        max_length=8,
        blank=True,
        null=True,
        validators=[Telephone2Validator()],
    )
    date_naissance = models.DateField()
    niveau = models.CharField(
        max_length=16,
        choices=NIVEAU_CHOICES,
        default="7BASE",
        help_text="Niveau scolaire (référentiel tunisien).",
    )
    classe = models.CharField(max_length=255)
    section = models.CharField(
        max_length=12,
        choices=SECTION_CHOICES,
        blank=True,
        default="",
        help_text="Tronc commun : laisser vide ; à partir de la 2ème secondaire : section obligatoire.",
    )
    adresse = models.TextField()
    tarif_scolarite = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    tarif_transport = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    tarif_etudes = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    tarif_autre = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    description_autre = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Libellé du poste « Autre » (si tarif_autre > 0).",
    )
    date_inscription = models.DateField(auto_now_add=True)
    is_gratuit = models.BooleanField(
        default=False,
        help_text="Exonération totale de frais : aucune dette comptable, tarifs enregistrés à 0.",
    )
    is_convention = models.BooleanField(
        default=False,
        help_text="Paiement différé / convention (fin d’année) — ne pas confondre avec l’impayé volontaire.",
    )
    montant_exoneration_reference_annuel = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Montant annuel de référence pour le manque à gagner comptable (exonération / gratuité), hors tarifs facturés.",
    )
    acompte = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text=(
            "Solde annuel signé : Σ encaissements − (tarif mensuel total × 10). "
            "Positif = acompte (crédit), négatif = reste à payer."
        ),
    )

    class Meta:
        verbose_name = "élève"
        verbose_name_plural = "élèves"

    def __str__(self) -> str:
        return f"{self.prenom} {self.nom}"

    def tarif_mensuel_total(self) -> Decimal:
        """Somme des quatre frais mensuels (échéance mensuelle totale)."""
        q = Decimal("0.01")
        return (
            Decimal(self.tarif_scolarite)
            + Decimal(self.tarif_transport)
            + Decimal(self.tarif_etudes)
            + Decimal(self.tarif_autre)
        ).quantize(q)


class Paiement(models.Model):
    METHODE_CHOICES = [
        ("ESPECE", "Espèce"),
        ("CHEQUE", "Chèque"),
        ("VIREMENT", "Virement"),
    ]

    TYPE_FRAIS_CHOICES = [
        ("SCOLARITE", "Scolarité"),
        ("INSCRIPTION", "Inscription"),
        ("ETUDES", "Études"),
        ("TRANSPORT", "Transport"),
        ("AUTRE", "Autre"),
    ]

    eleve = models.ForeignKey(
        Eleve,
        on_delete=models.CASCADE,
        related_name="paiements",
    )
    type_frais = models.CharField(
        max_length=20,
        choices=TYPE_FRAIS_CHOICES,
        default="SCOLARITE",
    )
    montant_du = models.DecimalField(max_digits=8, decimal_places=2)
    montant_paye = models.DecimalField(max_digits=8, decimal_places=2)
    date_encaissement = models.DateTimeField(auto_now_add=True)
    mois_concerne = models.DateField(null=True, blank=True)
    mois_concernes = models.JSONField(default=list, blank=True)
    methode = models.CharField(max_length=10, choices=METHODE_CHOICES)
    remarque = models.TextField(blank=True, null=True)
    session_caisse = models.ForeignKey(
        "SessionCaisse",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="paiements",
        help_text="Session de caisse (obligatoire pour les nouveaux encaissements).",
    )
    cree_par = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="paiements_enregistres",
        help_text="Utilisateur ayant enregistré l’encaissement (rapports caisse).",
    )

    class Meta:
        verbose_name = "paiement"
        verbose_name_plural = "paiements"

    @property
    def reste_a_payer(self):
        return self.montant_du - self.montant_paye

    def __str__(self) -> str:
        return f"Paiement {self.montant_paye} DT (dû {self.montant_du} DT) — {self.eleve}"


class Professeur(models.Model):
    nom = models.CharField(max_length=255)
    prenom = models.CharField(max_length=255)
    matiere = models.CharField(max_length=255)
    telephone = models.CharField(max_length=8, validators=[phone_regex])
    tarif_horaire = models.DecimalField(max_digits=8, decimal_places=2)
    date_embauche = models.DateField()
    travaille_ailleurs = models.BooleanField(
        default=False,
        verbose_name="travaille dans un autre établissement",
    )
    nom_autre_etablissement = models.CharField(
        "nom de l'autre établissement",
        max_length=255,
        blank=True,
        default="",
    )

    class Meta:
        verbose_name = "professeur"
        verbose_name_plural = "professeurs"

    def __str__(self) -> str:
        return f"{self.prenom} {self.nom}"


class EmploiDuTemps(models.Model):
    """Séance datée dans l’emploi du temps (lundi = 0 … dimanche = 6, aligné sur date_seance.weekday())."""

    TRIMESTRE_CHOICES = [
        ("T1", "Trimestre 1 (15 sept. 2025 – 21 déc. 2025)"),
        ("T2", "Trimestre 2 (5 janv. – 15 mars 2026)"),
        ("T3", "Trimestre 3 (30 mars – 30 juin 2026)"),
    ]

    professeur = models.ForeignKey(
        Professeur,
        on_delete=models.CASCADE,
        related_name="emplois_du_temps",
    )
    classe = models.ForeignKey(
        Classe,
        on_delete=models.CASCADE,
        related_name="creneaux_emploi",
        null=True,
        blank=True,
    )
    trimestre = models.CharField(
        max_length=2,
        choices=TRIMESTRE_CHOICES,
        default="T1",
        db_index=True,
        help_text="Trimestre scolaire couvert par cette séance (cohérent avec date_seance).",
    )
    date_seance = models.DateField(
        help_text="Date calendaire de la séance (jour_semaine doit correspondre au jour civil).",
    )
    jour_semaine = models.PositiveSmallIntegerField(
        help_text="0 = lundi, 6 = dimanche",
    )
    heure_debut = models.TimeField()
    heure_fin = models.TimeField()
    matiere = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Matière affichée (surcharge) ; si vide, on peut utiliser celle du professeur côté UI.",
    )
    salle = models.CharField(
        max_length=64,
        blank=True,
        default="",
    )

    class Meta:
        verbose_name = "emploi du temps"
        verbose_name_plural = "emplois du temps"
        ordering = ["date_seance", "jour_semaine", "heure_debut", "id"]

    @property
    def duree_heures(self) -> float:
        t0 = datetime.combine(date.min, self.heure_debut)
        t1 = datetime.combine(date.min, self.heure_fin)
        return (t1 - t0).total_seconds() / 3600.0

    def clean(self):
        from django.core.exceptions import ValidationError

        from scolarite.academic_trimesters import trimestre_for_date

        super().clean()
        if self.date_seance is not None:
            attendu = trimestre_for_date(self.date_seance)
            if attendu is None:
                raise ValidationError(
                    {
                        "date_seance": "Date invalide pour un cours (hors périodes actives, week-end ou vacances scolaires).",
                    }
                )
            if self.trimestre and self.trimestre != attendu:
                raise ValidationError(
                    {"trimestre": f"Incohérent avec date_seance : attendu {attendu} pour {self.date_seance}."}
                )

    def __str__(self) -> str:
        return f"{self.professeur} — {self.date_seance} ({self.trimestre}) {self.heure_debut}-{self.heure_fin}"


class Pointage(models.Model):
    class StatutPaiement(models.TextChoices):
        """Versement de salaire : une séance pointée ne peut être payée qu’une seule fois (liée au reçu)."""

        EN_ATTENTE = "en_attente", "En attente de paiement"
        PAYE = "paye", "Payé"

    STATUT_PRESENCE_CHOICES = [
        ("PRESENTE", "Présent"),
        ("ABSENTE", "Absent"),
        ("RETARD", "En retard"),
    ]

    professeur = models.ForeignKey(
        Professeur,
        on_delete=models.CASCADE,
        related_name="pointages",
    )
    date_cours = models.DateField()
    nombre_heures = models.DecimalField(max_digits=5, decimal_places=2)
    statut_presence = models.CharField(
        max_length=10,
        choices=STATUT_PRESENCE_CHOICES,
        default="PRESENTE",
    )
    est_paye = models.BooleanField(
        default=False,
        verbose_name="est payé",
        help_text="Déprécié : aligné sur statut_paiement (paye ⇒ True).",
    )
    statut_paiement = models.CharField(
        max_length=16,
        choices=StatutPaiement.choices,
        default=StatutPaiement.EN_ATTENTE,
        db_index=True,
        help_text="Seules les séances en attente entrent dans un nouveau calcul de salaire.",
    )
    recu_paiement = models.ForeignKey(
        "PaiementSalaire",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="pointages_lies",
        help_text="Reçu de salaire (versement) associé lorsque le pointage est payé.",
    )
    remarque = models.TextField(blank=True, null=True)
    classe = models.ForeignKey(
        Classe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pointages",
    )
    emploi_du_temps = models.ForeignKey(
        EmploiDuTemps,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pointages",
        help_text="Créneau d’origine (emploi du temps), pour rattacher la séance à un slot précis.",
    )

    class Meta:
        verbose_name = "pointage"
        verbose_name_plural = "pointages"
        ordering = ["date_cours", "id"]

    def __str__(self) -> str:
        return f"{self.professeur} — {self.date_cours} ({self.nombre_heures} h)"

    def save(self, *args, **kwargs):
        self.est_paye = self.statut_paiement == self.StatutPaiement.PAYE
        super().save(*args, **kwargs)


class AvanceSalaire(models.Model):
    professeur = models.ForeignKey(
        Professeur,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="avances_salaire",
    )
    personnel = models.ForeignKey(
        "Personnel",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="avances_salaire",
    )
    montant = models.DecimalField(max_digits=8, decimal_places=2)
    date = models.DateField()
    remarque = models.TextField(blank=True, null=True)
    est_solde = models.BooleanField(
        default=False,
        verbose_name="est soldée",
        help_text="True lorsque l’avance a été déduite / réconciliée lors d’un paiement de salaire.",
    )

    class Meta:
        verbose_name = "avance sur salaire"
        verbose_name_plural = "avances sur salaire"
        ordering = ["-date", "id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(professeur__isnull=False, personnel__isnull=True)
                    | models.Q(professeur__isnull=True, personnel__isnull=False)
                ),
                name="scolarite_avance_prof_ou_personnel",
            ),
        ]

    def __str__(self) -> str:
        who = self.personnel if self.personnel_id is not None else self.professeur
        return f"Avance {self.montant} — {who} ({self.date})"


class SessionCaisse(models.Model):
    class Statut(models.TextChoices):
        OUVERT = "ouvert", "Ouvert"
        FERME = "ferme", "Fermé"

    ouvert_par = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sessions_caisse",
    )
    date_ouverture = models.DateTimeField(auto_now_add=True)
    date_fermeture = models.DateTimeField(null=True, blank=True)
    solde_initial = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Montant en caisse à l’ouverture : solde final de la dernière session fermée moins la somme des versements banque (MouvementBanque) rattachés à cette session ; plancher 0.",
    )
    solde_actuel = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Solde théorique : solde initial + entrées (paiements) − sorties (dépenses).",
    )
    solde_final = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Montant réel compté en caisse à la fermeture.",
    )
    montant_report_versement_banque = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Versement banque non effectué faute de justificatif ; ajouté au solde initial de la prochaine session.",
    )
    versement_promesse_en_attente = models.BooleanField(
        default=False,
        help_text="Promesse de justificatif non régularisée : bloque l’ouverture d’une nouvelle session jusqu’à action sur la page Justificatifs.",
    )
    statut = models.CharField(
        max_length=10,
        choices=Statut.choices,
        default=Statut.OUVERT,
    )

    class Meta:
        verbose_name = "session de caisse"
        verbose_name_plural = "sessions de caisse"
        ordering = ["-date_ouverture", "-id"]

    def __str__(self) -> str:
        return f"Session caisse {self.date_ouverture} — {self.get_statut_display()}"

    def save(self, *args, **kwargs):
        q = Decimal("0.01")
        if self.pk is None:
            from django.db.models import Sum

            last = (
                type(self)
                .objects.filter(statut=self.Statut.FERME)
                .exclude(solde_final__isnull=True)
                .order_by("-date_fermeture", "-id")
                .first()
            )
            if last:
                base = last.solde_final.quantize(q)
                total_versements = (
                    MouvementBanque.objects.filter(
                        session_caisse_id=last.pk,
                        type=MouvementBanque.Mouvement.VERSEMENT,
                    ).aggregate(s=Sum("montant"))["s"]
                    or Decimal("0")
                ).quantize(q)
                remaining = (base - total_versements).quantize(q)
                if remaining < Decimal("0"):
                    remaining = Decimal("0.00")
                self.solde_initial = remaining
            else:
                self.solde_initial = Decimal("0.00").quantize(q)
            self.solde_actuel = self.solde_initial
        super().save(*args, **kwargs)

    def refresh_solde_actuel(self) -> Decimal:
        """Recalcule et persiste ``solde_actuel`` (paiements, dépenses, flux banque)."""
        from django.db.models import Sum

        q = Decimal("0.01")
        ent = (
            self.paiements.aggregate(s=Sum("montant_paye"))["s"] or Decimal("0")
        ).quantize(q)
        sor = (self.depenses.aggregate(s=Sum("montant"))["s"] or Decimal("0")).quantize(q)
        mv = self.mouvements_banque
        vers = (mv.filter(type=MouvementBanque.Mouvement.VERSEMENT).aggregate(s=Sum("montant"))["s"] or Decimal("0")).quantize(q)
        retr = (mv.filter(type=MouvementBanque.Mouvement.RETRAIT).aggregate(s=Sum("montant"))["s"] or Decimal("0")).quantize(q)
        new_solde = (self.solde_initial + ent - sor - vers + retr).quantize(q)
        type(self).objects.filter(pk=self.pk).update(solde_actuel=new_solde)
        self.solde_actuel = new_solde
        return new_solde


def _justificatif_banque_upload_to(instance, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"justificatifs_banque/{uuid.uuid4().hex}.{ext}"


class Banque(models.Model):
    """
    Caisse « banque » (compte interne) : un seul enregistrement (pk=1) en pratique.
    """

    solde_actuel = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    class Meta:
        verbose_name = "banque (interne)"
        verbose_name_plural = "banque (interne)"

    def __str__(self) -> str:
        return f"Banque — solde {self.solde_actuel}"


class CalendrierScolaire(models.Model):
    """
    Jours fériés et vacances scolaires — utilisés par le pointage et l’emploi du temps (intégration à venir).
    """

    class TypeEvenement(models.TextChoices):
        JOUR_FERIE = "jour_ferie", "Jour férié"
        VACANCES_SCOLAIRES = "vacances_scolaires", "Vacances scolaires"

    nom = models.CharField(max_length=200)
    date_debut = models.DateField()
    date_fin = models.DateField()
    type_evenement = models.CharField(
        max_length=32,
        choices=TypeEvenement.choices,
    )

    class Meta:
        ordering = ["date_debut", "id"]
        verbose_name = "entrée du calendrier scolaire"
        verbose_name_plural = "calendrier scolaire (vacances et jours fériés)"

    def __str__(self) -> str:
        return f"{self.nom} ({self.date_debut} → {self.date_fin})"


class MouvementBanque(models.Model):
    class Mouvement(models.TextChoices):
        VERSEMENT = "versement", "Versement"
        RETRAIT = "retrait", "Retrait"

    type = models.CharField(
        max_length=20,
        choices=Mouvement.choices,
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    justificatif_file = models.FileField(
        upload_to=_justificatif_banque_upload_to,
        blank=True,
        default="",
    )
    justificatif_recu = models.BooleanField(
        default=True,
        verbose_name="justificatif reçu",
        help_text="False pour un versement en attente (promesse) ; True une fois le fichier validé.",
    )
    session_caisse = models.ForeignKey(
        SessionCaisse,
        on_delete=models.PROTECT,
        related_name="mouvements_banque",
    )

    class Meta:
        verbose_name = "mouvement banque"
        verbose_name_plural = "mouvements banque"
        ordering = ["-date", "-id"]

    def __str__(self) -> str:
        return f"{self.get_type_display()} {self.montant} ({self.date})"


def session_caisse_ouverte():
    """Session actuellement ouverte, s’il y en a une."""
    return (
        SessionCaisse.objects.filter(statut=SessionCaisse.Statut.OUVERT)
        .order_by("-date_ouverture", "-id")
        .first()
    )


class Personnel(models.Model):
    """
    Personnel administratif et de soutien (hors enseignement) : RH, technique, cuisine, etc.
    """

    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Administratif"
        AGENT = "AGENT", "Agent"
        TECHNICIEN = "TECHNICIEN", "Technicien"
        CHAUFFEUR = "CHAUFFEUR", "Chauffeur"
        CUISINIER = "CUISINIER", "Cuisinier"
        SECURITE = "SECURITE", "Sécurité"
        ENTRETIEN = "ENTRETIEN", "Entretien"
        AUTRE = "AUTRE", "Autre"

    nom = models.CharField(max_length=255)
    prenom = models.CharField(max_length=255)
    telephone = models.CharField(max_length=8, validators=[phone_regex])
    adresse = models.TextField(blank=True, default="")
    role = models.CharField(
        max_length=32,
        choices=Role.choices,
        default=Role.AGENT,
    )
    salaire_mensuel = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Salaire mensuel de base (contrat), avant retenues d’absence.",
    )
    retenue_par_absence = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Montant déduit par jour marqué « Absent » dans le pointage personnel du mois.",
    )
    date_embauche = models.DateField()

    class Meta:
        verbose_name = "personnel (non enseignant)"
        verbose_name_plural = "personnel (non enseignant)"
        ordering = ["nom", "prenom", "id"]

    def __str__(self) -> str:
        return f"{self.prenom} {self.nom}"


class Depense(models.Model):
    """
    Dépenses d'exploitation (loyer, factures, fournitures, etc.) — distinctes des avances sur salaires.
    """

    class Categorie(models.TextChoices):
        LOYER = "LOYER", "Loyer"
        FACTURES = "FACTURES", "Factures (électricité, eau, etc.)"
        FOURNITURES = "FOURNITURES", "Fournitures"
        ENTRETIEN = "ENTRETIEN", "Entretien"
        SALAIRE = "SALAIRE", "Salaires"
        AUTRE = "AUTRE", "Autre"

    titre = models.CharField(max_length=255)
    categorie = models.CharField(
        max_length=32,
        choices=Categorie.choices,
        default=Categorie.AUTRE,
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    date_depense = models.DateField(default=_default_depense_date)
    note = models.TextField()
    piece_jointe = models.FileField(
        upload_to="depenses/justificatifs/",
        null=True,
        blank=True,
    )
    session_caisse = models.ForeignKey(
        SessionCaisse,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="depenses",
        help_text="Session de caisse (obligatoire pour les nouvelles dépenses).",
    )
    cree_par = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="depenses_enregistrees",
        help_text="Utilisateur ayant enregistré la dépense (rapports caisse).",
    )

    class Meta:
        verbose_name = "dépense"
        verbose_name_plural = "dépenses"
        ordering = ["-date_depense", "-id"]

    def __str__(self) -> str:
        return f"{self.titre} — {self.montant} ({self.get_categorie_display()})"


class PointagePersonnel(models.Model):
    """Présence / retard du personnel non enseignant (jour de pointage)."""

    class Statut(models.TextChoices):
        PRESENT = "PRESENT", "Présent"
        ABSENT = "ABSENT", "Absent"
        RETARD = "RETARD", "Retard"

    personnel = models.ForeignKey(
        Personnel,
        on_delete=models.CASCADE,
        related_name="pointages_personnel",
    )
    date = models.DateField()
    statut = models.CharField(max_length=16, choices=Statut.choices)

    class Meta:
        verbose_name = "pointage personnel"
        verbose_name_plural = "pointages personnel"
        ordering = ["-date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["personnel", "date"],
                name="uniq_pointagepersonnel_personnel_date",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.personnel} — {self.date} ({self.get_statut_display()})"


class PaiementSalaire(models.Model):
    """Paiement de salaire mensuel : fiche `Personnel` **ou** enseignant `Professeur` ; lié optionnellement à `Depense`."""

    personnel = models.ForeignKey(
        Personnel,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="paiements_salaire",
    )
    professeur = models.ForeignKey(
        Professeur,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="paiements_salaire_prof",
    )
    date_paiement = models.DateTimeField(default=django_timezone.now)
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    mois_concerne = models.DateField(
        help_text="Mois d’imputation (généralement le 1er du mois).",
    )
    depense = models.OneToOneField(
        Depense,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="paiement_salaire",
    )
    heures_liquidees = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Total des heures des pointages couverts par ce versement.",
    )
    salaire_base = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Brut (heures × tarif) pour ce versement, au moment du paiement.",
    )
    primes = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Primes ou bonus positifs (0 si non utilisé).",
    )
    primes_remarque = models.CharField(
        max_length=500,
        blank=True,
        default="",
        help_text="Libellé ou motif des primes / bonus (optionnel).",
    )
    nb_heures_prime = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Heures pour une prime calculée (ex. cours de rattrapage).",
    )
    tarif_prime = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Tarif horaire appliqué au calcul de la prime (rattrapage).",
    )
    avances_deduites = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Part du brut reprise sur les avances (brut + primes − net).",
    )
    tarif_horaire_snapshot = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Tarif horaire du professeur au moment du versement (PDF archivage).",
    )
    heures_reliquat_m_precedent = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Heures issues du mois M-1 (reliquat) liquidées sur ce reçu.",
    )
    reliquat_anticipatif_heures = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Heures prévues à l’EDT entre le jour suivant le paiement et la fin du mois de prestation, non encore pointées (note de report, paiement anticipé).",
    )

    class Meta:
        verbose_name = "paiement de salaire"
        verbose_name_plural = "paiements de salaire"
        ordering = ["-date_paiement", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        personnel__isnull=False,
                        professeur__isnull=True,
                    )
                    | models.Q(
                        personnel__isnull=True,
                        professeur__isnull=False,
                    )
                ),
                name="scolarite_paiementsalaire_personnel_xor_professeur",
            ),
        ]

    def __str__(self) -> str:
        who = self.personnel if self.personnel_id is not None else self.professeur
        return f"Salaire {who} — {self.montant} ({self.mois_concerne})"
