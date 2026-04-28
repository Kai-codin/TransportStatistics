import json
import logging
import os
import re
from datetime import datetime

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime, parse_time

from .models import ImportJob, TripLog

logger = logging.getLogger(__name__)


# ============================================================================
# SCHEMA CONFIGURATION
# ============================================================================
# Keep schema detection only for the parts that still genuinely vary by version.
# Field extraction is handled separately via canonical aliases so obfuscated V4
# keys do not require another round of hand-mapping.
SCHEMAS = {
    'v4': {
        'markers': ['ports', 'vehicle', 'leg_name', 'organisation'],
        'flags': {
            'coord_order': 'lat_lon',
        },
    },
    'v3': {
        'markers': ['stations', 'fleet_item', 'traverse_name'],
        'flags': {
            'coord_order': 'lat_lon',
        },
    },
    'v2': {
        'markers': ['excursion', 'run_type', 'updated_at', 'data_sources_id'],
        'flags': {
            'coord_order': 'auto',
        },
    },
    'v1': {
        'markers': ['id', 'vehicle', 'data_sources_id', 'departure_date'],
        'flags': {
            'coord_order': 'lon_lat',
        },
    },
}


FIELD_ALIASES = {
    'stops': ['ports', 'stops', 'stations', 'nodes'],
    'stop_name': ['stand_name', 'berth_name', 'platform_name', 'excursion_name', 'stop_name', 'name'],
    'departure_time': ['dispatch_time', 'from_time', 'departure_time', 'departure', 'depart_at'],
    'arrival_time': ['arrive_time', 'arrival_time', 'arrival', 'alight_time'],
    'trace': ['linestring_to_stand', 'trail_to_platform', 'trace_to_berth', 'polyline_to_stop', 'trace'],
    'position': ['pin', 'position', 'coordinates', 'latlon'],
    'coordinates': ['pin', 'coordinates', 'position', 'latlon'],
    'fleet': ['vehicle', 'fleet_item', 'equipment'],
    'unit_reg': [
        'allocation_reg',
        'unit_reg',
        'fleet_reg',
        'vehicle_ref',
        'vehicle.vehicle_data.reg',
        'fleet_item_data.reg',
        'equipment_data.reg',
    ],
    'unit_name': [
        'allocation_name',
        'unit_name',
        'fleet_name',
        'fleet_number',
        'fleet_code',
        'vehicle.vehicle_data.fleet_number',
        'vehicle.vehicle_data.fleet_code',
        'fleet_item_data.fleet_number',
        'fleet_item_data.fleet_code',
        'equipment_data.fleet_number',
        'equipment_data.fleet_code',
    ],
    'fleet_data': ['vehicle_data', 'vehicle.vehicle_data', 'fleet_item_data', 'equipment_data'],
    'service_name': ['leg_name', 'traverse_name', 'service_name', 'excursion_name', 'service', 'name'],
    'operator': ['organisation', 'agency', 'operator', 'undertaking', 'undertaking.name'],
    'data_sources': ['data_sources_id', 'data_sources'],
    'service_date': ['dispatch_date', 'from_date', 'departure_date', 'created_at'],
    'polyline': ['polyline'],
    'origin_departure': ['annotations.origin_departure'],
    'stop_code': ['stand_id', 'atco_code', 'stop_id', 'platform_id'],
    'stop_crs': ['crs'],
    'stop_tiploc': ['tiploc'],
    'vehicle_type': ['vehicle_type', 'type'],
    'livery': ['livery'],
    'livery_name': ['livery.name', 'name'],
}


CAMEL_BOUNDARY_RE_1 = re.compile(r'(.)([A-Z][a-z]+)')
CAMEL_BOUNDARY_RE_2 = re.compile(r'([a-z0-9])([A-Z])')
TRAILING_DIGIT_HEX_RE = re.compile(r'([A-Za-z])([0-9][0-9A-Fa-f]{5,7})$')
TRAILING_HEX_TOKEN_RE = re.compile(r'_[0-9a-f]{6,8}$')
NON_ALNUM_RE = re.compile(r'[^a-z0-9]+')
NUMERIC_RE = re.compile(r'^\d+(\.\d+)?$')


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _trim_headcode(val):
    if not isinstance(val, str):
        return str(val)[:20]
    return val[:20]

