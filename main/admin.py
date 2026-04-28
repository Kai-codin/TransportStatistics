from django.contrib import admin

from .models import Operator, Trains, HistoricalRoutes, TrainEditRequest, TrainRID

@admin.register(Operator)
class OperatorAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'slug')
    search_fields = ('name', 'code', 'slug')
    prepopulated_fields = { 'slug': ('name',) }
    readonly_fields = ()

    def get_prepopulated_fields(self, request, obj=None):
        # Only provide prepopulated behavior when creating a new object.
        # If the object exists we make `slug` readonly, so prepopulated_fields
        # must not reference it (Django will otherwise raise KeyError).
        if obj:
            return {}
        return self.prepopulated_fields

@admin.register(TrainEditRequest)
class TrainEditRequestAdmin(admin.ModelAdmin):
    list_display = ('train', 'user', 'status', 'created_at')
    search_fields = ('train__fleetnumber', 'user__username')
    list_filter = ('status', 'created_at')
    readonly_fields = ('original_values',)

@admin.register(TrainRID)
class TrainRIDAdmin(admin.ModelAdmin):
    list_display = ('rid', 'headcode', 'origin_name', 'destination_name')
    search_fields = ('rid', 'headcode', 'origin_name', 'destination_name')

@admin.register(HistoricalRoutes)
class HistoricalRoutesAdmin(admin.ModelAdmin):
    list_display = ('name', 'description', 'start_date', 'end_date')
    search_fields = ('name', 'description')
    list_filter = ('start_date', 'end_date')

@admin.register(Trains)
class TrainsAdmin(admin.ModelAdmin):
    list_display = ("fleetnumber", "type", "operator", "livery_name")
    search_fields = ("fleetnumber", "type", "livery_name", "operator__name")
    list_filter = ("operator", "type", "livery_name")
