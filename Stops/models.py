from django.db import models


class StopType(models.Model):
	name = models.CharField(max_length=100)
	code = models.CharField(max_length=50, null=True, blank=True, unique=True)
	sub_of = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='sub_types')

	class Meta:
		verbose_name = "Stop Type"
		verbose_name_plural = "Stop Types"

	def __str__(self):
		return self.name


class Stop(models.Model):
	name = models.CharField(max_length=255, null=True, blank=True)
	atco_code = models.CharField(max_length=64, null=True, blank=True)
	naptan_code = models.CharField(max_length=64, null=True, blank=True)
	tiploc = models.CharField(max_length=64, null=True, blank=True)
	crs = models.CharField(max_length=10, null=True, blank=True)
	stop_type = models.ForeignKey(StopType, null=True, blank=True, on_delete=models.SET_NULL, related_name='stops')
	active = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)
	modified_at = models.DateTimeField(auto_now=True)
	bearing = models.FloatField(null=True, blank=True)
	lat = models.FloatField()
	lon = models.FloatField()
	lines = models.CharField(max_length=255, null=True, blank=True)
	indicator = models.CharField(max_length=64, null=True, blank=True)
	icon = models.CharField(max_length=255, null=True, blank=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self):
		if self.atco_code:
			return f"{self.name} - {self.atco_code}"
		if self.naptan_code:
			return f"{self.name} - {self.naptan_code}"
		if self.crs and self.tiploc:
			return f"{self.name} - {self.crs} / {self.tiploc}"
		if self.crs:
			return f"{self.name} - {self.crs}"
		return f"Stop {self.pk}"

