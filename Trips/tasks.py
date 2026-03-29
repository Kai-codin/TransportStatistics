import json
import os
from django.utils import timezone
from django.db import transaction

from .models import ImportJob, TripLog


def _trim_headcode(val):
    if not isinstance(val, str):
        return str(val)[:20]
    return val[:20] if len(val) > 20 else val


def _normalize_coords(coords):
    """
    Always return coordinates in [lon, lat] format (GeoJSON standard).
    Input lists may arrive as [lat, lon] — detect and swap automatically.
    """
    if coords is None:
        return None

    # dict input — keys tell us exactly which is which
    if isinstance(coords, dict):
        lat = coords.get('lat') or coords.get('latitude') or coords.get('y')
        lon = coords.get('lon') or coords.get('lng') or coords.get('longitude') or coords.get('x')
        try:
            return [float(lon), float(lat)]
        except Exception:
            return None

    # list/tuple input — source data arrives as [lat, lon], need to detect and swap
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            a = float(coords[0])
            b = float(coords[1])
        except Exception:
            return None

        # Heuristic: a valid longitude must be in (-180, 180],
        # a valid latitude must be in [-90, 90].
        # If coords[0] looks like a latitude (|a| <= 90) and coords[1] looks
        # like a longitude (|b| > 90 OR |b| > |a| when both are small),
        # treat input as [lat, lon] and swap to [lon, lat].
        a_could_be_lat = abs(a) <= 90
        b_could_be_lat = abs(b) <= 90
        a_could_be_lon = abs(a) <= 180
        b_could_be_lon = abs(b) <= 180

        if a_could_be_lat and b_could_be_lon and not b_could_be_lat:
            # b is clearly a longitude (|b| > 90), so input is [lat, lon]
            return [b, a]

        if a_could_be_lat and b_could_be_lon:
            # Both values are within ±90 so we can't tell from range alone.
            # For UK/European data latitudes are typically > |longitude|,
            # so if a > |b| it's almost certainly [lat, lon] — swap.
            # If b > |a| it's probably already [lon, lat] — keep.
            if abs(a) > abs(b):
                return [b, a]   # [lat, lon] → swap
            else:
                return [a, b]   # already [lon, lat]

        # Fallback: treat as [lon, lat] (GeoJSON standard)
        return [a, b]

    return None