V4_SUFFIX_RE = re.compile(r'_[0-9A-Fa-f]{6,8}$')

def _canonicalize_key(key):
    if not isinstance(key, str):
        return ''

    key = key.strip()
    # Strip V4-style obfuscation suffix (e.g. PORTS_9DEA7E, LEG_NAME_C7909D)
    # Must happen before camelCase splitting so the suffix isn't mangled first.
    key = V4_SUFFIX_RE.sub('', key)

    key = CAMEL_BOUNDARY_RE_1.sub(r'\1_\2', key)
    key = CAMEL_BOUNDARY_RE_2.sub(r'\1_\2', key)
    key = TRAILING_DIGIT_HEX_RE.sub(r'\1_\2', key)
    key = NON_ALNUM_RE.sub('_', key.lower()).strip('_')
    key = TRAILING_HEX_TOKEN_RE.sub('', key)
    return re.sub(r'_+', '_', key)


def _lookup_key(obj, wanted):
    if not isinstance(obj, dict):
        return None

    if wanted in obj:
        return wanted

    target = _canonicalize_key(wanted)
    if not target:
        return None

    prefix_match = None
    for key in obj.keys():
        canonical = _canonicalize_key(key)
        if canonical == target:
            return key
        if canonical.startswith(f'{target}_'):
            continue
        if prefix_match is None and (canonical.startswith(target) or target.startswith(canonical)):
            prefix_match = key

    return prefix_match


def _get_nested(obj, path):
    if not isinstance(obj, dict):
        return None

    current = obj
    for segment in path.split('.'):
        actual_key = _lookup_key(current, segment)
        if actual_key is None:
            return None
        current = current.get(actual_key)
        if current is None:
            return None

    return current


def _get_any(obj, candidates):
    if not isinstance(obj, dict):
        return None

    for path in candidates:
        if '.' in path:
            value = _get_nested(obj, path)
        else:
            actual_key = _lookup_key(obj, path)
            value = obj.get(actual_key) if actual_key else None
        if value is not None:
            return value

    return None


def _find_list_of_dicts(obj, preferred_keys=None):
    if not isinstance(obj, dict):
        return None

    preferred_keys = {_canonicalize_key(key) for key in (preferred_keys or [])}
    fallback = None

    for key, value in obj.items():
        if not (isinstance(value, list) and value and isinstance(value[0], dict)):
            continue
        if _canonicalize_key(key) in preferred_keys:
            return value
        if fallback is None:
            fallback = value

    return fallback


def _normalize_coords(coords, coord_order='lat_lon'):
    if coords is None:
        return None

    def resolve_pair(a, b):
        if coord_order == 'auto':
            # UK-focused heuristic for mixed upstream exports:
            # latitudes are typically ~50-60, longitudes usually much smaller.
            if abs(a) >= 20 and abs(b) < 20:
                return [b, a]
            if abs(a) < 20 and abs(b) >= 20:
                return [a, b]
            return [a, b]
        return [b, a] if coord_order == 'lat_lon' else [a, b]

    if isinstance(coords, str) and ',' in coords:
        try:
            a, b = coords.split(',', 1)
            a, b = float(a.strip()), float(b.strip())
            return resolve_pair(a, b)
        except Exception:
            return None

    if isinstance(coords, dict):
        lat = _get_any(coords, ['lat', 'latitude', 'y'])
        lon = _get_any(coords, ['lon', 'lng', 'longitude', 'x'])
        try:
            return [float(lon), float(lat)]
        except Exception:
            return None

    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            a = float(coords[0])
            b = float(coords[1])
            return resolve_pair(a, b)
        except Exception:
            return None

    return None


def _parse_epoch(value):
    try:
        value = float(value)
    except Exception:
        return None, None

    if value > 10**12:
        value /= 1000

    try:
        dt = datetime.fromtimestamp(value)
    except Exception:
        return None, None

    return dt.date(), dt.time().replace(tzinfo=None)


def parse_human_datetime(s):
    """Parse strings like 'Wednesday, January 21st 2026 at 7:47 AM'."""
    if not s or not isinstance(s, str):
        return None, None

    try:
        from dateutil import parser as _dparser

        dt = _dparser.parse(s)
        return dt.date(), dt.time().replace(tzinfo=None)
    except Exception:
        pass

    s2 = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", s)
    for fmt in ("%A, %B %d %Y at %I:%M %p", "%B %d %Y at %I:%M %p"):
        try:
            dt = datetime.strptime(s2.split(', ', 1)[-1] if fmt.startswith("%B") else s2, fmt)
            return dt.date(), dt.time()
        except Exception:
            continue

    return None, None


