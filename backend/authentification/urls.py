from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.csrf_cookie_api, name="auth-csrf-cookie"),
    path("login/", views.login_api, name="auth-login"),
    path("logout/", views.logout_api, name="auth-logout"),
    path("me/", views.me_api, name="auth-me"),
    path(
        "password-reset/request/",
        views.password_reset_request_api,
        name="auth-password-reset-request",
    ),
    path(
        "password-reset/confirm/",
        views.password_reset_confirm_api,
        name="auth-password-reset-confirm",
    ),
    path("password/change/", views.password_change_api, name="auth-password-change"),
    path(
        "password-ops/send-reset/",
        views.password_ops_send_reset_api,
        name="auth-password-ops-send-reset",
    ),
]
