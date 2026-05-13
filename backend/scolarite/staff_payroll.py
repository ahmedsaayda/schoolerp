"""Calcul salaire net personnel (salaire fixe − retenues absences) et exécution de paie + avances."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone as django_timezone
from rest_framework.exceptions import ValidationError

if TYPE_CHECKING:
    from scolarite.models import Personnel

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


def count_absences_personnel_month(personnel_id: int, year: int, month: int) -> int:
    from scolarite.models import PointagePersonnel

    return PointagePersonnel.objects.filter(
        personnel_id=personnel_id,
        date__year=year,
        date__month=month,
        statut=PointagePersonnel.Statut.ABSENT,
    ).count()


def _salaire_fixe_mois(
    personnel: "Personnel", year: int, month: int
) -> tuple[Decimal, Decimal, int, Decimal, Decimal, Decimal]:
    """
    Retourne (salaire_contrat, retenue_par_jour, n_abs, retenue_totale,
    salaire_fixe_après_abs, primes_quantifiées) — primes ici = 0 par défaut.
    """
    n_abs = count_absences_personnel_month(personnel.pk, year, month)
    contrat = Decimal(personnel.salaire_mensuel).quantize(Decimal("0.01"))
    per = Decimal(personnel.retenue_par_absence).quantize(Decimal("0.01"))
    retenue_totale = (per * n_abs).quantize(Decimal("0.01"))
    fixe = (contrat - retenue_totale).quantize(Decimal("0.01"))
    if fixe < 0:
        fixe = Decimal("0.00")
    return contrat, per, n_abs, retenue_totale, fixe, Decimal("0.00")


def _primes_value(raw: object) -> Decimal:
    if raw in (None, ""):
        return Decimal("0.00")
    try:
        p = Decimal(str(raw).strip().replace(",", "."))
    except Exception:
        return Decimal("0.00")
    p = p.quantize(Decimal("0.01"))
    return p if p >= 0 else Decimal("0.00")


def _avances_non_soldees_sum(personnel_id: int) -> Decimal:
    from scolarite.models import AvanceSalaire

    s = (
        AvanceSalaire.objects.filter(personnel_id=personnel_id, est_solde=False).aggregate(
            s=Sum("montant")
        )["s"]
        or Decimal("0")
    )
    return Decimal(str(s)).quantize(Decimal("0.01"))


def personnel_resume_paie_for_month(
    personnel: "Personnel", mois_premier_jour: date, primes: Decimal | str | None = None
) -> dict[str, str | int]:
    """
    mois_premier_jour : n’importe quel jour du mois (on normalise au 1er).
    primes : optionnel, bonus affiché dans la fiche (défaut 0).
    """
    y, m = mois_premier_jour.year, mois_premier_jour.month
    contrat, per, n_abs, retenue_totale, fixe, _z = _salaire_fixe_mois(personnel, y, m)
    pri = _primes_value(primes)
    brut = (fixe + pri).quantize(Decimal("0.01"))
    av = _avances_non_soldees_sum(personnel.pk)
    net = (brut - av).quantize(Decimal("0.01"))
    if net < 0:
        net = Decimal("0.00")
    pl = f"{_MOIS_FR[m].capitalize()} {y}" if 1 <= m <= 12 else f"{m:02d}/{y}"
    periode = f"Mois de prestation : {pl}"
    return {
        "mois_concerne": date(y, m, 1).isoformat(),
        "salaire_base": str(contrat),
        "salaire_mensuel_fixe": str(fixe),
        "retenue_par_absence": str(per),
        "jours_absents": n_abs,
        "retenue_totale": str(retenue_totale),
        "primes": str(pri),
        "brut_salaire_plus_primes": str(brut),
        "avances_non_soldees": str(av),
        "salaire_net": str(net),
        "periode_libelle": periode,
    }


def _apply_avance_deduction_fifo(deduction: Decimal, advs: list) -> None:
    """
    Applique une déduction `deduction` sur les avances (FIFO) : solde entière, ou
    réduction du montant de la fiche d’avance si consommation partielle.
    """
    if deduction <= 0:
        return
    remaining = deduction.quantize(Decimal("0.01"))
    for adv in advs:
        if remaining <= 0:
            break
        take = min(remaining, adv.montant).quantize(Decimal("0.01"))
        if take < adv.montant:
            new_m = (adv.montant - take).quantize(Decimal("0.01"))
            adv.montant = new_m
            if new_m <= 0:
                adv.est_solde = True
        else:
            adv.est_solde = True
        adv.save(update_fields=["montant", "est_solde"])
        remaining -= take


@transaction.atomic
def executer_paiement_personnel(
    personnel: "Personnel",
    montant_net: Decimal,
    date_depense: date,
    mois_prestation: int,
    annee_prestation: int,
    primes: Decimal,
    primes_remarque: str = "",
    *,
    cree_par=None,
) -> dict:
    """
    Enregistre PaiementSalaire + Depense (catégorie Salaires) ; applique les avances (FIFO).
    """
    from scolarite.models import (
        AvanceSalaire,
        Depense,
        PaiementSalaire,
        Personnel,
        session_caisse_ouverte,
    )

    p = Personnel.objects.select_for_update().get(pk=personnel.pk)
    _ = p

    mois_concerne = date(annee_prestation, mois_prestation, 1)
    y, m = annee_prestation, mois_prestation

    if PaiementSalaire.objects.filter(
        personnel_id=p.pk, mois_concerne=mois_concerne
    ).exists():
        raise ValidationError(
            {
                "mois": (
                    f"Un paiement de salaire existe déjà pour le mois "
                    f"{mois_concerne.year}-{mois_concerne.month:02d}."
                )
            }
        )

    *_, fixe, _z = _salaire_fixe_mois(p, y, m)
    pri = _primes_value(primes)
    s_brut = (fixe + pri).quantize(Decimal("0.01"))
    if s_brut <= 0:
        raise ValidationError(
            {
                "montant": "Aucun salaire à verser pour ce mois (montant nul après retenues d’absence)."
            }
        )

    montant_net = montant_net.quantize(Decimal("0.01"))
    av = _avances_non_soldees_sum(p.pk)
    min_cash = (s_brut - av).quantize(Decimal("0.01"))
    if min_cash < 0:
        min_cash = Decimal("0.00")

    if montant_net < 0:
        raise ValidationError({"montant": "Le montant ne peut pas être négatif."})
    if min_cash > 0 and montant_net <= 0:
        raise ValidationError(
            {"montant": "Indiquez un montant net versé (supérieur à 0) pour ce mois."}
        )
    if min_cash == Decimal("0.00") and s_brut > 0 and montant_net > Decimal("0.01"):
        raise ValidationError(
            {
                "montant": (
                    f"Aucun versement en espèces n’est dû (avances = {s_brut} DT) ; le net attendu est 0."
                )
            }
        )
    if montant_net - min_cash < -Decimal("0.02"):
        raise ValidationError(
            {
                "montant": (
                    f"Le net versé est trop bas (minimum attendu {min_cash} DT, "
                    f"salaire + primes {s_brut} DT, avances {av} DT)."
                )
            }
        )
    if montant_net - s_brut > Decimal("0.02"):
        raise ValidationError(
            {
                "montant": (
                    f"Le montant ({montant_net} DT) dépasse le salaire dû + primes ({s_brut} DT)."
                )
            }
        )

    avances_a_deduire = (s_brut - montant_net).quantize(Decimal("0.01"))
    if avances_a_deduire < 0:
        avances_a_deduire = Decimal("0.00")
    if avances_a_deduire - av > Decimal("0.02"):
        raise ValidationError(
            {
                "montant": "Déduction d’avances supérieure aux avances enregistrées; vérifiez le net.",
            }
        )

    advs = list(
        AvanceSalaire.objects.filter(personnel_id=p.pk, est_solde=False)
        .select_for_update()
        .order_by("date", "id")
    )
    _apply_avance_deduction_fifo(avances_a_deduire, advs)

    rem = (primes_remarque or "").strip()
    if len(rem) > 500:
        rem = rem[:500]
    note = (
        f"Paiement salaire personnel — net {montant_net} DT — avances reprises "
        f"{avances_a_deduire} DT (mois {m:02d}/{y})."
    )
    if pri > 0:
        note += f" Primes : {pri} DT."
        if rem:
            note += f" ({rem})"
    sess = session_caisse_ouverte()
    if sess is None:
        raise ValidationError(
            {
                "detail": "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'enregistrer ce paiement."
            }
        )
    now = django_timezone.now()
    titre = f"Salaire — {p.prenom} {p.nom}"
    dep = Depense.objects.create(
        titre=titre,
        categorie=Depense.Categorie.SALAIRE,
        montant=montant_net,
        date_depense=date_depense,
        note=note,
        session_caisse=sess,
        cree_par=cree_par,
    )
    ps = PaiementSalaire.objects.create(
        professeur=None,
        personnel=p,
        montant=montant_net,
        mois_concerne=mois_concerne,
        depense=dep,
        date_paiement=now,
        heures_liquidees=None,
        salaire_base=fixe,
        primes=pri,
        primes_remarque=rem if rem else "",
        avances_deduites=avances_a_deduire,
        tarif_horaire_snapshot=None,
        heures_reliquat_m_precedent=None,
        reliquat_anticipatif_heures=None,
    )
    return {
        "detail": "Paiement enregistré.",
        "receipt_id": ps.id,
        "depense_id": dep.id,
    }
