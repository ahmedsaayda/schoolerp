from django.contrib import admin

from authentification.audit import audit_user

from .audit_logs import (
    build_diff,
    log_classe_create,
    log_classe_delete,
    log_classe_update,
    log_depense_create,
    log_depense_delete,
    log_depense_update,
    log_eleve_create,
    log_eleve_delete,
    log_eleve_update,
    model_snapshot,
)
from .models import (
    AvanceSalaire,
    Banque,
    CalendrierScolaire,
    Classe,
    Depense,
    Eleve,
    MouvementBanque,
    EmploiDuTemps,
    PaiementSalaire,
    Personnel,
    Pointage,
    PointagePersonnel,
    Professeur,
)


@admin.register(CalendrierScolaire)
class CalendrierScolaireAdmin(admin.ModelAdmin):
    list_display = ("nom", "date_debut", "date_fin", "type_evenement")
    list_filter = ("type_evenement",)


@admin.register(Banque)
class BanqueAdmin(admin.ModelAdmin):
    list_display = ("id", "solde_actuel")


@admin.register(MouvementBanque)
class MouvementBanqueAdmin(admin.ModelAdmin):
    list_display = ("id", "type", "montant", "date", "justificatif_recu", "session_caisse")
    list_filter = ("type", "date")
    raw_id_fields = ("session_caisse",)
    readonly_fields = ("justificatif_file",)


@admin.register(Classe)
class ClasseAdmin(admin.ModelAdmin):
    list_display = ("nom", "niveau", "section", "capacite_max")
    search_fields = ("nom", "niveau")
    ordering = ("nom",)

    def save_model(self, request, obj, form, change):
        old_snap = None
        if change and obj.pk:
            try:
                old_snap = model_snapshot(Classe.objects.get(pk=obj.pk))
            except Classe.DoesNotExist:
                pass
        super().save_model(request, obj, form, change)
        u = audit_user(request)
        if not change:
            log_classe_create(u, obj)
        elif old_snap is not None:
            new_snap = model_snapshot(obj)
            diff = build_diff(old_snap, new_snap)
            if diff:
                log_classe_update(u, obj, diff)

    def delete_model(self, request, obj):
        log_classe_delete(audit_user(request), obj, model_snapshot(obj))
        super().delete_model(request, obj)


@admin.register(Eleve)
class EleveAdmin(admin.ModelAdmin):
    readonly_fields = ("acompte",)
    list_display = (
        "nom",
        "prenom",
        "niveau",
        "classe",
        "section",
        "telephone_1",
        "tarif_mensuel_total_display",
        "date_inscription",
    )
    list_filter = ("classe", "section", "niveau")
    search_fields = ("nom", "prenom", "telephone_1", "nom_parent")
    ordering = ("nom", "prenom")

    @admin.display(description="Tarif mensuel (total)")
    def tarif_mensuel_total_display(self, obj):
        return obj.tarif_mensuel_total()

    def save_model(self, request, obj, form, change):
        old_snap = None
        if change and obj.pk:
            try:
                old_snap = model_snapshot(Eleve.objects.get(pk=obj.pk))
            except Eleve.DoesNotExist:
                pass
        super().save_model(request, obj, form, change)
        u = audit_user(request)
        if not change:
            log_eleve_create(u, obj)
        elif old_snap is not None:
            new_snap = model_snapshot(obj)
            diff = build_diff(old_snap, new_snap)
            if diff:
                log_eleve_update(u, obj, diff)

    def delete_model(self, request, obj):
        log_eleve_delete(audit_user(request), obj, model_snapshot(obj))
        super().delete_model(request, obj)


class PointageInline(admin.TabularInline):
    model = Pointage
    extra = 0


class AvanceSalaireInline(admin.TabularInline):
    model = AvanceSalaire
    extra = 0


class EmploiDuTempsInline(admin.TabularInline):
    model = EmploiDuTemps
    extra = 0


