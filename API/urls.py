from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import StopViewSet, enrich_stop, fleet_search, train_fleet, live_trains_proxy, refresh_train_detail, GetTrainOperatorsViewSet
from Depatures.api import ServiceLocationsViewSet, TrainDeparturesViewSet, BusDeparturesViewSet, BusServiceViewSet

router = DefaultRouter()
router.register(r'stops', StopViewSet, basename='stop')
router.register(r'train-service', ServiceLocationsViewSet, basename='service-locations')
router.register(r'train-departures', TrainDeparturesViewSet, basename='train-departures')
router.register(r'bus-departures', BusDeparturesViewSet, basename='bus-departures')
router.register(r'bus-service', BusServiceViewSet, basename='bus-service')
router.register(r'get_train_operators', GetTrainOperatorsViewSet, basename='train-operatos')

urlpatterns = [
    # Place the explicit enrich route before the router to avoid it being
    # interpreted as a stop lookup by the DefaultRouter's generated patterns.
    path('stops/enrich/', enrich_stop, name='stop-enrich'),
    path('fleet', fleet_search, name='fleet-search'),
    path('fleet/', fleet_search, name='fleet-search-slash'),
    path('train-fleet/', train_fleet, name='train-fleet'),
    path('train-detail/refresh/', refresh_train_detail, name='train-detail-refresh'),
    path('live-trains/', live_trains_proxy.as_view(), name='live-trains'),
    path('', include(router.urls)),
]
