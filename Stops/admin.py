from django.contrib import admin
from .models import Stop, StopType


@admin.register(Stop)
class StopAdmin(admin.ModelAdmin):
	list_display = ('name', 'crs', 'atco_code', 'tiploc', 'stop_type', 'active')
	search_fields = ('name', 'atco_code', 'tiploc', 'crs')
	list_filter = ('active', 'stop_type')
	autocomplete_fields = ('stop_type',)

@admin.register(StopType)
class StopTypeAdmin(admin.ModelAdmin):
	list_display = ('name', 'code', 'sub_of')
	search_fields = ('name', 'code')

