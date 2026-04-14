from django.db import models
from django.contrib.auth.models import User

class SpottedLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='spotted_logs')
    logged_at = models.DateTimeField(auto_now_add=True)
    service_date = models.DateTimeField(null=True, blank=True)
    headcode = models.CharField(max_length=20, blank=True)
    logged_at_location = models.TextField(blank=True)
    destination = models.CharField(max_length=200, blank=True)
    operator = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)

    #vehicle
    unit_number = models.CharField(max_length=20, blank=True)
    reg = models.CharField(max_length=12, blank=True)
    vehicle_type = models.CharField(max_length=80, blank=True)
    livery = models.CharField(max_length=80, blank=True)
    livery_name = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ['-logged_at']
        verbose_name = 'Spotted log'
        verbose_name_plural = 'Spotted logs'

    def __str__(self):
        return f"{self.user.username} spotted {self.headcode or '?'} | {self.unit_number or self.reg or '?'} on {self.service_date or 'no date'} at {self.logged_at_location or '?'}"

class TripLog(models.Model):
    user        = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trip_logs')
    on_trip_trip = models.ManyToManyField(User, related_name='on_trip_trips', blank=True,
        help_text='Other users who were on the same trip (e.g. friends you travelled with) - optional, for social features and trip grouping')
    logged_at   = models.DateTimeField(auto_now_add=True)

    headcode    = models.CharField(max_length=20, blank=True)
    operator    = models.CharField(max_length=120, blank=True)
    service_date = models.DateField(null=True, blank=True)

    TRANSPORT_RAIL = 'rail'
    TRANSPORT_BUS  = 'bus'
    TRANSPORT_TRAM = 'tram'
    TRANSPORT_FERRY = 'ferry'
    TRANSPORT_CHOICES = [
        (TRANSPORT_RAIL,  'Rail'),
        (TRANSPORT_BUS,   'Bus'),
        (TRANSPORT_TRAM,  'Tram'),
        (TRANSPORT_FERRY, 'Ferry'),
    ]
    transport_type = models.CharField(
        max_length=10, choices=TRANSPORT_CHOICES,
        default=TRANSPORT_RAIL, blank=True,
    )

    origin_name         = models.CharField(max_length=200, blank=True)
    origin_crs          = models.CharField(max_length=10,  blank=True)
    origin_tiploc       = models.CharField(max_length=20,  blank=True)

    destination_name    = models.CharField(max_length=200, blank=True)
    destination_crs     = models.CharField(max_length=10,  blank=True)
    destination_tiploc  = models.CharField(max_length=20,  blank=True)

    scheduled_departure = models.TimeField(null=True, blank=True)
    scheduled_arrival   = models.TimeField(null=True, blank=True)

    boarded_stop_name   = models.CharField(max_length=200, blank=True)
    boarded_stop_crs    = models.CharField(max_length=10,  blank=True)
    boarded_stop_atco   = models.CharField(max_length=30,  blank=True)

    route_geometry = models.JSONField(null=True, blank=True,
        help_text='GeoJSON LineString coordinate array [[lon,lat],...]')

    full_route_geometry = models.JSONField(null=True, blank=True,
        help_text='GeoJSON LineString coordinate array [[lon,lat],...] for the full route (not just the boarded stop onwards)')

    full_locations = models.JSONField(null=True, blank=True,
        help_text='Array of all locations passed through, with timestamps and stop info, e.g. [{"name": "Stop A", "crs": "AAA", "tiploc": "AAA", "arrival": "15:04", "departure": "15:05"}, ...]')

    train_fleet_number  = models.CharField(max_length=20,  blank=True)
    train_type          = models.CharField(max_length=60,  blank=True,
        help_text='e.g. Class 390, Pendolino')

    bus_fleet_number    = models.CharField(max_length=20,  blank=True)
    bus_registration    = models.CharField(max_length=12,  blank=True,
        help_text='e.g. BV24 LSJ')
    bus_type            = models.CharField(max_length=80,  blank=True,
        help_text='e.g. Wrightbus StreetDeck')
    bus_livery          = models.TextField(blank=True,
        help_text='Hex colour code, e.g. #15803d')
    bus_livery_name     = models.CharField(max_length=80,  blank=True,
        help_text='e.g. First Greater Manchester pink')

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-logged_at']
        verbose_name      = 'Trip log'
        verbose_name_plural = 'Trip logs'

    def __str__(self):
        return (
            f"{self.user.username} · {self.headcode or '?'} "
            f"{self.origin_name or '?'} → {self.destination_name or '?'} "
            f"({self.service_date or 'no date'})"
        )

    @property
    def is_bus(self):
        return self.transport_type in (self.TRANSPORT_BUS, self.TRANSPORT_TRAM, self.TRANSPORT_FERRY)

    @property
    def is_rail(self):
        return self.transport_type == self.TRANSPORT_RAIL

class ImportJob(models.Model):
    STATUS_UPLOADED = 'uploaded'
    STATUS_QUEUED = 'queued'
    STATUS_RUNNING = 'running'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_UPLOADED, 'Uploaded'),
        (STATUS_QUEUED, 'Queued'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='import_jobs')
    filepath = models.CharField(max_length=800)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_UPLOADED)

    total = models.IntegerField(default=0)
    inserted = models.IntegerField(default=0)
    duplicates = models.IntegerField(default=0)
    failed_count = models.IntegerField(default=0)

    result_log = models.JSONField(null=True, blank=True)

    dupe_policy = models.CharField(max_length=20, blank=True, default='skip')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"ImportJob {self.pk} by {self.user.username} ({self.status})"