def _parse_temporal_value(value):
    if value in (None, ''):
        return None, None

    if isinstance(value, datetime):
        return value.date(), value.time().replace(tzinfo=None)

    if isinstance(value, (int, float)):
        return _parse_epoch(value)

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None, None

        if NUMERIC_RE.match(raw):
            date_part, time_part = _parse_epoch(raw)
            if date_part or time_part:
                return date_part, time_part

        parsed_dt = parse_datetime(raw)
        if parsed_dt is None:
            try:
                parsed_dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            except Exception:
                parsed_dt = None
        if parsed_dt is not None:
            return parsed_dt.date(), parsed_dt.time().replace(tzinfo=None)

        parsed_date = parse_date(raw)
        if parsed_date is not None:
            return parsed_date, None

        parsed_time = parse_time(raw)
        if parsed_time is not None:
            return None, parsed_time

        if any(ch.isalpha() for ch in raw):
            return parse_human_datetime(raw)

    return None, None


# ============================================================================
# SCHEMA DETECTION AND EXTRACTION
# ============================================================================

def detect_schema(item):
    if not isinstance(item, dict):
        return 'v1'

    keys = {_canonicalize_key(k) for k in item.keys()}

    if {'departure_date', 'vehicle'}.issubset(keys):
        return 'v1'
    if 'ports' in keys or 'leg_name' in keys or 'organisation' in keys:
        return 'v4'
    if 'nodes' in keys or 'excursion_name' in keys or 'equipment' in keys:
        return 'v2'
    if 'stations' in keys or 'fleet_item' in keys or 'traverse_name' in keys:
        return 'v3'

    for name, schema in SCHEMAS.items():
        if name == 'v1':
            continue
        markers = {_canonicalize_key(marker) for marker in schema.get('markers', [])}
        if keys.intersection(markers):
            return name

    return 'v1'


def get_stops(item):
    stops = _get_any(item, FIELD_ALIASES['stops'])
    if isinstance(stops, list):
        return stops
    return _find_list_of_dicts(item, preferred_keys=FIELD_ALIASES['stops']) or []


def get_stop_name(stop):
    name = _get_any(stop, FIELD_ALIASES['stop_name'])
    if name:
        return str(name)

    for key, value in stop.items():
        if isinstance(value, str) and _canonicalize_key(key).endswith('name'):
            return value

    return ''


def detect_vehicle(item, stops=None):
    """Detect vehicle/equipment info across all supported payload styles."""
    candidates = []

    top = _get_any(item, FIELD_ALIASES['fleet'])
    if isinstance(top, list):
        candidates.append(top)

    found = _find_list_of_dicts(item, preferred_keys=FIELD_ALIASES['fleet'])
    if isinstance(found, list):
        candidates.append(found)

    if isinstance(stops, list):
        candidates.append(stops)

    for value in item.values() if isinstance(item, dict) else []:
        if isinstance(value, list) and value and isinstance(value[0], dict):
            candidates.append(value)

    for group in candidates:
        if not isinstance(group, list):
            continue

        for vehicle in group:
            if not isinstance(vehicle, dict):
                continue

            vdata = _get_any(vehicle, FIELD_ALIASES['fleet_data']) or {}
            if not isinstance(vdata, dict):
                vdata = {}

            vfleet = _get_any(vehicle, FIELD_ALIASES['unit_name'])
            if not vfleet:
                vfleet = _get_any(vdata, ['fleet_number', 'fleet_code', 'name', 'id'])

            vreg = _get_any(vehicle, FIELD_ALIASES['unit_reg'])
            if not vreg:
                vreg = _get_any(vdata, ['reg', 'registration', 'vehicle_ref'])

            vtype_obj = _get_any(vdata, FIELD_ALIASES['vehicle_type'])
            if isinstance(vtype_obj, dict):
                vtype = _get_any(vtype_obj, ['name']) or ''
            else:
                vtype = str(vtype_obj or '')

            livery = _get_any(vdata, FIELD_ALIASES['livery']) or {}
            if isinstance(livery, dict):
                vlivery = livery.get('left') or livery.get('colour') or ''
                vlivery_name = _get_any(livery, FIELD_ALIASES['livery_name']) or ''
            else:
                vlivery = ''
                vlivery_name = ''

            if any([vfleet, vreg, vtype, vlivery, vlivery_name]):
                return str(vfleet or ''), str(vreg or ''), str(vtype or ''), str(vlivery or ''), str(vlivery_name or '')

    return '', '', '', '', ''


