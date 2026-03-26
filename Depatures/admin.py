from django.contrib import admin
from django.db.models import F
from django.db.models.functions import Coalesce, Cast
from django.db import models

from .models import Timetable, ScheduleLocation


@admin.register(Timetable)
class TimetableAdmin(admin.ModelAdmin):
    list_display = ('CIF_train_uid', 'headcode', 'operator', 'safe_schedule_start_date', 'safe_schedule_end_date')
    search_fields = ('CIF_train_uid', 'train_service_code', 'headcode')
    list_filter = ('headcode', 'operator')
    autocomplete_fields = ('operator',)

    def _coerce_date(self, value):
        import datetime as _dt
        # If DB returned a string, try to parse ISO date or ISO datetime; otherwise return as-is
        if isinstance(value, str):
            try:
                # Try date first (YYYY-MM-DD)
                return _dt.date.fromisoformat(value)
            except Exception:
                try:
                    # Try full ISO datetime and extract date part
                    return _dt.datetime.fromisoformat(value).date()
                except Exception:
                    return value
        return value

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        # Defer heavy datetime fields so MySQL's datetime converter doesn't see
        # any string values for those fields when rendering the changelist.
        return qs.defer('created_at', 'modified_at')

    @admin.display(ordering='schedule_start_date', description='schedule_start_date')
    def safe_schedule_start_date(self, obj):
        return self._coerce_date(getattr(obj, 'schedule_start_date'))

    @admin.display(ordering='schedule_end_date', description='schedule_end_date')
    def safe_schedule_end_date(self, obj):
        return self._coerce_date(getattr(obj, 'schedule_end_date'))


@admin.register(ScheduleLocation)
class ScheduleLocationAdmin(admin.ModelAdmin):
    list_display = ('timetable', 'tiploc_code', 'stop', 'time_display', 'platform')
    search_fields = ('tiploc_code', 'stop__name', 'timetable__CIF_train_uid')
    autocomplete_fields = ('stop', 'timetable')
    list_per_page = 50
    list_select_related = ('stop', 'timetable')  # covers list_display relations

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return (
            qs
            .select_related('stop', 'timetable')
            .defer('timetable__created_at', 'timetable__modified_at')
            .annotate(
                primary_time=Cast(
                    Coalesce(
                        F('departure_time'),
                        F('arrival_time'),
                        F('pass_time'),
                    ),
                    output_field=models.TimeField(),
                )
            )
        )

    @admin.display(ordering='primary_time', description='Time')
    def time_display(self, obj):
        return obj.primary_time  # was obj.time — annotation is named primary_time
