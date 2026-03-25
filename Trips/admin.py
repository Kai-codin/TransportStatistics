from django.contrib import admin
from .models import TripLog
from .models import ImportJob
 
@admin.register(TripLog)
class TripLogAdmin(admin.ModelAdmin):
    list_display  = ['user', 'headcode', 'transport_type', 'origin_name',
                     'destination_name', 'service_date', 'logged_at',]
    list_filter   = ['transport_type', 'service_date', 'user']
    search_fields = ['headcode', 'origin_name', 'destination_name', 'operator', 'bus_registration', 'bus_fleet_number', 'train_fleet_number']
    readonly_fields = ['logged_at']
    autocomplete_fields = ['user']


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'status', 'created_at', 'started_at', 'completed_at', 'total', 'inserted', 'duplicates']
    readonly_fields = ['created_at', 'started_at', 'completed_at']
    search_fields = ['user__username', 'filepath']
    autocomplete_fields = ['user']