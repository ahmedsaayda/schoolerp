"""Journalisation métier (pointages, paiements, caisse, élèves, classes)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from django.db.models import Model

from authentification.audit import create_audit_log
from authentification.models import AuditLog


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def model_snapshot(instance: Model) -> dict:
    snap: dict = {}
    for field in instance._meta.concrete_fields:
        if field.primary_key:
            continue
        if field.is_relation:
            if field.many_to_one or field.one_to_one:
                snap[field.name] = getattr(instance, field.attname)
            continue
        val = getattr(instance, field.name)
        snap[field.name] = _json_safe(val)
    return snap


def build_diff(old_snap: dict, new_snap: dict) -> dict | None:
    out: dict = {}
    for key in new_snap:
        old_v, new_v = old_snap.get(key), new_snap.get(key)
        if old_v != new_v:
            out[key] = {"old": _json_safe(old_v), "new": _json_safe(new_v)}
    return out if out else None


def log_eleve_create(user: Any, instance: Model) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="Eleve",
        details={"created": True, "values": model_snapshot(instance)},
    )


def log_eleve_update(user: Any, instance: Model, diff: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="Eleve",
        details=diff,
    )


def log_eleve_delete(user: Any, instance: Model, values: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="Eleve",
        details={"deleted": True, "values": values},
    )


def log_classe_create(user: Any, instance: Model) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="Classe",
        details={"created": True, "values": model_snapshot(instance)},
    )


def log_classe_update(user: Any, instance: Model, diff: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="Classe",
        details=diff,
    )


def log_classe_delete(user: Any, instance: Model, values: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="Classe",
        details={"deleted": True, "values": values},
    )


_POINTAGE_LABEL = {
    "PRESENTE": "Présent",
    "ABSENTE": "Absent",
    "RETARD": "En retard",
}


def log_pointage_create(user: Any, pointage) -> None:
    prof = pointage.professeur
    name = f"{prof.nom} {prof.prenom}".strip()
    st = pointage.statut_presence
    label = _POINTAGE_LABEL.get(st, st)
    resume = f"Marqué {label}"
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="Pointage",
        details={
            "professeur": name,
            "date_cours": str(pointage.date_cours),
            "nombre_heures": str(pointage.nombre_heures),
            "statut_presence": st,
            "resume": resume,
        },
    )


def log_pointage_update(user: Any, pointage, ancien_statut: str | None) -> None:
    prof = pointage.professeur
    name = f"{prof.nom} {prof.prenom}".strip()
    st = pointage.statut_presence
    old_l = _POINTAGE_LABEL.get(ancien_statut, ancien_statut)
    new_l = _POINTAGE_LABEL.get(st, st)
    if ancien_statut != st:
        resume = f"Modifié en {new_l} (était : {old_l})"
    else:
        resume = f"Modification pointage — statut : {new_l}"
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="Pointage",
        details={
            "professeur": name,
            "pointage_id": pointage.id,
            "date_cours": str(pointage.date_cours),
            "ancien_statut_presence": ancien_statut,
            "statut_presence": st,
            "resume": resume,
        },
    )


def log_pointage_delete(user: Any, pointage) -> None:
    prof = pointage.professeur
    name = f"{prof.nom} {prof.prenom}".strip()
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="Pointage",
        details={
            "professeur": name,
            "pointage_id": pointage.id,
            "date_cours": str(pointage.date_cours),
            "values": model_snapshot(pointage),
        },
    )


def log_paiement_create(user: Any, paiement) -> None:
    el = paiement.eleve
    eleve_nom = f"{el.nom} {el.prenom}".strip()
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="Paiement",
        details={
            "eleve": eleve_nom,
            "montant_paye": str(paiement.montant_paye),
            "montant_du": str(paiement.montant_du),
            "methode": paiement.methode,
            "resume": f"Encaissement {paiement.montant_paye} DT — {eleve_nom}",
        },
    )


def log_paiement_update(user: Any, paiement, diff: dict) -> None:
    el = paiement.eleve
    eleve_nom = f"{el.nom} {el.prenom}".strip()
    details = {"eleve": eleve_nom, "paiement_id": paiement.id, "modifications": diff}
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="Paiement",
        details=details,
    )


def log_paiement_delete(user: Any, paiement) -> None:
    el = paiement.eleve
    eleve_nom = f"{el.nom} {el.prenom}".strip()
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="Paiement",
        details={
            "eleve": eleve_nom,
            "paiement_id": paiement.id,
            "values": model_snapshot(paiement),
        },
    )


def log_session_caisse_ouverture(user: Any, session_caisse) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="SessionCaisse",
        details={
            "session_id": session_caisse.id,
            "solde_initial": str(session_caisse.solde_initial),
            "resume": "Ouverture de caisse",
        },
    )


def log_session_caisse_fermeture(user: Any, session_caisse) -> None:
    from django.db.models import Sum

    ent = session_caisse.paiements.aggregate(s=Sum("montant_paye"))["s"]
    sor = session_caisse.depenses.aggregate(s=Sum("montant"))["s"]
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="SessionCaisse",
        details={
            "session_id": session_caisse.id,
            "solde_final": str(session_caisse.solde_final),
            "solde_actuel": str(session_caisse.solde_actuel),
            "total_entrees": str(ent or 0),
            "total_sorties": str(sor or 0),
            "resume": "Fermeture de caisse",
        },
    )


def log_session_caisse_delete(user: Any, session_caisse) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="SessionCaisse",
        details={
            "session_id": session_caisse.id,
            "values": model_snapshot(session_caisse),
        },
    )


def log_depense_create(user: Any, instance: Model) -> None:
    snap = model_snapshot(instance)
    titre = snap.get("titre") or str(instance)
    montant = snap.get("montant")
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.CREATION,
        modele_concerne="Depense",
        details={
            "created": True,
            "values": snap,
            "resume": f"Dépense « {titre} » — {montant} DT",
        },
    )


def log_depense_update(user: Any, instance: Model, diff: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.MODIFICATION,
        modele_concerne="Depense",
        details=diff,
    )


def log_depense_delete(user: Any, instance: Model, values: dict) -> None:
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.SUPPRESSION,
        modele_concerne="Depense",
        details={"deleted": True, "values": values},
    )
