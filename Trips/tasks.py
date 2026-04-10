import json
import logging
import os
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from .models import ImportJob, TripLog

logger = logging.getLogger(__name__)


# -------------------------
# Helpers
# -------------------------

def _trim_headcode(val):
    if not isinstance(val, str):
        return str(val)[:20]
    return val[:20]


def _get_key(obj, base):
    """Case-insensitive prefix match for obfuscated keys."""
    if not isinstance(obj, dict):
        return None
    base = base.lower()
    for k, v in obj.items():
        if k.lower().startswith(base):
            return v
    return None


def _get_all_keys(obj, base):
    if not isinstance(obj, dict):
        return []
    base = base.lower()
    return [v for k, v in obj.items() if k.lower().startswith(base)]


def _find_list_of_dicts(obj):
    """Find first list of dicts inside object."""
    if not isinstance(obj, dict):
        return None
    for v in obj.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    return None


def _detect_stops(svc):
    """Schema-agnostic stop detection."""
    # Try known prefix first
    stops = svc.get('stops') or _get_key(svc, 'stations')
    if stops:
        return stops

    # Fallback: detect by structure
    candidates = _find_list_of_dicts(svc)
    if not candidates:
        return []

    for item in candidates:
        keys = [k.lower() for k in item.keys()]
        if any("berth" in k or "name" in k for k in keys):
            return candidates

    return []


def _normalize_coords(coords):
    if coords is None:
        return None

    if isinstance(coords, str) and ',' in coords:
        try:
            lat, lon = coords.split(',')
            return [float(lon), float(lat)]
        except Exception:
            return None

    if isinstance(coords, dict):
        lat = coords.get('lat') or coords.get('latitude') or coords.get('y')
        lon = coords.get('lon') or coords.get('lng') or coords.get('longitude') or coords.get('x')
        try:
            return [float(lon), float(lat)]
        except Exception:
            return None

    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            a = float(coords[0])
            b = float(coords[1])
            return [b, a] if abs(a) <= 90 else [a, b]
        except Exception:
            return None

    return None


def _parse_timestamp(ts):
    try:
        dt = datetime.fromtimestamp(ts)
        return dt.date(), dt.time()
    except Exception:
        return None, None


def _get_name(st):
    return (
        st.get('stop_name')
        or st.get('name')
        or _get_key(st, 'berthName')
        or ''
    )


def _detect_vehicle(svc):
    """Schema-agnostic vehicle detection."""
    vehicles = svc.get('vehicle') or _get_key(svc, 'fleetItem')

    if not vehicles:
        vehicles = _find_list_of_dicts(svc)

    if not isinstance(vehicles, list) or not vehicles:
        return {}, {}, {}

    v = vehicles[0]

    vreg = _get_key(v, 'unitReg') or ''
    vfleet = _get_key(v, 'unitName') or ''

    vdata = (
        _get_key(v, 'fleetItemData')
        or v.get('vehicle_data')
        or {}
    )

    vtype = (vdata.get('vehicle_type') or {}).get('name', '')

    l = vdata.get('livery') or {}
    vlivery = l.get('left') or l.get('colour') or ''
    vlivery_name = l.get('name') or ''

    return vfleet, vreg, vtype, vlivery, vlivery_name


# -------------------------
# Main job
# -------------------------

