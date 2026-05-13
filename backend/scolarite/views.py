import calendar
import logging
from collections import defaultdict
import django_filters
from datetime import date, datetime, time as time_midnight, timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)

from django.db import transaction
from django.conf import settings as django_settings
from django.shortcuts import get_object_or_404
from django.db.models import (
    Case,
    Count,
    DecimalField,
    Exists,
    ExpressionWrapper,
    F,
    FloatField,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Cast, Coalesce, Concat, Greatest, TruncMonth
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend, FilterSet
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from authentification.audit import audit_user
from authentification.models import User
from authentification.permissions import (
    IsAdminComptableOrPointageEleveAccess,
    IsAdminComptableOrPointageRead,
    IsAdminOrComptable,
    IsAdminOrComptableFinancial,
    IsAdminOrPointageAgentWrite,
    IsAdminRole,
    effective_role,
)

from .audit_logs import (
    build_diff,
    log_depense_create,
    log_depense_delete,
    log_depense_update,
    log_eleve_create,
    log_eleve_delete,
    log_eleve_update,
    log_paiement_create,
    log_paiement_delete,
    log_paiement_update,
    log_pointage_create,
    log_pointage_delete,
    log_pointage_update,
    log_session_caisse_delete,
    log_session_caisse_fermeture,
    log_session_caisse_ouverture,
    model_snapshot,
)
from .rapport_auteur import auteur_rapport_payload
from .models import (
    ACADEMIC_MONTHS,
    AvanceSalaire,
    CalendrierScolaire,
    Classe,
    Banque,
    Depense,
    Eleve,
    EmploiDuTemps,
    NIVEAU_CHOICES,
    Paiement,
    PaiementSalaire,
    Personnel,
    Pointage,
    PointagePersonnel,
    Professeur,
    MouvementBanque,
    SessionCaisse,
    session_caisse_ouverte,
)

_ELEVE_TARIF_MENSUEL_SUM = (
    F("tarif_scolarite") + F("tarif_transport") + F("tarif_etudes") + F("tarif_autre")
)
from .academic_trimesters import (
    count_school_session_days_in_range,
    generate_seances_for_trimestre,
    trimestre_date_range,
    trimestre_period_containing_date,
)
from .serializers import (
    AvanceSalaireSerializer,
    CalendrierScolaireSerializer,
    ClasseSerializer,
    DepenseSerializer,
    EleveSerializer,
    EmploiDuTempsSerializer,
    PaiementSalaireListSerializer,
    PaiementSalaireProfHistoriqueSerializer,
    PaiementSalaireWriteSerializer,
    PaiementSerializer,
    PersonnelDetailSerializer,
    PersonnelSerializer,
    PointagePersonnelBulkSerializer,
    PointagePersonnelSerializer,
    PointageSerializer,
    ProfesseurSerializer,
    MouvementBanqueListeSerializer,
    GenerateFromTemplateEmploiSerializer,
    RemplacerModeleAnneeSerializer,
    RemplacerModeleTrimestreSerializer,
    SessionCaissePromesseJustificatifSerializer,
    SessionCaisseSerializer,
)


def _paiement_couvre_mois_calendaire(mois: int, annee: int, mconc, mlist) -> bool:
    """Mois réglé si `mois_concerne` tombe sur (mois, année) ou si le code « MM » est dans `mois_concernes`."""
    code = f"{int(mois):02d}"
    if mconc is not None and mconc.year == annee and mconc.month == mois:
        return True
    if mlist:
        for item in mlist:
            if str(item).strip().zfill(2) == code:
                return True
    return False


def _first_day_current_month() -> date:
    t = timezone.localdate()
    return date(t.year, t.month, 1)


def _annotate_is_paid_current_month(qs, *, for_professeur: bool):
    first = _first_day_current_month()
    if for_professeur:
        sub = PaiementSalaire.objects.filter(
            professeur_id=OuterRef("pk"),
            mois_concerne=first,
        )
    else:
        sub = PaiementSalaire.objects.filter(
            personnel_id=OuterRef("pk"),
            mois_concerne=first,
        )
    return qs.annotate(is_paid_current_month=Exists(sub))


def _normalized_mois_codes_couverts_paiement(mconc, mlist) -> list[str]:
    """Codes « MM » distincts couverts par le paiement (liste JSON puis `mois_concerne`)."""
    seen: set[str] = set()
    ordered: list[str] = []
    if mlist:
        for item in mlist:
            c = str(item).strip().zfill(2)
            if len(c) == 2 and c.isdigit() and c not in seen:
                seen.add(c)
                ordered.append(c)
    if mconc is not None:
        c = f"{int(mconc.month):02d}"
        if c not in seen:
            seen.add(c)
            ordered.append(c)
    return ordered


def _montant_paiement_attribue_mois_calendaire(
    mois: int,
    annee: int,
    montant_paye,
    mconc,
    mlist,
) -> Decimal:
    """
    Part du `montant_paye` affectée au mois calendaire (mois, année).

    Si plusieurs mois sont listés pour le même encaissement, le montant est réparti
    équitablement (évite de compter 3× un versement trimestriel pour un seul mois).
    """
    if not _paiement_couvre_mois_calendaire(mois, annee, mconc, mlist):
        return Decimal("0")
    paye = montant_paye or Decimal("0")
    if not isinstance(paye, Decimal):
        paye = Decimal(str(paye))
    paye = paye.quantize(Decimal("0.01"))
    code_cible = f"{int(mois):02d}"
    codes = _normalized_mois_codes_couverts_paiement(mconc, mlist)
    if not codes or code_cible not in codes:
        return Decimal("0")
    n = len(codes)
    if n <= 1:
        return paye
    return (paye / Decimal(n)).quantize(Decimal("0.01"))


_TRIMESTRE_ACADEMIC_MONTH_CODES: dict[str, frozenset[str]] = {
    "T1": frozenset({"09", "10", "11", "12"}),
    "T2": frozenset({"01", "02", "03"}),
    "T3": frozenset({"04", "05", "06"}),
}


def _paiement_touche_codes_mois_academiques(mconc, mlist, codes: frozenset[str]) -> bool:
    """True si le paiement couvre au moins un mois scolaire dont le code est dans `codes`."""
    if mlist:
        for item in mlist:
            if str(item).strip().zfill(2) in codes:
                return True
    if mconc is not None:
        c = f"{mconc.month:02d}"
        if c in codes:
            return True
    return False


def _reliquat_lignes_pour_trimestre(tri: str) -> Decimal:
    """
    Somme des reliquats (montant_du − montant_paye) sur les lignes sous-payées
    dont les mois couverts touchent un mois académique du trimestre (T1…T3).
    """
    codes = _TRIMESTRE_ACADEMIC_MONTH_CODES.get(tri)
    if not codes:
        return Decimal("0")
    total = Decimal("0")
    for mdu, mpay, mconc, mlist in Paiement.objects.filter(montant_du__gt=F("montant_paye")).values_list(
        "montant_du", "montant_paye", "mois_concerne", "mois_concernes"
    ).iterator(chunk_size=500):
        if not _paiement_touche_codes_mois_academiques(mconc, mlist, codes):
            continue
        du = mdu if isinstance(mdu, Decimal) else Decimal(str(mdu))
        pay = mpay if isinstance(mpay, Decimal) else Decimal(str(mpay))
        rel = (du - pay).quantize(Decimal("0.01"))
        if rel > 0:
            total += rel
    return total.quantize(Decimal("0.01"))


def _eleve_ids_ayant_paiement_pour_mois(mois: int, annee: int) -> set[int]:
    paid: set[int] = set()
    for eid, mconc, mlist in Paiement.objects.values_list(
        "eleve_id", "mois_concerne", "mois_concernes"
    ).iterator(chunk_size=500):
        if _paiement_couvre_mois_calendaire(mois, annee, mconc, mlist):
            paid.add(eid)
    return paid


def _verify_eleve_financials_after_paiement(eleve_id: int) -> None:
    """
    Après création d'un paiement : vérifie que l'annotation « liste élèves »
    (total_paye, reste_a_payer) coïncide avec un recalcul direct sur les lignes.
    Journalise un avertissement si incohérence (ne bloque pas la requête : données déjà persistées).
    """
    dec = DecimalField(max_digits=14, decimal_places=2)
    row = (
        Eleve.objects.filter(pk=eleve_id)
        .annotate(
            total_paye=Coalesce(
                Sum("paiements__montant_paye"),
                Value(Decimal("0")),
                output_field=dec,
            ),
            _tm=_ELEVE_TARIF_MENSUEL_SUM,
        )
        .annotate(
            reste_a_payer=Greatest(
                ExpressionWrapper(
                    F("_tm") * Value(Decimal("10")) - F("total_paye"),
                    output_field=dec,
                ),
                Value(Decimal("0")),
                output_field=dec,
            ),
            credit_eleve=Greatest(
                ExpressionWrapper(
                    F("total_paye") - F("_tm") * Value(Decimal("10")),
                    output_field=dec,
                ),
                Value(Decimal("0")),
                output_field=dec,
            ),
        )
        .values("total_paye", "reste_a_payer", "credit_eleve", "_tm")
        .first()
    )
    if row is None:
        logger.warning("verify_eleve_financials: élève %s introuvable après paiement", eleve_id)
        return
    tp_direct = Paiement.objects.filter(eleve_id=eleve_id).aggregate(
        x=Coalesce(Sum("montant_paye"), Value(Decimal("0"), output_field=dec))
    )["x"]
    if tp_direct != row["total_paye"]:
        logger.warning(
            "verify_eleve_financials: élève %s total_paye annotate (%s) != agrégat direct (%s)",
            eleve_id,
            row["total_paye"],
            tp_direct,
        )
    tm = row["_tm"]
    if not isinstance(tm, Decimal):
        tm = Decimal(str(tm))
    diff_annuel = tm * Decimal("10") - tp_direct
    reste_manual = diff_annuel if diff_annuel > Decimal("0") else Decimal("0")
    credit_manual = abs(diff_annuel) if diff_annuel < Decimal("0") else Decimal("0")
    if row["reste_a_payer"] != reste_manual:
        logger.warning(
            "verify_eleve_financials: élève %s reste_a_payer annotate (%s) != recalculé (%s)",
            eleve_id,
            row["reste_a_payer"],
            reste_manual,
        )
    if row.get("credit_eleve") != credit_manual:
        logger.warning(
            "verify_eleve_financials: élève %s credit_eleve annotate (%s) != recalculé (%s)",
            eleve_id,
            row.get("credit_eleve"),
            credit_manual,
        )




class StatsDashboardLegacyView(APIView):
    """
    Statistiques pour le mois calendaire en cours (timezone du projet).

    - encaissements_mois : somme des `montant_paye` pour les paiements couvrant ce mois
      (`mois_concerne` ou code présent dans `mois_concernes`).
    - total_dette_eleves : somme des dettes par ligne max(0, montant_du − montant_paye) sur tous les paiements.
    - dettes_impayees : somme des soldes annuels dus max(0, tarif×10 − total encaissé) pour tous les élèves
      (« reste à recouvrer » annuel agrégé).
    - heures_profs_a_payer / argent_du_profs : pointages avec `est_paye=False` et
      présence autre qu'absence (`statut_presence` PRESENTE ou RETARD) ;
      le champ heures est `nombre_heures`.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        now = timezone.now()
        mois = now.month
        annee = now.year

        total_eleves = Eleve.objects.count()

        encaissements_mois = Decimal("0")
        for paye, mconc, mlist in Paiement.objects.values_list(
            "montant_paye", "mois_concerne", "mois_concernes"
        ).iterator(chunk_size=500):
            encaissements_mois += _montant_paiement_attribue_mois_calendaire(
                mois, annee, paye, mconc, mlist
            )

        total_dette_eleves = (
            Paiement.objects.aggregate(
                s=Sum(
                    Greatest(
                        ExpressionWrapper(
                            F("montant_du") - F("montant_paye"),
                            output_field=DecimalField(max_digits=14, decimal_places=2),
                        ),
                        Value(Decimal("0")),
                    )
                )
            )["s"]
            or Decimal("0")
        )

        dec2 = DecimalField(max_digits=14, decimal_places=2)
        eleves_reste_annuel = (
            Eleve.objects.annotate(
                _tp=Coalesce(
                    Sum("paiements__montant_paye"),
                    Value(Decimal("0")),
                    output_field=dec2,
                ),
                _tm=_ELEVE_TARIF_MENSUEL_SUM,
            ).annotate(
                _reste_annuel=Greatest(
                    ExpressionWrapper(
                        F("_tm") * Value(Decimal("10")) - F("_tp"),
                        output_field=dec2,
                    ),
                    Value(Decimal("0")),
                    output_field=dec2,
                ),
            )
        )
        dettes_impayees = eleves_reste_annuel.aggregate(s=Sum("_reste_annuel"))["s"] or Decimal("0")

        pointages_non_payes = Pointage.objects.filter(
            statut_paiement=Pointage.StatutPaiement.EN_ATTENTE,
            statut_presence__in=["PRESENTE", "RETARD"],
        )

        heures_profs_a_payer = (
            pointages_non_payes.aggregate(s=Sum("nombre_heures"))["s"] or Decimal("0")
        )

        argent_du_profs = pointages_non_payes.aggregate(
            s=Sum(
                ExpressionWrapper(
                    F("nombre_heures") * F("professeur__tarif_horaire"),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                )
            )
        )["s"] or Decimal("0")

        return Response(
            {
                "total_eleves": total_eleves,
                "encaissements_mois": encaissements_mois,
                "dettes_impayees": dettes_impayees,
                "heures_profs_a_payer": heures_profs_a_payer,
                "argent_du_profs": argent_du_profs,
                "total_dette_eleves": total_dette_eleves,
            }
        )


_DASH_MOIS_COURT = {
    "09": "Sept",
    "10": "Oct",
    "11": "Nov",
    "12": "Déc",
    "01": "Jan",
    "02": "Fév",
    "03": "Mar",
    "04": "Avr",
    "05": "Mai",
    "06": "Juin",
}
_FR_CAL_MONTHS = (
    "",
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)


def _school_year_start_end(today: date) -> tuple[date, date]:
    """Année scolaire : 1er sept. → 30 juin."""
    start = _academic_year_start(today)
    end = date(start.year + 1, 6, 30)
    return start, end


def _iter_calendar_months(d0: date, d1: date):
    """Itère sur chaque mois calendaire touchant l'intervalle [d0, d1] (bornes inclusives)."""
    y, m = d0.year, d0.month
    end_y, end_m = d1.year, d1.month
    while y < end_y or (y == end_y and m <= end_m):
        yield y, m
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1


def _dash_chart_axis_label(month: int, year: int) -> str:
    """Libellé court pour l'axe du graphique (ex. « Avr 2026 »)."""
    code = f"{int(month):02d}"
    if code in _DASH_MOIS_COURT:
        return f"{_DASH_MOIS_COURT[code]} {year}"
    name = _FR_CAL_MONTHS[int(month)]
    abbr = name[:3].replace("û", "u").title()
    return f"{abbr} {year}"


class DashboardStatsView(APIView):
    """
    Agrégats pour le tableau de bord (GET /api/dashboard/stats/).

    - recettes_periode : somme des montant_paye ; si ``start_date`` / ``end_date`` sont passés,
      restreinte aux encaissements dont ``date_encaissement`` tombe dans l'intervalle (bornes inclusives).
    - reste_a_recouvrer : somme (montant_du - montant_paye) sur les lignes où montant_du > montant_paye.
    - top_impayes : top 5 élèves par reste à payer annuel max(0, tarif mensuel × 10 − Σ montant_paye),
      hors gratuits et hors conventionnés (``is_convention``).
    - evolution_encaissements / encaissements_par_mois : sommes par mois d'encaissement (date_encaissement),
      pour les mois scolaires sept. → juin de l'année scolaire courante ; si ``?start_date=&end_date=`` (ISO),
      uniquement les mois calendaires compris dans cet intervalle (même agrégat, filtré sur les encaissements).
    - objectif_journalier : cible = max(reliquat scolaire sur le trimestre calendaire courant, déficit du mois) ;
      divisé par le nombre de jours d'école restants (lun–ven hors vacances) jusqu'à la fin du trimestre
      (`academic_trimesters`). 0 si pas dans une période T1–T3 ou 0 jours actifs restants.
    - kpis.pourcentage_soldes : part des élèves dont l'annuité (tarif × 10) est exactement couverte
      (ni dette, ni crédit), comme la part « À jour » de la répartition des statuts.
    - total_depenses : somme des ``montant`` des ``Depense`` sur la période (``date_depense`` dans
      l'intervalle si ``start_date``/``end_date`` ; sinon toutes les dépenses).
    - ratio_depenses_recettes : ``(total_depenses / recettes_periode) * 100`` ; 0 si recettes 0.
    - depenses_par_categorie : montants par ``categorie`` (pour le graphique).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptable]

    def get(self, request):
        today = timezone.localdate()
        mois_cal = today.month
        annee_cal = today.year

        dec2 = DecimalField(max_digits=16, decimal_places=2)

        tz = timezone.get_current_timezone()
        raw_start = request.query_params.get("start_date")
        raw_end = request.query_params.get("end_date")
        has_start = raw_start not in (None, "")
        has_end = raw_end not in (None, "")
        if has_start != has_end:
            return Response(
                {"detail": "Les paramètres start_date et end_date doivent être fournis ensemble."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start_d = _parse_iso_date_param(raw_start) if has_start else None
        end_d = _parse_iso_date_param(raw_end) if has_end else None
        filter_active = start_d is not None and end_d is not None
        if filter_active and (start_d is None or end_d is None):
            return Response(
                {"detail": "Format de date invalide (attendu YYYY-MM-DD)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if filter_active and start_d > end_d:
            return Response(
                {"detail": "start_date doit être antérieur ou égal à end_date."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if filter_active:
            start_enc = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
            end_enc = timezone.make_aware(datetime.combine(end_d, time_midnight(23, 59, 59, 999999)), tz)
        else:
            start_enc = end_enc = None

        pay_recettes_qs = Paiement.objects.all()
        if filter_active:
            pay_recettes_qs = pay_recettes_qs.filter(
                date_encaissement__gte=start_enc,
                date_encaissement__lte=end_enc,
            )
        recettes_periode = (
            pay_recettes_qs.aggregate(s=Coalesce(Sum("montant_paye"), Value(Decimal("0")), output_field=dec2))[
                "s"
            ]
            or Decimal("0")
        )
        if not isinstance(recettes_periode, Decimal):
            recettes_periode = Decimal(str(recettes_periode))
        recettes_periode = recettes_periode.quantize(Decimal("0.01"))

        depense_qs = Depense.objects.all()
        if filter_active:
            depense_qs = depense_qs.filter(date_depense__gte=start_d, date_depense__lte=end_d)
        total_depenses = depense_qs.aggregate(
            s=Coalesce(Sum("montant"), Value(Decimal("0")), output_field=dec2)
        )["s"] or Decimal("0")
        if not isinstance(total_depenses, Decimal):
            total_depenses = Decimal(str(total_depenses))
        total_depenses = total_depenses.quantize(Decimal("0.01"))

        if recettes_periode > 0:
            ratio_depenses_recettes = float(
                ((total_depenses / recettes_periode) * Decimal("100")).quantize(Decimal("0.1"))
            )
        else:
            ratio_depenses_recettes = 0.0

        _cat_labels = dict(Depense.Categorie.choices)
        depenses_par_categorie = []
        for row in (
            depense_qs.values("categorie")
            .annotate(
                subtotal=Coalesce(Sum("montant"), Value(Decimal("0")), output_field=dec2),
            )
            .order_by("categorie")
        ):
            sub = row["subtotal"] or Decimal("0")
            if not isinstance(sub, Decimal):
                sub = Decimal(str(sub))
            sub = sub.quantize(Decimal("0.01"))
            c = row.get("categorie") or Depense.Categorie.AUTRE
            depenses_par_categorie.append(
                {
                    "categorie": c,
                    "name": _cat_labels.get(c, c),
                    "montant": str(sub),
                }
            )

        reste_a_recouvrer = (
            Paiement.objects.filter(montant_du__gt=F("montant_paye")).aggregate(
                s=Coalesce(
                    Sum(
                        ExpressionWrapper(
                            F("montant_du") - F("montant_paye"),
                            output_field=dec2,
                        )
                    ),
                    Value(Decimal("0")),
                    output_field=dec2,
                )
            )["s"]
            or Decimal("0")
        )
        if not isinstance(reste_a_recouvrer, Decimal):
            reste_a_recouvrer = Decimal(str(reste_a_recouvrer))
        reste_a_recouvrer = reste_a_recouvrer.quantize(Decimal("0.01"))

        encaissements_mois_calendaire = Decimal("0")
        for paye, mconc, mlist in Paiement.objects.values_list(
            "montant_paye", "mois_concerne", "mois_concernes"
        ).iterator(chunk_size=500):
            encaissements_mois_calendaire += _montant_paiement_attribue_mois_calendaire(
                mois_cal, annee_cal, paye, mconc, mlist
            )

        sum_tarif_mensuel_agg = _sum_tarif_mensuel_all_eleves()
        expected_month = sum_tarif_mensuel_agg.quantize(Decimal("0.01"))
        deficit_mois_courant = (expected_month - encaissements_mois_calendaire).quantize(Decimal("0.01"))
        if deficit_mois_courant < Decimal("0"):
            deficit_mois_courant = Decimal("0")

        tri_period = trimestre_period_containing_date(today)
        if tri_period is not None:
            tri, _a, t_end = tri_period
            reliquat_tri = _reliquat_lignes_pour_trimestre(tri)
            restant_cible = max(reliquat_tri, deficit_mois_courant)
            jours_scolaires_restants = count_school_session_days_in_range(today, t_end)
            if jours_scolaires_restants > 0:
                objectif_journalier = (restant_cible / Decimal(jours_scolaires_restants)).quantize(
                    Decimal("0.01")
                )
            else:
                objectif_journalier = Decimal("0")
        else:
            objectif_journalier = Decimal("0")

        attendu_annuel = (sum_tarif_mensuel_agg * Decimal("10")).quantize(Decimal("0.01"))
        if attendu_annuel > 0:
            taux_recouvrement_pct = float(
                ((recettes_periode / attendu_annuel) * Decimal("100")).quantize(Decimal("0.1"))
            )
        else:
            taux_recouvrement_pct = 0.0

        mois_courant_code = f"{today.month:02d}"
        mois_courant_label = f"{_FR_CAL_MONTHS[today.month].capitalize()} {today.year}"

        top_qs = (
            Eleve.objects.annotate(
                total_paye=Coalesce(Sum("paiements__montant_paye"), Value(Decimal("0")), output_field=dec2),
            )
            .annotate(_tm=_ELEVE_TARIF_MENSUEL_SUM)
            .annotate(
                _reste_a_payer=Greatest(
                    ExpressionWrapper(
                        F("_tm") * Value(Decimal("10")) - F("total_paye"),
                        output_field=dec2,
                    ),
                    Value(Decimal("0")),
                    output_field=dec2,
                ),
            )
            .filter(_reste_a_payer__gt=0)
            .exclude(is_gratuit=True)
            .exclude(is_convention=True)
            .order_by("-_reste_a_payer")[:5]
        )
        # Vérif. temporaire : la clause convention doit apparaître dans le WHERE (à retirer ou passer en DEBUG si bruyant).
        if django_settings.DEBUG:
            logger.debug("[DashboardStatsView top_impayes] SQL=%s", str(top_qs.query))

        top_impayes = []
        for e in top_qs:
            d = getattr(e, "_reste_a_payer")
            if not isinstance(d, Decimal):
                d = Decimal(str(d))
            top_impayes.append(
                {
                    "id": e.id,
                    "nom_prenom": f"{e.prenom} {e.nom}".strip(),
                    "classe": e.classe or "",
                    "reste_a_payer": str(d.quantize(Decimal("0.01"))),
                }
            )

        month_totals: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))

        if filter_active:
            chart_pay_qs = Paiement.objects.filter(
                date_encaissement__gte=start_enc,
                date_encaissement__lte=end_enc,
            )
            chart_range_start, chart_range_end = start_d, end_d
        else:
            sy_start, sy_end = _school_year_start_end(today)
            start_dt = timezone.make_aware(datetime.combine(sy_start, time_midnight.min), tz)
            end_dt = timezone.make_aware(datetime.combine(sy_end, time_midnight(23, 59, 59, 999999)), tz)
            chart_pay_qs = Paiement.objects.filter(
                date_encaissement__gte=start_dt, date_encaissement__lte=end_dt
            )
            chart_range_start, chart_range_end = sy_start, sy_end

        for row in (
            chart_pay_qs.annotate(m=TruncMonth("date_encaissement"))
            .values("m")
            .annotate(total=Sum("montant_paye"))
        ):
            m = row["m"]
            if m is None:
                continue
            if timezone.is_naive(m):
                m = timezone.make_aware(m, tz)
            ml = timezone.localtime(m, tz)
            key = (ml.year, ml.month)
            t = row["total"] or Decimal("0")
            if not isinstance(t, Decimal):
                t = Decimal(str(t))
            month_totals[key] += t.quantize(Decimal("0.01"))

        encaissements_par_mois = []
        evolution_encaissements = []
        if filter_active:
            for y, im in _iter_calendar_months(chart_range_start, chart_range_end):
                code = f"{im:02d}"
                amt = month_totals.get((y, im), Decimal("0"))
                amt_s = str(amt.quantize(Decimal("0.01")))
                label_court = _dash_chart_axis_label(im, y)
                encaissements_par_mois.append(
                    {"code": code, "label_court": label_court, "montant": amt_s}
                )
                evolution_encaissements.append(
                    {
                        "annee": y,
                        "mois_calendaire": im,
                        "periode": f"{y}-{code}",
                        "code": code,
                        "label_court": label_court,
                        "montant": amt_s,
                    }
                )
        else:
            for code, _full in ACADEMIC_MONTHS:
                im = int(code, 10)
                if im >= 9:
                    sy = sy_start.year
                else:
                    sy = sy_end.year
                amt = month_totals.get((sy, im), Decimal("0"))
                amt_s = str(amt.quantize(Decimal("0.01")))
                label_court = _DASH_MOIS_COURT.get(code, code)
                encaissements_par_mois.append(
                    {"code": code, "label_court": label_court, "montant": amt_s}
                )
                evolution_encaissements.append(
                    {
                        "annee": sy,
                        "mois_calendaire": im,
                        "periode": f"{sy}-{code}",
                        "code": code,
                        "label_court": label_court,
                        "montant": amt_s,
                    }
                )

        eleves_stat = Eleve.objects.annotate(
            total_paye=Coalesce(Sum("paiements__montant_paye"), Value(Decimal("0")), output_field=dec2),
            _tm=_ELEVE_TARIF_MENSUEL_SUM,
        ).annotate(
            reste_annuel=Greatest(
                ExpressionWrapper(F("_tm") * Value(Decimal("10")) - F("total_paye"), output_field=dec2),
                Value(Decimal("0")),
                output_field=dec2,
            ),
            credit_eleve=Greatest(
                ExpressionWrapper(F("total_paye") - F("_tm") * Value(Decimal("10")), output_field=dec2),
                Value(Decimal("0")),
                output_field=dec2,
            ),
        )
        n_avance = 0
        n_retard = 0
        n_ok = 0
        n_total_eleves = 0
        for _ in eleves_stat:
            n_total_eleves += 1
            c = _.credit_eleve
            r = _.reste_annuel
            if not isinstance(c, Decimal):
                c = Decimal(str(c))
            if not isinstance(r, Decimal):
                r = Decimal(str(r))
            if c > 0:
                n_avance += 1
            elif r > 0:
                n_retard += 1
            else:
                n_ok += 1
        if n_total_eleves > 0:
            pourcentage_soldes = float(
                ((Decimal(n_ok) * Decimal("100")) / Decimal(n_total_eleves)).quantize(Decimal("0.1"))
            )
        else:
            pourcentage_soldes = 0.0

        repartition_statuts = [
            {"name": "À jour", "value": n_ok, "eleves": n_ok},
            {"name": "En retard", "value": n_retard, "eleves": n_retard},
            {"name": "Avance", "value": n_avance, "eleves": n_avance},
        ]

        derniers_qs = Paiement.objects.select_related("eleve").order_by("-date_encaissement", "-id")
        if filter_active:
            derniers_qs = derniers_qs.filter(
                date_encaissement__gte=start_enc,
                date_encaissement__lte=end_enc,
            )
        derniers = derniers_qs[:5]
        derniers_encaissements = []
        for p in derniers:
            el = p.eleve
            derniers_encaissements.append(
                {
                    "id": p.id,
                    "eleve_nom": el.nom,
                    "eleve_prenom": el.prenom,
                    "montant_paye": str(
                        (p.montant_paye if isinstance(p.montant_paye, Decimal) else Decimal(str(p.montant_paye))).quantize(
                            Decimal("0.01")
                        )
                    ),
                    "date_encaissement": p.date_encaissement.isoformat(),
                }
            )

        deficit_mois_str = str(deficit_mois_courant.quantize(Decimal("0.01")))
        periode_stats = {
            "active": filter_active,
            "start_date": start_d.isoformat() if filter_active else None,
            "end_date": end_d.isoformat() if filter_active else None,
        }
        return Response(
            {
                "recettes_periode": str(recettes_periode),
                "total_depenses": str(total_depenses),
                "ratio_depenses_recettes": ratio_depenses_recettes,
                "depenses_par_categorie": depenses_par_categorie,
                "reste_a_recouvrer": str(reste_a_recouvrer),
                "objectif_journalier": str(objectif_journalier),
                "deficit_mois_courant": deficit_mois_str,
                "periode_stats": periode_stats,
                "top_impayes": top_impayes,
                "evolution_encaissements": evolution_encaissements,
                "kpis": {
                    "total_encaisse_annee": str(recettes_periode),
                    "total_depenses": str(total_depenses),
                    "ratio_depenses_recettes": ratio_depenses_recettes,
                    "reste_a_recouvrer_global": str(reste_a_recouvrer),
                    "deficit_mois_courant": deficit_mois_str,
                    "taux_recouvrement_pct": taux_recouvrement_pct,
                    "mois_courant_code": mois_courant_code,
                    "mois_courant_label": mois_courant_label,
                    "objectif_journalier": str(objectif_journalier),
                    "pourcentage_soldes": pourcentage_soldes,
                },
                "encaissements_par_mois": encaissements_par_mois,
                "repartition_statuts": repartition_statuts,
                "derniers_encaissements": derniers_encaissements,
            }
        )


WEEKS_PER_MONTH = Decimal("4.33")
ACADEMIC_MONTHS_FOR_PROJECTION = Decimal("10")


def _academic_year_start(today: date) -> date:
    """
    Début de l'année scolaire (sept. → juin) : 1er septembre de l'année en cours.
    Juillet–août : rattachement à la rentrée précédente (année scolaire écoulée).
    """
    if today.month >= 9:
        return date(today.year, 9, 1)
    if today.month <= 6:
        return date(today.year - 1, 9, 1)
    return date(today.year - 1, 9, 1)


def _parse_iso_date_param(raw: str | None) -> date | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        return date.fromisoformat(str(raw).strip())
    except ValueError:
        return None


def _sum_paiements_encaissement(start, end) -> Decimal:
    """Somme des `montant_paye` entre deux datetimes (date d'encaissement)."""
    dec_paiement = DecimalField(max_digits=14, decimal_places=2)
    s = (
        Paiement.objects.filter(
            date_encaissement__gte=start,
            date_encaissement__lte=end,
        ).aggregate(s=Sum("montant_paye", output_field=dec_paiement))["s"]
        or Decimal("0")
    )
    return s if isinstance(s, Decimal) else Decimal(str(s))


def _financial_period_bounds(period: str, now=None):
    """
    Retourne (start, end) en datetime aware pour le filtre métier.
    `end` = maintenant (flux « temps réel »).
    """
    now = now or timezone.now()
    if timezone.is_naive(now):
        now = timezone.make_aware(now, timezone.get_current_timezone())
    tz = timezone.get_current_timezone()
    today = timezone.localdate(now)
    period = (period or "month").strip().lower()
    if period not in ("today", "week", "month", "year"):
        period = "month"

    if period == "today":
        start_d = today
        start = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
        return start, now

    if period == "week":
        start_d = today - timedelta(days=today.weekday())
        start = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
        return start, now

    if period == "month":
        start_d = today.replace(day=1)
        start = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
        return start, now

    start_d = today.replace(month=1, day=1)
    start = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
    return start, now


def _sum_tarif_mensuel_all_eleves() -> Decimal:
    dec = DecimalField(max_digits=14, decimal_places=2)
    s = (
        Eleve.objects.annotate(tm=_ELEVE_TARIF_MENSUEL_SUM).aggregate(
            s=Sum("tm", output_field=dec)
        )["s"]
        or Decimal("0")
    )
    return s if isinstance(s, Decimal) else Decimal(str(s))


def _encaissements_mois_calendaire(mois: int, annee: int) -> Decimal:
    s = Decimal("0")
    for paye, mconc, mlist in Paiement.objects.values_list(
        "montant_paye", "mois_concerne", "mois_concernes"
    ).iterator(chunk_size=500):
        s += _montant_paiement_attribue_mois_calendaire(mois, annee, paye, mconc, mlist)
    return s


def _prof_edt_weekly_cost() -> Decimal:
    """Coût théorique pour la semaine civile courante (lundi–dimanche), d’après les séances datées."""
    today = timezone.localdate()
    mon = today - timedelta(days=today.weekday())
    sun = mon + timedelta(days=6)
    total = Decimal("0")
    for e in EmploiDuTemps.objects.select_related("professeur").filter(
        date_seance__gte=mon,
        date_seance__lte=sun,
    ):
        h = Decimal(str(e.duree_heures))
        total += h * Decimal(str(e.professeur.tarif_horaire))
    return total.quantize(Decimal("0.01"))


def _prof_edt_monthly_cost() -> Decimal:
    return (_prof_edt_weekly_cost() * WEEKS_PER_MONTH).quantize(Decimal("0.01"))


def _prof_edt_monthly_cost_four_weeks() -> Decimal:
    """
    Masse salaire profs : coût hebdomadaire théorique (emploi du temps) × 4.

    Ne somme pas les pointages : indépendant des absences. Les agrégats basés sur
    les heures réellement pointées (cockpit, résumé pointage) utilisent
    statut_presence=PRESENTE uniquement.
    """
    return (_prof_edt_weekly_cost() * Decimal("4")).quantize(Decimal("0.01"))


def _sum_staff_salaires() -> Decimal:
    s = Personnel.objects.aggregate(s=Sum("salaire_mensuel"))["s"]
    if s is None:
        return Decimal("0")
    return s if isinstance(s, Decimal) else Decimal(str(s))


def _total_due_for_period(period: str, sum_tarif_mensuel: Decimal) -> Decimal:
    """Échéance théorique sur la période (frais mensuels × prorata)."""
    if sum_tarif_mensuel <= 0:
        return Decimal("0")
    if period == "today":
        return (sum_tarif_mensuel / Decimal("30")).quantize(Decimal("0.01"))
    if period == "week":
        return (sum_tarif_mensuel * Decimal("7") / Decimal("30")).quantize(Decimal("0.01"))
    if period == "month":
        return sum_tarif_mensuel.quantize(Decimal("0.01"))
    return (sum_tarif_mensuel * ACADEMIC_MONTHS_FOR_PROJECTION).quantize(Decimal("0.01"))


def _revenue_projection_for_period(period: str, sum_tarif_mensuel: Decimal) -> Decimal:
    """CA prévu affiché selon le filtre (prorata ou année scolaire 10 mois)."""
    if sum_tarif_mensuel <= 0:
        return Decimal("0")
    if period == "today":
        return (sum_tarif_mensuel / Decimal("30")).quantize(Decimal("0.01"))
    if period == "week":
        return (sum_tarif_mensuel * Decimal("7") / Decimal("30")).quantize(Decimal("0.01"))
    if period == "month":
        return sum_tarif_mensuel.quantize(Decimal("0.01"))
    return (sum_tarif_mensuel * ACADEMIC_MONTHS_FOR_PROJECTION).quantize(Decimal("0.01"))


def _prorate_monthly_amount(monthly: Decimal, period: str) -> Decimal:
    """Masse salariale (base mensuelle) ramenée à la période sélectionnée."""
    if monthly <= 0:
        return Decimal("0")
    if period == "today":
        return (monthly / Decimal("30")).quantize(Decimal("0.01"))
    if period == "week":
        return (monthly * Decimal("7") / Decimal("30")).quantize(Decimal("0.01"))
    if period == "month":
        return monthly.quantize(Decimal("0.01"))
    return (monthly * Decimal("12")).quantize(Decimal("0.01"))


class FinancialAnalyticsView(APIView):
    """
    Cockpit financier : projection annuelle, masse salariale, flux de trésorerie,
    taux de recouvrement, séries pour graphiques (6 mois, tendance inscriptions).
    Query : `period` = today | week | month | year
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        period = (request.query_params.get("period") or "month").strip().lower()
        if period not in ("today", "week", "month", "year"):
            period = "month"

        now = timezone.now()
        start, end = _financial_period_bounds(period, now=now)
        start_date = start.date()
        end_date = end.date()

        sum_tarif_m = _sum_tarif_mensuel_all_eleves()
        annual_revenue_projection = (sum_tarif_m * ACADEMIC_MONTHS_FOR_PROJECTION).quantize(
            Decimal("0.01")
        )

        prof_monthly = _prof_edt_monthly_cost()
        staff_monthly = _sum_staff_salaires()
        monthly_fixed_costs = (prof_monthly + staff_monthly).quantize(Decimal("0.01"))

        dec_paiement = DecimalField(max_digits=14, decimal_places=2)
        total_paid_period = (
            Paiement.objects.filter(
                date_encaissement__gte=start,
                date_encaissement__lte=end,
            ).aggregate(s=Sum("montant_paye", output_field=dec_paiement))["s"]
            or Decimal("0")
        )
        if not isinstance(total_paid_period, Decimal):
            total_paid_period = Decimal(str(total_paid_period))

        total_depenses = (
            AvanceSalaire.objects.filter(
                date__gte=start_date,
                date__lte=end_date,
            ).aggregate(s=Sum("montant", output_field=dec_paiement))["s"]
            or Decimal("0")
        )
        if not isinstance(total_depenses, Decimal):
            total_depenses = Decimal(str(total_depenses))

        real_time_cash_flow = (total_paid_period - total_depenses).quantize(Decimal("0.01"))

        total_due_period = _total_due_for_period(period, sum_tarif_m)
        if total_due_period > 0:
            raw_pct = (total_paid_period / total_due_period) * Decimal("100")
            collection_rate = float(min(raw_pct, Decimal("100")).quantize(Decimal("0.01")))
        else:
            collection_rate = None

        revenue_projection_display = _revenue_projection_for_period(period, sum_tarif_m)
        masse_salariale_display = _prorate_monthly_amount(monthly_fixed_costs, period)

        pie_ref_month = end_date.month
        pie_ref_year = end_date.year
        avances_pie_month = (
            AvanceSalaire.objects.filter(
                date__year=pie_ref_year,
                date__month=pie_ref_month,
            ).aggregate(s=Sum("montant", output_field=dec_paiement))["s"]
            or Decimal("0")
        )
        if not isinstance(avances_pie_month, Decimal):
            avances_pie_month = Decimal(str(avances_pie_month))

        bar_chart = []
        cursor = timezone.localdate(end)
        for _ in range(6):
            y, m = cursor.year, cursor.month
            rev = _encaissements_mois_calendaire(m, y)
            av_m = (
                AvanceSalaire.objects.filter(date__year=y, date__month=m).aggregate(
                    s=Sum("montant", output_field=dec_paiement)
                )["s"]
                or Decimal("0")
            )
            if not isinstance(av_m, Decimal):
                av_m = Decimal(str(av_m))
            dep_m = (av_m + staff_monthly + prof_monthly).quantize(Decimal("0.01"))
            label = f"{m:02d}/{y}"
            bar_chart.append(
                {
                    "label": label,
                    "revenus": str(rev.quantize(Decimal("0.01"))),
                    "depenses": str(dep_m),
                }
            )
            if m == 1:
                cursor = date(y - 1, 12, 1)
            else:
                cursor = date(y, m - 1, 1)
        bar_chart.reverse()

        y_reg, m_reg = end_date.year, end_date.month
        m_reg -= 11
        while m_reg <= 0:
            m_reg += 12
            y_reg -= 1
        twelve_months_ago = date(y_reg, m_reg, 1)

        reg_qs = (
            Eleve.objects.filter(date_inscription__gte=twelve_months_ago)
            .annotate(m=TruncMonth("date_inscription"))
            .values("m")
            .annotate(count=Count("id"))
            .order_by("m")
        )
        registration_trend = []
        for row in reg_qs:
            m = row["m"]
            if m is None:
                continue
            registration_trend.append(
                {
                    "month": m.strftime("%Y-%m"),
                    "count": row["count"],
                }
            )

        return Response(
            {
                "period": period,
                "date_start": start.isoformat(),
                "date_end": end.isoformat(),
                "annual_revenue_projection": str(annual_revenue_projection),
                "revenue_projection_display": str(revenue_projection_display),
                "monthly_fixed_costs": str(monthly_fixed_costs),
                "masse_salariale_display": str(masse_salariale_display),
                "real_time_cash_flow": str(real_time_cash_flow),
                "collection_rate": collection_rate,
                "total_paid_period": str(total_paid_period.quantize(Decimal("0.01"))),
                "total_due_period": str(total_due_period),
                "total_depenses_period": str(total_depenses.quantize(Decimal("0.01"))),
                "pie_costs": {
                    "salaires_prof_edt": str(prof_monthly),
                    "salaires_staff": str(staff_monthly),
                    "charges_fixes": str(avances_pie_month.quantize(Decimal("0.01"))),
                },
                "bar_chart_last_6_months": bar_chart,
                "registration_trend": registration_trend,
            }
        )


class DashboardAnalyticsView(APIView):
    """
    Tableau de bord Directrice : flux de trésorerie et obligations de paie.

    Query : `start_date` et `end_date` (ISO `YYYY-MM-DD`). Défaut : du 1er du mois calendaire
    courant jusqu'à aujourd'hui.

    Recettes (`recettes_periode`) : somme des encaissements dont la date tombe dans la plage
    (si la fin est aujourd'hui ou après, plafonnée à l'instant présent).
    Dépenses de période : enregistrements `Depense` dont `date_depense` est dans la plage.
    Bénéfice net de période : recettes_periode − somme des dépenses sur la plage (hors masse
    salariale mensuelle affichée à part).

    Taux de recouvrement : encaissements de la période / échéance théorique (frais mensuels
    agrégés × nombre de jours / 30).

    Obligations affichées (salaires profs + personnel, charges « autres ») : toujours le
    mois calendaire en cours (ce que la direction doit payer maintenant), indépendamment de la
    plage sélectionnée.

    `reste_a_recouvrer_mois` : frais mensuels théoriques (somme des tarifs) − montants déjà
    affectés au mois calendaire courant (via `mois_concerne` / `mois_concernes`), plafonné à 0.
    `objectif_journalier` : reste ÷ jours restants jusqu’à la fin du mois (0 le dernier jour →
    égal au reste).

    Séries : 6 mois calendaires se terminant au mois de `end_date`.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        now = timezone.now()
        if timezone.is_naive(now):
            now = timezone.make_aware(now, timezone.get_current_timezone())
        tz = timezone.get_current_timezone()
        today = timezone.localdate(now)
        dec_paiement = DecimalField(max_digits=14, decimal_places=2)

        start_d = _parse_iso_date_param(request.query_params.get("start_date"))
        end_d = _parse_iso_date_param(request.query_params.get("end_date"))
        if start_d is None:
            start_d = today.replace(day=1)
        if end_d is None:
            end_d = today
        if start_d > end_d:
            return Response(
                {"detail": "start_date doit être antérieur ou égal à end_date."},
                status=400,
            )

        start_enc = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
        if end_d >= today:
            end_enc = now
        else:
            end_enc = timezone.make_aware(
                datetime.combine(end_d, time_midnight(23, 59, 59, 999999)),
                tz,
            )

        recettes_periode = _sum_paiements_encaissement(start_enc, end_enc)

        depenses_periode = (
            Depense.objects.filter(
                date_depense__gte=start_d,
                date_depense__lte=end_d,
            ).aggregate(s=Sum("montant", output_field=dec_paiement))["s"]
            or Decimal("0")
        )
        if not isinstance(depenses_periode, Decimal):
            depenses_periode = Decimal(str(depenses_periode))

        benefice_net = (recettes_periode - depenses_periode).quantize(Decimal("0.01"))

        sum_tarif_m = _sum_tarif_mensuel_all_eleves()
        days_inclusive = (end_d - start_d).days + 1
        if sum_tarif_m > 0 and days_inclusive > 0:
            total_due_period = (
                sum_tarif_m * Decimal(days_inclusive) / Decimal("30")
            ).quantize(Decimal("0.01"))
        else:
            total_due_period = Decimal("0")

        if total_due_period > 0:
            raw_pct = (recettes_periode / total_due_period) * Decimal("100")
            taux_recouvrement = float(min(raw_pct, Decimal("100")).quantize(Decimal("0.01")))
        else:
            taux_recouvrement = None

        salaires_profs_mois = _prof_edt_monthly_cost_four_weeks()
        salaires_personnel_mois = _sum_staff_salaires()

        debut_mois_cal = today.replace(day=1)
        autres_depenses_mois = (
            Depense.objects.filter(
                date_depense__gte=debut_mois_cal,
                date_depense__lte=today,
            ).aggregate(s=Sum("montant", output_field=dec_paiement))["s"]
            or Decimal("0")
        )
        if not isinstance(autres_depenses_mois, Decimal):
            autres_depenses_mois = Decimal(str(autres_depenses_mois))

        frais_attendus_mois = _sum_tarif_mensuel_all_eleves()
        deja_collecte_mois = _encaissements_mois_calendaire(today.month, today.year)
        reste_brut = frais_attendus_mois - deja_collecte_mois
        reste_a_recouvrer_mois = (
            reste_brut if reste_brut > 0 else Decimal("0")
        ).quantize(Decimal("0.01"))

        dernier_jour_mois = today.replace(
            day=calendar.monthrange(today.year, today.month)[1]
        )
        jours_restants_mois = (dernier_jour_mois - today).days
        if jours_restants_mois <= 0:
            objectif_journalier = reste_a_recouvrer_mois
        else:
            objectif_journalier = (
                reste_a_recouvrer_mois / Decimal(jours_restants_mois)
            ).quantize(Decimal("0.01"))

        ay_start = _academic_year_start(today)

        chart_data = []
        cursor = date(end_d.year, end_d.month, 1)
        for _ in range(6):
            y, m = cursor.year, cursor.month
            revenu = (
                Paiement.objects.filter(
                    date_encaissement__year=y,
                    date_encaissement__month=m,
                ).aggregate(s=Sum("montant_paye", output_field=dec_paiement))["s"]
                or Decimal("0")
            )
            if not isinstance(revenu, Decimal):
                revenu = Decimal(str(revenu))
            dep_var = (
                Depense.objects.filter(date_depense__year=y, date_depense__month=m).aggregate(
                    s=Sum("montant", output_field=dec_paiement)
                )["s"]
                or Decimal("0")
            )
            if not isinstance(dep_var, Decimal):
                dep_var = Decimal(str(dep_var))
            depenses = (dep_var + salaires_personnel_mois + salaires_profs_mois).quantize(
                Decimal("0.01")
            )
            name = f"{m:02d}/{y}"
            chart_data.append(
                {
                    "name": name,
                    "revenu": str(revenu.quantize(Decimal("0.01"))),
                    "depenses": str(depenses),
                }
            )
            if m == 1:
                cursor = date(y - 1, 12, 1)
            else:
                cursor = date(y, m - 1, 1)
        chart_data.reverse()

        return Response(
            {
                "start_date": start_d.isoformat(),
                "end_date": end_d.isoformat(),
                "recettes_periode": str(recettes_periode.quantize(Decimal("0.01"))),
                "depenses_periode": str(depenses_periode.quantize(Decimal("0.01"))),
                "benefice_net": str(benefice_net),
                "taux_recouvrement": taux_recouvrement,
                "total_due_period": str(total_due_period),
                "salaires_profs_mois": str(salaires_profs_mois.quantize(Decimal("0.01"))),
                "salaires_personnel_mois": str(salaires_personnel_mois.quantize(Decimal("0.01"))),
                "autres_depenses_mois": str(autres_depenses_mois.quantize(Decimal("0.01"))),
                "reste_a_recouvrer_mois": str(reste_a_recouvrer_mois),
                "objectif_journalier": str(objectif_journalier),
                "annee_scolaire_debut": ay_start.isoformat(),
                "chart_data": chart_data,
                "pie_costs": {
                    "salaires_prof_edt": str(salaires_profs_mois.quantize(Decimal("0.01"))),
                    "salaires_staff": str(salaires_personnel_mois.quantize(Decimal("0.01"))),
                    "autres_depenses": str(autres_depenses_mois.quantize(Decimal("0.01"))),
                },
            }
        )


def _theoretical_hours_emploi_range(
    start_d: date,
    end_d: date,
    professeur_ids: list[int] | None,
) -> Decimal:
    """
    Somme des durées des séances EmploiDuTemps dont `date_seance` est dans [start_d, end_d].

    `professeur_ids` None = tous les profs ayant un créneau ; liste vide = 0 h.
    """
    qs = EmploiDuTemps.objects.filter(
        date_seance__gte=start_d,
        date_seance__lte=end_d,
    )
    if professeur_ids is not None:
        if not professeur_ids:
            return Decimal("0")
        qs = qs.filter(professeur_id__in=professeur_ids)
    total = Decimal("0")
    for row in qs.iterator(chunk_size=500):
        total += Decimal(str(row.duree_heures))
    return total


def _professeur_ids_for_pointage_search(search_term: str) -> list[int] | None:
    """
    None = pas de filtre nom (tous les créneaux d'emploi du temps).
    Liste (éventuellement vide) = profs correspondant au terme et ayant au moins un créneau.

    Gère les noms complets (« Prénom Nom », « Nom Prénom ») via Concat, et les requêtes
    multi-mots comme SearchFilter DRF : chaque mot doit apparaître dans le nom ou le prénom.
    """
    scheduled = EmploiDuTemps.objects.values_list("professeur_id", flat=True).distinct()
    term = (search_term or "").strip()
    if not term:
        return None

    phrase = " ".join(term.split())
    qs = Professeur.objects.annotate(
        full_name=Concat(F("prenom"), Value(" "), F("nom")),
        reverse_name=Concat(F("nom"), Value(" "), F("prenom")),
    )
    q_phrase = Q(full_name__icontains=phrase) | Q(reverse_name__icontains=phrase)
    words = phrase.split()
    if len(words) > 1:
        q_tokens = Q()
        for w in words:
            q_tokens &= Q(Q(nom__icontains=w) | Q(prenom__icontains=w))
        q = q_phrase | q_tokens
    else:
        q = q_phrase | Q(nom__icontains=phrase) | Q(prenom__icontains=phrase)

    return list(qs.filter(q).filter(id__in=scheduled).values_list("id", flat=True))


def _emploi_du_temps_queryset_for_virtual_rows(
    request,
    prof_scope_from_search: list[int] | None,
    start_d: date,
    end_d: date,
) -> tuple[bool, list]:
    """
    Créneaux EDT utilisés pour projeter les séances futures (même logique que le filtre prof / recherche).

    Retourne (empty, slots_list) où slots_list est la liste des EmploiDuTemps (évaluée une fois),
    limitée aux `date_seance` dans [start_d, end_d].
    """
    qs_base = EmploiDuTemps.objects.select_related("professeur", "classe").filter(
        date_seance__gte=start_d,
        date_seance__lte=end_d,
    )
    raw_prof = request.query_params.get("professeur")
    if raw_prof is not None and str(raw_prof).strip() != "":
        try:
            pid = int(raw_prof)
        except (TypeError, ValueError):
            return True, []
        if prof_scope_from_search is not None and pid not in prof_scope_from_search:
            return True, []
        qs = qs_base.filter(professeur_id=pid)
        return False, list(qs.iterator(chunk_size=500))

    if prof_scope_from_search is not None:
        if not prof_scope_from_search:
            return True, []
        qs = qs_base.filter(professeur_id__in=prof_scope_from_search)
        return False, list(qs.iterator(chunk_size=500))

    qs = qs_base
    return False, list(qs.iterator(chunk_size=500))


def _virtual_pointage_dicts_for_future_range(
    start_d: date,
    end_d: date,
    today: date,
    occupied_edt: set[tuple[date, int]],
    slots: list,
) -> list[dict]:
    """
    Lignes « virtuelles » (pas de modèle Pointage) pour les jours futurs, d'après l'emploi du temps.
    """
    if end_d <= today:
        return []

    future_start = max(start_d, today + timedelta(days=1))
    if future_start > end_d:
        return []

    by_date: dict[date, list] = defaultdict(list)
    for slot in slots:
        ds = getattr(slot, "date_seance", None)
        if ds is None:
            continue
        if future_start <= ds <= end_d and ds > today:
            by_date[ds].append(slot)
    for ds in by_date:
        by_date[ds].sort(key=lambda s: (s.heure_debut, s.id))

    out: list[dict] = []
    d = future_start
    while d <= end_d:
        for slot in by_date.get(d, ()):
            if (d, slot.id) in occupied_edt:
                continue
            nh = Decimal(str(slot.duree_heures)).quantize(Decimal("0.01"))
            prof = slot.professeur
            classe = slot.classe
            out.append(
                {
                    "id": f"virtual_{d.isoformat()}_{slot.id}",
                    "professeur": prof.id,
                    "professeur_nom": prof.nom,
                    "professeur_prenom": prof.prenom,
                    "classe": classe.id if classe is not None else None,
                    "classe_nom": classe.nom if classe is not None else None,
                    "emploi_du_temps": slot.id,
                    "date_cours": d.isoformat(),
                    "nombre_heures": str(nh),
                    "statut_presence": "A_VENIR",
                    "est_paye": False,
                    "statut_paiement": "en_attente",
                    "recu_paiement": None,
                    "remarque": None,
                }
            )
        d += timedelta(days=1)

    return out


class PointageFilter(FilterSet):
    """Filtre par professeur, dates (`start_date`/`end_date` ou `date_debut`/`date_fin`), statut, payé."""

    date_debut = django_filters.DateFilter(field_name="date_cours", lookup_expr="gte")
    date_fin = django_filters.DateFilter(field_name="date_cours", lookup_expr="lte")
    start_date = django_filters.DateFilter(field_name="date_cours", lookup_expr="gte")
    end_date = django_filters.DateFilter(field_name="date_cours", lookup_expr="lte")
    statut_presence = django_filters.CharFilter(field_name="statut_presence", lookup_expr="iexact")
    est_paye = django_filters.BooleanFilter(field_name="est_paye")
    statut_paiement = django_filters.CharFilter(field_name="statut_paiement", lookup_expr="iexact")

    class Meta:
        model = Pointage
        fields = ["professeur", "classe"]


class EleveViewSet(viewsets.ModelViewSet):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = EleveSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["classe", "section", "niveau", "is_gratuit", "is_convention"]
    search_fields = ["nom", "prenom", "nom_parent", "telephone_1", "telephone_2"]

    def get_permissions(self):
        if self.action == "impayes":
            return [IsAuthenticated(), IsAdminOrComptable()]
        if self.action == "destroy":
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated(), IsAdminComptableOrPointageEleveAccess()]

    def get_queryset(self):
        dec = DecimalField(max_digits=14, decimal_places=2)
        # `total_paye` = somme des `montant_paye` (lignes Paiement) par élève — sert à `progression_annuelle`
        # dans `EleveSerializer` sans requêtes N+1.
        qs = (
            Eleve.objects.annotate(
                reste_global=Coalesce(
                    Sum(
                        ExpressionWrapper(
                            F("paiements__montant_du") - F("paiements__montant_paye"),
                            output_field=dec,
                        )
                    ),
                    Value(Decimal("0")),
                    output_field=dec,
                ),
                total_paye=Coalesce(
                    Sum("paiements__montant_paye"),
                    Value(Decimal("0")),
                    output_field=dec,
                ),
            )
            .annotate(
                _tm=_ELEVE_TARIF_MENSUEL_SUM,
            )
            .annotate(
                reste_a_payer=Greatest(
                    ExpressionWrapper(
                        F("_tm") * Value(Decimal("10")) - F("total_paye"),
                        output_field=dec,
                    ),
                    Value(Decimal("0")),
                    output_field=dec,
                ),
                credit_eleve=Greatest(
                    ExpressionWrapper(
                        F("total_paye") - F("_tm") * Value(Decimal("10")),
                        output_field=dec,
                    ),
                    Value(Decimal("0")),
                    output_field=dec,
                ),
            )
        )
        if self.action in ("retrieve", "list", "impayes"):
            qs = qs.prefetch_related("paiements")
        tt = (self.request.query_params.get("tarif_type") or "").strip().lower()
        if tt == "gratuit":
            qs = qs.filter(is_gratuit=True)
        elif tt in ("convention", "conventionne", "conventionné"):
            qs = qs.filter(is_convention=True)
        elif tt == "standard":
            qs = qs.filter(is_gratuit=False, is_convention=False)
        return qs.order_by("nom", "prenom")

    @action(detail=False, methods=["get"], url_path="impayes")
    def impayes(self, request):
        """
        Élèves sans paiement enregistré pour le mois calendaire demandé (défaut : mois en cours).

        Réponse : ``{ "eleves": [...], "comptage": {...} }``.

        - ``retardataires_tous`` : tous les élèves (filtres de recherche appliqués) sans paiement pour le mois.
        - ``exclus_gratuits`` / ``exclus_conventionnes`` : sous-ensembles de ceux-ci (non cumulables :
          un gratuit n’est pas compté en convention).
        - ``vrais_impayes`` : retraités « standard » (ni gratuit ni convention) = retardataires hors exceptions.

        Query : `search` (nom, prénom, parent, téléphones — SearchFilter), `debt_only=true`
        pour ne garder que les élèves avec reste de paiement cumulé > 0.
        """
        now = timezone.now()
        try:
            mois = int(request.query_params.get("mois", now.month))
            annee = int(request.query_params.get("annee", now.year))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Paramètres mois et annee invalides."},
                status=400,
            )
        if mois < 1 or mois > 12:
            return Response(
                {"detail": "Le mois doit être compris entre 1 et 12."},
                status=400,
            )

        paye_ce_mois = _eleve_ids_ayant_paiement_pour_mois(mois, annee)

        tous_sans_paiement = self.get_queryset().exclude(id__in=paye_ce_mois)
        tous_sans_paiement = self.filter_queryset(tous_sans_paiement)

        n_exclus_gratuits = tous_sans_paiement.filter(is_gratuit=True).count()
        n_exclus_conventionnes = tous_sans_paiement.filter(is_gratuit=False, is_convention=True).count()
        n_vrais_impayes = tous_sans_paiement.filter(is_gratuit=False, is_convention=False).count()
        n_retardataires_tous = tous_sans_paiement.count()

        impayes_qs = tous_sans_paiement.filter(is_gratuit=False, is_convention=False)
        debt_only = request.query_params.get("debt_only", "").lower()
        if debt_only in ("1", "true", "yes"):
            impayes_qs = impayes_qs.filter(reste_global__gt=Decimal("0"))
        impayes_qs = impayes_qs.order_by("nom", "prenom")
        return Response(
            {
                "eleves": EleveSerializer(impayes_qs, many=True).data,
                "comptage": {
                    "retardataires_tous": n_retardataires_tous,
                    "exclus_gratuits": n_exclus_gratuits,
                    "exclus_conventionnes": n_exclus_conventionnes,
                    "vrais_impayes": n_vrais_impayes,
                },
            }
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        log_eleve_create(audit_user(self.request), instance)

    def perform_update(self, serializer):
        old_snap = model_snapshot(serializer.instance)
        instance = serializer.save()
        new_snap = model_snapshot(instance)
        diff = build_diff(old_snap, new_snap)
        if diff:
            log_eleve_update(audit_user(self.request), instance, diff)

    def perform_destroy(self, instance):
        snap = model_snapshot(instance)
        u = audit_user(self.request)
        log_eleve_delete(u, instance, snap)
        instance.delete()


class PaiementViewSet(viewsets.ModelViewSet):
    """
    Liste : filtres `eleve`, `type_frais`, recherche texte `?search=` (nom, prénom, téléphones élève, remarque),
    tranche de dates `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` sur le jour d’encaissement,
    option `?debt_only=true` pour les lignes avec montant dû > montant payé,
    tranche de progression annuelle `?progression_range=` (0-20, 20-40, 40-60, 60-80, 80-100)
    : part de l’annuité théorique (somme des encaissements de l’élève / (tarif mensuel × 10)) × 100.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]
    queryset = (
        Paiement.objects.select_related("eleve", "session_caisse", "cree_par")
        .all()
        .order_by("-date_encaissement")
    )
    serializer_class = PaiementSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["eleve", "type_frais"]
    search_fields = [
        "remarque",
        "eleve__nom",
        "eleve__prenom",
        "eleve__nom_parent",
        "eleve__telephone_1",
        "eleve__telephone_2",
    ]

    def get_queryset(self):
        dec2 = DecimalField(max_digits=16, decimal_places=2)
        sub_total_paye_eleve = (
            Paiement.objects.filter(eleve_id=OuterRef("eleve_id"))
            .order_by()
            .values("eleve_id")
            .annotate(
                s=Coalesce(
                    Sum("montant_paye"),
                    Value(Decimal("0"), output_field=dec2),
                    output_field=dec2,
                )
            )
            .values("s")[:1]
        )
        qs = (
            super()
            .get_queryset()
            .annotate(
                _total_paye_eleve=Subquery(sub_total_paye_eleve, output_field=dec2),
                _denom_annual=ExpressionWrapper(
                    (
                        F("eleve__tarif_scolarite")
                        + F("eleve__tarif_transport")
                        + F("eleve__tarif_etudes")
                        + F("eleve__tarif_autre")
                    )
                    * Value(Decimal("10"), output_field=dec2),
                    output_field=dec2,
                ),
            )
            .annotate(
                _reste_a_payer_annuel_eleve=Greatest(
                    ExpressionWrapper(
                        F("_denom_annual") - F("_total_paye_eleve"),
                        output_field=dec2,
                    ),
                    Value(Decimal("0"), output_field=dec2),
                    output_field=dec2,
                ),
            )
        )
        params = self.request.query_params
        start = (params.get("start_date") or "").strip()
        end = (params.get("end_date") or "").strip()
        if start:
            try:
                d = date.fromisoformat(start)
                qs = qs.filter(date_encaissement__date__gte=d)
            except (TypeError, ValueError):
                pass
        if end:
            try:
                d = date.fromisoformat(end)
                qs = qs.filter(date_encaissement__date__lte=d)
            except (TypeError, ValueError):
                pass
        pr = (params.get("progression_range") or "").strip()
        if pr in (
            "0-20",
            "20-40",
            "40-60",
            "60-80",
            "80-100",
        ):
            prog_float = Case(
                When(
                    _denom_annual__gt=0,
                    then=ExpressionWrapper(
                        Cast(F("_total_paye_eleve"), FloatField())
                        * Value(100.0, output_field=FloatField())
                        / Cast(F("_denom_annual"), FloatField()),
                        output_field=FloatField(),
                    ),
                ),
                default=Value(0.0, output_field=FloatField()),
                output_field=FloatField(),
            )
            qs = qs.annotate(_progression_pourcent=prog_float)
            if pr == "0-20":
                qs = qs.filter(
                    _progression_pourcent__gte=0.0, _progression_pourcent__lte=20.0
                )
            elif pr == "20-40":
                qs = qs.filter(
                    _progression_pourcent__gt=20.0, _progression_pourcent__lte=40.0
                )
            elif pr == "40-60":
                qs = qs.filter(
                    _progression_pourcent__gt=40.0, _progression_pourcent__lte=60.0
                )
            elif pr == "60-80":
                qs = qs.filter(
                    _progression_pourcent__gt=60.0, _progression_pourcent__lte=80.0
                )
            else:
                qs = qs.filter(
                    _progression_pourcent__gt=80.0, _progression_pourcent__lte=100.0
                )
        return qs

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        if self.request.query_params.get("debt_only", "").lower() in ("1", "true", "yes"):
            qs = qs.filter(montant_du__gt=F("montant_paye"))
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_paiement_create(audit_user(self.request), instance)
        _verify_eleve_financials_after_paiement(instance.eleve_id)

    def perform_update(self, serializer):
        old_snap = model_snapshot(serializer.instance)
        instance = serializer.save()
        new_snap = model_snapshot(instance)
        diff = build_diff(old_snap, new_snap)
        if diff:
            log_paiement_update(audit_user(self.request), instance, diff)
        _verify_eleve_financials_after_paiement(instance.eleve_id)

    def perform_destroy(self, instance):
        u = audit_user(self.request)
        eleve_id = instance.eleve_id
        log_paiement_delete(u, instance)
        instance.delete()
        _verify_eleve_financials_after_paiement(eleve_id)


def _heures_prevues_restantes_mois_courant(prof_id: int, today: date) -> Decimal:
    """
    Heures prévues d’après l’emploi du temps entre demain et la fin du mois civil,
    en excluant les créneaux déjà couverts par un pointage lié à l’emploi du temps.
    """
    last = calendar.monthrange(today.year, today.month)[1]
    end_m = date(today.year, today.month, last)
    start_d = today + timedelta(days=1)
    if start_d > end_m:
        return Decimal("0")
    return _heures_prevues_edt_entre(prof_id, start_d, end_m)


def _prev_calendar_month(annee: int, mois: int) -> tuple[int, int]:
    d0 = date(annee, mois, 1) - timedelta(days=1)
    return d0.year, d0.month


def _month_date_bounds(annee: int, mois: int) -> tuple[date, date]:
    last = calendar.monthrange(annee, mois)[1]
    return date(annee, mois, 1), date(annee, mois, last)


def _default_prestation_mois_annee(today: date) -> tuple[int, int]:
    y, m = _prev_calendar_month(today.year, today.month)
    return m, y


def _heures_prevues_edt_entre(prof_id: int, start_d: date, end_m: date) -> Decimal:
    if start_d > end_m:
        return Decimal("0")
    slots = list(
        EmploiDuTemps.objects.select_related("professeur", "classe").filter(
            professeur_id=prof_id,
            date_seance__gte=start_d,
            date_seance__lte=end_m,
        )
    )
    if not slots:
        return Decimal("0")
    occupied = set(
        Pointage.objects.filter(
            professeur_id=prof_id,
            date_cours__gte=start_d,
            date_cours__lte=end_m,
            emploi_du_temps_id__isnull=False,
        ).values_list("date_cours", "emploi_du_temps_id")
    )
    by_date: dict[date, list] = defaultdict(list)
    for slot in slots:
        by_date[slot.date_seance].append(slot)
    for ds in by_date:
        by_date[ds].sort(key=lambda s: (s.heure_debut, s.id))
    total = Decimal("0")
    d = start_d
    while d <= end_m:
        for slot in by_date.get(d, ()):
            if (d, slot.id) in occupied:
                continue
            nh = Decimal(str(slot.duree_heures)).quantize(Decimal("0.01"))
            total += nh
        d += timedelta(days=1)
    return total.quantize(Decimal("0.01"))


def _heures_note_report_anticipatif(
    prof_id: int, date_paiement: date, mois_prest: int, annee_prest: int
) -> Decimal:
    m0, m1 = _month_date_bounds(annee_prest, mois_prest)
    if date_paiement < m0 or date_paiement > m1 or date_paiement >= m1:
        return Decimal("0")
    start_d = date_paiement + timedelta(days=1)
    return _heures_prevues_edt_entre(prof_id, start_d, m1)


def _heures_prevues_restantes_mois_prestation(
    prof_id: int, today: date, mois: int, annee: int
) -> Decimal:
    last = calendar.monthrange(annee, mois)[1]
    end_m = date(annee, mois, last)
    if today > end_m:
        return Decimal("0")
    start_d = today + timedelta(days=1)
    if start_d > end_m:
        return Decimal("0")
    return _heures_prevues_edt_entre(prof_id, start_d, end_m)


def _detail_ligne_pointage(p) -> dict:
    edt = p.emploi_du_temps
    h0 = edt.heure_debut if edt is not None else None
    h1 = edt.heure_fin if edt is not None else None
    return {
        "date_cours": p.date_cours.isoformat(),
        "nombre_heures": str(p.nombre_heures),
        "classe": p.classe.nom if p.classe_id else None,
        "heure_debut": h0.strftime("%H:%M") if h0 is not None else None,
        "heure_fin": h1.strftime("%H:%M") if h1 is not None else None,
    }


def _resolve_prestation_params(
    today: date,
    perimetre: str | None,
    mois_prestation: int | None,
    annee_prestation: int | None,
) -> tuple[int, int, bool]:
    if (
        mois_prestation is not None
        and annee_prestation is not None
        and 1 <= mois_prestation <= 12
    ):
        return mois_prestation, annee_prestation, True
    if perimetre == "mois_courant":
        return today.month, today.year, False
    y, m = _prev_calendar_month(today.year, today.month)
    return m, y, True


def _pointages_pool_paiement_professeur(
    prof: Professeur, today: date, mois_sel: int, annee_sel: int, inclut_reliquat: bool
):
    pay_unpaid = Pointage.objects.filter(
        professeur=prof,
        statut_paiement=Pointage.StatutPaiement.EN_ATTENTE,
        statut_presence__in=["PRESENTE", "RETARD"],
        date_cours__lte=today,
    )
    m_start, m_end = _month_date_bounds(annee_sel, mois_sel)
    m_cap_end = min(m_end, today)
    if m_start > m_cap_end:
        q_m = pay_unpaid.none()
    else:
        q_m = pay_unpaid.filter(
            date_cours__gte=m_start,
            date_cours__lte=m_cap_end,
        )
    if not inclut_reliquat:
        return q_m.order_by("date_cours", "id")
    py, pm = _prev_calendar_month(annee_sel, mois_sel)
    m1_start, m1_end = _month_date_bounds(py, pm)
    m1_cap = min(m1_end, today)
    if m1_start > m1_cap:
        q_m1 = pay_unpaid.none()
    else:
        q_m1 = pay_unpaid.filter(
            date_cours__gte=m1_start,
            date_cours__lte=m1_cap,
        )
    return (q_m1 | q_m).order_by("date_cours", "id")


def _resume_paie_payload(
    prof: Professeur,
    today: date | None = None,
    *,
    perimetre: str | None = None,
    mois_prestation: int | None = None,
    annee_prestation: int | None = None,
) -> dict:
    today = today or timezone.localdate()
    mois_sel, annee_sel, inclut_reliquat = _resolve_prestation_params(
        today, perimetre, mois_prestation, annee_prestation
    )
    m_start, m_end = _month_date_bounds(annee_sel, mois_sel)
    tarif = prof.tarif_horaire
    pay_unpaid = Pointage.objects.filter(
        professeur=prof,
        statut_paiement=Pointage.StatutPaiement.EN_ATTENTE,
        statut_presence__in=["PRESENTE", "RETARD"],
        date_cours__lte=today,
    )
    m_cap_end = min(m_end, today)
    if m_start > m_cap_end:
        q_m = pay_unpaid.none()
    else:
        q_m = pay_unpaid.filter(
            date_cours__gte=m_start,
            date_cours__lte=m_cap_end,
        )
    if inclut_reliquat:
        py, pm = _prev_calendar_month(annee_sel, mois_sel)
        m1_start, m1_end = _month_date_bounds(py, pm)
        m1_cap = min(m1_end, today)
        if m1_start > m1_cap:
            q_m1 = pay_unpaid.none()
        else:
            q_m1 = pay_unpaid.filter(
                date_cours__gte=m1_start,
                date_cours__lte=m1_cap,
            )
    else:
        q_m1 = pay_unpaid.none()
    heures_m = q_m.aggregate(s=Sum("nombre_heures"))["s"] or Decimal("0")
    heures_m1 = (
        (q_m1.aggregate(s=Sum("nombre_heures"))["s"] or Decimal("0"))
        if inclut_reliquat
        else Decimal("0")
    )
    heures_m = Decimal(heures_m).quantize(Decimal("0.01"))
    heures_m1 = Decimal(heures_m1).quantize(Decimal("0.01"))
    heures_non_payees = (heures_m + heures_m1).quantize(Decimal("0.01"))
    total_brut = (heures_non_payees * tarif).quantize(Decimal("0.01"))
    avances_non_soldees = (
        AvanceSalaire.objects.filter(professeur=prof, est_solde=False).aggregate(
            s=Sum("montant")
        )["s"]
        or Decimal("0")
    )
    avances_non_soldees = Decimal(avances_non_soldees).quantize(Decimal("0.01"))
    net_a_payer = (total_brut - avances_non_soldees).quantize(Decimal("0.01"))
    if net_a_payer < 0:
        net_a_payer = Decimal("0")
    heures_restantes_mois = _heures_prevues_restantes_mois_prestation(
        prof.id, today, mois_sel, annee_sel
    )
    pointages_non_payes_detail: list[dict] = []
    for p in q_m1.select_related("classe", "emploi_du_temps").order_by("date_cours", "id")[
        :250
    ]:
        row = _detail_ligne_pointage(p)
        row["source_ligne"] = "reliquat_mois_precedent"
        pointages_non_payes_detail.append(row)
    for p in q_m.select_related("classe", "emploi_du_temps").order_by("date_cours", "id")[:250]:
        row = _detail_ligne_pointage(p)
        row["source_ligne"] = "mois_prestation"
        pointages_non_payes_detail.append(row)
    m1_lib = ""
    if inclut_reliquat:
        py, pm = _prev_calendar_month(annee_sel, mois_sel)
        m1_lib = f" (reliquat {pm:02d}/{py} si en attente)"
    periode_libelle = (
        f"Mois de prestation {m_start.strftime('%d/%m/%Y')} – {m_end.strftime('%d/%m/%Y')}"
        f"{m1_lib}"
    )
    if not inclut_reliquat:
        periode_libelle = (
            f"Mois civil en cours (sans reliquat M-1) : "
            f"{m_start.strftime('%d/%m/%Y')} – {m_end.strftime('%d/%m/%Y')}"
        )
    return {
        "professeur_id": prof.id,
        "professeur_nom": prof.nom,
        "professeur_prenom": prof.prenom,
        "date_reference": today.isoformat(),
        "mois_prestation": mois_sel,
        "annee_prestation": annee_sel,
        "periode_prestation_debut": m_start.isoformat(),
        "periode_prestation_fin": m_end.isoformat(),
        "mois_courant": today.month,
        "annee_courante": today.year,
        "periode_debut": m_start.isoformat(),
        "periode_fin": m_end.isoformat(),
        "periode_libelle": periode_libelle,
        "inclut_reliquat_m_precedent": inclut_reliquat,
        "tarif_horaire": tarif,
        "heures_mois_prestation": heures_m,
        "heures_reliquat_mois_precedent": heures_m1 if inclut_reliquat else Decimal("0"),
        "heures_non_payees": heures_non_payees,
        "total_brut": total_brut,
        "avances_non_soldees": avances_non_soldees,
        "net_a_payer": net_a_payer,
        "heures_restantes_mois": heures_restantes_mois,
        "pointages_non_payes_detail": pointages_non_payes_detail,
        "total_heures": heures_non_payees,
        "salaire_brut": total_brut,
        "total_avances": avances_non_soldees,
        "salaire_net": net_a_payer,
    }


def _executer_paiement_professeur(
    prof: Professeur,
    montant_net: Decimal,
    date_depense: date,
    today: date,
    *,
    perimetre: str | None = None,
    mois_prestation: int | None = None,
    annee_prestation: int | None = None,
    primes_montant: Decimal | None = None,
    primes_remarque: str = "",
    nb_heures_prime: Decimal | None = None,
    tarif_prime: Decimal | None = None,
    cree_par=None,
) -> dict:
    """FIFO sur le pool (reliquat M-1 + mois M) ; attache chaque pointage au reçu (PaiementSalaire).

    `montant_net` = total versé (salaire net issu des heures + primes). Les pointages ne couvrent
    que la partie salaire : ``montant_net - primes_montant``.
    """
    if montant_net <= 0:
        raise ValidationError({"montant": "Le montant doit être strictement positif."})
    prime_amt = Decimal("0.00") if primes_montant is None else Decimal(str(primes_montant))
    prime_amt = prime_amt.quantize(Decimal("0.01"))
    if prime_amt < 0:
        raise ValidationError({"primes": "Les primes ne peuvent pas être négatives."})
    nh_p: Decimal | None = None
    tp_p: Decimal | None = None
    if nb_heures_prime is not None or tarif_prime is not None:
        if nb_heures_prime is None or tarif_prime is None:
            raise ValidationError(
                {
                    "nb_heures_prime": (
                        "Indiquez à la fois nb_heures_prime et tarif_prime pour une prime au temps, "
                        "ou omettez les deux."
                    )
                }
            )
        nh_p = Decimal(str(nb_heures_prime)).quantize(Decimal("0.01"))
        tp_p = Decimal(str(tarif_prime)).quantize(Decimal("0.01"))
        if nh_p <= 0 or tp_p <= 0:
            raise ValidationError(
                {
                    "nb_heures_prime": (
                        "Les heures et le tarif de prime doivent être strictement positifs."
                    )
                }
            )
        attendu = (nh_p * tp_p).quantize(Decimal("0.01"))
        if abs(attendu - prime_amt) > Decimal("0.02"):
            raise ValidationError(
                {
                    "primes": (
                        f"Le montant des primes ({prime_amt}) ne correspond pas à "
                        f"{nh_p} h × {tp_p} DT = {attendu} DT."
                    )
                }
            )
    montant_total = montant_net.quantize(Decimal("0.01"))
    montant_salaire_net = (montant_total - prime_amt).quantize(Decimal("0.01"))
    if montant_salaire_net < 0:
        raise ValidationError(
            {"montant": "Le montant total est inférieur aux primes indiquées."}
        )
    mois_sel, annee_sel, inclut_reliquat = _resolve_prestation_params(
        today, perimetre, mois_prestation, annee_prestation
    )
    payload = _resume_paie_payload(
        prof,
        today,
        perimetre=perimetre,
        mois_prestation=mois_prestation,
        annee_prestation=annee_prestation,
    )
    net_a_payer = Decimal(str(payload["net_a_payer"]))
    if montant_salaire_net - net_a_payer > Decimal("0.02"):
        raise ValidationError(
            {
                "montant": (
                    f"La part salaire ({montant_salaire_net} DT) dépasse le net à payer "
                    f"({net_a_payer} DT) pour cette période."
                )
            }
        )
    tarif = prof.tarif_horaire
    pt_qs = _pointages_pool_paiement_professeur(
        prof, today, mois_sel, annee_sel, inclut_reliquat
    )
    pts = list(pt_qs)
    advs = list(
        AvanceSalaire.objects.filter(professeur=prof, est_solde=False).order_by(
            "date", "id"
        )
    )
    adv_idx = 0
    adv_left = advs[0].montant if advs else Decimal("0")
    net_allocated = Decimal("0")
    pts_to_mark: list[Pointage] = []
    advs_to_solde: list[AvanceSalaire] = []
    if montant_salaire_net > 0:
        for pt in pts:
            brut = (pt.nombre_heures * tarif).quantize(Decimal("0.01"))
            left = brut
            while adv_idx < len(advs) and left > 0:
                take = min(left, adv_left)
                left -= take
                adv_left -= take
                if adv_left == 0:
                    advs_to_solde.append(advs[adv_idx])
                    adv_idx += 1
                    adv_left = advs[adv_idx].montant if adv_idx < len(advs) else Decimal("0")
            net_from_pt = left
            net_allocated += net_from_pt
            pts_to_mark.append(pt)
            if net_allocated >= montant_salaire_net:
                break
        if net_allocated + Decimal("0.01") < montant_salaire_net:
            raise ValidationError(
                {
                    "montant": (
                        "Montant incompatible avec les heures et avances disponibles "
                        "(pointages insuffisants pour couvrir la part salaire nette)."
                    )
                }
            )
    pointages_marques = len(pts_to_mark)
    avances_soldees = len(advs_to_solde)
    sum_brut = Decimal("0")
    sum_heures = Decimal("0")
    sum_reliquat = Decimal("0")
    m_start, m_end = _month_date_bounds(annee_sel, mois_sel)
    for pt in pts_to_mark:
        nh = Decimal(str(pt.nombre_heures or 0)).quantize(Decimal("0.01"))
        sum_heures += nh
        sum_brut += (nh * tarif).quantize(Decimal("0.01"))
        if not (m_start <= pt.date_cours <= m_end):
            sum_reliquat += nh
    primes_enregistrees = prime_amt
    avances_deduites = (sum_brut + primes_enregistrees - montant_total).quantize(Decimal("0.01"))
    if avances_deduites < 0:
        avances_deduites = Decimal("0")
    tarif_snapshot = prof.tarif_horaire
    rem = (primes_remarque or "").strip()
    if len(rem) > 500:
        rem = rem[:500]
    note = (
        f"Paiement net {montant_total} DT — {pointages_marques} pointage(s) "
        f"réglé(s), {avances_soldees} avance(s) soldée(s)."
    )
    if prime_amt > 0:
        note += f" Primes : {prime_amt} DT."
        if rem:
            note += f" ({rem})"
    reliquat_note = _heures_note_report_anticipatif(
        prof.id, date_depense, mois_sel, annee_sel
    )
    sess = session_caisse_ouverte()
    if sess is None:
        raise ValidationError(
            {
                "detail": "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'enregistrer ce paiement."
            }
        )
    with transaction.atomic():
        titre = f"Salaire professeur — {prof.prenom} {prof.nom}"
        dep = Depense.objects.create(
            titre=titre,
            categorie=Depense.Categorie.AUTRE,
            montant=montant_total,
            date_depense=date_depense,
            note=note,
            session_caisse=sess,
            cree_par=cree_par,
        )
        mois_concerne = date(annee_sel, mois_sel, 1)
        ps = PaiementSalaire.objects.create(
            professeur=prof,
            personnel=None,
            montant=montant_total,
            mois_concerne=mois_concerne,
            depense=dep,
            date_paiement=timezone.now(),
            heures_liquidees=sum_heures,
            salaire_base=sum_brut,
            primes=primes_enregistrees,
            primes_remarque=rem if rem else "",
            nb_heures_prime=nh_p,
            tarif_prime=tp_p,
            avances_deduites=avances_deduites,
            tarif_horaire_snapshot=tarif_snapshot,
            heures_reliquat_m_precedent=sum_reliquat,
            reliquat_anticipatif_heures=reliquat_note,
        )
        Pointage.objects.filter(pk__in=[p.id for p in pts_to_mark]).update(
            statut_paiement=Pointage.StatutPaiement.PAYE,
            est_paye=True,
            recu_paiement=ps,
        )
        if advs_to_solde:
            AvanceSalaire.objects.filter(
                pk__in=[a.id for a in advs_to_solde]
            ).update(est_solde=True)
    apres = _resume_paie_payload(
        prof,
        today,
        perimetre=perimetre,
        mois_prestation=mois_prestation,
        annee_prestation=annee_prestation,
    )
    return {
        "detail": "Paiement enregistré.",
        "depense_id": dep.id,
        "receipt_id": ps.id,
        "montant_verse": montant_total,
        "pointages_marques": pointages_marques,
        "avances_soldees": avances_soldees,
        "net_a_payer_restant": apres["net_a_payer"],
        "reliquat_anticipatif_heures": str(reliquat_note),
        "note_de_report": (
            f"Heures non encore pointées d'ici la fin du mois de prestation (EDT) : {reliquat_note} h"
            if reliquat_note and reliquat_note > 0
            else None
        ),
        "resume_apres": apres,
    }




_MOIS_FR = (
    "",
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)


def _fiche_payload_personnel_from_paiement(ps: PaiementSalaire) -> dict:
    """
    Même rôle que `_fiche_payload_from_paiement` pour le personnel (reçu double, sans heures).
    """
    p = ps.personnel
    if p is None:
        return {}
    m = ps.mois_concerne
    annee = m.year
    mois_num = m.month
    periode = f"{_MOIS_FR[mois_num].capitalize()} {annee}" if 1 <= mois_num <= 12 else "—"
    fixe = ps.salaire_base
    if fixe is None:
        fixe = Decimal("0")
    else:
        fixe = Decimal(str(fixe)).quantize(Decimal("0.01"))
    pri = ps.primes or Decimal("0")
    pri = Decimal(str(pri)).quantize(Decimal("0.01"))
    net = ps.montant
    adv = ps.avances_deduites
    if adv is None:
        adv = (fixe + pri - net).quantize(Decimal("0.01"))
    else:
        adv = Decimal(str(adv)).quantize(Decimal("0.01"))
    if adv < 0:
        adv = Decimal("0")
    date_ref = ps.date_paiement.date() if ps.date_paiement else None
    return {
        "personnel": {
            "id": p.id,
            "nom": p.nom,
            "prenom": p.prenom,
            "poste": p.get_role_display() or p.role,
        },
        "periode_libelle": f"Mois de prestation : {periode}",
        "date_reference": date_ref.isoformat() if date_ref else None,
        "date_paiement": ps.date_paiement.isoformat() if ps.date_paiement else None,
        "mois": mois_num,
        "annee": annee,
        "salaire_mensuel_fixe": fixe,
        "primes_affichees": pri,
        "primes_remarque": (ps.primes_remarque or "").strip(),
        "nb_heures_prime": ps.nb_heures_prime,
        "tarif_prime": ps.tarif_prime,
        "avances_non_soldees": adv,
        "total_avances": adv,
        "net_a_payer": net,
        "salaire_net": net,
        "fiche_historique": True,
        "fiche_donnee_partielle": ps.salaire_base is None,
        "fiche_type": "personnel",
    }


def _fiche_payload_from_paiement(ps: PaiementSalaire) -> dict:
    """
    Représentation alignée sur `resume_paie` / `calculer_paie` pour générer le PDF
    côté client (fiche d’un versement enregistré).
    """
    if ps.personnel_id is not None:
        return _fiche_payload_personnel_from_paiement(ps)
    prof = ps.professeur
    if prof is None:
        return {}
    m = ps.mois_concerne
    annee = m.year
    mois_num = m.month
    periode = f"{_MOIS_FR[mois_num].capitalize()} {annee}" if 1 <= mois_num <= 12 else "—"
    sbase = ps.salaire_base
    adv = ps.avances_deduites
    heures = ps.heures_liquidees
    th = ps.tarif_horaire_snapshot or prof.tarif_horaire
    net = ps.montant
    primes = ps.primes or Decimal("0")
    fiche_donnee_partielle = sbase is None
    if fiche_donnee_partielle:
        sbase = sbase or net
        if adv is None:
            adv = Decimal("0")
        if heures is None:
            heures = Decimal("0")
    else:
        if adv is None:
            adv = (sbase + primes - net).quantize(Decimal("0.01"))
        if heures is None and th and th != 0:
            heures = (sbase / th).quantize(Decimal("0.01"))
        if heures is None:
            heures = Decimal("0")
    if adv is not None and adv < 0:
        adv = Decimal("0")
    date_ref = ps.date_paiement.date() if ps.date_paiement else None
    hl = Decimal(str(heures or 0))
    hr_mp = Decimal(str(ps.heures_reliquat_m_precedent or 0))
    heures_effectuees_mois = (hl - hr_mp).quantize(Decimal("0.01"))
    if heures_effectuees_mois < 0:
        heures_effectuees_mois = Decimal("0")
    hr_mp_q = hr_mp.quantize(Decimal("0.01"))
    ra = ps.reliquat_anticipatif_heures
    rel_ant_q = (
        Decimal(str(ra)).quantize(Decimal("0.01")) if ra is not None else Decimal("0")
    )
    return {
        "professeur": {
            "id": prof.id,
            "nom": prof.nom,
            "prenom": prof.prenom,
            "matiere": prof.matiere or "",
        },
        "periode_libelle": periode,
        "date_reference": date_ref.isoformat() if date_ref else None,
        "date_paiement": ps.date_paiement.isoformat() if ps.date_paiement else None,
        "mois": mois_num,
        "annee": annee,
        "tarif_horaire": th,
        "heures_non_payees": heures,
        "heures_effectuees_mois": heures_effectuees_mois,
        "heures_reliquat_mois_precedent": hr_mp_q,
        "total_heures_payees": hl.quantize(Decimal("0.01")),
        "reliquat_anticipatif_heures": rel_ant_q,
        "total_brut": sbase,
        "salaire_brut": sbase,
        "avances_non_soldees": adv,
        "total_avances": adv,
        "primes_affichees": primes,
        "primes_remarque": (ps.primes_remarque or "").strip(),
        "nb_heures_prime": ps.nb_heures_prime,
        "tarif_prime": ps.tarif_prime,
        "net_a_payer": net,
        "salaire_net": net,
        "fiche_historique": True,
        "fiche_donnee_partielle": fiche_donnee_partielle,
    }


_FR_MOIS_PAIE_LONG = (
    "",
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)


def _libelle_mois_annee_fr(mois: int, annee: int) -> str:
    mi = int(mois)
    if 1 <= mi <= 12:
        return f"{_FR_MOIS_PAIE_LONG[mi].capitalize()} {int(annee)}"
    return f"{mi:02d}/{int(annee)}"


def _payer_salaire_integration_response(
    request,
    *,
    professeur: Professeur | None,
    personnel: Personnel | None,
) -> Response:
    """POST — paiement salaire depuis l’UI liste (caisse ou banque interne)."""
    body = request.data if isinstance(request.data, dict) else {}

    raw_m = (
        str(body.get("mois_concerne") or body.get("year_month") or body.get("mois_a_payer") or "")
        .strip()
    )
    raw_m10 = raw_m.replace("/", "-")[:10]
    if len(raw_m10) >= 10:
        try:
            d_mois = date.fromisoformat(raw_m10[:10])
        except ValueError:
            return Response({"mois_concerne": "Mois invalide (attendu YYYY-MM)."}, status=status.HTTP_400_BAD_REQUEST)
    elif len(raw_m.replace("-", "")) >= 6 and "-" in raw_m:
        parts = raw_m.split("-")[:3]
        try:
            y, mm = int(parts[0]), int(parts[1])
            if not (1 <= mm <= 12):
                raise ValueError
            d_mois = date(y, mm, 1)
        except (ValueError, IndexError):
            return Response({"mois_concerne": "Mois invalide (attendu YYYY-MM)."}, status=status.HTTP_400_BAD_REQUEST)
    else:
        return Response(
            {"mois_concerne": "Indiquez le mois au format YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST
        )
    mois_concerne_date = date(d_mois.year, d_mois.month, 1)
    y, m = mois_concerne_date.year, mois_concerne_date.month

    raw_amt = body.get("montant")
    try:
        montant = Decimal(str(raw_amt).strip().replace(",", "."))
    except Exception:
        return Response({"montant": "Montant invalide."}, status=status.HTTP_400_BAD_REQUEST)
    montant = montant.quantize(Decimal("0.01"))
    if montant <= 0:
        return Response(
            {"montant": "Le montant doit être strictement positif."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    meth_raw = (body.get("methode") or body.get("mode") or "").strip().lower()
    if meth_raw in ("virement", "banque", "bank"):
        meth_key = "banque"
    elif meth_raw in ("caisse", "especes", "espèces", "cash"):
        meth_key = "caisse"
    else:
        return Response(
            {
                "methode": ('Indiquez « caisse » (espèces) ou « banque » (virement). ' f"Reçu : {repr(meth_raw)}."),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    who = personnel if personnel is not None else professeur
    assert who is not None
    nom_affichage = f"{who.prenom} {who.nom}".strip()
    titre_enc = f"Salaire {_libelle_mois_annee_fr(m, y)} - {nom_affichage}"[:255]

    if professeur is not None:
        dup_exists = PaiementSalaire.objects.filter(
            professeur_id=professeur.pk,
            personnel__isnull=True,
            mois_concerne=mois_concerne_date,
        ).exists()
    else:
        dup_exists = PaiementSalaire.objects.filter(
            personnel_id=personnel.pk,
            professeur__isnull=True,
            mois_concerne=mois_concerne_date,
        ).exists()
    if dup_exists:
        return Response(
            {
                "detail": (
                    f"Un paiement existe déjà pour {_libelle_mois_annee_fr(m, y)} ({nom_affichage})."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    now = timezone.now()
    pays_date = timezone.localdate()
    ps: PaiementSalaire | None = None

    try:
        if meth_key == "caisse":
            with transaction.atomic():
                sess = (
                    SessionCaisse.objects.select_for_update()
                    .filter(statut=SessionCaisse.Statut.OUVERT)
                    .order_by("-date_ouverture", "-id")
                    .first()
                )
                if not sess:
                    return Response(
                        {
                            "detail": (
                                "Aucune session de caisse n'est ouverte. "
                                "Ouvrez une session avant d'enregistrer un paiement en espèces."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                dep = Depense.objects.create(
                    titre=titre_enc,
                    categorie=Depense.Categorie.SALAIRE,
                    montant=montant,
                    date_depense=pays_date,
                    note=titre_enc,
                    session_caisse=sess,
                    cree_par=audit_user(request),
                )
                kwargs_ps = dict(
                    montant=montant,
                    mois_concerne=mois_concerne_date,
                    depense=dep,
                    date_paiement=now,
                    primes=Decimal("0.00"),
                )
                if professeur is not None:
                    ps = PaiementSalaire.objects.create(
                        professeur=professeur, personnel=None, **kwargs_ps
                    )
                else:
                    ps = PaiementSalaire.objects.create(
                        personnel=personnel, professeur=None, **kwargs_ps
                    )
                sess.refresh_solde_actuel()
        else:
            with transaction.atomic():
                sess = (
                    SessionCaisse.objects.select_for_update()
                    .filter(statut=SessionCaisse.Statut.OUVERT)
                    .order_by("-date_ouverture", "-id")
                    .first()
                )
                if not sess:
                    return Response(
                        {
                            "detail": (
                                "Aucune session de caisse ouverte : mouvement bancaire et salaire "
                                "non enregistrés (attachement comptable requis)."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                b = Banque.objects.select_for_update().filter(pk=1).first()
                if not b:
                    return Response({"detail": "Compte banque interne absent."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                q = Decimal("0.01")
                if montant > b.solde_actuel:
                    return Response(
                        {
                            "detail": (
                                f"Solde banque insuffisant ({b.solde_actuel} DT disponibles, "
                                f"{montant} DT demandés)."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                b.solde_actuel = (b.solde_actuel - montant).quantize(q)
                b.save(update_fields=["solde_actuel"])

                MouvementBanque.objects.create(
                    type=MouvementBanque.Mouvement.RETRAIT,
                    montant=montant,
                    date=pays_date,
                    session_caisse=sess,
                    justificatif_recu=True,
                )
                sess.refresh_solde_actuel()

                kwargs_ps = dict(
                    montant=montant,
                    mois_concerne=mois_concerne_date,
                    depense=None,
                    date_paiement=now,
                    primes=Decimal("0.00"),
                )
                if professeur is not None:
                    ps = PaiementSalaire.objects.create(
                        professeur=professeur, personnel=None, **kwargs_ps
                    )
                else:
                    ps = PaiementSalaire.objects.create(
                        personnel=personnel, professeur=None, **kwargs_ps
                    )
    except ValidationError as e:
        detail = getattr(e, "detail", None)
        if isinstance(detail, dict) or isinstance(detail, list):
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    assert ps is not None
    return Response(
        {
            "detail": "Paiement enregistré.",
            "paiement_salaire_id": ps.id,
            "methode": meth_key,
        },
        status=status.HTTP_201_CREATED,
    )


def _accorder_avance_response(
    request,
    *,
    professeur: Professeur | None,
    personnel: Personnel | None,
) -> Response:
    """
    POST — avance sur salaire : ``Depense`` (caisse) ou ``MouvementBanque`` (retrait banque)
    + création ``AvanceSalaire`` (compteur déduit lors des paies ultérieurs).

    Corps JSON : ``montant``, ``date`` (AAAA-MM-JJ, défaut aujourd’hui),
    ``methode`` — ``caisse`` ou ``banque``, ``remarque`` (optionnel).
    """
    body = request.data if isinstance(request.data, dict) else {}
    raw_m = body.get("montant")
    try:
        montant = Decimal(str(raw_m).strip().replace(",", "."))
    except Exception:
        return Response({"montant": "Montant invalide."}, status=status.HTTP_400_BAD_REQUEST)
    montant = montant.quantize(Decimal("0.01"))
    if montant <= 0:
        return Response(
            {"montant": "Le montant doit être strictement positif."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    date_raw = body.get("date") or body.get("date_avance")
    if date_raw in (None, ""):
        pays_date = timezone.localdate()
    else:
        from django.utils.dateparse import parse_date

        pays_date = parse_date(str(date_raw))
        if pays_date is None:
            return Response({"date": "Date invalide (AAAA-MM-JJ)."}, status=status.HTTP_400_BAD_REQUEST)

    meth_raw = (body.get("methode") or body.get("mode") or "").strip().lower()
    if meth_raw in ("virement", "banque", "bank"):
        meth_key = "banque"
    elif meth_raw in ("caisse", "especes", "espèces", "cash"):
        meth_key = "caisse"
    else:
        return Response(
            {"methode": "Indiquez « caisse » ou « banque »."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    rem = body.get("remarque")
    remarque = str(rem).strip() if rem not in (None, "") else ""

    who = personnel if personnel is not None else professeur
    assert who is not None
    nom_affichage = f"{who.prenom} {who.nom}".strip()
    titre_dep = f"Avance sur salaire — {nom_affichage}"[:255]

    adv: AvanceSalaire | None = None
    try:
        if meth_key == "caisse":
            with transaction.atomic():
                sess = (
                    SessionCaisse.objects.select_for_update()
                    .filter(statut=SessionCaisse.Statut.OUVERT)
                    .order_by("-date_ouverture", "-id")
                    .first()
                )
                if not sess:
                    return Response(
                        {
                            "detail": (
                                "Aucune session de caisse n'est ouverte. "
                                "Ouvrez une session avant d'enregistrer une avance en espèces."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                Depense.objects.create(
                    titre=titre_dep,
                    categorie=Depense.Categorie.AUTRE,
                    montant=montant,
                    date_depense=pays_date,
                    note=(titre_dep + (f" — {remarque}" if remarque else "")),
                    session_caisse=sess,
                    cree_par=audit_user(request),
                )
                sess.refresh_solde_actuel()
                adv = AvanceSalaire.objects.create(
                    professeur=professeur,
                    personnel=personnel,
                    montant=montant,
                    date=pays_date,
                    remarque=remarque or None,
                    est_solde=False,
                )
        else:
            with transaction.atomic():
                sess = (
                    SessionCaisse.objects.select_for_update()
                    .filter(statut=SessionCaisse.Statut.OUVERT)
                    .order_by("-date_ouverture", "-id")
                    .first()
                )
                if not sess:
                    return Response(
                        {
                            "detail": (
                                "Aucune session de caisse ouverte : mouvement bancaire "
                                "non enregistré (attachement comptable requis)."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                b = Banque.objects.select_for_update().filter(pk=1).first()
                if not b:
                    return Response(
                        {"detail": "Compte banque interne absent."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
                q = Decimal("0.01")
                if montant > b.solde_actuel:
                    return Response(
                        {
                            "detail": (
                                f"Solde banque insuffisant ({b.solde_actuel} DT disponibles, "
                                f"{montant} DT demandés)."
                            ),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                b.solde_actuel = (b.solde_actuel - montant).quantize(q)
                b.save(update_fields=["solde_actuel"])

                MouvementBanque.objects.create(
                    type=MouvementBanque.Mouvement.RETRAIT,
                    montant=montant,
                    date=pays_date,
                    session_caisse=sess,
                    justificatif_recu=True,
                )
                sess.refresh_solde_actuel()

                adv = AvanceSalaire.objects.create(
                    professeur=professeur,
                    personnel=personnel,
                    montant=montant,
                    date=pays_date,
                    remarque=remarque or None,
                    est_solde=False,
                )
    except ValidationError as e:
        detail = getattr(e, "detail", None)
        if isinstance(detail, dict) or isinstance(detail, list):
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    assert adv is not None
    return Response(
        {
            "detail": "Avance enregistrée.",
            "avance_id": adv.id,
            "methode": meth_key,
        },
        status=status.HTTP_201_CREATED,
    )


class ProfesseurViewSet(viewsets.ModelViewSet):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    queryset = Professeur.objects.all().order_by("nom", "prenom")
    serializer_class = ProfesseurSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["matiere"]
    search_fields = ["nom", "prenom", "matiere", "telephone"]

    def get_queryset(self):
        return _annotate_is_paid_current_month(Professeur.objects.all(), for_professeur=True).order_by(
            "nom", "prenom"
        )

    def get_permissions(self):
        act = getattr(self, "action", None)
        if act in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated(), IsAdminOrComptableFinancial()]

    @action(detail=True, methods=["get"], url_path="resume_paie")
    def resume_paie(self, request, pk=None):
        """
        Résumé de paie « jusqu’à aujourd’hui » : heures PRESENTE non payées (y compris mois passés),
        brut, avances non soldées, net à payer, heures prévues restantes sur le mois (EDT).

        Query `perimetre=mois_courant` : uniquement les heures non payées dont la date de cours
        est dans le mois civil en cours (gestionnaire de salaire / fiche du mois).
        """
        prof = self.get_object()
        today = timezone.localdate()
        raw_per = (request.query_params.get("perimetre") or "").strip()
        perimetre = raw_per if raw_per == "mois_courant" else None
        if raw_per and perimetre is None:
            return Response(
                {"perimetre": "Valeur attendue : mois_courant ou omis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        mois_p = request.query_params.get("mois")
        annee_p = request.query_params.get("annee")
        if mois_p not in (None, "") and annee_p not in (None, ""):
            try:
                m_int = int(mois_p)
                a_int = int(annee_p)
            except (TypeError, ValueError):
                return Response(
                    {"mois": "Valeurs mois/annee entières attendues."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if m_int < 1 or m_int > 12:
                return Response(
                    {"mois": "Le mois doit être entre 1 et 12."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                _resume_paie_payload(
                    prof, today, perimetre=perimetre, mois_prestation=m_int, annee_prestation=a_int
                )
            )
        return Response(_resume_paie_payload(prof, today, perimetre=perimetre))

    @action(detail=True, methods=["post"], url_path="executer_paiement")
    def executer_paiement(self, request, pk=None):
        """
        Enregistre un paiement net : pointages en FIFO, avances consommées sur le brut le plus ancien,
        avances soldées quand entièrement couvertes, dépense comptable.

        Corps JSON : { \"montant\": \"123.45\", \"date_paiement\": \"YYYY-MM-DD\" (optionnel) }.
        """
        prof = self.get_object()
        today = timezone.localdate()
        body = request.data if isinstance(request.data, dict) else {}
        raw = body.get("montant")
        if raw is None:
            return Response(
                {"montant": "Le champ montant est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            montant_net = Decimal(str(raw).strip().replace(",", "."))
        except Exception:
            return Response(
                {"montant": "Montant invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_raw = body.get("date_paiement") or body.get("date")
        if date_raw not in (None, ""):
            from django.utils.dateparse import parse_date

            date_depense = parse_date(str(date_raw))
            if date_depense is None:
                return Response(
                    {"date_paiement": "Date invalide (attendu AAAA-MM-JJ)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            date_depense = today

        raw_per = body.get("perimetre")
        if raw_per in (None, ""):
            perimetre_paiement = None
        elif isinstance(raw_per, str) and raw_per.strip() == "mois_courant":
            perimetre_paiement = "mois_courant"
        else:
            return Response(
                {"perimetre": "Valeur attendue : mois_courant ou omis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mois_body = body.get("mois_prestation") or body.get("mois")
        annee_body = body.get("annee_prestation") or body.get("annee")
        mois_int: int | None
        annee_int: int | None
        if mois_body not in (None, "") and annee_body not in (None, ""):
            try:
                mois_int = int(mois_body)
                annee_int = int(annee_body)
            except (TypeError, ValueError):
                return Response(
                    {"mois_prestation": "mois/annee (entiers) attendus."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            mois_int, annee_int = None, None

        pr_prof_raw = body.get("primes")
        if pr_prof_raw in (None, ""):
            primes_prof = Decimal("0.00")
        else:
            try:
                primes_prof = Decimal(str(pr_prof_raw).strip().replace(",", "."))
            except Exception:
                return Response(
                    {"primes": "Valeur de primes invalide."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if primes_prof < 0:
            return Response(
                {"primes": "Les primes ne peuvent pas être négatives."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        primes_prof = primes_prof.quantize(Decimal("0.01"))
        rem_raw = body.get("primes_remarque") or body.get("prime_remarque") or body.get("remarque_primes")
        primes_remarque_prof = str(rem_raw).strip() if rem_raw not in (None, "") else ""

        nh_raw = body.get("nb_heures_prime")
        tt_raw = body.get("tarif_prime")
        nh_dec: Decimal | None
        tt_dec: Decimal | None
        if nh_raw not in (None, "") and tt_raw not in (None, ""):
            try:
                nh_dec = Decimal(str(nh_raw).strip().replace(",", "."))
                tt_dec = Decimal(str(tt_raw).strip().replace(",", "."))
            except Exception:
                return Response(
                    {
                        "nb_heures_prime": "Heures et tarif de prime invalides (nombres décimaux attendus).",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif nh_raw in (None, "") and tt_raw in (None, ""):
            nh_dec, tt_dec = None, None
        else:
            return Response(
                {
                    "nb_heures_prime": (
                        "Fournissez nb_heures_prime et tarif_prime ensemble pour une prime au temps."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            out = _executer_paiement_professeur(
                prof,
                montant_net,
                date_depense,
                today,
                perimetre=perimetre_paiement,
                mois_prestation=mois_int,
                annee_prestation=annee_int,
                primes_montant=primes_prof,
                primes_remarque=primes_remarque_prof,
                nb_heures_prime=nh_dec,
                tarif_prime=tt_dec,
                cree_par=audit_user(request),
            )
        except ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(out, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="calculer_paie")
    def calculer_paie(self, request, pk=None):
        """
        Résumé de paie pour un mois donné.

        - total_heures : somme des `nombre_heures` des pointages non payés du mois
          (`date_cours` dans le mois, `est_paye=False`), en excluant les absences
          (`statut_presence=ABSENTE`) : seuls PRESENTE et RETARD comptent pour la paie.
        - salaire_brut : total_heures × tarif_horaire du professeur.
        - total_avances : somme des avances (`AvanceSalaire`) dont `date` est dans le mois.
        - salaire_net : salaire_brut − total_avances.

        Query params : mois (1–12), annee (défaut : mois / année courants).
        """
        prof = self.get_object()
        now = timezone.now()
        try:
            mois = int(request.query_params.get("mois", now.month))
            annee = int(request.query_params.get("annee", now.year))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Paramètres mois et annee invalides."},
                status=400,
            )
        if mois < 1 or mois > 12:
            return Response(
                {"detail": "Le mois doit être compris entre 1 et 12."},
                status=400,
            )

        total_heures = (
            Pointage.objects.filter(
                professeur=prof,
                statut_paiement=Pointage.StatutPaiement.EN_ATTENTE,
                date_cours__month=mois,
                date_cours__year=annee,
                statut_presence__in=["PRESENTE", "RETARD"],
            ).aggregate(s=Sum("nombre_heures"))["s"]
            or Decimal("0")
        )

        tarif_horaire = prof.tarif_horaire
        salaire_brut = (total_heures * tarif_horaire).quantize(Decimal("0.01"))

        total_avances = (
            AvanceSalaire.objects.filter(
                professeur=prof,
                date__month=mois,
                date__year=annee,
            ).aggregate(s=Sum("montant"))["s"]
            or Decimal("0")
        )

        salaire_net = (salaire_brut - total_avances).quantize(Decimal("0.01"))

        return Response(
            {
                "professeur_id": prof.id,
                "professeur_nom": prof.nom,
                "professeur_prenom": prof.prenom,
                "mois": mois,
                "annee": annee,
                "total_heures": total_heures,
                "tarif_horaire": tarif_horaire,
                "salaire_brut": salaire_brut,
                "total_avances": total_avances,
                "salaire_net": salaire_net,
            }
        )

    @action(detail=True, methods=["post"], url_path="marquer_comme_paye")
    def marquer_comme_paye(self, request, pk=None):
        """
        Désactivé : utiliser l’enregistrement d’un versement (executer_paiement) pour lier chaque
        pointage payé à un reçu PaiementSalaire.
        """
        return Response(
            {
                "detail": (
                    "Action obsolète : validez la paie via « executer_paiement » "
                    "pour lier chaque séance à un reçu (traçabilité obligatoire)."
                ),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=["get"], url_path="historique_fiches_paie")
    def historique_fiches_paie(self, request, pk=None):
        """Lignes de paiement enregistrés pour l’onglet historique (mois, brut, primes, etc.)."""
        prof = self.get_object()
        qs = PaiementSalaire.objects.filter(professeur=prof, personnel__isnull=True).order_by(
            "-mois_concerne", "-date_paiement", "-id"
        )
        return Response(PaiementSalaireProfHistoriqueSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="payer-salaire")
    def payer_salaire(self, request, pk=None):
        """
        Paiement de salaire « direct » depuis la liste (pour un mois donné).

        Corps JSON :
        - ``mois_concerne`` — ``YYYY-MM`` ;
        - ``montant`` — décimal strictement positif ;
        - ``methode`` — ``caisse`` (dépense + session) ou ``banque`` (retrait compte interne + mouvement).
        """
        prof = self.get_object()
        return _payer_salaire_integration_response(request, professeur=prof, personnel=None)

    @action(detail=True, methods=["post"], url_path="accorder-avance")
    def accorder_avance(self, request, pk=None):
        """Avance sur salaire : dépense caisse ou retrait banque + ``AvanceSalaire``."""
        prof = self.get_object()
        return _accorder_avance_response(request, professeur=prof, personnel=None)

    @action(
        detail=True,
        methods=["get"],
        url_path=r"fiche_paie_salaire/(?P<paiement_id>[0-9]+)",
    )
    def fiche_paie_salaire(self, request, pk=None, paiement_id=None):
        """Données fiche de paie pour un versement donné (regénérer le PDF côté client)."""
        prof = self.get_object()
        try:
            pid = int(paiement_id)
        except (TypeError, ValueError):
            return Response({"detail": "Identifiant de paiement invalide."}, status=400)
        ps = get_object_or_404(
            PaiementSalaire,
            pk=pid,
            professeur=prof,
            personnel__isnull=True,
        )
        return Response(_fiche_payload_from_paiement(ps))


class PersonnelViewSet(viewsets.ModelViewSet):
    """
    Personnel non enseignant (RH).

    — Lecture (list/retrieve), résumés paie et paiement : direction ou comptable
      (``IsAdminOrComptableFinancial``).
    — Création / modification / suppression : administrateur uniquement (``IsAdminRole``).

    Détail (`retrieve`) : historiques `paiements_salaire` et `pointages_personnel`.
    Recherche : `?search=` sur nom, prénom, rôle.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    queryset = Personnel.objects.all()
    serializer_class = PersonnelSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["role"]
    search_fields = ["nom", "prenom", "role"]

    def get_queryset(self):
        qs = _annotate_is_paid_current_month(Personnel.objects.all(), for_professeur=False).order_by(
            "nom", "prenom", "id"
        )
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                Prefetch(
                    "paiements_salaire",
                    queryset=PaiementSalaire.objects.select_related("depense").order_by(
                        "-mois_concerne", "-date_paiement", "-id"
                    ),
                ),
                Prefetch(
                    "pointages_personnel",
                    queryset=PointagePersonnel.objects.order_by("-date", "-id"),
                ),
            )
        return qs

    def get_permissions(self):
        act = getattr(self, "action", None)
        if act in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated(), IsAdminOrComptableFinancial()]

    def get_serializer_class(self):
        if self.action == "retrieve":
            return PersonnelDetailSerializer
        return PersonnelSerializer

    @action(detail=True, methods=["get"], url_path="resume-paie")
    def resume_paie(self, request, pk=None):
        """
        Récap. paie (salaire fixe, primes optionnelles, avances) pour un mois.
        Query : `mois_concerne` = YYYY-MM-DD ; `primes` = montant optionnel (bonus).
        """
        from .staff_payroll import personnel_resume_paie_for_month

        personnel = self.get_object()
        mois_raw = (request.query_params.get("mois_concerne") or "").strip()
        if not mois_raw:
            return Response(
                {"detail": "Paramètre mois_concerne requis (format YYYY-MM-DD)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            mois_d = date.fromisoformat(mois_raw[:10])
        except ValueError:
            return Response(
                {"detail": "mois_concerne invalide. Utilisez YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        mois_first = date(mois_d.year, mois_d.month, 1)
        primes_raw = (request.query_params.get("primes") or "").strip() or "0"
        data = personnel_resume_paie_for_month(personnel, mois_first, primes=primes_raw)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="executer_paiement")
    def executer_paiement(self, request, pk=None):
        """
        Enregistre la fiche de paie (net) + `Depense` (Salaires) + soldes / réduit avances.
        JSON : { \"montant\": \"…\", \"date_paiement\": \"AAAA-MM-JJ\",
        \"mois_prestation\": 1-12, \"annee_prestation\": AAAA, \"primes\": \"0.00\" (optionnel) }.
        """
        from .staff_payroll import executer_paiement_personnel

        p = self.get_object()
        body = request.data if isinstance(request.data, dict) else {}
        raw = body.get("montant")
        if raw is None:
            return Response(
                {"montant": "Le champ montant est requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            montant = Decimal(str(raw).strip().replace(",", "."))
        except Exception:
            return Response(
                {"montant": "Montant invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        date_raw = body.get("date_paiement") or body.get("date")
        if date_raw in (None, ""):
            date_dep = timezone.localdate()
        else:
            from django.utils.dateparse import parse_date

            date_dep = parse_date(str(date_raw))
            if date_dep is None:
                return Response(
                    {"date_paiement": "Date invalide (AAAA-MM-JJ)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        m_raw = body.get("mois_prestation") or body.get("mois")
        a_raw = body.get("annee_prestation") or body.get("annee")
        try:
            m_int = int(m_raw)
            a_int = int(a_raw)
        except (TypeError, ValueError):
            return Response(
                {
                    "mois_prestation": "Mois et année de prestation (entiers) sont requis.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if m_int < 1 or m_int > 12:
            return Response(
                {"mois_prestation": "Le mois doit être entre 1 et 12."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pr_raw = body.get("primes")
        if pr_raw in (None, ""):
            primes = Decimal("0.00")
        else:
            try:
                primes = Decimal(str(pr_raw).strip().replace(",", "."))
            except Exception:
                return Response(
                    {"primes": "Valeur de primes invalide."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        rem_pers_raw = body.get("primes_remarque") or body.get("prime_remarque") or body.get("remarque_primes")
        primes_remarque_pers = str(rem_pers_raw).strip() if rem_pers_raw not in (None, "") else ""
        try:
            out = executer_paiement_personnel(
                p,
                montant,
                date_dep,
                m_int,
                a_int,
                primes,
                primes_remarque=primes_remarque_pers,
                cree_par=audit_user(request),
            )
        except ValidationError as e:
            return Response(
                e.detail if hasattr(e, "detail") else str(e),
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(out)

    @action(detail=True, methods=["post"], url_path="payer-salaire")
    def payer_salaire(self, request, pk=None):
        """
        Paiement de salaire « direct » depuis la liste personnel (pour un mois).

        Contrat JSON identique à ``ProfesseurViewSet.payer_salaire``.
        """
        pers = self.get_object()
        return _payer_salaire_integration_response(request, professeur=None, personnel=pers)

    @action(detail=True, methods=["post"], url_path="accorder-avance")
    def accorder_avance(self, request, pk=None):
        """Avance sur salaire : dépense caisse ou retrait banque + ``AvanceSalaire``."""
        pers = self.get_object()
        return _accorder_avance_response(request, professeur=None, personnel=pers)

    @action(
        detail=True,
        methods=["get"],
        url_path=r"fiche_paie_salaire/(?P<paiement_id>[0-9]+)",
    )
    def fiche_paie_salaire(self, request, pk=None, paiement_id=None):
        """Données reçu double pour un versement enregistré (PDF côté client)."""
        pers = self.get_object()
        try:
            ps_id = int(paiement_id)
        except (TypeError, ValueError):
            return Response(
                {"detail": "Identifiant de paiement invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ps = get_object_or_404(
            PaiementSalaire,
            pk=ps_id,
            personnel=pers,
            professeur__isnull=True,
        )
        return Response(_fiche_payload_from_paiement(ps))


class PaiementSalaireViewSet(viewsets.ModelViewSet):
    """
    Paiements de salaire du personnel. Création : enregistre aussi une `Depense` (catégorie Salaires).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    http_method_names = ["get", "post", "delete", "head", "options"]
    queryset = PaiementSalaire.objects.select_related("personnel", "professeur", "depense").order_by(
        "-date_paiement", "-id"
    )

    def get_serializer_class(self):
        if self.action == "create":
            return PaiementSalaireWriteSerializer
        return PaiementSalaireListSerializer

    def perform_destroy(self, instance):
        dep = instance.depense
        instance.delete()
        if dep is not None:
            dep.delete()


class PointagePersonnelViewSet(viewsets.ModelViewSet):
    """Présence / retard du personnel (non enseignant). Même règle d’accès écriture que le pointage profs."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrPointageAgentWrite]
    queryset = (
        PointagePersonnel.objects.select_related("personnel")
        .all()
        .order_by("-date", "-id")
    )
    serializer_class = PointagePersonnelSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["personnel", "date"]

    @action(detail=False, methods=["get"], url_path="get-personnel-and-pointages")
    def get_personnel_and_pointages(self, request):
        """
        Effectif (toutes les fiches `Personnel` : pas de filtre *actif* côté modèle) avec, pour la date
        demandée, le `PointagePersonnel` s’il existe. Query : `date` (YYYY-MM-DD, requis).
        """
        date_str = (request.query_params.get("date") or "").strip()
        if not date_str:
            return Response(
                {"detail": "Paramètre date requis. Utilisez le format YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            return Response(
                {"detail": "Paramètre date invalide. Utilisez le format YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        by_personnel: dict[int, PointagePersonnel] = {
            p.personnel_id: p
            for p in PointagePersonnel.objects.filter(date=target_date).select_related("personnel")
        }
        personnel_qs = Personnel.objects.all().order_by("nom", "prenom", "id")
        ser = PointagePersonnelSerializer
        out = []
        for pers in personnel_qs:
            pt = by_personnel.get(pers.id)
            out.append(
                {
                    "personnel": {
                        "id": pers.id,
                        "nom": pers.nom,
                        "prenom": pers.prenom,
                        "role": pers.role,
                        "role_display": pers.get_role_display(),
                    },
                    "pointage": None if pt is None else ser(pt).data,
                }
            )
        return Response({"date": target_date.isoformat(), "results": out})

    @action(detail=False, methods=["get"], url_path="pointage-manquants")
    def pointage_manquants(self, request):
        """
        Personnel dont l’enregistrement de présence n’existe pas encore pour le jour indiqué
        (comparaison fiches `Personnel` actives inscrites vs. `PointagePersonnel` pour la date).
        Requête : `date` optionnelle (YYYY-MM-DD), défaut = date locale courante.
        """
        date_str = (request.query_params.get("date") or "").strip()
        if date_str:
            try:
                target_date = date.fromisoformat(date_str)
            except ValueError:
                return Response(
                    {"detail": "Paramètre date invalide. Utilisez le format YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            target_date = timezone.localdate()

        all_ids = set(Personnel.objects.values_list("id", flat=True))
        pointes_ids = set(
            PointagePersonnel.objects.filter(date=target_date).values_list(
                "personnel_id", flat=True
            )
        )
        manquant_ids = sorted(all_ids - pointes_ids)
        if not manquant_ids:
            return Response(
                {
                    "date": target_date.isoformat(),
                    "count": 0,
                    "manquants": [],
                }
            )
        manquants = []
        for p in (
            Personnel.objects.filter(id__in=manquant_ids)
            .order_by("nom", "prenom", "id")
            .only("id", "nom", "prenom")
        ):
            nom_complet = f"{(p.prenom or '').strip()} {(p.nom or '').strip()}".strip() or "—"
            manquants.append(
                {
                    "id": p.id,
                    "nom": p.nom,
                    "prenom": p.prenom,
                    "nom_complet": nom_complet,
                }
            )
        return Response(
            {
                "date": target_date.isoformat(),
                "count": len(manquants),
                "manquants": manquants,
            }
        )

    @action(detail=False, methods=["post"], url_path="bulk-enregistrer")
    def bulk_enregistrer(self, request):
        """
        Crée ou met à jour les pointages du jour. Même règle métier que pour les pointages profs :
        aucune date strictement postérieure à aujourd’hui (date locale).
        """
        ser = PointagePersonnelBulkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data["date"]
        today = timezone.localdate()
        if d > today:
            return Response(
                {"detail": "Impossible d'enregistrer un pointage pour une date future."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        items = ser.validated_data["items"]
        personnel_ids = {it["personnel_id"] for it in items}
        if len(personnel_ids) != len(items):
            return Response(
                {"detail": "Chaque personne ne doit apparaire qu’une seule fois dans la liste."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing = set(
            Personnel.objects.filter(id__in=personnel_ids).values_list("id", flat=True)
        )
        missing = personnel_ids - existing
        if missing:
            return Response(
                {"detail": f"Identifiants de personnel inconnus : {sorted(missing)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            for it in items:
                PointagePersonnel.objects.update_or_create(
                    personnel_id=it["personnel_id"],
                    date=d,
                    defaults={"statut": it["statut"]},
                )
        return Response(
            {
                "detail": "Pointage enregistré.",
                "date": d.isoformat(),
                "enregistres": len(items),
            },
            status=status.HTTP_200_OK,
        )


class DepenseViewSet(viewsets.ModelViewSet):
    """
    Dépenses (loyer, factures, fournitures, etc.) — rôles ADMIN ou COMPTABLE.
    Tranche de dates : `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` sur `date_depense`.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptable]
    queryset = Depense.objects.select_related("session_caisse", "cree_par").all().order_by("-date_depense", "-id")
    serializer_class = DepenseSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["categorie"]
    search_fields = ["titre", "note"]

    def get_queryset(self):
        qs = super().get_queryset()
        start_d = _parse_iso_date_param(self.request.query_params.get("start_date"))
        end_d = _parse_iso_date_param(self.request.query_params.get("end_date"))
        if start_d is not None:
            qs = qs.filter(date_depense__gte=start_d)
        if end_d is not None:
            qs = qs.filter(date_depense__lte=end_d)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        log_depense_create(audit_user(self.request), instance)

    def perform_update(self, serializer):
        old_snap = model_snapshot(serializer.instance)
        instance = serializer.save()
        new_snap = model_snapshot(instance)
        diff = build_diff(old_snap, new_snap)
        if diff:
            log_depense_update(audit_user(self.request), instance, diff)

    def perform_destroy(self, instance):
        snap = model_snapshot(instance)
        u = audit_user(self.request)
        log_depense_delete(u, instance, snap)
        instance.delete()


class EmploiDuTempsViewSet(viewsets.ModelViewSet):
    """CRUD emploi du temps (séances datées) — réservé au rôle ADMIN."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    serializer_class = EmploiDuTempsSerializer

    def get_queryset(self):
        """
        Filtre par `classe` et/ou `professeur`. `trimestre` (T1/T2/T3) restreint au trimestre.
        `start_date` / `end_date` : intervalle de dates.
        Si `classe` ou `professeur` est fourni sans trimestre ni plage de dates :
        toute l’année scolaire (`annee_scolaire_debut`, défaut 2025).
        """
        qs = (
            EmploiDuTemps.objects.select_related("professeur", "classe")
            .all()
            .order_by("date_seance", "jour_semaine", "heure_debut", "id")
        )
        raw = self.request.query_params.get("classe")
        if raw is not None and str(raw).strip() != "":
            try:
                qs = qs.filter(classe_id=int(raw))
            except (TypeError, ValueError):
                pass

        prof_raw = self.request.query_params.get("professeur")
        if prof_raw is not None and str(prof_raw).strip() != "":
            try:
                qs = qs.filter(professeur_id=int(prof_raw))
            except (TypeError, ValueError):
                pass

        tri_raw = (self.request.query_params.get("trimestre") or "").strip().upper()
        if tri_raw in ("T1", "T2", "T3"):
            qs = qs.filter(trimestre=tri_raw)

        start_d = _parse_iso_date_param(
            self.request.query_params.get("start_date") or self.request.query_params.get("date_debut")
        )
        end_d = _parse_iso_date_param(
            self.request.query_params.get("end_date") or self.request.query_params.get("date_fin")
        )
        if start_d is not None and end_d is not None:
            qs = qs.filter(date_seance__gte=start_d, date_seance__lte=end_d)
        elif start_d is not None:
            qs = qs.filter(date_seance__gte=start_d)
        elif end_d is not None:
            qs = qs.filter(date_seance__lte=end_d)
        elif tri_raw not in ("T1", "T2", "T3") and (
            (raw is not None and str(raw).strip() != "")
            or (prof_raw is not None and str(prof_raw).strip() != "")
        ):
            # Année scolaire complète (T1 → T3) pour l’extraction du modèle hebdo.
            annee_def = 2025
            try:
                annee_def = int((self.request.query_params.get("annee_scolaire_debut") or "2025").strip())
            except (TypeError, ValueError):
                annee_def = 2025
            y0 = trimestre_date_range("T1", annee_def)[0]
            y1 = trimestre_date_range("T3", annee_def)[1]
            qs = qs.filter(date_seance__gte=y0, date_seance__lte=y1)
        return qs

    @action(detail=False, methods=["post"], url_path="remplacer-modele-trimestre")
    def remplacer_modele_trimestre(self, request):
        """
        Supprime toutes les séances de la classe dans la période du trimestre puis recrée
        les séances datées (lun–ven) à partir du modèle hebdomadaire.
        """
        ser = RemplacerModeleTrimestreSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        vd = ser.validated_data
        classe = vd["classe"]
        tri = vd["trimestre"]
        annee = vd["annee_scolaire_debut"]
        creneaux = [
            {
                "professeur_id": c["professeur"].pk,
                "jour_semaine": c["jour_semaine"],
                "heure_debut": c["heure_debut"],
                "heure_fin": c["heure_fin"],
                "matiere": (c.get("matiere") or "").strip()[:255],
                "salle": (c.get("salle") or "").strip()[:64],
            }
            for c in vd["creneaux"]
        ]
        t_start, t_end = trimestre_date_range(tri, annee)
        with transaction.atomic():
            deleted, _ = EmploiDuTemps.objects.filter(
                classe_id=classe.pk,
                date_seance__gte=t_start,
                date_seance__lte=t_end,
            ).delete()
            rows = generate_seances_for_trimestre(classe.pk, tri, annee, creneaux)
            EmploiDuTemps.objects.bulk_create(rows, batch_size=1500)
        return Response(
            {
                "detail": "Emploi du temps du trimestre enregistré.",
                "trimestre": tri,
                "annee_scolaire_debut": annee,
                "date_debut": t_start.isoformat(),
                "date_fin": t_end.isoformat(),
                "supprime": deleted,
                "cree": len(rows),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="remplacer-modele-annuel")
    def remplacer_modele_annuel(self, request):
        """
        Supprime toutes les séances de la classe sur l’année scolaire puis recrée T1+T2+T3
        à partir du même modèle hebdomadaire.
        """
        ser = RemplacerModeleAnneeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        vd = ser.validated_data
        classe = vd["classe"]
        annee = vd["annee_scolaire_debut"]
        creneaux = [
            {
                "professeur_id": c["professeur"].pk,
                "jour_semaine": c["jour_semaine"],
                "heure_debut": c["heure_debut"],
                "heure_fin": c["heure_fin"],
                "matiere": (c.get("matiere") or "").strip()[:255],
                "salle": (c.get("salle") or "").strip()[:64],
            }
            for c in vd["creneaux"]
        ]
        y0 = trimestre_date_range("T1", annee)[0]
        y1 = trimestre_date_range("T3", annee)[1]
        all_rows = []
        with transaction.atomic():
            deleted, _ = EmploiDuTemps.objects.filter(
                classe_id=classe.pk,
                date_seance__gte=y0,
                date_seance__lte=y1,
            ).delete()
            for tri in ("T1", "T2", "T3"):
                all_rows.extend(generate_seances_for_trimestre(classe.pk, tri, annee, creneaux))
            EmploiDuTemps.objects.bulk_create(all_rows, batch_size=1500)
        return Response(
            {
                "detail": "Emploi du temps annuel enregistré (trimestres T1, T2 et T3).",
                "annee_scolaire_debut": annee,
                "date_debut": y0.isoformat(),
                "date_fin": y1.isoformat(),
                "supprime": deleted,
                "cree": len(all_rows),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="bulk-generate-from-template")
    def bulk_generate_from_template(self, request):
        """
        Déduit un modèle hebdomadaire à partir des séances `EmploiDuTemps` déjà enregistrées
        pour la classe et le trimestre, puis régénère toutes les dates du trimestre
        (même logique que `remplacer-modele-trimestre`).
        """
        ser = GenerateFromTemplateEmploiSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        classe = ser.validated_data["classe"]
        tri = ser.validated_data["trimestre"]
        annee = ser.validated_data["annee_scolaire_debut"]
        t_start, t_end = trimestre_date_range(tri, annee)
        existing = (
            EmploiDuTemps.objects.filter(
                classe_id=classe.pk,
                trimestre=tri,
                date_seance__gte=t_start,
                date_seance__lte=t_end,
            )
            .order_by("jour_semaine", "heure_debut", "id")
        )
        if not existing.exists():
            return Response(
                {
                    "detail": "Aucune séance existante pour extraire un modèle hebdomadaire. Enregistrez d’abord un modèle (créneaux) pour cette classe et ce trimestre.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        seen: set[tuple] = set()
        creneaux: list[dict] = []
        for e in existing:
            key = (e.professeur_id, e.jour_semaine, e.heure_debut, e.heure_fin)
            if key in seen:
                continue
            seen.add(key)
            creneaux.append(
                {
                    "professeur_id": e.professeur_id,
                    "jour_semaine": e.jour_semaine,
                    "heure_debut": e.heure_debut,
                    "heure_fin": e.heure_fin,
                    "matiere": (e.matiere or "").strip()[:255],
                    "salle": (e.salle or "").strip()[:64],
                }
            )
        with transaction.atomic():
            deleted, _ = EmploiDuTemps.objects.filter(
                classe_id=classe.pk,
                date_seance__gte=t_start,
                date_seance__lte=t_end,
            ).delete()
            rows = generate_seances_for_trimestre(classe.pk, tri, annee, creneaux)
            EmploiDuTemps.objects.bulk_create(rows, batch_size=1500)
        return Response(
            {
                "detail": "Séances du trimestre régénérées à partir du modèle en base.",
                "trimestre": tri,
                "annee_scolaire_debut": annee,
                "date_debut": t_start.isoformat(),
                "date_fin": t_end.isoformat(),
                "supprime": deleted,
                "cree": len(rows),
                "creneaux_modele": len(creneaux),
            },
            status=status.HTTP_200_OK,
        )


class ClasseViewSet(viewsets.ModelViewSet):
    """Classes (référentiel) — écriture ADMIN ; lecture pour scolarité / comptabilité / saisie élèves."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    serializer_class = ClasseSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["niveau", "section"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsAdminComptableOrPointageRead()]
        return [IsAuthenticated(), IsAdminRole()]

    def get_queryset(self):
        eleves_par_classe_section = (
            Eleve.objects.filter(classe=OuterRef("nom"), section=OuterRef("section"))
            .values("classe")
            .annotate(c=Count("id"))
            .values("c")[:1]
        )
        cnt = Subquery(eleves_par_classe_section, output_field=IntegerField())
        nord = Case(
            *[When(niveau=code, then=Value(i)) for i, (code, _) in enumerate(NIVEAU_CHOICES)],
            default=Value(99),
            output_field=IntegerField(),
        )
        return (
            Classe.objects.annotate(nombre_eleves=Coalesce(cnt, Value(0, output_field=IntegerField())))
            .annotate(_nord=nord)
            .order_by("_nord", "section", "nom", "id")
        )


def _sessions_du_jour_rows_for_date(target_date: date) -> list[dict]:
    """
    Une entrée par séance d'emploi du temps à cette date, avec drapeau de pointage
    (même règles de correspondance que `PointageViewSet.sessions_du_jour`).
    """
    schedules = (
        EmploiDuTemps.objects.filter(date_seance=target_date)
        .select_related("professeur", "classe")
        .order_by("heure_debut", "id")
    )
    day_pointages = list(
        Pointage.objects.filter(date_cours=target_date)
        .select_related("classe", "emploi_du_temps")
        .order_by("-id")
    )
    by_edt_id: dict[int, Pointage] = {}
    legacy_by_prof: dict[int, Pointage] = {}
    for pt in day_pointages:
        eid = pt.emploi_du_temps_id
        if eid:
            if eid not in by_edt_id:
                by_edt_id[eid] = pt
        elif pt.professeur_id not in legacy_by_prof:
            legacy_by_prof[pt.professeur_id] = pt

    out: list[dict] = []
    for row in schedules:
        prof = row.professeur
        pt = by_edt_id.get(row.id)
        if pt is None:
            leg = legacy_by_prof.get(prof.id)
            if leg is not None and (leg.classe_id is None or leg.classe_id == row.classe_id):
                pt = leg
        duree = row.duree_heures
        out.append(
            {
                "schedule_id": row.id,
                "professeur_id": prof.id,
                "professeur_nom": prof.nom,
                "professeur_prenom": prof.prenom,
                "professeur_name": f"{prof.nom} {prof.prenom}".strip(),
                "classe_id": row.classe_id,
                "classe_nom": row.classe.nom if row.classe else "Sans classe",
                "heure_debut": row.heure_debut.isoformat() if row.heure_debut else None,
                "heure_fin": row.heure_fin.isoformat() if row.heure_fin else None,
                "duree_heures": round(duree, 2),
                "deja_pointe": pt is not None,
                "pointage_id": pt.id if pt else None,
                "statut_presence": pt.statut_presence if pt else None,
            }
        )
    return out


def _professeurs_creneaux_non_pointes(rows: list[dict]) -> list[dict]:
    """
    Professeurs avec au moins un créneau sans pointage. `heure_debut` = heure de la
    première séance de la journée (emploi du temps), tous créneaux confondus.
    """
    by_pid: dict[int, dict] = {}
    for r in rows:
        pid = r["professeur_id"]
        if pid not in by_pid:
            by_pid[pid] = {
                "nom": r.get("professeur_nom") or "",
                "prenom": r.get("professeur_prenom") or "",
                "heure_debuts": [],
                "any_unpointed": False,
            }
        g = by_pid[pid]
        hd = r.get("heure_debut")
        if hd:
            g["heure_debuts"].append(hd)
        if not r.get("deja_pointe"):
            g["any_unpointed"] = True
    out = []
    for pid, g in by_pid.items():
        if not g["any_unpointed"]:
            continue
        times = g["heure_debuts"]
        first = min(times) if times else None
        heure_court = first[:5] if first and len(first) >= 5 else (first or None)
        out.append(
            {
                "professeur_id": pid,
                "nom": g["nom"],
                "prenom": g["prenom"],
                "heure_debut": heure_court,
            }
        )
    out.sort(key=lambda x: (x["heure_debut"] or "", x["nom"] or "", x["prenom"] or ""))
    return out


_SESSIONS_DU_JOUR_API_KEYS = (
    "schedule_id",
    "professeur_id",
    "professeur_name",
    "classe_id",
    "classe_nom",
    "heure_debut",
    "heure_fin",
    "duree_heures",
    "deja_pointe",
    "pointage_id",
    "statut_presence",
)


class PointageViewSet(viewsets.ModelViewSet):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrPointageAgentWrite]
    queryset = (
        Pointage.objects.select_related("professeur", "classe", "emploi_du_temps")
        .all()
        .order_by("date_cours", "id")
    )
    serializer_class = PointageSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_class = PointageFilter
    search_fields = ["remarque", "professeur__nom", "professeur__prenom", "classe__nom"]

    def list(self, request, *args, **kwargs):
        today = timezone.localdate()
        start_d = _parse_iso_date_param(
            request.query_params.get("start_date") or request.query_params.get("date_debut")
        )
        end_d = _parse_iso_date_param(
            request.query_params.get("end_date") or request.query_params.get("date_fin")
        )
        if start_d is None:
            start_d = today.replace(day=1)
        if end_d is None:
            end_d = today
        if start_d > end_d:
            return Response(
                {"detail": "start_date doit être antérieur ou égal à end_date."},
                status=400,
            )

        qs = self.filter_queryset(self.get_queryset()).filter(
            date_cours__gte=start_d,
            date_cours__lte=end_d,
        )

        search_term = (request.query_params.get("search") or "").strip()
        prof_scope = _professeur_ids_for_pointage_search(search_term)
        if prof_scope is not None and not prof_scope:
            heures_theoriques = Decimal("0")
        else:
            heures_theoriques = _theoretical_hours_emploi_range(
                start_d, end_d, prof_scope
            ).quantize(Decimal("0.01"))

        dec_h = DecimalField(max_digits=12, decimal_places=2)
        heures_realisees = (
            qs.filter(statut_presence="PRESENTE").aggregate(
                s=Sum("nombre_heures", output_field=dec_h)
            )["s"]
            or Decimal("0")
        )
        if not isinstance(heures_realisees, Decimal):
            heures_realisees = Decimal(str(heures_realisees))
        heures_realisees = heures_realisees.quantize(Decimal("0.01"))

        if start_d > today:
            taux_presence = None
        elif heures_theoriques > 0:
            taux_presence = float(
                (heures_realisees / heures_theoriques * Decimal("100")).quantize(
                    Decimal("0.01")
                )
            )
        else:
            taux_presence = None

        occupied_edt: set[tuple[date, int]] = set()
        for p in qs:
            if p.emploi_du_temps_id:
                occupied_edt.add((p.date_cours, p.emploi_du_temps_id))

        serializer = self.get_serializer(qs, many=True)
        results = list(serializer.data)

        skip_virtual = bool(
            (request.query_params.get("statut_presence") or "").strip()
            or ("est_paye" in request.query_params)
            or (request.query_params.get("statut_paiement") or "").strip()
        )
        if end_d > today and not skip_virtual:
            empty_slots, slot_list = _emploi_du_temps_queryset_for_virtual_rows(
                request, prof_scope, start_d, end_d
            )
            if not empty_slots:
                virtual_rows = _virtual_pointage_dicts_for_future_range(
                    start_d,
                    end_d,
                    today,
                    occupied_edt,
                    slot_list,
                )
                results.extend(virtual_rows)
                results.sort(key=lambda r: (r.get("date_cours") or "", str(r.get("id"))))

        return Response(
            {
                "results": results,
                "summary": {
                    "heures_realisees": str(heures_realisees),
                    "heures_theoriques": str(heures_theoriques),
                    "taux_presence": taux_presence,
                    "start_date": start_d.isoformat(),
                    "end_date": end_d.isoformat(),
                },
            }
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        log_pointage_create(audit_user(self.request), instance)

    def perform_update(self, serializer):
        inst = serializer.instance
        if inst.statut_paiement == Pointage.StatutPaiement.PAYE or inst.recu_paiement_id:
            raise ValidationError(
                {"detail": "Une séance payée (liée à un reçu) ne peut plus être modifiée."}
            )
        ancien_statut = inst.statut_presence
        instance = serializer.save()
        log_pointage_update(audit_user(self.request), instance, ancien_statut)

    def perform_destroy(self, instance):
        if instance.statut_paiement == Pointage.StatutPaiement.PAYE or instance.recu_paiement_id:
            raise ValidationError(
                {"detail": "Une séance payée (liée à un reçu) ne peut pas être supprimée."}
            )
        u = audit_user(self.request)
        log_pointage_delete(u, instance)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="sessions_du_jour")
    def sessions_du_jour(self, request):
        """
        Séances prévues pour une date (emploi du temps) avec état de pointage éventuel.

        Query : `date` (optionnel, format YYYY-MM-DD). Sinon : date locale du serveur.

        Les séances sont celles dont `date_seance` égale la date demandée.
        Les pointages sont comparés sur cette même date (`date_cours`).
        """
        date_str = request.query_params.get("date")
        if date_str:
            date_str = date_str.strip()
            try:
                target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                return Response(
                    {"detail": "Paramètre date invalide. Utilisez le format YYYY-MM-DD."},
                    status=400,
                )
        else:
            target_date = timezone.localdate()

        raw = _sessions_du_jour_rows_for_date(target_date)
        return Response([{k: r[k] for k in _SESSIONS_DU_JOUR_API_KEYS} for r in raw])

    @action(detail=False, methods=["get"], url_path="professeurs-pointage-manquants")
    def professeurs_pointage_manquants(self, request):
        """
        Professeurs qui ont au moins un cours prévu aujourd'hui (emploi du temps) sans
        pointage enregistré pour ce créneau. Les enseignants sans séance à cette date
        n'apparaissent pas.

        Query : `date` (optionnel, YYYY-MM-DD), défaut = jour civil local.
        """
        date_str = request.query_params.get("date")
        if date_str:
            date_str = date_str.strip()
            try:
                target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                return Response(
                    {"detail": "Paramètre date invalide. Utilisez le format YYYY-MM-DD."},
                    status=400,
                )
        else:
            target_date = timezone.localdate()

        rows = _sessions_du_jour_rows_for_date(target_date)
        manquants = _professeurs_creneaux_non_pointes(rows)
        return Response(
            {
                "date": target_date.isoformat(),
                "count": len(manquants),
                "manquants": manquants,
            }
        )


class AvanceSalaireViewSet(viewsets.ModelViewSet):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]
    queryset = (
        AvanceSalaire.objects.select_related("professeur").all().order_by("-date", "-id")
    )
    serializer_class = AvanceSalaireSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["professeur"]


def _journal_raw_rows_from_paiements_depenses(paiements, depenses, tz):
    """Construit les lignes brutes ordonnées (entrées/sorties caisse élèves + dépenses)."""
    q = Decimal("0.01")
    raw_rows = []

    for p in paiements:
        e = p.eleve
        montant = Decimal(p.montant_paye).quantize(q)
        student_name = f"{e.prenom} {e.nom}".strip()
        libelle = f"Paiement: {student_name}"
        type_lbl = p.get_type_frais_display()
        raw_rows.append(
            {
                "_sort_at": p.date_encaissement,
                "_tie": (0, p.id),
                "id": f"paiement-{p.id}",
                "date": p.date_encaissement,
                "montant": montant,
                "is_entree": True,
                "libelle": libelle,
                "source": f"{type_lbl} · {p.get_methode_display()} · {e.classe}",
                **auteur_rapport_payload(getattr(p, "cree_par", None)),
            }
        )

    for d in depenses:
        montant = Decimal(d.montant).quantize(q)
        sort_at = timezone.make_aware(
            datetime.combine(d.date_depense, time_midnight(23, 59, 59, 999999)), tz
        )
        libelle = f"Dépense: {d.titre}"
        cat_label = d.get_categorie_display()
        note = (d.note or "").strip()
        raw_rows.append(
            {
                "_sort_at": sort_at,
                "_tie": (1, d.id),
                "id": f"depense-{d.id}",
                "date": sort_at,
                "montant": montant,
                "is_entree": False,
                "libelle": libelle,
                "source": cat_label + (f" · {note}" if note else ""),
                **auteur_rapport_payload(getattr(d, "cree_par", None)),
            }
        )

    raw_rows.sort(key=lambda r: (r["_sort_at"], r["_tie"]))
    return raw_rows


def _caisse_journal_payload(request) -> Response:
    """
    Journal financier unifié : encaissements élèves et dépenses.

    * **Entrées** : modèle ``Paiement`` (équivalent métier « Paiement élève » ; pas de table
      ``PaiementEleve``). Date = ``date_encaissement`` (horodatage réel de l’encaissement).
    * **Sorties** : ``Depense`` ; date = ``date_depense`` (fin de journée locale pour l’ordre).

    Filtre inclusif : ``date_debut`` / ``date_fin`` ou ``start_date`` / ``end_date`` (YYYY-MM-DD).
    Si aucune borne n’est fournie : du **1er septembre de l’année scolaire en cours** au jour courant
    (rentrée au 1er sept., sinon année précédente).

    Le solde progressif est calculé dans l’ordre chronologique (entrées augmentent, sorties diminuent),
    puis les lignes sont renvoyées triées par **date décroissante**.

    Si ``session_caisse`` (id entier) est fourni : uniquement les paiements et dépenses **liés à cette session**
    (filtre ignoré pour les dates). Réponse enrichie : ``session_caisse``, ``mouvements_banque``, ``bilan``.
    """
    qp = request.query_params
    tz = timezone.get_current_timezone()
    q = Decimal("0.01")

    sess_obj = None
    session_pk_raw = qp.get("session_caisse") or qp.get("session_caisse_id")

    if session_pk_raw not in (None, ""):
        try:
            session_pk = int(str(session_pk_raw).strip())
        except (ValueError, TypeError):
            return Response(
                {"detail": "session_caisse doit être un identifiant entier."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sess_obj = (
            SessionCaisse.objects.select_related("ouvert_par")
            .filter(pk=session_pk)
            .first()
        )
        if not sess_obj:
            return Response(
                {"detail": "Session de caisse introuvable."},
                status=status.HTTP_404_NOT_FOUND,
            )
        sess_obj.refresh_solde_actuel()
        sess_obj.refresh_from_db()
        paiements = (
            Paiement.objects.select_related("eleve", "cree_par")
            .filter(session_caisse_id=session_pk)
            .order_by("date_encaissement", "id")
        )
        depenses = Depense.objects.select_related("cree_par").filter(session_caisse_id=session_pk).order_by(
            "date_depense", "id"
        )
        start_d = timezone.localdate(sess_obj.date_ouverture)
        end_d = (
            timezone.localdate(sess_obj.date_fermeture)
            if sess_obj.date_fermeture
            else timezone.localdate()
        )
    else:
        has_any_bound = any(
            qp.get(k) not in (None, "")
            for k in ("date_debut", "date_fin", "start_date", "end_date")
        )
        start_d = _parse_iso_date_param(qp.get("date_debut") or qp.get("start_date"))
        end_d = _parse_iso_date_param(qp.get("date_fin") or qp.get("end_date"))
        today = timezone.localdate()
        if not has_any_bound:
            # Année scolaire type TN : septembre → juin — fenêtre par défaut plus large qu’un seul mois.
            y = today.year if today.month >= 9 else today.year - 1
            start_d = date(y, 9, 1)
            end_d = today
        else:
            if start_d is None:
                start_d = today.replace(day=1)
            if end_d is None:
                end_d = today
        if start_d > end_d:
            return Response(
                {"detail": "date_debut doit être antérieur ou égal à date_fin."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        start_dt = timezone.make_aware(datetime.combine(start_d, time_midnight.min), tz)
        end_dt = timezone.make_aware(
            datetime.combine(end_d, time_midnight(23, 59, 59, 999999)), tz
        )

        paiements = (
            Paiement.objects.select_related("eleve", "cree_par")
            .filter(date_encaissement__gte=start_dt, date_encaissement__lte=end_dt)
            .order_by("date_encaissement", "id")
        )
        depenses = Depense.objects.select_related("cree_par").filter(
            date_depense__gte=start_d, date_depense__lte=end_d
        ).order_by("date_depense", "id")

    raw_rows = _journal_raw_rows_from_paiements_depenses(paiements, depenses, tz)

    total_entrees = Decimal("0")
    total_sorties = Decimal("0")
    running = Decimal("0")
    entries_chrono = []

    for row in raw_rows:
        m = row["montant"]
        if row["is_entree"]:
            total_entrees += m
            running += m
            entree_f = float(m)
            sortie_f = 0.0
        else:
            total_sorties += m
            running -= m
            entree_f = 0.0
            sortie_f = float(m)

        dt = row["date"]
        running_f = float(running.quantize(q))

        entries_chrono.append(
            {
                "id": row["id"],
                "date": dt.isoformat(),
                "date_time": dt.isoformat(),
                "type": "ENTRÉE" if row["is_entree"] else "SORTIE",
                "libelle": row["libelle"],
                "source": row["source"],
                "entree": entree_f,
                "sortie": sortie_f,
                "montant": str(m),
                "solde_progressif": running_f,
                "cree_par_id": row.get("cree_par_id"),
                "cree_par_nom": row.get("cree_par_nom"),
                "cree_par_role": row.get("cree_par_role"),
            }
        )

    entries_out = sorted(
        entries_chrono,
        key=lambda e: (e["date"], e["id"]),
        reverse=True,
    )

    solde_final = (total_entrees - total_sorties).quantize(q)
    te = float(total_entrees.quantize(q))
    ts = float(total_sorties.quantize(q))
    sf = float(solde_final)

    payload = {
        "date_debut": start_d.isoformat(),
        "date_fin": end_d.isoformat(),
        "start_date": start_d.isoformat(),
        "end_date": end_d.isoformat(),
        "entries": entries_out,
        "total_entrees": te,
        "total_sorties": ts,
        "solde_final": sf,
        "total_entrees_str": str(total_entrees.quantize(q)),
        "total_sorties_str": str(total_sorties.quantize(q)),
        "solde_final_str": str(solde_final),
    }

    if sess_obj is not None:
        mouvements_qs = MouvementBanque.objects.filter(
            session_caisse_id=sess_obj.pk
        ).order_by("date", "id")
        total_retraits = Decimal("0")
        total_versements = Decimal("0")
        mb_out = []
        for m in mouvements_qs:
            amt = Decimal(m.montant).quantize(q)
            if m.type == MouvementBanque.Mouvement.RETRAIT:
                total_retraits += amt
            else:
                total_versements += amt
            det = None
            if m.type == MouvementBanque.Mouvement.VERSEMENT:
                det = (
                    "Justificatif reçu"
                    if m.justificatif_recu
                    else "En attente de justificatif"
                )
            mb_out.append(
                {
                    "id": m.id,
                    "type": m.type,
                    "montant": str(amt),
                    "date": m.date.isoformat(),
                    "justificatif_recu": m.justificatif_recu,
                    "libelle": (
                        "Versement vers la banque"
                        if m.type == MouvementBanque.Mouvement.VERSEMENT
                        else "Alimentation caisse (retrait banque)"
                    ),
                    "detail": det,
                }
            )

        si = Decimal(sess_obj.solde_initial).quantize(q)
        solde_theorique = (
            si + total_entrees - total_sorties + total_retraits - total_versements
        ).quantize(q)
        ecart = None
        if sess_obj.solde_final is not None:
            ecart = (
                Decimal(sess_obj.solde_final).quantize(q) - solde_theorique
            ).quantize(q)

        u = sess_obj.ouvert_par
        ouvert_nom = ""
        if u:
            ouvert_nom = (u.get_full_name() or "").strip() or u.username

        payload["session_caisse"] = {
            "id": sess_obj.id,
            "statut": sess_obj.statut,
            "solde_initial": str(si),
            "solde_actuel": str(Decimal(sess_obj.solde_actuel).quantize(q)),
            "solde_final": (
                str(Decimal(sess_obj.solde_final).quantize(q))
                if sess_obj.solde_final is not None
                else None
            ),
            "date_ouverture": sess_obj.date_ouverture.isoformat(),
            "date_fermeture": (
                sess_obj.date_fermeture.isoformat()
                if sess_obj.date_fermeture
                else None
            ),
            "ouvert_par_username": u.username if u else "",
            "ouvert_par_nom": ouvert_nom,
        }
        payload["mouvements_banque"] = mb_out
        payload["bilan"] = {
            "solde_initial": str(si),
            "total_entrees": str(total_entrees.quantize(q)),
            "total_sorties": str(total_sorties.quantize(q)),
            "total_retraits_banque": str(total_retraits),
            "total_versements_banque": str(total_versements),
            "solde_theorique": str(solde_theorique),
            "session_en_cours": sess_obj.statut == SessionCaisse.Statut.OUVERT,
            "solde_reel_declare": (
                str(Decimal(sess_obj.solde_final).quantize(q))
                if sess_obj.solde_final is not None
                else None
            ),
            "ecart": str(ecart) if ecart is not None else None,
        }

    return Response(payload)


_JUSTIFICATIF_BANQUE_MIME = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    }
)
_JUSTIFICATIF_BANQUE_MAX = 8 * 1024 * 1024


def _parse_banque_date(v):
    if v in (None, ""):
        return timezone.localdate()
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        s = str(v).strip()[:10]
        y, m, d = s.split("-", 2)
        return date(int(y), int(m), int(d))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({"date": ["Date invalide (utilisez AAAA-MM-JJ)."]})


def _banque_verifier_fichier(f) -> None:
    if f is None:
        raise ValidationError(
            {"justificatif_file": ["Un justificatif (image ou PDF) est obligatoire."]}
        )
    n = f.size
    if n is not None and n > _JUSTIFICATIF_BANQUE_MAX:
        raise ValidationError({"justificatif_file": ["Fichier trop volumineux (max. 8 Mo)."]})
    ct = (getattr(f, "content_type", None) or "").split(";")[0].strip().lower()
    if ct and ct in _JUSTIFICATIF_BANQUE_MIME:
        return
    name = (getattr(f, "name", "") or "").lower()
    if name.endswith((".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return
    raise ValidationError(
        {"justificatif_file": ["Format accepté : PDF ou image (JPEG, PNG, WebP, GIF)."]}
    )


def _user_peut_voir_solde_banque_chiffre(user) -> bool:
    """Directrice / ADMIN : solde banque en chiffres ; COMPTABLE : masqué."""
    return effective_role(user) == User.Role.ADMIN


def _banque_solde_api_payload(request, banque: Banque) -> dict:
    if _user_peut_voir_solde_banque_chiffre(request.user):
        return {"masque": False, "solde_actuel": str(banque.solde_actuel)}
    return {"masque": True, "solde_libelle": "**** DT"}


def _parse_bool_justificatif(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "1", "oui", "yes", "o"):
        return True
    if s in ("false", "0", "non", "no", "n"):
        return False
    return None


class BanqueViewSet(viewsets.ViewSet):
    """
    Solde unique « banque interne » et transferts caisse ⟷ banque (multipart).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    @action(detail=False, methods=["get"], url_path="solde")
    def solde(self, request):
        b, _ = Banque.objects.get_or_create(
            pk=1,
            defaults={"solde_actuel": Decimal("0.00")},
        )
        return Response(_banque_solde_api_payload(request, b))

    def _transfert(self, request, *, vers_banque: bool):
        session = session_caisse_ouverte()
        if not session or session.statut != SessionCaisse.Statut.OUVERT:
            return Response(
                {"detail": "Aucune session de caisse ouverte."},
                status=400,
            )
        f = request.FILES.get("justificatif_file")
        if f is None:
            f = request.FILES.get("fichier")
        try:
            _banque_verifier_fichier(f)
        except ValidationError as e:
            return Response(e.detail, status=400)
        try:
            vdate = _parse_banque_date(
                request.data.get("date")
                or request.POST.get("date")
            )
        except ValidationError as e:
            return Response(e.detail, status=400)
        raw = request.data.get("montant", request.POST.get("montant", ""))
        try:
            m = Decimal(str(raw).replace(",", ".").strip())
        except (ArithmeticError, TypeError, ValueError):
            return Response({"montant": ["Montant invalide."]}, status=400)
        if m <= 0:
            return Response({"montant": ["Le montant doit être positif."]}, status=400)
        q = Decimal("0.01")
        m = m.quantize(q)

        with transaction.atomic():
            s = (
                SessionCaisse.objects.select_for_update()
                .filter(pk=session.pk, statut=SessionCaisse.Statut.OUVERT)
                .first()
            )
            if not s:
                return Response(
                    {"detail": "La session a été fermée. Rafraîchissez la page."},
                    status=400,
                )
            b = Banque.objects.select_for_update().filter(pk=1).first()
            if not b:
                return Response(
                    {"detail": "Compte banque non initialisé. Contactez l’administrateur."},
                    status=500,
                )
            s.refresh_solde_actuel()
            b.refresh_from_db()
            if vers_banque:
                if m > s.solde_actuel:
                    return Response(
                        {"montant": [f"Solde caisse insuffisant ({s.solde_actuel} DT disponible)."]},
                        status=400,
                    )
                b.solde_actuel = (b.solde_actuel + m).quantize(q)
                mv = MouvementBanque.Mouvement.VERSEMENT
            else:
                if m > b.solde_actuel:
                    return Response(
                        {"montant": [f"Solde banque insuffisant ({b.solde_actuel} DT disponible)."]},
                        status=400,
                    )
                b.solde_actuel = (b.solde_actuel - m).quantize(q)
                mv = MouvementBanque.Mouvement.RETRAIT
            b.save(update_fields=["solde_actuel"])
            MouvementBanque.objects.create(
                type=mv,
                montant=m,
                date=vdate,
                justificatif_file=f,
                session_caisse_id=s.id,
                justificatif_recu=True,
            )
            s.refresh_solde_actuel()
        s = SessionCaisse.objects.get(pk=session.pk)
        b = Banque.objects.get(pk=1)
        out = {"session": SessionCaisseSerializer(s).data}
        out["banque"] = (
            {"solde_actuel": str(b.solde_actuel)}
            if _user_peut_voir_solde_banque_chiffre(request.user)
            else {"masque": True, "solde_libelle": "**** DT"}
        )
        return Response(out)

    @action(
        detail=False,
        methods=["post"],
        url_path="verser-vers-banque",
        parser_classes=[MultiPartParser, FormParser],
    )
    def verser_vers_banque(self, request):
        return self._transfert(request, vers_banque=True)

    @action(
        detail=False,
        methods=["post"],
        url_path="retrait-alimentation",
        parser_classes=[MultiPartParser, FormParser],
    )
    def retrait_alimentation(self, request):
        return self._transfert(request, vers_banque=False)

    @action(
        detail=False,
        methods=["post"],
        url_path="definir-solde-actuel",
        permission_classes=[IsAuthenticated, IsAdminRole],
    )
    def definir_solde_actuel(self, request):
        """
        Remplace le solde interne Banque(pk=1) par le montant réel —
        hors historique mouvements (installation / réconciliation initiale).
        """
        raw = request.data.get("solde_actuel", "")
        try:
            m = Decimal(str(raw).replace(",", ".").strip())
        except (ArithmeticError, TypeError, ValueError):
            return Response({"solde_actuel": ["Montant invalide."]}, status=400)
        q = Decimal("0.01")
        m = m.quantize(q)
        b, _ = Banque.objects.update_or_create(pk=1, defaults={"solde_actuel": m})
        return Response({"solde_actuel": str(b.solde_actuel)})


class CalendrierScolaireViewSet(viewsets.ModelViewSet):
    """
    Vacances et jours fériés — paramètres école (ADMIN uniquement).
    Consommation future par le pointage et l’emploi du temps.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminRole]
    serializer_class = CalendrierScolaireSerializer
    queryset = CalendrierScolaire.objects.all()
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]


class CaisseViewSet(viewsets.ViewSet):
    """
    Point d’entrée « caisse » : journal unifié des mouvements (encaissements + dépenses).
    Réservé aux rôles ADMIN et COMPTABLE (``IsAdminOrComptableFinancial``).
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]

    @action(detail=False, methods=["get"], url_path="journal")
    def journal(self, request):
        return _caisse_journal_payload(request)


class MouvementBanqueViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET liste : ``/api/mouvements-banque/`` (filtres query : ``date_debut``, ``date_fin``, ``type``).
    ``type=all`` (défaut) : pas de filtre sur le type ; sinon ``versement`` ou ``retrait`` uniquement.

    GET ``promesses/`` : mouvements avec promesse de justificatif (inchangé).

    POST sur un pk : ``annuler_versement``, ``completer-justificatif``.
    """

    queryset = MouvementBanque.objects.select_related(
        "session_caisse", "session_caisse__ouvert_par"
    )
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]
    serializer_class = MouvementBanqueListeSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        qp = self.request.query_params
        dd = qp.get("date_debut") or qp.get("start_date")
        df = qp.get("date_fin") or qp.get("end_date")
        if dd and len(str(dd).strip()) >= 10:
            try:
                d0 = datetime.strptime(str(dd).strip()[:10], "%Y-%m-%d").date()
                qs = qs.filter(date__gte=d0)
            except ValueError:
                logger.warning(
                    "[MouvementBanque] date_debut invalide (ignoré): %r",
                    dd,
                )
        if df and len(str(df).strip()) >= 10:
            try:
                d1 = datetime.strptime(str(df).strip()[:10], "%Y-%m-%d").date()
                qs = qs.filter(date__lte=d1)
            except ValueError:
                logger.warning(
                    "[MouvementBanque] date_fin invalide (ignoré): %r",
                    df,
                )
        # Ne jamais passer type=all (ou autre valeur hors choix) à l'ORM sur le champ `type`.
        type_filter = (qp.get("type") or "all").strip().lower()
        if type_filter in ("versement", "retrait"):
            qs = qs.filter(type=type_filter)
        return qs.order_by("-date", "-id")

    @action(detail=False, methods=["get"], url_path="promesses")
    def promesses(self, request):
        """Versements promis (justificatif_recu=False) lies a une session fermee en attente."""
        qs = (
            MouvementBanque.objects.filter(
                justificatif_recu=False,
                session_caisse__statut=SessionCaisse.Statut.FERME,
                session_caisse__versement_promesse_en_attente=True,
            )
            .select_related("session_caisse", "session_caisse__ouvert_par")
            .order_by("-session_caisse__date_fermeture", "-id")
        )
        from .serializers import MouvementBanquePromesseSerializer
        return Response(MouvementBanquePromesseSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="annuler_versement")
    def annuler_versement(self, request, pk=None):
        """
        Annule une promesse de versement :
        - Supprime le MouvementBanque (justificatif_recu=False).
        - Ne touche PAS le solde banque (la banque n'a jamais ete creditee pour ces promesses).
        - Reintegre le montant dans le solde de la session ouverte si elle existe.
        - Leve le blocage d'ouverture sur la session fermee associee.
        """
        q = Decimal("0.01")
        m = self.get_object()
        if m.justificatif_recu:
            return Response(
                {"detail": "Ce mouvement possede deja un justificatif valide."},
                status=400,
            )
        montant = m.montant.quantize(q)
        m_type = m.type
        session_pk = m.session_caisse_id
        with transaction.atomic():
            m_db = (
                MouvementBanque.objects.select_for_update()
                .filter(pk=m.pk, justificatif_recu=False)
                .first()
            )
            if not m_db:
                return Response(
                    {"detail": "Mouvement deja traite ou introuvable."},
                    status=400,
                )
            m_db.delete()
            ouv = (
                SessionCaisse.objects.select_for_update()
                .filter(statut=SessionCaisse.Statut.OUVERT)
                .order_by("-date_ouverture", "-id")
                .first()
            )
            if ouv and m_type == MouvementBanque.Mouvement.VERSEMENT:
                ouv.solde_actuel = (ouv.solde_actuel + montant).quantize(q)
                ouv.save(update_fields=["solde_actuel"])
            session = (
                SessionCaisse.objects.select_for_update()
                .filter(pk=session_pk)
                .first()
            )
            if session and session.versement_promesse_en_attente:
                remaining = MouvementBanque.objects.filter(
                    session_caisse_id=session.pk, justificatif_recu=False
                ).count()
                if remaining == 0:
                    session.versement_promesse_en_attente = False
                    session.montant_report_versement_banque = Decimal("0.00")
                    session.save(
                        update_fields=[
                            "versement_promesse_en_attente",
                            "montant_report_versement_banque",
                        ]
                    )
        return Response(
            {
                "detail": "Promesse de versement annulee. Montant reintegre en caisse.",
                "session_caisse": session_pk,
            }
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="completer-justificatif",
        parser_classes=[MultiPartParser, FormParser],
    )
    def completer_justificatif(self, request, pk=None):
        """
        Televerser le justificatif de versement :
        - Credite la banque du montant promis.
        - Met a jour le MouvementBanque (justificatif_recu=True, fichier attache).
        - Leve le blocage d'ouverture sur la session fermee associee.
        """
        m = self.get_object()
        if m.justificatif_recu:
            return Response(
                {"detail": "Ce mouvement possede deja un justificatif valide."},
                status=400,
            )
        f = request.FILES.get("justificatif_file") or request.FILES.get("fichier")
        if f is None or getattr(f, "size", 0) <= 0:
            return Response(
                {"detail": "Joindre le justificatif de versement (fichier obligatoire)."},
                status=400,
            )
        try:
            _banque_verifier_fichier(f)
        except ValidationError as e:
            return Response(e.detail, status=400)
        q = Decimal("0.01")
        with transaction.atomic():
            m_db = (
                MouvementBanque.objects.select_for_update()
                .filter(pk=m.pk, justificatif_recu=False)
                .first()
            )
            if not m_db:
                return Response(
                    {"detail": "Mouvement deja traite ou introuvable."},
                    status=400,
                )
            montant = m_db.montant.quantize(q)
            b = Banque.objects.select_for_update().filter(pk=1).first()
            if not b:
                return Response(
                    {"detail": "Compte banque non initialise. Contactez l'administrateur."},
                    status=500,
                )
            if m_db.type == MouvementBanque.Mouvement.VERSEMENT:
                b.solde_actuel = (b.solde_actuel + montant).quantize(q)
                b.save(update_fields=["solde_actuel"])
            m_db.justificatif_file = f
            m_db.justificatif_recu = True
            m_db.save(update_fields=["justificatif_file", "justificatif_recu"])
            session = (
                SessionCaisse.objects.select_for_update()
                .filter(pk=m_db.session_caisse_id)
                .first()
            )
            if session and session.versement_promesse_en_attente:
                remaining = MouvementBanque.objects.filter(
                    session_caisse_id=session.pk, justificatif_recu=False
                ).count()
                if remaining == 0:
                    session.versement_promesse_en_attente = False
                    session.montant_report_versement_banque = Decimal("0.00")
                    session.save(
                        update_fields=[
                            "versement_promesse_en_attente",
                            "montant_report_versement_banque",
                        ]
                    )
        return Response({"detail": "Justificatif enregistre. Versement banque confirme."})


class SessionCaisseViewSet(viewsets.ModelViewSet):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrComptableFinancial]
    queryset = (
        SessionCaisse.objects.select_related("ouvert_par")
        .prefetch_related("paiements", "depenses", "mouvements_banque")
        .all()
        .order_by("-date_ouverture", "-id")
    )
    serializer_class = SessionCaisseSerializer
    http_method_names = ["get", "post", "head", "options", "delete"]

    def perform_create(self, serializer):
        instance = serializer.save(ouvert_par=self.request.user)
        instance.refresh_solde_actuel()
        log_session_caisse_ouverture(audit_user(self.request), instance)

    def perform_destroy(self, instance):
        u = audit_user(self.request)
        log_session_caisse_delete(u, instance)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="courante")
    def courante(self, request):
        bloquee = SessionCaisse.objects.filter(
            versement_promesse_en_attente=True
        ).exists()
        s = session_caisse_ouverte()
        if not s:
            return Response(
                {"session": None, "ouverture_session_bloquee": bloquee}
            )
        s.refresh_solde_actuel()
        return Response(
            {
                "session": SessionCaisseSerializer(s).data,
                "ouverture_session_bloquee": bloquee,
            }
        )

    @action(detail=False, methods=["get"], url_path="promesses-justificatif")
    def promesses_justificatif(self, request):
        qs = (
            SessionCaisse.objects.filter(
                versement_promesse_en_attente=True,
                statut=SessionCaisse.Statut.FERME,
            )
            .select_related("ouvert_par")
            .order_by("-date_fermeture", "-id")
        )
        return Response(
            SessionCaissePromesseJustificatifSerializer(qs, many=True).data
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="regulariser-promesse-justificatif",
        parser_classes=[JSONParser, FormParser, MultiPartParser],
    )
    def regulariser_promesse_justificatif(self, request, pk=None):
        """Téléverse le justificatif : crédit banque, mouvement enregistré, fin du blocage d’ouverture."""
        session = self.get_object()
        if session.statut != SessionCaisse.Statut.FERME:
            return Response(
                {"detail": "Seule une session fermée peut être régularisée."},
                status=400,
            )
        if not session.versement_promesse_en_attente:
            return Response(
                {
                    "detail": "Aucune promesse de justificatif en attente pour cette session.",
                },
                status=400,
            )
        f = request.FILES.get("justificatif_file") or request.FILES.get("fichier")
        if f is None or getattr(f, "size", 0) <= 0:
            return Response(
                {"detail": "Joindre le justificatif de versement (fichier obligatoire)."},
                status=400,
            )
        try:
            _banque_verifier_fichier(f)
        except ValidationError as e:
            return Response(e.detail, status=400)
        q = Decimal("0.01")
        mvt_date = timezone.localdate()
        with transaction.atomic():
            s = (
                SessionCaisse.objects.select_for_update()
                .filter(
                    pk=session.pk,
                    statut=SessionCaisse.Statut.FERME,
                    versement_promesse_en_attente=True,
                )
                .first()
            )
            if not s:
                return Response(
                    {"detail": "Session introuvable ou déjà régularisée."},
                    status=400,
                )
            mv = s.montant_report_versement_banque.quantize(q)
            if mv <= 0:
                return Response(
                    {"detail": "Montant de report invalide."},
                    status=400,
                )
            b = Banque.objects.select_for_update().filter(pk=1).first()
            if not b:
                return Response(
                    {"detail": "Compte banque non initialisé."},
                    status=500,
                )
            b.solde_actuel = (b.solde_actuel + mv).quantize(q)
            b.save(update_fields=["solde_actuel"])
            MouvementBanque.objects.create(
                type=MouvementBanque.Mouvement.VERSEMENT,
                montant=mv,
                date=mvt_date,
                justificatif_file=f,
                session_caisse_id=s.id,
                justificatif_recu=True,
            )
            s.montant_report_versement_banque = Decimal("0.00")
            s.versement_promesse_en_attente = False
            s.save(
                update_fields=[
                    "montant_report_versement_banque",
                    "versement_promesse_en_attente",
                ]
            )
            s.refresh_solde_actuel()
        s = SessionCaisse.objects.get(pk=session.pk)
        return Response(SessionCaisseSerializer(s).data)

    @action(
        detail=True,
        methods=["post"],
        url_path="garder-versement-en-caisse",
        parser_classes=[JSONParser, FormParser, MultiPartParser],
    )
    def garder_versement_en_caisse(self, request, pk=None):
        """
        Retard / maintien en caisse : supprime les MouvementBanque en attente (sans justificatif reçu),
        corrige le solde banque, réintègre le montant au solde caisse de la session ouverte si elle existe,
        lève le blocage d’ouverture ; le report théorique est soldé lorsque le montant est réintégré en caisse.
        """
        session = self.get_object()
        if session.statut != SessionCaisse.Statut.FERME:
            return Response(
                {"detail": "Seule une session fermée peut être mise à jour."},
                status=400,
            )
        if not session.versement_promesse_en_attente:
            return Response(
                {
                    "detail": "Aucune promesse de justificatif en attente pour cette session.",
                },
                status=400,
            )
        q = Decimal("0.01")
        with transaction.atomic():
            s = (
                SessionCaisse.objects.select_for_update()
                .filter(
                    pk=session.pk,
                    statut=SessionCaisse.Statut.FERME,
                    versement_promesse_en_attente=True,
                )
                .first()
            )
            if not s:
                return Response(
                    {"detail": "Session introuvable ou déjà traitée."},
                    status=400,
                )
            m_report = s.montant_report_versement_banque.quantize(q)
            pending = list(
                MouvementBanque.objects.select_for_update().filter(
                    session_caisse_id=s.id,
                    justificatif_recu=False,
                )
            )
            b = Banque.objects.select_for_update().filter(pk=1).first()
            delta_from_mvt = Decimal("0.00")
            for m in pending:
                if m.type == MouvementBanque.Mouvement.VERSEMENT:
                    delta_from_mvt = (delta_from_mvt + m.montant).quantize(q)
                    if b:
                        b.solde_actuel = (b.solde_actuel - m.montant).quantize(q)
                elif m.type == MouvementBanque.Mouvement.RETRAIT:
                    if b:
                        b.solde_actuel = (b.solde_actuel + m.montant).quantize(q)
                m.delete()
            if b and pending:
                b.save(update_fields=["solde_actuel"])
            to_caisse = delta_from_mvt
            if to_caisse <= 0 and m_report > 0:
                to_caisse = m_report
            ouv = (
                SessionCaisse.objects.select_for_update()
                .filter(statut=SessionCaisse.Statut.OUVERT)
                .order_by("-date_ouverture", "-id")
                .first()
            )
            update_fields = ["versement_promesse_en_attente"]
            if ouv and to_caisse > 0:
                ouv.solde_actuel = (ouv.solde_actuel + to_caisse).quantize(q)
                ouv.save(update_fields=["solde_actuel"])
                s.montant_report_versement_banque = Decimal("0.00")
                update_fields.append("montant_report_versement_banque")
            s.versement_promesse_en_attente = False
            s.save(update_fields=update_fields)
        s = SessionCaisse.objects.get(pk=session.pk)
        return Response(SessionCaisseSerializer(s).data)

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[JSONParser, FormParser, MultiPartParser],
    )
    def fermer_caisse(self, request, pk=None):
        session = self.get_object()
        if session.statut != SessionCaisse.Statut.OUVERT:
            return Response(
                {"detail": "La caisse est déjà fermée."},
                status=400,
            )

        data = request.data
        montant_raw = data.get("solde_final")
        if montant_raw is None:
            montant_raw = data.get("montant_final_reel")
        if montant_raw is None:
            return Response(
                {"detail": "Le champ solde_final est requis."},
                status=400,
            )
        try:
            montant_final = Decimal(str(montant_raw).replace(",", ".").strip())
        except (ArithmeticError, ValueError, TypeError):
            return Response(
                {"detail": "solde_final invalide."},
                status=400,
            )

        verser = _parse_bool_justificatif(data.get("verser_vers_banque")) is True
        m_vers = None
        f = request.FILES.get("justificatif_file") or request.FILES.get("fichier")
        justif_fourni = _parse_bool_justificatif(data.get("justificatif_fourni"))
        if verser:
            mv_raw = data.get("montant_vers_banque") or data.get("montant_vers")
            if mv_raw in (None, ""):
                return Response(
                    {"detail": "Indiquez le montant versé vers la banque (montant_vers_banque)."},
                    status=400,
                )
            try:
                m_vers = Decimal(str(mv_raw).replace(",", ".").strip())
            except (ArithmeticError, ValueError, TypeError):
                return Response(
                    {"detail": "montant_vers_banque invalide."},
                    status=400,
                )
            m_vers = m_vers.quantize(Decimal("0.01"))
            if m_vers <= 0:
                return Response(
                    {"detail": "Le montant versé vers la banque doit être positif."},
                    status=400,
                )
            if justif_fourni is None:
                return Response(
                    {
                        "detail": "Indiquez si le justificatif de dépôt est disponible (justificatif_fourni : true ou false).",
                    },
                    status=400,
                )
            if justif_fourni is False:
                if f is not None and getattr(f, "size", 0) > 0:
                    return Response(
                        {
                            "detail": "Aucun fichier ne doit être joint lorsque le justificatif n’est pas disponible.",
                        },
                        status=400,
                    )
        else:
            if justif_fourni is True:
                return Response(
                    {"detail": "justificatif_fourni n’a de sens qu’avec « verser_vers_banque »."},
                    status=400,
                )
            if f is not None and getattr(f, "size", 0) > 0:
                return Response(
                    {"detail": "Le justificatif n’est pris en compte qu’avec « verser_vers_banque »."},
                    status=400,
                )

        q = Decimal("0.01")
        now = timezone.now()
        mvt_date = timezone.localdate()

        with transaction.atomic():
            s = (
                SessionCaisse.objects.select_for_update()
                .filter(pk=session.pk, statut=SessionCaisse.Statut.OUVERT)
                .first()
            )
            if not s:
                return Response(
                    {"detail": "La caisse a déjà été fermée. Rafraîchissez la page."},
                    status=400,
                )
            b = Banque.objects.select_for_update().filter(pk=1).first()
            if not b:
                return Response(
                    {"detail": "Compte banque non initialisé. Contactez l’administrateur."},
                    status=500,
                )
            s.refresh_solde_actuel()
            b.refresh_from_db()
            report_vers = Decimal("0.00")
            if verser and m_vers is not None and justif_fourni is True:
                if f is None or getattr(f, "size", 0) <= 0:
                    return Response(
                        {
                            "detail": "Le justificatif de dépôt est obligatoire pour créditer la banque.",
                        },
                        status=400,
                    )
                if m_vers > s.solde_actuel:
                    return Response(
                        {
                            "detail": f"Solde caisse insuffisant pour ce versement (disponible : {s.solde_actuel} DT).",
                        },
                        status=400,
                    )
                try:
                    _banque_verifier_fichier(f)
                except ValidationError as e:
                    return Response(e.detail, status=400)
                b.solde_actuel = (b.solde_actuel + m_vers).quantize(q)
                b.save(update_fields=["solde_actuel"])
                MouvementBanque.objects.create(
                    type=MouvementBanque.Mouvement.VERSEMENT,
                    montant=m_vers,
                    date=mvt_date,
                    justificatif_file=f,
                    session_caisse_id=s.id,
                    justificatif_recu=True,
                )
                s.refresh_solde_actuel()
            elif verser and m_vers is not None and justif_fourni is False:
                if m_vers > s.solde_actuel:
                    return Response(
                        {
                            "detail": f"Solde caisse insuffisant pour ce versement théorique (disponible : {s.solde_actuel} DT).",
                        },
                        status=400,
                    )
                report_vers = m_vers
                # Create pending MouvementBanque as a tracking record.
                # Bank is NOT credited here; it will be credited when completer-justificatif is called.
                MouvementBanque.objects.create(
                    type=MouvementBanque.Mouvement.VERSEMENT,
                    montant=m_vers.quantize(q),
                    date=mvt_date,
                    justificatif_file="",
                    session_caisse_id=s.id,
                    justificatif_recu=False,
                )
            s.montant_report_versement_banque = report_vers.quantize(q)
            s.versement_promesse_en_attente = report_vers > 0
            s.solde_final = montant_final.quantize(q)
            s.date_fermeture = now
            s.statut = SessionCaisse.Statut.FERME
            s.save(
                update_fields=[
                    "montant_report_versement_banque",
                    "versement_promesse_en_attente",
                    "solde_final",
                    "date_fermeture",
                    "statut",
                    "solde_actuel",
                ]
            )

        s = SessionCaisse.objects.get(pk=session.pk)
        log_session_caisse_fermeture(audit_user(request), s)
        return Response(SessionCaisseSerializer(s).data)