def run_import_job(job_id, policy='skip'):
    """Background import worker for an ImportJob.

    policy: 'skip' | 'import_all' | 'overwrite'
    """
    job = ImportJob.objects.filter(pk=job_id).first()
    if not job:
        return

    print(f"[import-job {job.pk}] starting, file={job.filepath}")
    job.status = ImportJob.STATUS_RUNNING
    job.started_at = timezone.now()
    job.save()

    inserted = 0
    duplicates = 0
    failed = 0
    errors = []

    try:
        if not os.path.exists(job.filepath):
            raise FileNotFoundError(f"Import file not found: {job.filepath}")

        with open(job.filepath, 'r', encoding='utf8') as fh:
            data = json.load(fh)

        total = len(data) if isinstance(data, list) else 0
        job.total = total
        job.save()

        from django.utils.dateparse import parse_date, parse_time

        for i, svc in enumerate(data):
            # debug info
            svc_id = ''
            try:
                svc_id = str(svc.get('id') or svc.get('service_id') or svc.get('service_name') or '')[:80]
            except Exception:
                pass
            print(f"[import-job {job.pk}] processing {i+1}/{total} id={svc_id}")

            try:
                stops = svc.get('stops', []) or []
                if not stops:
                    failed += 1
                    errors.append({'index': i, 'error': 'no stops'})
                    print(f"[import-job {job.pk}] item {i} has no stops; skipping")
                    continue

                origin = stops[0].get('stop_name') or stops[0].get('name') or ''
                destination = stops[-1].get('stop_name') or stops[-1].get('name') or ''

                departure = stops[0].get('departure_time') or stops[0].get('departure') or ''
                arrival = stops[-1].get('departure_time') or stops[-1].get('departure') or ''

                service_date = None
                scheduled_departure = None
                scheduled_arrival = None

                # parse departure (accept date-only values and common keys)
                try:
                    # allow date-only keys from stop or service
                    if not departure:
                        # try alternate keys
                        departure = st.get('departure_date') or svc.get('departure_date') or departure

                    if isinstance(departure, str) and 'T' in departure:
                        date_part, time_part = departure.split('T', 1)
                        service_date = parse_date(date_part)
                        scheduled_departure = parse_time(time_part)
                    elif isinstance(departure, str) and ' ' in departure:
                        date_part, time_part = departure.split(' ', 1)
                        service_date = parse_date(date_part)
                        scheduled_departure = parse_time(time_part)
                    elif isinstance(departure, str) and ':' in departure:
                        # time-only string
                        scheduled_departure = parse_time(departure)
                    elif isinstance(departure, str):
                        # date-only string like '2026-03-08' -> set time to 00:00
                        d = parse_date(departure)
                        if d:
                            service_date = d
                            scheduled_departure = parse_time('00:00')
                except Exception:
                    pass

                # parse arrival (accept date-only values and common keys)
                try:
                    if not arrival:
                        arrival = stops[-1].get('arrival_date') or svc.get('arrival_date') or arrival

                    if isinstance(arrival, str) and 'T' in arrival:
                        _, time_part2 = arrival.split('T', 1)
                        scheduled_arrival = parse_time(time_part2)
                    elif isinstance(arrival, str) and ' ' in arrival:
                        _, time_part2 = arrival.split(' ', 1)
                        scheduled_arrival = parse_time(time_part2)
                    elif isinstance(arrival, str) and ':' in arrival:
                        scheduled_arrival = parse_time(arrival)
                    elif isinstance(arrival, str):
                        # date-only string -> set time to 00:00
                        da = parse_date(arrival)
                        if da:
                            scheduled_arrival = parse_time('00:00')
                except Exception:
                    pass

                # duplicate detection
                existing_qs = TripLog.objects.filter(
                    user=job.user,
                    origin_name=origin,
                    destination_name=destination,
                    service_date=service_date,
                    scheduled_departure=scheduled_departure,
                )
                is_dup = existing_qs.exists()

                if is_dup and policy == 'skip':
                    duplicates += 1
                    print(f"[import-job {job.pk}] item {i} duplicate detected; skipping")
                    continue

                # build full_locations
                full_locations = []
                for st in stops:
                    coords_raw = st.get('coordinates') or st.get('latlon') or st.get('location') or None
                    coords = _normalize_coords(coords_raw)
                    full_locations.append({
                        'name': st.get('stop_name') or st.get('name') or '',
                        'crs': st.get('crs') or '',
                        'tiploc': st.get('tiploc') or '',
                        'arrival': st.get('arrival_time') or st.get('departure_time') or st.get('arrival') or '',
                        'departure': st.get('departure_time') or st.get('departure') or '',
                        'coordinates': coords,
                    })

                # build route geometry from polyline arrays if present
                route_coords = []
                poly_arr = svc.get('polyline_to_stop') or svc.get('polyline') or []
                if poly_arr and isinstance(poly_arr, list):
                    for segment in poly_arr:
                        if isinstance(segment, list):
                            # normalize any coordinate pairs inside segment
                            for pair in segment:
                                nc = _normalize_coords(pair)
                                if nc:
                                    route_coords.append(nc)

                if not route_coords:
                    for loc in full_locations:
                        c = loc.get('coordinates')
                        if c:
                            route_coords.append(c)

                # extract vehicle info (if present)
                veh = None
                try:
                    vehicles = svc.get('vehicle') or svc.get('vehicle_data') or []
                    if isinstance(vehicles, list) and vehicles:
                        veh = vehicles[0]
                    elif isinstance(vehicles, dict):
                        veh = vehicles
                except Exception:
                    veh = None

                vfleet = ''
                vreg = ''
                vtype = ''
                vlivery = ''
                vlivery_name = ''
                if veh:
                    try:
                        vfleet = veh.get('fleet_name') or (veh.get('vehicle_data') or {}).get('fleet_name') or ''
                    except Exception:
                        vfleet = ''
                    try:
                        vreg = veh.get('fleet_reg') or (veh.get('vehicle_data') or {}).get('reg') or ''
                    except Exception:
                        vreg = ''
                    try:
                        vtype = (veh.get('vehicle_data') or {}).get('vehicle_type', {})
                        if isinstance(vtype, dict):
                            vtype = vtype.get('name') or ''
                        else:
                            vtype = str(vtype)
                    except Exception:
                        vtype = ''
                    try:
                        l = (veh.get('vehicle_data') or {}).get('livery') or {}
                        vlivery = l.get('left') or l.get('colour') or l.get('hex') or ''
                        vlivery_name = l.get('name') or ''
                    except Exception:
                        vlivery = ''
                        vlivery_name = ''

                # create or update TripLog
                if is_dup and policy == 'overwrite':
                    trip = existing_qs.first()
                    svc_head = svc.get('service_name') or svc.get('service') or svc.get('trip') or svc.get('id') or ''
                    trip.headcode = _trim_headcode(svc_head)
                    trip.origin_name = origin
                    trip.destination_name = destination
                    trip.service_date = service_date
                    trip.scheduled_departure = scheduled_departure
                    trip.scheduled_arrival = scheduled_arrival
                    trip.full_locations = full_locations
                    trip.full_route_geometry = route_coords
                    trip.route_geometry = route_coords
                    # update vehicle fields
                    try:
                        trip.bus_fleet_number = vfleet or trip.bus_fleet_number
                        trip.bus_registration = vreg or trip.bus_registration
                        trip.bus_type = vtype or trip.bus_type
                        trip.bus_livery = vlivery or trip.bus_livery
                        trip.bus_livery_name = vlivery_name or trip.bus_livery_name
                    except Exception:
                        pass
                    with transaction.atomic():
                        trip.save()
                    inserted += 1
                    print(f"[import-job {job.pk}] item {i} overwritten existing trip id={trip.pk}")
                else:
                    svc_head = svc.get('service_name') or svc.get('service') or svc.get('trip') or svc.get('id') or ''
                    trip = TripLog(
                        user=job.user,
                        headcode=_trim_headcode(svc_head),
                        operator=svc.get('operator') or '',
                        service_date=service_date,
                        transport_type=svc.get('transport_type') or TripLog.TRANSPORT_BUS,
                        origin_name=origin,
                        destination_name=destination,
                        scheduled_departure=scheduled_departure,
                        scheduled_arrival=scheduled_arrival,
                        # vehicle fields
                        bus_fleet_number=vfleet,
                        bus_registration=vreg,
                        bus_type=vtype,
                        bus_livery=vlivery,
                        bus_livery_name=vlivery_name,
                        full_locations=full_locations,
                        full_route_geometry=route_coords,
                        route_geometry=route_coords,
                    )
                    with transaction.atomic():
                        trip.save()
                    inserted += 1
                    print(f"[import-job {job.pk}] item {i} created trip id={trip.pk}")

                # periodic save
                if (i + 1) % 10 == 0:
                    job.inserted = inserted
                    job.duplicates = duplicates
                    job.failed_count = failed
                    job.save()
                    print(f"[import-job {job.pk}] progress {i+1}/{total} inserted={inserted} dupes={duplicates} failed={failed}")

            except Exception as e:
                failed += 1
                # capture error and a small sample
                try:
                    sample = json.dumps(svc if isinstance(svc, dict) else {'value': str(svc)})[:800]
                except Exception:
                    sample = '<unserializable service>'
                errors.append({'index': i, 'error': str(e), 'sample': sample})
                print(f"[import-job {job.pk}] ERROR processing item {i}: {e}; sample={sample}")

        # final save
        job.inserted = inserted
        job.duplicates = duplicates
        job.failed_count = failed
        job.status = ImportJob.STATUS_COMPLETED
        job.completed_at = timezone.now()
        job.result_log = job.result_log or {}
        job.result_log.update({'inserted': inserted, 'duplicates': duplicates, 'failed': failed, 'errors': errors[:50]})
        job.save()
        print(f"[import-job {job.pk}] completed inserted={inserted} dupes={duplicates} failed={failed}")

    except Exception as exc:
        job.status = ImportJob.STATUS_FAILED
        job.completed_at = timezone.now()
        job.result_log = {'error': str(exc)}
        job.save()
        print(f"[import-job {job.pk}] FAILED: {exc}")
