from django.db import models
from django.utils.text import slugify


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


class Trains(models.Model):
    fleetnumber = models.CharField(max_length=32, unique=True, db_index=True)
    type = models.CharField(max_length=255)
    livery_name = models.CharField(max_length=255, blank=True, default="")
    livery_css = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["fleetnumber"]

    def __str__(self) -> str:
        return f"{self.fleetnumber} - {self.type}"
