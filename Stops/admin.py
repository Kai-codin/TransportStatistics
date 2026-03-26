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

@admin.register(StopType)
class StopTypeAdmin(admin.ModelAdmin):
	list_display = ('name', 'code', 'sub_of')
	search_fields = ('name', 'code')

