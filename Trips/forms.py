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

            # geometry
            'route_geometry',
        ]

        widgets = {
            'service_date':         forms.DateInput(attrs={'type': 'date'}),
            'scheduled_departure':  forms.TimeInput(attrs={'type': 'time'}),
            'actual_departure':     forms.TimeInput(attrs={'type': 'time'}),
            'transport_type':       forms.Select(),

            'notes': forms.Textarea(attrs={'rows': 3}),
            'route_geometry': forms.HiddenInput(),

            # hidden pre-fill fields
            'origin_crs':        forms.HiddenInput(),
            'destination_crs':   forms.HiddenInput(),
            'boarded_stop_crs':  forms.HiddenInput(),
            'boarded_stop_atco': forms.HiddenInput(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # everything optional
        for field in self.fields.values():
            field.required = False

        # detect transport type (POST > instance > initial)
        transport = (
            self.data.get("transport_type")
            or getattr(self.instance, "transport_type", None)
            or self.initial.get("transport_type")
        )

        if transport:
            transport = transport.lower()

        # ─────────────────────────────────────────────
        # BUS MODE
        # ─────────────────────────────────────────────
        if transport == "bus":

            # rename headcode → route number
            self.fields["headcode"].label = "Route number"
            self.fields["headcode"].widget.attrs["placeholder"] = "e.g. 50"

            # hide TRAIN fields
            self._hide_fields([
                "train_fleet_number",
                "train_type",
            ])

        # ─────────────────────────────────────────────
        # TRAIN MODE (default)
        # ─────────────────────────────────────────────
        else:
            self.fields["headcode"].label = "Headcode"
            self.fields["headcode"].widget.attrs["placeholder"] = "e.g. 2H41"

            # hide BUS fields
            self._hide_fields([
                "bus_fleet_number",
                "bus_registration",
                "bus_type",
                "bus_livery",
                "bus_livery_name",
            ])

    # helper
    def _hide_fields(self, field_names):
        for name in field_names:
            if name in self.fields:
                self.fields[name].widget = forms.HiddenInput()
                self.fields[name].required = False