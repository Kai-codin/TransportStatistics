from django.db import models
from django.utils import timezone
from main.models import Operator
from Stops.models import Stop

class PowerType(models.Model):
    name = models.CharField(max_length=64, unique=True)
    code = models.CharField(max_length=16, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} ({self.code})'
    
class TrainClass(models.Model):
    name = models.CharField(max_length=64, unique=True)
    code = models.CharField(max_length=16, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} ({self.code})'

class TrainStatus(models.Model):
    name = models.CharField(max_length=64, unique=True)
    code = models.CharField(max_length=16, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} ({self.code})'

class TrainCategory(models.Model):
    name = models.CharField(max_length=64, unique=True)
    code = models.CharField(max_length=16, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} ({self.code})'    
    
class PathType(models.Model):
    name = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name}'
class TimingLoad(models.Model):
    type = models.ManyToManyField('PathType', related_name='timing_loads')
    code = models.CharField(max_length=16, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.code}'

class Timetable(models.Model):
    CIF_train_uid = models.CharField(max_length=64, db_index=True)
    operator = models.ForeignKey(Operator, null=True, blank=True, on_delete=models.SET_NULL, related_name='timetables', db_index=True)
    headcode = models.CharField(max_length=16, null=True, blank=True, db_index=True)
    train_service_code = models.CharField(max_length=32, null=True, blank=True, db_index=True)
    schedule_start_date = models.DateField(null=True, blank=True, db_index=True)
    schedule_end_date = models.DateField(null=True, blank=True, db_index=True)
    
    schedule_days_runs = models.CharField(max_length=16, null=True, blank=True)
    train_status = models.CharField(max_length=8, null=True, blank=True)
    CIF_train_category = models.CharField(max_length=16, null=True, blank=True)
    CIF_timing_load = models.CharField(max_length=16, null=True, blank=True)
    CIF_headcode = models.CharField(max_length=16, null=True, blank=True)
    power_type = models.CharField(max_length=32, null=True, blank=True)
    max_speed = models.IntegerField(null=True, blank=True)
    train_class = models.CharField(max_length=8, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['schedule_start_date', 'schedule_end_date']),  # composite
        ]


    def __str__(self):
        return f"{self.headcode} {self.operator} - ({self.schedule_start_date} to {self.schedule_end_date})"


class ScheduleLocation(models.Model):
    timetable = models.ForeignKey(Timetable, related_name='location_entries', on_delete=models.CASCADE, db_index=True)
    stop = models.ForeignKey(Stop, null=True, blank=True, on_delete=models.SET_NULL, related_name='schedule_locations', db_index=True)
    tiploc_code = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    sort_time = models.TimeField(null=True, blank=True, db_index=True)
    
    location_type = models.CharField(max_length=8, null=True, blank=True)
    departure_time = models.CharField(max_length=16, null=True, blank=True)
    arrival_time = models.CharField(max_length=16, null=True, blank=True)
    pass_time = models.CharField(max_length=16, null=True, blank=True)
    platform = models.CharField(max_length=16, null=True, blank=True)
    engineering_allowance = models.CharField(max_length=16, null=True, blank=True)
    pathing_allowance = models.CharField(max_length=16, null=True, blank=True)
    performance_allowance = models.CharField(max_length=16, null=True, blank=True)
    position = models.IntegerField(null=True, blank=True, db_index=True)
    from_date = models.DateField(null=True, blank=True, db_index=True)
    to_date = models.DateField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "timetable":
            kwargs["queryset"] = (
                Timetable.objects
                .all()
                .defer("created_at", "modified_at")
            )
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)

        if queryset.model is Timetable:
            queryset = queryset.defer("created_at", "modified_at")

        return queryset, use_distinct

    def __str__(self):
        return f"{self.stop} at {self.departure_time or self.arrival_time or self.pass_time} for {self.timetable}"

    @property
    def time(self):
        """Return primary time: departure > arrival > pass > '-'"""
        if self.departure_time and self.arrival_time:
            return f"{self.arrival_time} - {self.departure_time} | arr-dep"
        if self.departure_time:
            return f"{self.departure_time} | dep"
        if self.arrival_time:
            return f"{self.arrival_time} | arr"
        if self.pass_time:
            return f"{self.pass_time} | pass"
        return '-'