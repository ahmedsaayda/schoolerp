import secrets

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import AuditLog

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Profil utilisateur exposé à l'API (rôle + identité affichable)."""

    role_label = serializers.CharField(source="get_role_display", read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "display_name",
            "role",
            "role_label",
            "is_superuser",
            "must_change_password",
        )
        read_only_fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "is_superuser",
            "must_change_password",
        )

    def get_display_name(self, obj) -> str:
        parts = [obj.first_name, obj.last_name]
        name = " ".join(p for p in parts if p).strip()
        if name:
            return name
        return obj.username or ""


class StaffUserSerializer(serializers.ModelSerializer):
    """
    Comptes (ADMIN, POINTAGE_AGENT, COMPTABLE) — création / mise à jour par l’admin.
    Mot de passe : saisi ou généré (`generate_password`).
    """

    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    generate_password = serializers.BooleanField(write_only=True, default=False)
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "display_name",
            "role",
            "role_label",
            "must_change_password",
            "password",
            "generate_password",
        )
        read_only_fields = ("id", "must_change_password")

    def get_display_name(self, obj) -> str:
        parts = [obj.first_name, obj.last_name]
        name = " ".join(p for p in parts if p).strip()
        if name:
            return name
        return obj.username or ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._plain_password_to_return = None

    def validate_role(self, value):
        allowed = (
            User.Role.ADMIN,
            User.Role.POINTAGE_AGENT,
            User.Role.COMPTABLE,
        )
        if value not in allowed:
            raise serializers.ValidationError("Rôle non autorisé pour ce formulaire.")
        return value

    def validate(self, attrs):
        is_create = self.instance is None
        gen = bool(attrs.get("generate_password"))
        pwd = attrs.get("password")

        if is_create:
            if gen:
                plain = secrets.token_urlsafe(16)
                attrs["password"] = plain
                self._plain_password_to_return = plain
            elif not pwd or not str(pwd).strip():
                raise serializers.ValidationError(
                    {
                        "password": (
                            "Indiquez un mot de passe ou cochez la génération automatique."
                        )
                    }
                )
        else:
            if gen:
                plain = secrets.token_urlsafe(16)
                attrs["password"] = plain
                self._plain_password_to_return = plain
            elif pwd is not None and not str(pwd).strip():
                attrs.pop("password", None)

        attrs.pop("generate_password", None)
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.must_change_password = True
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
            instance.must_change_password = True
        instance.save()
        return instance


class AuditLogSerializer(serializers.ModelSerializer):
    utilisateur_username = serializers.CharField(
        source="utilisateur.username",
        read_only=True,
        allow_null=True,
    )
    utilisateur_display_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "utilisateur",
            "utilisateur_username",
            "utilisateur_display_name",
            "action",
            "modele_concerne",
            "date",
            "details",
        )

    def get_utilisateur_display_name(self, obj):
        u = obj.utilisateur
        if u is None:
            return None
        full = (u.get_full_name() or "").strip()
        if full:
            return full
        return u.username
