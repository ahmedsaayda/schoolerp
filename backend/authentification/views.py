import json
from datetime import datetime, time

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from rest_framework import viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .audit import create_audit_log
from .audit_model_catalog import build_audit_model_catalog
from .models import AuditLog
from .permissions import CannotDeleteSelf, IsAdminRole, IsSuperAdminRole
from .serializers import AuditLogSerializer, StaffUserSerializer, UserSerializer

User = get_user_model()

_PASSWORD_RESET_PUBLIC_MSG = (
    "Si un compte correspond à cette adresse, un e-mail de réinitialisation a été envoyé."
)


def _send_password_reset_email(user) -> None:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    reset_url = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}/reinitialiser-mot-de-passe"
        f"?uid={uid}&token={token}"
    )
    subject = "Réinitialisation du mot de passe — administration"
    body = (
        "Bonjour,\n\n"
        "Pour définir un nouveau mot de passe, ouvrez ce lien dans votre navigateur :\n\n"
        f"{reset_url}\n\n"
        "Ce lien expire après un délai limité. "
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n"
    )
    send_mail(
        subject,
        body,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )


def _password_ops_gate(user) -> bool:
    if not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True
    return getattr(user, "role", None) == User.Role.PASSWORD_OPS


@ensure_csrf_cookie
@require_POST
def login_api(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "JSON invalide."}, status=400)
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return JsonResponse({"detail": "Identifiant et mot de passe requis."}, status=400)
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"detail": "Identifiants invalides."}, status=401)
    login(request, user)
    return JsonResponse(UserSerializer(user).data)


@csrf_exempt
@require_POST
def logout_api(request):
    logout(request)
    return JsonResponse({"detail": "Déconnecté."})


@require_GET
def me_api(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Non authentifié."}, status=401)
    user = request.user
    return JsonResponse(UserSerializer(user).data)


@csrf_exempt
@require_POST
def password_reset_request_api(request):
    """Demande de lien par e-mail (pas d'énumération des comptes)."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "JSON invalide."}, status=400)
    email = (data.get("email") or "").strip()
    if not email:
        return JsonResponse({"detail": "Adresse e-mail requise."}, status=400)

    user = (
        User.objects.filter(email__iexact=email, is_active=True)
        .exclude(email="")
        .first()
    )
    if user is not None and user.has_usable_password():
        try:
            _send_password_reset_email(user)
        except Exception:
            return JsonResponse(
                {
                    "detail": (
                        "L'envoi d'e-mail est temporairement indisponible. "
                        "Contactez l'administrateur système."
                    )
                },
                status=503,
            )
        create_audit_log(
            utilisateur=None,
            action=AuditLog.Action.RESET_PASSWORD_REQUESTED,
            modele_concerne="User",
            details={"target_user_id": user.pk, "target_username": user.username},
        )

    return JsonResponse({"detail": _PASSWORD_RESET_PUBLIC_MSG})


@csrf_exempt
@require_POST
def password_reset_confirm_api(request):
    """Définit un nouveau mot de passe à partir du jeton reçu par e-mail."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "JSON invalide."}, status=400)
    uid_b64 = (data.get("uid") or "").strip()
    token = (data.get("token") or "").strip()
    new_password = data.get("new_password") or ""
    if not uid_b64 or not token:
        return JsonResponse({"detail": "uid et token requis."}, status=400)
    if not new_password:
        return JsonResponse({"detail": "Mot de passe requis."}, status=400)
    try:
        uid = force_str(urlsafe_base64_decode(uid_b64))
        user = User.objects.get(pk=uid, is_active=True)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError):
        return JsonResponse({"detail": "Lien invalide ou expiré."}, status=400)
    if not default_token_generator.check_token(user, token):
        return JsonResponse({"detail": "Lien invalide ou expiré."}, status=400)
    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        msg = exc.messages[0] if exc.messages else "Mot de passe refusé."
        return JsonResponse({"detail": str(msg)}, status=400)
    user.set_password(new_password)
    user.must_change_password = False
    user.save()
    create_audit_log(
        utilisateur=None,
        action=AuditLog.Action.RESET_PASSWORD_COMPLETED,
        modele_concerne="User",
        details={"user_id": user.pk, "username": user.username},
    )
    return JsonResponse({"detail": "Mot de passe mis à jour. Vous pouvez vous connecter."})


@require_POST
def password_change_api(request):
    """Changement à l'initiative de l'utilisateur connecté (compte actif)."""
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Non authentifié."}, status=401)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "JSON invalide."}, status=400)
    old_password = data.get("old_password") or ""
    new_password = data.get("new_password") or ""
    if not new_password:
        return JsonResponse({"detail": "Nouveau mot de passe requis."}, status=400)
    user = request.user
    if not user.check_password(old_password):
        return JsonResponse({"detail": "Mot de passe actuel incorrect."}, status=400)
    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        msg = exc.messages[0] if exc.messages else "Mot de passe refusé."
        return JsonResponse({"detail": str(msg)}, status=400)
    user.set_password(new_password)
    user.must_change_password = False
    user.save()
    create_audit_log(
        utilisateur=user,
        action=AuditLog.Action.PASSWORD_CHANGED,
        modele_concerne="User",
        details={"changed_by": "self", "username": user.username},
    )
    login(request, user)
    return JsonResponse(UserSerializer(user).data)