def run_import_job(job_id, policy='skip'):
    job = ImportJob.objects.filter(pk=job_id).first()
    if not job:
        return

    logger.info("[import-job %s] starting", job.pk)

    job.status = ImportJob.STATUS_RUNNING
    job.started_at = timezone.now()
    job.save()

    inserted = 0
    duplicates = 0
    failed = 0
    errors = []

    try:
        if not os.path.exists(job.filepath):
            raise FileNotFoundError(job.filepath)

        with open(job.filepath, 'r', encoding='utf8') as fh:
            data = json.load(fh)

        total = len(data) if isinstance(data, list) else 0
        job.total = total
        job.save()

        from django.utils.dateparse import parse_time

        for i, svc in enumerate(data):
            try:
                # -------------------------
                # Stops
                # -------------------------
                stops = _detect_stops(svc)
                if not stops:
                    failed += 1
                    continue

                origin = _get_name(stops[0])
                destination = _get_name(stops[-1])

                # -------------------------
                # Time
                # -------------------------
                service_date = None
                scheduled_departure = None
                scheduled_arrival = None

                ts = _get_key(stops[0], 'fromTime')
                if ts:
                    service_date, scheduled_departure = _parse_timestamp(ts)

                ts_arr = _get_key(stops[-1], 'fromTime')
                if ts_arr:
                    _, scheduled_arrival = _parse_timestamp(ts_arr)

                if not scheduled_departure:
                    dep = stops[0].get('departure_time') or stops[0].get('departure')
                    if isinstance(dep, str) and ':' in dep:
                        scheduled_departure = parse_time(dep)

                if not scheduled_arrival:
                    arr = stops[-1].get('departure_time') or stops[-1].get('departure')
                    if isinstance(arr, str) and ':' in arr:
                        scheduled_arrival = parse_time(arr)

                # -------------------------
                # Duplicate check
                # -------------------------
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
                    continue

                # -------------------------
                # Locations
                # -------------------------
                full_locations = []

                for st in stops:
                    coords_raw = (
                        st.get('coordinates')
                        or _get_key(st, 'position')
                        or st.get('latlon')
                    )

                    coords = _normalize_coords(coords_raw)

                    full_locations.append({
                        'name': _get_name(st),
                        'crs': st.get('crs') or '',
                        'tiploc': st.get('tiploc') or '',
                        'arrival': st.get('arrival_time') or '',
                        'departure': st.get('departure_time') or '',
                        'coordinates': coords,
                    })

                # -------------------------
                # Route geometry
                # -------------------------
                route_coords = []

                for st in stops:
                    trace = _get_key(st, 'traceToBerth')
                    if trace:
                        for pair in trace.split(';'):
                            c = _normalize_coords(pair)
                            if c:
                                route_coords.append(c)

                if not route_coords:
                    poly = svc.get('polyline') or []
                    for seg in poly:
                        for p in seg:
                            c = _normalize_coords(p)
                            if c:
                                route_coords.append(c)

                if not route_coords:
                    route_coords = [l['coordinates'] for l in full_locations if l['coordinates']]

                # -------------------------
                # Vehicle
                # -------------------------
                vfleet, vreg, vtype, vlivery, vlivery_name = _detect_vehicle(svc)

                # -------------------------
                # Headcode
                # -------------------------
                svc_head = (
                    svc.get('service_name')
                    or svc.get('service')
                    or svc.get('trip')
                    or _get_key(svc, 'traverseName')
                    or ''
                )

                # -------------------------
                # Save
                # -------------------------
                if is_dup and policy == 'overwrite':
                    trip = existing_qs.first()
                else:
                    trip = TripLog(user=job.user)

                trip.headcode = _trim_headcode(svc_head)
                trip.origin_name = origin
                trip.destination_name = destination
                trip.service_date = service_date
                trip.scheduled_departure = scheduled_departure
                trip.scheduled_arrival = scheduled_arrival
                trip.full_locations = full_locations
                trip.route_geometry = route_coords
                trip.full_route_geometry = route_coords

                trip.bus_fleet_number = vfleet
                trip.bus_registration = vreg
                trip.bus_type = vtype
                trip.bus_livery = vlivery
                trip.bus_livery_name = vlivery_name

                with transaction.atomic():
                    trip.save()

                inserted += 1

            except Exception as e:
                failed += 1
                errors.append({'index': i, 'error': str(e)})
                logger.exception("[import-job %s] error on item %s", job.pk, i)

        job.inserted = inserted
        job.duplicates = duplicates
        job.failed_count = failed
        job.status = ImportJob.STATUS_COMPLETED
        job.completed_at = timezone.now()
        job.result_log = {
            'inserted': inserted,
            'duplicates': duplicates,
            'failed': failed,
            'errors': errors[:50],
        }
        job.save()

    except Exception as exc:
        job.status = ImportJob.STATUS_FAILED
        job.completed_at = timezone.now()
        job.result_log = {'error': str(exc)}
        job.save()
        logger.exception("[import-job %s] FAILED", job.pk)