from django.contrib import admin
from .models import TripLog
 
@admin.register(TripLog)
class TripLogAdmin(admin.ModelAdmin):
    list_display  = ['user', 'headcode', 'transport_type', 'origin_name',
                     'destination_name', 'service_date', 'logged_at']
    list_filter   = ['transport_type', 'service_date', 'user']
    search_fields = ['headcode', 'origin_name', 'destination_name',
                     'bus_registration', 'train_fleet_number']
    readonly_fields = ['logged_at']
    autocomplete_fields = ['user']