from django.contrib import admin

from .models import Operator


@admin.register(Operator)
class OperatorAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'slug')
    search_fields = ('name', 'code', 'slug')
    prepopulated_fields = { 'slug': ('name',) }
    readonly_fields = ()

    def get_prepopulated_fields(self, request, obj=None):
        # Only provide prepopulated behavior when creating a new object.
        # If the object exists we make `slug` readonly, so prepopulated_fields
        # must not reference it (Django will otherwise raise KeyError).
        if obj:
            return {}
        return self.prepopulated_fields
