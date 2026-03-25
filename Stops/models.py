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
	common_name = models.CharField(max_length=255, null=True, blank=True, db_index=True)
	name = models.CharField(max_length=255, null=True, blank=True, db_index=True)
	long_name = models.CharField(max_length=255, null=True, blank=True, db_index=True)
	atco_code = models.CharField(max_length=64, null=True, blank=True, db_index=True)
	naptan_code = models.CharField(max_length=64, null=True, blank=True, db_index=True)
	tiploc = models.CharField(max_length=64, null=True, blank=True, db_index=True)
	other_tiplocs = models.CharField(max_length=255, null=True, blank=True, db_index=True)
	crs = models.CharField(max_length=10, null=True, blank=True, db_index=True)
	other_crs = models.CharField(max_length=10, null=True, blank=True, db_index=True)
	stop_type = models.ForeignKey(StopType, null=True, blank=True, on_delete=models.SET_NULL, related_name='stops', db_index=True)
	active = models.BooleanField(default=True, db_index=True)
	created_at = models.DateTimeField(auto_now_add=True, db_index=True)
	modified_at = models.DateTimeField(auto_now=True, db_index=True)
	bearing = models.FloatField(null=True, blank=True, db_index=True)
	lat = models.FloatField(db_index=True)
	lon = models.FloatField(db_index=True)
	lines = models.CharField(max_length=255, null=True, blank=True, db_index=True)
	indicator = models.CharField(max_length=64, null=True, blank=True, db_index=True)
	icon = models.CharField(max_length=255, null=True, blank=True, db_index=True)

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

