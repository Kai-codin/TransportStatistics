from django.contrib import admin
from .models import Stop, StopType


def better_name(obj):
	if obj.long_name:
		return obj.long_name
	if obj.common_name:
		return obj.common_name
	return obj.name

@admin.register(Stop)
class StopAdmin(admin.ModelAdmin):
    list_display = (better_name, 'indicator', 'crs', 'atco_code', 'tiploc', 'stop_type', 'show_on_map')
    search_fields = ('name', 'long_name', 'common_name', 'atco_code', 'tiploc', 'crs')
    list_filter = ('show_on_map', 'stop_type')
    autocomplete_fields = ('stop_type',)
    actions = ['hide_on_map', 'show_on_map']

    @admin.action(description='Hide selected stops on map')
    def hide_on_map(self, request, queryset):
        updated = queryset.update(show_on_map=False)
        self.message_user(request, f'{updated} stop(s) hidden from map.')

    @admin.action(description='Show selected stops on map')
    def show_on_map(self, request, queryset):
        updated = queryset.update(show_on_map=True)
        self.message_user(request, f'{updated} stop(s) shown on map.')

@admin.register(StopType)
class StopTypeAdmin(admin.ModelAdmin):
	list_display = ('name', 'code', 'sub_of')
	search_fields = ('name', 'code')

