from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.utils.dateparse import parse_time, parse_date

from .forms import TripLogForm


@login_required
def log_trip(request):
    """
    GET  — show pre-filled form (query params come from the map's ts:log event)
    POST — save and redirect back to the map

    Query params the map injects (all optional):
        headcode, date, scheduled_time,
        origin, origin_crs, origin_tiploc,
        destination, destination_crs, destination_tiploc,
        stop, stop_crs, stop_atco,
        operator, transport_type,
        vehicle   (bus: "fleet - REG", populated from the vehicle field)
    """
    if request.method == 'POST':
        form = TripLogForm(request.POST)
        if form.is_valid():
            trip = form.save(commit=False)
            trip.user = request.user
            trip.save()
            return redirect('home')
        # fall through to re-render with errors

    else:
        p = request.GET

        # Try to parse a vehicle string like "21425 - BV24 LSJ"
        vehicle_raw  = p.get('vehicle', '')
        bus_fleet    = ''
        bus_reg      = ''
        if ' - ' in vehicle_raw:
            parts    = vehicle_raw.split(' - ', 1)
            bus_fleet = parts[0].strip()
            bus_reg   = parts[1].strip()

        initial = {
            'headcode':           p.get('headcode', ''),
            'operator':           p.get('operator', ''),
            'service_date':       p.get('date', ''),
            'scheduled_departure': p.get('scheduled_time', ''),
            'transport_type':     p.get('transport_type', 'rail'),

            'origin_name':        p.get('origin', ''),
            'origin_crs':         p.get('origin_crs', ''),
            'origin_tiploc':      p.get('origin_tiploc', ''),

            'destination_name':   p.get('destination', ''),
            'destination_crs':    p.get('destination_crs', ''),
            'destination_tiploc': p.get('destination_tiploc', ''),

            'boarded_stop_name':  p.get('stop', ''),
            'boarded_stop_crs':   p.get('stop_crs', ''),
            'boarded_stop_atco':  p.get('stop_atco', ''),

            'bus_fleet_number':   bus_fleet,
            'bus_registration':   bus_reg,
        }
        form = TripLogForm(initial=initial)

    # Determine transport type so the template can show/hide vehicle sections
    transport_type = (
        request.POST.get('transport_type')
        or request.GET.get('transport_type', 'rail')
    )
    is_bus = transport_type in ('bus', 'tram', 'ferry')

    return render(request, 'log_trip.html', {
        'form':           form,
        'transport_type': transport_type,
        'is_bus':         is_bus,
        'is_rail':        not is_bus,
    })