def extract_stop_datetime(stop, aliases):
    value = _get_any(stop, aliases)
    return _parse_temporal_value(value)


def extract_latlon_from_stop(stop):
    if not isinstance(stop, dict):
        return None

    lat_key = None
    lon_key = None
    for key in stop.keys():
        canonical = _canonicalize_key(key)
        if canonical in {'lat', 'latitude', 'y'} or canonical.endswith('_lat'):
            lat_key = key
        if canonical in {'lon', 'lng', 'longitude', 'x'} or canonical.endswith('_lng') or canonical.endswith('_lon'):
            lon_key = key

    if lat_key and lon_key:
        try:
            return [float(stop[lon_key]), float(stop[lat_key])]
        except Exception:
            return None

    return None


def extract_trace_coords(stop, coord_order):
    trace = _get_any(stop, FIELD_ALIASES['trace'])
    if not trace:
        return []

    coords = []
    if isinstance(trace, list):
        for pair in trace:
            normalized = _normalize_coords(pair, coord_order)
            if normalized:
                coords.append(normalized)
        return coords

    if isinstance(trace, str):
        for pair in trace.split(';'):
            normalized = _normalize_coords(pair, coord_order)
            if normalized:
                coords.append(normalized)

    return coords


def map_transport_type(data_sources='', operator='', service_name='', fleet_name='', vehicle_type=''):
    values = ' '.join(
        str(value or '')
        for value in (data_sources, operator, service_name, fleet_name, vehicle_type)
    ).upper()

    if 'FERRY' in values:
        return TripLog.TRANSPORT_FERRY
    if 'TRAM' in values:
        return TripLog.TRANSPORT_TRAM
    if 'BODS' in values or 'BODSUK' in values:
        return TripLog.TRANSPORT_BUS
    if 'NETRAL' in values or 'RAIL' in values or 'TRAIN' in values:
        return TripLog.TRANSPORT_RAIL
    return ''


def _stringify_or_blank(value):
    if value in (None, ''):
        return ''
    return str(value)