@admin.register(Personnel)
class PersonnelAdmin(admin.ModelAdmin):
    list_display = (
        "nom",
        "prenom",
        "role",
        "telephone",
        "salaire_mensuel",
        "date_embauche",
    )
    list_filter = ("role",)
    search_fields = ("nom", "prenom", "telephone", "adresse")
    ordering = ("nom", "prenom")


@admin.register(PaiementSalaire)
class PaiementSalaireAdmin(admin.ModelAdmin):
    list_display = ("personnel", "professeur", "montant", "mois_concerne", "date_paiement", "depense")
    list_filter = ("date_paiement",)
    search_fields = (
        "personnel__nom",
        "personnel__prenom",
        "professeur__nom",
        "professeur__prenom",
    )
    raw_id_fields = ("personnel", "professeur", "depense")


@admin.register(PointagePersonnel)
class PointagePersonnelAdmin(admin.ModelAdmin):
    list_display = ("personnel", "date", "statut")
    list_filter = ("statut", "date")
    search_fields = ("personnel__nom", "personnel__prenom")
    raw_id_fields = ("personnel",)


@admin.register(Professeur)
class ProfesseurAdmin(admin.ModelAdmin):
    list_display = (
        "nom",
        "prenom",
        "matiere",
        "telephone",
        "tarif_horaire",
        "date_embauche",
        "travaille_ailleurs",
        "nom_autre_etablissement",
    )
    list_filter = ("matiere",)
    search_fields = ("nom", "prenom", "matiere", "telephone")
    ordering = ("nom", "prenom")
    inlines = (EmploiDuTempsInline, PointageInline, AvanceSalaireInline)


@admin.register(EmploiDuTemps)
class EmploiDuTempsAdmin(admin.ModelAdmin):
    list_display = ("professeur", "classe", "trimestre", "date_seance", "jour_semaine", "heure_debut", "heure_fin")
    list_filter = ("trimestre", "jour_semaine", "professeur", "classe")
    search_fields = ("professeur__nom", "professeur__prenom", "classe__nom")
    autocomplete_fields = ("professeur", "classe")
    ordering = ("jour_semaine", "heure_debut", "id")


@admin.register(Pointage)
class PointageAdmin(admin.ModelAdmin):
    list_display = (
        "professeur",
        "date_cours",
        "classe",
        "nombre_heures",
        "statut_presence",
        "statut_paiement",
        "est_paye",
        "recu_paiement",
    )
    list_filter = (
        "est_paye",
        "statut_paiement",
        "statut_presence",
        "date_cours",
        "professeur",
        "classe",
    )
    search_fields = ("remarque", "professeur__nom", "professeur__prenom", "classe__nom")
    autocomplete_fields = ("professeur", "classe", "emploi_du_temps")
    ordering = ("date_cours", "id")


@admin.register(Depense)
class DepenseAdmin(admin.ModelAdmin):
    list_display = ("titre", "categorie", "montant", "date_depense")
    list_filter = ("categorie", "date_depense")
    search_fields = ("titre", "note")
    ordering = ("-date_depense", "-id")

    def save_model(self, request, obj, form, change):
        old_snap = None
        if change and obj.pk:
            try:
                old_snap = model_snapshot(Depense.objects.get(pk=obj.pk))
            except Depense.DoesNotExist:
                pass
        super().save_model(request, obj, form, change)
        u = audit_user(request)
        if not change:
            log_depense_create(u, obj)
        elif old_snap is not None:
            new_snap = model_snapshot(obj)
            diff = build_diff(old_snap, new_snap)
            if diff:
                log_depense_update(u, obj, diff)

    def delete_model(self, request, obj):
        log_depense_delete(audit_user(request), obj, model_snapshot(obj))
        super().delete_model(request, obj)


@admin.register(AvanceSalaire)
class AvanceSalaireAdmin(admin.ModelAdmin):
    list_display = ("professeur", "personnel", "montant", "date", "est_solde", "remarque")
    list_filter = ("date", "professeur", "personnel", "est_solde")
    search_fields = (
        "remarque",
        "professeur__nom",
        "professeur__prenom",
        "personnel__nom",
        "personnel__prenom",
    )
    autocomplete_fields = ("professeur", "personnel")
    ordering = ("-date", "-id")
