import json

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AuditLog, User
from .permissions import PERM_AUDIT_LOGS


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "username",
        "email",
        "first_name",
        "last_name",
        "role",
        "must_change_password",
        "is_staff",
        "is_active",
    )
    list_filter = BaseUserAdmin.list_filter + ("role", "must_change_password")
    search_fields = ("username", "email", "first_name", "last_name")
    ordering = ("username",)

    fieldsets = BaseUserAdmin.fieldsets + (
        ("Rôle", {"fields": ("role",)}),
        ("Sécurité", {"fields": ("must_change_password",)}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "password1", "password2", "role"),
            },
        ),
    )


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("date", "utilisateur", "action", "modele_concerne", "details_preview")
    list_filter = ("action",)
    search_fields = ("modele_concerne", "utilisateur__username")
    ordering = ("-date",)

    @admin.display(description="Détails (aperçu)")
    def details_preview(self, obj):
        if obj.details is None:
            return "—"
        try:
            s = json.dumps(obj.details, ensure_ascii=False)
        except (TypeError, ValueError):
            s = str(obj.details)
        return (s[:120] + "…") if len(s) > 120 else s

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def _allow_audit(self, request) -> bool:
        return request.user.has_perm(PERM_AUDIT_LOGS)

    def has_module_permission(self, request):
        return self._allow_audit(request)

    def has_view_permission(self, request, obj=None):
        return self._allow_audit(request)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