# ============================================================================
# MAIN IMPORT FUNCTION
# ============================================================================

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

        for index, item in enumerate(data):
            try:
                schema_name = detect_schema(item)
                schema = SCHEMAS.get(schema_name, SCHEMAS['v1'])
                coord_order = schema['flags'].get('coord_order', 'lat_lon')

                stops = get_stops(item)
                if not stops:
                    failed += 1
                    continue

                origin_stop = stops[0]
                destination_stop = stops[-1]
                origin = get_stop_name(origin_stop)
                destination = get_stop_name(destination_stop)

                operator_raw = _get_any(item, FIELD_ALIASES['operator']) or ''
                if isinstance(operator_raw, dict):
                    operator_name = _stringify_or_blank(_get_any(operator_raw, ['name']))
                else:
                    operator_name = _stringify_or_blank(operator_raw)

                service_name = _stringify_or_blank(_get_any(item, FIELD_ALIASES['service_name']))
                data_sources = _stringify_or_blank(_get_any(item, FIELD_ALIASES['data_sources']))

                service_date = None
                scheduled_departure = None
                scheduled_arrival = None

                dep_date, dep_time = extract_stop_datetime(origin_stop, FIELD_ALIASES['departure_time'])
                if dep_time is None:
                    dep_date, dep_time = extract_stop_datetime(item, FIELD_ALIASES['origin_departure'])
                if dep_time:
                    scheduled_departure = dep_time
                if dep_date:
                    service_date = dep_date

                arr_date, arr_time = extract_stop_datetime(destination_stop, FIELD_ALIASES['arrival_time'])
                if arr_time is None:
                    arr_date, arr_time = extract_stop_datetime(destination_stop, FIELD_ALIASES['departure_time'])
                if arr_time:
                    scheduled_arrival = arr_time
                if service_date is None and arr_date:
                    service_date = arr_date

                if service_date is None:
                    top_level_date, _ = _parse_temporal_value(_get_any(item, FIELD_ALIASES['service_date']))
                    service_date = top_level_date

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

                full_locations = []
                for stop in stops:
                    coords_raw = (
                        _get_any(stop, FIELD_ALIASES['coordinates'])
                        or _get_any(stop, FIELD_ALIASES['position'])
                    )
                    coords = _normalize_coords(coords_raw, coord_order)
                    if not coords:
                        coords = extract_latlon_from_stop(stop)

                    full_locations.append({
                        'name': get_stop_name(stop),
                        'crs': _stringify_or_blank(_get_any(stop, FIELD_ALIASES['stop_crs'])),
                        'tiploc': _stringify_or_blank(_get_any(stop, FIELD_ALIASES['stop_tiploc'])),
                        'arrival': _stringify_or_blank(_get_any(stop, FIELD_ALIASES['arrival_time'])),
                        'departure': _stringify_or_blank(_get_any(stop, FIELD_ALIASES['departure_time'])),
                        'coordinates': coords,
                    })

                route_coords = []
                for stop in stops:
                    route_coords.extend(extract_trace_coords(stop, coord_order))

                if not route_coords:
                    polyline = _get_any(item, FIELD_ALIASES['polyline']) or []
                    for segment in polyline:
                        for point in segment:
                            normalized = _normalize_coords(point, coord_order)
                            if normalized:
                                route_coords.append(normalized)

                if not route_coords:
                    route_coords = [location['coordinates'] for location in full_locations if location['coordinates']]

                vfleet, vreg, vtype, vlivery, vlivery_name = detect_vehicle(item, stops=stops)
                transport_type = map_transport_type(
                    data_sources=data_sources,
                    operator=operator_name,
                    service_name=service_name,
                    fleet_name=vfleet,
                    vehicle_type=vtype,
                )

                if is_dup and policy == 'overwrite':
                    trip = existing_qs.first()
                else:
                    trip = TripLog(user=job.user)

                trip.headcode = _trim_headcode(service_name)
                trip.origin_name = origin
                trip.origin_crs = _stringify_or_blank(_get_any(origin_stop, FIELD_ALIASES['stop_crs']))
                trip.origin_tiploc = _stringify_or_blank(_get_any(origin_stop, FIELD_ALIASES['stop_tiploc']))
                trip.destination_name = destination
                trip.destination_crs = _stringify_or_blank(_get_any(destination_stop, FIELD_ALIASES['stop_crs']))
                trip.destination_tiploc = _stringify_or_blank(_get_any(destination_stop, FIELD_ALIASES['stop_tiploc']))
                trip.boarded_stop_name = origin
                trip.boarded_stop_atco = _stringify_or_blank(_get_any(origin_stop, FIELD_ALIASES['stop_code']))
                trip.operator = operator_name
                trip.transport_type = transport_type
                trip.service_date = service_date
                trip.scheduled_departure = scheduled_departure
                trip.scheduled_arrival = scheduled_arrival
                trip.full_locations = full_locations
                trip.route_geometry = route_coords
                trip.full_route_geometry = route_coords

                trip.train_type = vtype
                trip.train_fleet_number = vfleet

                trip.bus_fleet_number = vfleet
                trip.bus_registration = vreg
                trip.bus_type = vtype
                trip.bus_livery = vlivery
                trip.bus_livery_name = vlivery_name

                with transaction.atomic():
                    trip.save()

                inserted += 1

            except Exception as exc:
                failed += 1
                errors.append({'index': index, 'error': str(exc)})
                logger.exception("[import-job %s] error on item %s", job.pk, index)

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

        if inserted > 0:
            try:
                from django.core.management import call_command
                call_command(
                    'backfill_bustimes_service_id',
                    user=[job.user.pk],
                    update_all=True,
                )
                print(f"[import-job %s] backfill_bustimes_service_id completed", job.pk)
            except Exception as exc:
                print(f"[import-job %s] backfill_bustimes_service_id failed: %s", job.pk, exc)

    except Exception as exc:
        job.status = ImportJob.STATUS_FAILED
        job.completed_at = timezone.now()
        job.result_log = {'error': str(exc)}
        job.save()
        logger.exception("[import-job %s] FAILED", job.pk)
