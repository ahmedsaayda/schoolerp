from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AvanceSalaireViewSet,
    BanqueViewSet,
    CalendrierScolaireViewSet,
    CaisseViewSet,
    ClasseViewSet,
    DashboardAnalyticsView,
    DashboardStatsView,
    DepenseViewSet,
    FinancialAnalyticsView,
    EleveViewSet,
    EmploiDuTempsViewSet,
    MouvementBanqueViewSet,
    PaiementViewSet,
    PaiementSalaireViewSet,
    PersonnelViewSet,
    PointagePersonnelViewSet,
    PointageViewSet,
    ProfesseurViewSet,
    SessionCaisseViewSet,
    StatsDashboardLegacyView,
)

router = DefaultRouter()
router.register(r"eleves", EleveViewSet, basename="eleve")
router.register(r"paiements", PaiementViewSet, basename="paiement")
router.register(r"professeurs", ProfesseurViewSet, basename="professeur")
router.register(r"personnel", PersonnelViewSet, basename="personnel")
router.register(r"paiements-salaire", PaiementSalaireViewSet, basename="paiement-salaire")
router.register(r"pointage-personnel", PointagePersonnelViewSet, basename="pointage-personnel")
router.register(r"pointages", PointageViewSet, basename="pointage")
router.register(r"avances-salaire", AvanceSalaireViewSet, basename="avance-salaire")
router.register(r"banque", BanqueViewSet, basename="banque")
router.register(r"calendrier-scolaire", CalendrierScolaireViewSet, basename="calendrier-scolaire")
router.register(r"caisse", CaisseViewSet, basename="caisse")
router.register(r"sessions-caisse", SessionCaisseViewSet, basename="session-caisse")
router.register(r"mouvements-banque", MouvementBanqueViewSet, basename="mouvement-banque")
router.register(r"emplois-du-temps", EmploiDuTempsViewSet, basename="emploi-du-temps")
router.register(r"classes", ClasseViewSet, basename="classe")
router.register(r"depenses", DepenseViewSet, basename="depense")

urlpatterns = [
    path("stats/dashboard/", StatsDashboardLegacyView.as_view(), name="dashboard-stats-legacy"),
    path("dashboard/stats/", DashboardStatsView.as_view(), name="dashboard-stats"),
    path("stats/financial-analytics/", FinancialAnalyticsView.as_view(), name="financial-analytics"),
    path("dashboard-analytics/", DashboardAnalyticsView.as_view(), name="dashboard-analytics"),
    path("", include(router.urls)),
]
