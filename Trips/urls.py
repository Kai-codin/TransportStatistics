from django.urls import path
from views import log_trip
 
urlpatterns += [
    path('log-trip/', log_trip, name='log_trip'),
]
 