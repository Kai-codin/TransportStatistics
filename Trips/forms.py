from django import forms

from .models import TripLog


class UploadServicesForm(forms.Form):
    services_file = forms.FileField(required=True, label='services.json')
    DUPE_CHOICES = [
        ('skip', 'Skip duplicates (default)'),
        ('import_all', 'Import all (allow duplicates)'),
        ('overwrite', 'Overwrite existing'),
    ]
    dupe_policy = forms.ChoiceField(choices=DUPE_CHOICES, required=False, initial='skip')


class TripLogForm(forms.ModelForm):

    class Meta:
        model  = TripLog
        fields = [
            'headcode', 'operator', 'service_date', 'transport_type',
            'origin_name', 'origin_crs',
            'destination_name', 'destination_crs',
            'scheduled_departure', 'scheduled_arrival',
            'boarded_stop_name', 'boarded_stop_crs', 'boarded_stop_atco',
            'train_fleet_number', 'train_type',
            'bus_fleet_number', 'bus_registration', 'bus_type',
            'bus_livery', 'bus_livery_name',
            'notes', 'bustimes_service_slug', 'bustimes_service_id',
            'route_geometry', 'full_route_geometry', 'full_locations',
        ]

        widgets = {
            'service_date':         forms.DateInput(attrs={'type': 'date'}),
            'scheduled_departure':  forms.TimeInput(attrs={'type': 'time'}),
            'scheduled_arrival':    forms.TimeInput(attrs={'type': 'time'}),
            'actual_departure':     forms.TimeInput(attrs={'type': 'time'}),
            'transport_type':       forms.Select(),

            'notes': forms.Textarea(attrs={'rows': 3}),
            'route_geometry': forms.HiddenInput(),
            'full_route_geometry': forms.HiddenInput(),
            'full_locations': forms.HiddenInput(),
            'origin_crs':        forms.HiddenInput(),
            'destination_crs':   forms.HiddenInput(),
            'boarded_stop_crs':  forms.HiddenInput(),
            'boarded_stop_atco': forms.HiddenInput(),
            'bustimes_service_slug': forms.HiddenInput(),
            'bustimes_service_id': forms.HiddenInput(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        for field in self.fields.values():
            field.required = False

        transport = (
            self.data.get("transport_type")
            or getattr(self.instance, "transport_type", None)
            or self.initial.get("transport_type")
        )

        if transport:
            transport = transport.lower()

        if transport in {"bus", "tram", "ferry"}:
            self.fields["headcode"].label = "Route number"
            self.fields["headcode"].widget.attrs["placeholder"] = "e.g. 50"
            self._hide_fields([
                "train_fleet_number",
                "train_type",
            ])
        else:
            self.fields["headcode"].label = "Headcode"
            self.fields["headcode"].widget.attrs["placeholder"] = "e.g. 2H41"
            self._hide_fields([
                "bus_fleet_number",
                "bus_registration",
                "bus_type",
                "bus_livery",
                "bus_livery_name",
                'bustimes_service_slug',
                'bustimes_service_id',
            ])

    def _hide_fields(self, field_names):
        for name in field_names:
            if name in self.fields:
                self.fields[name].widget = forms.HiddenInput()
                self.fields[name].required = False
