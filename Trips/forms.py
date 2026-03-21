from django import forms
from .models import TripLog


class TripLogForm(forms.ModelForm):

    class Meta:
        model  = TripLog
        fields = [
            # service
            'headcode', 'operator', 'service_date', 'transport_type',
            # journey
            'origin_name', 'origin_crs',
            'destination_name', 'destination_crs',
            'scheduled_departure', 'actual_departure',
            # boarded stop
            'boarded_stop_name', 'boarded_stop_crs', 'boarded_stop_atco',
            # vehicle — rail
            'train_fleet_number', 'train_type',
            # vehicle — bus
            'bus_fleet_number', 'bus_registration', 'bus_type',
            'bus_livery', 'bus_livery_name',
            # misc
            'notes',
            # geometry (hidden, populated by map JS if available)
            'route_geometry',
        ]
        widgets = {
            'service_date':         forms.DateInput(attrs={'type': 'date'}),
            'scheduled_departure':  forms.TimeInput(attrs={'type': 'time'}),
            'actual_departure':     forms.TimeInput(attrs={'type': 'time'}),
            'transport_type':       forms.Select(),
            'notes':                forms.Textarea(attrs={'rows': 3}),
            'route_geometry':       forms.HiddenInput(),
            # hidden pre-fill fields
            'origin_crs':           forms.HiddenInput(),
            'destination_crs':      forms.HiddenInput(),
            'boarded_stop_crs':     forms.HiddenInput(),
            'boarded_stop_atco':    forms.HiddenInput(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Make everything optional — user can fill in as much as they like
        for field in self.fields.values():
            field.required = False