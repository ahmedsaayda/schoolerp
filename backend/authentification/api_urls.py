from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("staff-users", views.UserManagementViewSet, basename="staff-user")
router.register("audit-logs", views.AuditLogViewSet, basename="auditlog")

urlpatterns = router.urls