@require_POST
def password_ops_send_reset_api(request):
    """
    Envoie un lien de réinitialisation pour un compte métier (sans superuser).
    Réservé aux comptes PASSWORD_OPS et aux superusers Django.
    """
    if not _password_ops_gate(request.user):
        return JsonResponse({"detail": "Accès refusé."}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"detail": "JSON invalide."}, status=400)
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    if not username and not email:
        return JsonResponse({"detail": "Indiquez un identifiant ou une adresse e-mail."}, status=400)

    qs = User.objects.filter(is_active=True).exclude(is_superuser=True)
    target = None
    if username:
        target = qs.filter(username__iexact=username).first()
    if target is None and email:
        target = qs.filter(email__iexact=email).exclude(email="").first()

    if target is None:
        return JsonResponse({"detail": "Compte introuvable ou non éligible."}, status=404)
    if not target.has_usable_password():
        return JsonResponse({"detail": "Compte introuvable ou non éligible."}, status=404)
    if not (target.email or "").strip():
        return JsonResponse(
            {"detail": "Ce compte n'a pas d'adresse e-mail — impossible d'envoyer le lien."},
            status=400,
        )

    try:
        _send_password_reset_email(target)
    except Exception:
        return JsonResponse(
            {
                "detail": (
                    "L'envoi d'e-mail est temporairement indisponible. "
                    "Contactez l'administrateur système."
                )
            },
            status=503,
        )

    create_audit_log(
        utilisateur=request.user,
        action=AuditLog.Action.RESET_PASSWORD_REQUESTED,
        modele_concerne="User",
        details={
            "target_user_id": target.pk,
            "target_username": target.username,
            "via": "password_ops",
        },
    )
    return JsonResponse({"detail": f"E-mail de réinitialisation envoyé à {target.email}."})


class UserManagementViewSet(viewsets.ModelViewSet):
    """
    Gestion des comptes (ADMIN, POINTAGE_AGENT, COMPTABLE) — réservé au rôle ADMIN.
    """

    authentication_classes = [SessionAuthentication]
    serializer_class = StaffUserSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_permissions(self):
        perms = [IsAuthenticated(), IsAdminRole()]
        if self.action == "destroy":
            perms.append(CannotDeleteSelf())
        return perms

    def get_queryset(self):
        return (
            User.objects.filter(
                role__in=(
                    User.Role.ADMIN,
                    User.Role.POINTAGE_AGENT,
                    User.Role.COMPTABLE,
                ),
            )
            .exclude(is_superuser=True)
            .exclude(role=User.Role.PASSWORD_OPS)
            .order_by("username")
        )

    def _with_generated_password(self, serializer, data):
        plain = getattr(serializer, "_plain_password_to_return", None)
        if plain:
            return {**data, "generated_password": plain}
        return data

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        data = self._with_generated_password(serializer, dict(serializer.data))
        return Response(data, status=201, headers=headers)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        data = self._with_generated_password(serializer, dict(serializer.data))
        return Response(data)

    def perform_destroy(self, instance):
        create_audit_log(
            utilisateur=self.request.user,
            action=AuditLog.Action.SUPPRESSION,
            modele_concerne="User",
            details={
                "deleted_user_id": instance.pk,
                "deleted_username": instance.username,
                "deleted_role": instance.role,
            },
        )
        instance.delete()


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Liste et détail des journaux d'audit (GET uniquement).
    Filtres optionnels : ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&action=...&model_name=...
    Métadonnées : GET /api/audit-logs/models/ — modèles (Django scolarite/authentification + déjà journalisés).
    """

    authentication_classes = [SessionAuthentication]
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated, IsSuperAdminRole]

    @action(detail=False, methods=["get"], url_path="models")
    def models(self, request):
        catalog, _ = build_audit_model_catalog()
        return Response(catalog)

    def get_queryset(self):
        qs = AuditLog.objects.select_related("utilisateur").all()
        params = self.request.query_params
        start_raw = params.get("start_date")
        end_raw = params.get("end_date")
        action_param = params.get("action")
        model_param = params.get("model_name") or params.get("model")

        if start_raw:
            d = parse_date(start_raw)
            if d is not None:
                start_dt = timezone.make_aware(datetime.combine(d, time.min))
                qs = qs.filter(date__gte=start_dt)
        if end_raw:
            d = parse_date(end_raw)
            if d is not None:
                end_dt = timezone.make_aware(datetime.combine(d, time.max))
                qs = qs.filter(date__lte=end_dt)
        if action_param:
            allowed = {choice for choice, _ in AuditLog.Action.choices}
            if action_param in allowed:
                qs = qs.filter(action=action_param)
        if model_param:
            _, allowed = build_audit_model_catalog()
            key = model_param.strip()
            if key in allowed:
                qs = qs.filter(modele_concerne__iexact=key)

        return qs.order_by("-date", "-id")
