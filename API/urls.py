from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import StopViewSet
from Depatures.api import ServiceLocationsViewSet, TrainDeparturesViewSet, BusDeparturesViewSet, BusServiceViewSet

router = DefaultRouter()
router.register(r'stops', StopViewSet, basename='stop')
router.register(r'train-service', ServiceLocationsViewSet, basename='service-locations')
router.register(r'train-departures', TrainDeparturesViewSet, basename='train-departures')
router.register(r'bus-departures', BusDeparturesViewSet, basename='bus-departures')
router.register(r'bus-service', BusServiceViewSet, basename='bus-service')

urlpatterns = [
    path('', include(router.urls)),
]
