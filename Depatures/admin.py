from django.contrib import admin
from django.db.models import F
from django.db.models.functions import Coalesce

from .models import Timetable, ScheduleLocation
from Stops.models import Stop

@admin.register(Timetable)
class TimetableAdmin(admin.ModelAdmin):
    list_display = ('CIF_train_uid', 'headcode', 'operator', 'safe_schedule_start_date', 'safe_schedule_end_date')
    search_fields = ('^CIF_train_uid', '^train_service_code', '^headcode')  # ^ = startswith, uses index
    autocomplete_fields = ('operator',)
    list_per_page = 50
    show_full_result_count = False

    def _coerce_date(self, value):
        import datetime as _dt

        if isinstance(value, str):
            try:
                return _dt.date.fromisoformat(value)
            except Exception:
                try:
                    return _dt.datetime.fromisoformat(value).date()
                except Exception:
                    return value
        return value

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.defer('created_at', 'modified_at')

    @admin.display(ordering='schedule_start_date', description='schedule_start_date')
    def safe_schedule_start_date(self, obj):
        return self._coerce_date(getattr(obj, 'schedule_start_date'))

    @admin.display(ordering='schedule_end_date', description='schedule_end_date')
    def safe_schedule_end_date(self, obj):
        return self._coerce_date(getattr(obj, 'schedule_end_date'))

@admin.register(ScheduleLocation)
class ScheduleLocationAdmin(admin.ModelAdmin):
    list_display = ('timetable', 'stop', 'platform', 'position')
    search_fields = ('=timetable__CIF_train_uid',)
    autocomplete_fields = ('stop', 'timetable')
    show_full_result_count = False
    list_per_page = 25
    
    def get_queryset(self, request):
        qs = super().get_queryset(request)
        # If no search/filter applied, return empty queryset to avoid full scan
        if not request.GET:
            return qs.none()
        return qs.select_related('stop', 'timetable').only(
            'id', 'tiploc_code', 'platform',
            'departure_time', 'arrival_time', 'pass_time',
            'stop__id', 'stop__name',
            'timetable__id', 'timetable__CIF_train_uid', 'timetable__headcode',
        )
    
    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        """
        🚨 CRITICAL: prevent admin dropdowns from loading broken datetime fields
        """
        if db_field.name == "timetable":
            kwargs["queryset"] = Timetable.objects.only(
                'id',
                'CIF_train_uid',
                'headcode',
            )

        if db_field.name == "stop":
            kwargs["queryset"] = Stop.objects.only(
                'id',
                'name',
            )

        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def time_display(self, obj):
        return obj.departure_time or obj.arrival_time or obj.pass_time or "-"