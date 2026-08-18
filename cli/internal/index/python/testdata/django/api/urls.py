from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"orders", views.OrderViewSet)

urlpatterns = [
    path("health/", views.health),
    path("customers/<int:pk>/", views.customer_detail),
    re_path(r"^legacy/invoices/(?P<invoice_id>[^/.]+)/$", views.legacy_invoice),
    re_path(r"^reports/(summary|detail)/$", views.reports),
    path("", include(router.urls)),
]
