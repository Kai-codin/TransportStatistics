from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import StopViewSet, enrich_stop, fleet_search, train_fleet
from Depatures.api import ServiceLocationsViewSet, TrainDeparturesViewSet, BusDeparturesViewSet, BusServiceViewSet

router = DefaultRouter()
router.register(r'stops', StopViewSet, basename='stop')
router.register(r'train-service', ServiceLocationsViewSet, basename='service-locations')
router.register(r'train-departures', TrainDeparturesViewSet, basename='train-departures')
router.register(r'bus-departures', BusDeparturesViewSet, basename='bus-departures')
router.register(r'bus-service', BusServiceViewSet, basename='bus-service')

urlpatterns = [
    # Place the explicit enrich route before the router to avoid it being
    # interpreted as a stop lookup by the DefaultRouter's generated patterns.
    path('stops/enrich/', enrich_stop, name='stop-enrich'),
    path('fleet', fleet_search, name='fleet-search'),
    path('fleet/', fleet_search, name='fleet-search-slash'),
    path('train-fleet/', train_fleet, name='train-fleet'),
    path('', include(router.urls)),
]
