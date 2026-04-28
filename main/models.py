from django.db import models
from django.utils.text import slugify
from django.conf import settings
from django.utils import timezone


class TrainEditRequest(models.Model):
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    train = models.ForeignKey('main.Trains', on_delete=models.CASCADE, related_name="edit_requests")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="train_edit_requests")

    # Proposed values
    proposed_operator = models.ForeignKey(
        'main.Operator',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="proposed_in_requests",
    )
    proposed_type = models.CharField(max_length=255, blank=True, default="")
    proposed_livery_name = models.CharField(max_length=255, blank=True, default="")
    proposed_livery_css = models.TextField(blank=True, default="")

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_train_edit_requests",
    )
    rejection_reason = models.TextField(blank=True, default="")

    # optional snapshot of original values for quick diff
    original_values = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"EditRequest({self.train} by {self.user} status={self.status})"

    def save(self, *args, **kwargs):
        if not self.original_values:
            self.original_values = {
                "operator_id": self.train.operator_id,
                "type": self.train.type,
                "livery_name": self.train.livery_name,
                "livery_css": self.train.livery_css,
            }
        super().save(*args, **kwargs)


class Operator(models.Model):
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=32, unique=True)
    slug = models.SlugField(max_length=255, unique=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name or self.code) or slugify(self.code)
            slug = base
            counter = 1
            while Operator.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)

class HistoricalRoutes(models.Model):
    name = models.CharField(max_length=255)
    operators = models.TextField(blank=True, default="")  # Comma-separated list of operator names
    description = models.TextField(blank=True, default="")
    inbound_destination = models.CharField(max_length=255)
    outbound_destination = models.CharField(max_length=255)
    route_data = models.JSONField(blank=True, default=list)
    stops = models.JSONField(blank=True, default=list, null=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['start_date']

    def __str__(self) -> str:
        return f"{self.name} | {self.description} | ({self.start_date} - {self.end_date or 'Present'})"

class TrainRID(models.Model):
    """
    Caches per-RID service details fetched from the Signalbox train-information API.
    One row per RID - updated in-place if we ever re-fetch.
    """
 
    rid = models.CharField(max_length=64, primary_key=True)
    headcode = models.CharField(max_length=16, blank=True, default="")
    uid = models.CharField(max_length=16, blank=True, default="")
    toc_code = models.CharField(max_length=8, blank=True, default="")
    train_operator = models.CharField(max_length=128, blank=True, default="")
 
    origin_crs = models.CharField(max_length=8, blank=True, default="")
    origin_name = models.CharField(max_length=128, blank=True, default="")
    origin_departure = models.DateTimeField(null=True, blank=True)
 
    destination_crs = models.CharField(max_length=8, blank=True, default="")
    destination_name = models.CharField(max_length=128, blank=True, default="")
    destination_arrival = models.DateTimeField(null=True, blank=True)
 
    # Housekeeping
    fetched_at = models.DateTimeField(auto_now=True)
 
    class Meta:
        db_table = "train_rid"
        verbose_name = "Train RID"
        verbose_name_plural = "Train RIDs"
 
    def __str__(self):
        return f"{self.rid} - {self.headcode} {self.origin_name} → {self.destination_name}"
    
class Trains(models.Model):
    operator = models.ForeignKey(
        Operator,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="trains",
    )
    fleetnumber = models.CharField(max_length=32, unique=True, db_index=True)
    type = models.CharField(max_length=255)
    livery_name = models.CharField(max_length=255, blank=True, default="")
    livery_css = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["fleetnumber"]

    def __str__(self) -> str:
        return f"{self.fleetnumber} - {self.type}"
