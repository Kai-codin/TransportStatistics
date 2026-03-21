from django.contrib import admin
from django.db.models import F
from django.db.models.functions import Coalesce, Cast
from django.db import models

from .models import Timetable, ScheduleLocation


@admin.register(Timetable)
class TimetableAdmin(admin.ModelAdmin):
    list_display = ('CIF_train_uid', 'headcode', 'operator', 'schedule_start_date', 'schedule_end_date')
    search_fields = ('CIF_train_uid', 'train_service_code', 'headcode')
    list_filter = ('headcode', 'operator')
    autocomplete_fields = ('operator',)


@admin.register(ScheduleLocation)
class ScheduleLocationAdmin(admin.ModelAdmin):
    list_display = ('timetable', 'tiploc_code', 'stop', 'time_display', 'platform')
    search_fields = ('tiploc_code', 'stop__name', 'timetable__CIF_train_uid')
    #list_filter = ('timetable',)
    autocomplete_fields = ('stop', 'timetable')

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        # Cast the coalesced string time to a proper TimeField so admin treats
        # it as a time value instead of a plain string (avoids timezone.is_aware errors).
        return qs.annotate(
            primary_time=Cast(
                Coalesce(F('departure_time'), F('arrival_time'), F('pass_time')),
                output_field=models.TimeField(),
            )
        )

    @admin.display(ordering='primary_time', description='time')
    def time_display(self, obj):
        return obj.time
