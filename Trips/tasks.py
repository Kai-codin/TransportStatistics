import json
import logging
import os
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from .models import ImportJob, TripLog

logger = logging.getLogger(__name__)


# Schema registry: each schema lists candidate keys/prefixes for logical fields.
# Add new versions by appending a new key here with any custom prefixes.
SCHEMAS = {
    'v1': {
        'marker': ['service', 'stops', 'stations'],
        'stops': ['stops', 'stations', 'stations41477f'],
        'stop_name': ['stop_name', 'name', 'berthName', 'berthname', 'berth_name'],
        'from_time': ['fromTime', 'from_time', 'fromTime3f4c51'],
        'trace': ['traceToBerth', 'traceToBerth287925', 'trace_to_berth', 'trace'],
        'position': ['position', 'positionA7bb39', 'positionA7bb39', 'position_a'],
        'coordinates': ['coordinates', 'latlon', 'position'],
        'fleet': ['fleetItem', 'fleetItemB232a1', 'vehicle', 'vehicles'],
        'unitReg': ['unitReg', 'unitReg92b7f4'],
        'unitName': ['unitName', 'unitName99cb2e'],
        'fleetData': ['fleetItemData', 'fleetItemDataCad1db'],
        'service_name': ['service_name', 'service', 'trip', 'traverseName', 'traverseName4bc328'],
    },
    'v2': {
        'marker': ['excursion', 'runType', 'updatedAt', 'dataSourcesId'],
        'stops': ['stops', 'stations', 'stops_list', 'nodes', 'nodes016d3d'],
        'stop_name': ['excursionName', 'excursionName856488', 'platformName', 'platformName084055', 'name', 'stop_name'],
        'from_time': ['fromTime', 'from_time', 'depart_at'],
        'trace': ['traceToBerth', 'trace'],
        'position': ['position', 'positionA7bb39'],
        'coordinates': ['coordinates', 'latlon'],
        'fleet': ['fleetItem', 'fleetItemB232a1', 'vehicle', 'equipment', 'equipment738677'],
        'unitReg': ['unitReg'],
        'unitName': ['unitName'],
        'fleetData': ['fleetItemData', 'equipmentData78ca7f', 'equipmentData'],
        'service_name': ['excursionName', 'service', 'name'],
        'operator': ['undertaking', 'undertakingAec361'],
        'dataSources': ['dataSources', 'dataSourcesId1e5d2c'],
        'node_platform': ['platformName', 'platformName084055'],
        'node_dispatch': ['dispatchTime', 'dispatchTime285346', 'alightTime02c3d3'],
        'service_date': ['dispatchDate', 'dispatchDate5bacc7'],
    },
    'v3': {
        'marker': ['traverseName', 'traverseName4bc328'],
        'stops': ['stations', 'stations41477f'],
        'stop_name': ['traverseName', 'stop_name', 'berthName', 'berthName154523'],
        'from_time': ['fromTime', 'fromTime3f4c51'],
        'trace': ['traceToBerth', 'traceToBerth287925'],
        'position': ['position', 'positionA7bb39'],
        'coordinates': ['position', 'positionA7bb39', 'latlon'],
        'fleet': ['fleetItem', 'fleetItemB232a1'],
        'unitReg': ['unitReg', 'unitReg92b7f4'],
        'unitName': ['unitName', 'unitName99cb2e'],
        'fleetData': ['fleetItemData', 'fleetItemDataCad1db'],
        'service_name': ['traverseName', 'traverseName4bc328', 'service'],
    },
}


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


def _get_any(obj, candidates):
    """Try several candidate keys/prefixes and return the first found value."""
    if not isinstance(obj, dict):
        return None
    for key in candidates:
        # exact match
        if key in obj:
            return obj[key]
        # prefix match for obfuscated keys
        val = _get_key(obj, key)
        if val is not None:
            return val
    return None


def _find_list_of_dicts(obj):
    if not isinstance(obj, dict):
        return None
    for v in obj.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    return None


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
        # Try epoch seconds
        dt = datetime.fromtimestamp(int(ts))
        return dt.date(), dt.time()
    except Exception:
        # Try human readable parse as fallback
        return parse_human_datetime(ts)


def detect_schema(item):
    """Pick a schema version for an item by looking for marker keys."""
    if not isinstance(item, dict):
        return 'v1'
    keys = [k.lower() for k in item.keys()]
    for name, schema in SCHEMAS.items():
        for marker in schema.get('marker', []):
            for k in keys:
                if k.startswith(marker.lower()):
                    return name
    # fallback
    return 'v1'


def get_stops(item, schema):
    """Return list of stop dicts for an item using schema hints."""
    # try explicit candidates
    stops = _get_any(item, schema.get('stops', []))
    if isinstance(stops, list):
        return stops

    # sometimes stops are nested in a single top-level key
    found = _find_list_of_dicts(item)
    if isinstance(found, list):
        return found

    return []


def get_stop_name(st, schema):
    return (
        _get_any(st, schema.get('stop_name', []))
        or st.get('stop_name')
        or st.get('name')
        or ''
    )


def detect_vehicle(item, schema, stops=None, transport_type=''):
    """Detect vehicle/equipment info. Search top-level, nested lists, and stops.
    Prefer vehicle_type/fleetNumber for trains; keep livery mapping consistent."""
    candidates = []
    top = _get_any(item, schema.get('fleet', []))
    if isinstance(top, list):
        candidates.append(top)
    found = _find_list_of_dicts(item)
    if isinstance(found, list):
        candidates.append(found)
    if isinstance(stops, list):
        candidates.append(stops)

    # Also consider any dict values that are lists of dicts
    for v in item.values() if isinstance(item, dict) else []:
        if isinstance(v, list) and v and isinstance(v[0], dict):
            candidates.append(v)

    for lst in candidates:
        if not isinstance(lst, list):
            continue
        for v in lst:
            if not isinstance(v, dict):
                continue
            # Try known schema fleetData locations
            vdata = _get_any(v, schema.get('fleetData', [])) or v.get('equipmentData') or v.get('fleetData') or v.get('vehicle_data') or {}
            # Heuristics: prefer items with vehicle_type or fleetNumber or unitName/unitReg
            has_vehicle_type = isinstance(vdata, dict) and (vdata.get('vehicle_type') or vdata.get('type'))
            has_fleetnum = bool(v.get('fleetNumber') or v.get('fleet_number') or v.get('fleet'))
            has_reg = bool(_get_any(v, schema.get('unitReg', [])) or v.get('unitReg') or v.get('vehicleRef'))

            if not (has_vehicle_type or has_fleetnum or has_reg):
                # keep searching
                continue

            vfleet = _get_any(v, schema.get('unitName', [])) or v.get('fleetNumber') or v.get('fleet') or ''
            vreg = _get_any(v, schema.get('unitReg', [])) or v.get('unitReg') or v.get('vehicleRef') or ''
            # For rail, broaden heuristics to find train fleet numbers / ids
            if transport_type == TripLog.TRANSPORT_RAIL and (not vfleet or not vreg):
                # look for fleet-like keys in v and vdata
                import re
                def find_fleet_candidate(d):
                    for kk, vv in (d.items() if isinstance(d, dict) else []):
                        kkl = kk.lower()
                        if re.search(r'fleet|unit|vehicle|train', kkl) and isinstance(vv, (str, int)):
                            s = str(vv)
                            if len(s) > 0 and len(s) < 40:
                                return s
                    return None

                if not vfleet:
                    c = find_fleet_candidate(v) or find_fleet_candidate(vdata)
                    if c:
                        vfleet = c
                if not vreg:
                    # prefer explicit reg-like fields
                    for cand in ('registration','reg','vehicle_ref','vehicleRef','unitRef'):
                        if cand in v:
                            vreg = str(v.get(cand))
                            break
                    if not vreg:
                        c2 = find_fleet_candidate(vdata) or find_fleet_candidate(v)
                        if c2:
                            vreg = c2
            vtype = ''
            if isinstance(vdata, dict):
                vtype = (vdata.get('vehicle_type') or {}).get('name') or vdata.get('type') or ''
            # livery
            l = {}
            if isinstance(vdata, dict):
                l = vdata.get('livery') or {}
            vlivery = l.get('left') or l.get('colour') or ''
            vlivery_name = l.get('name') or ''
            return vfleet, vreg, vtype, vlivery, vlivery_name

    return '', '', '', '', ''


def extract_time_from_stop(st, schema):
    # Try schema-specified from_time
    ts = _get_any(st, schema.get('from_time', []))
    if ts:
        # if string like 'Wednesday, ...' parse human readable
        if isinstance(ts, str) and any(c.isalpha() for c in ts):
            return parse_human_datetime(ts)
        return _parse_timestamp(ts)

    # Try node dispatch candidates (human-readable)
    nd = _get_any(st, schema.get('node_dispatch', []))
    if nd and isinstance(nd, str):
        return parse_human_datetime(nd)

    # fallback to known fields
    if st.get('fromTime'):
        return _parse_timestamp(st.get('fromTime'))
    if st.get('dispatchTime') and isinstance(st.get('dispatchTime'), str):
        return parse_human_datetime(st.get('dispatchTime'))
    return None, None


def parse_human_datetime(s):
    """Parse strings like 'Wednesday, January 21st 2026 at 7:47 AM'.
    Returns (date, time) or (None, None).
    """
    if not s or not isinstance(s, str):
        return None, None
    # try dateutil if available
    try:
        from dateutil import parser as _dparser
        dt = _dparser.parse(s)
        return dt.date(), dt.time()
    except Exception:
        pass

    # remove ordinal suffixes: 1st, 2nd, 3rd, 4th
    import re
    s2 = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", s)
    try:
        # Expected format after cleaning: 'Wednesday, January 21 2026 at 7:47 AM'
        dt = datetime.strptime(s2, "%A, %B %d %Y at %I:%M %p")
        return dt.date(), dt.time()
    except Exception:
        # Try without weekday
        try:
            s3 = s2.split(', ', 1)[-1]
            dt = datetime.strptime(s3, "%B %d %Y at %I:%M %p")
            return dt.date(), dt.time()
        except Exception:
            return None, None


def extract_latlon_from_stop(st):
    """Detect separate lat/lng fields and return [lon, lat] or None."""
    if not isinstance(st, dict):
        return None
    import re
    lat_key = None
    lon_key = None
    # Prefer keys that explicitly end with 'lat' / 'lng' / 'lon' or contain '_lat'/'_lng'
    keys = list(st.keys())
    for k in keys:
        kl = k.lower()
        if kl.endswith('lat') or '_lat' in kl or kl.endswith('.lat'):
            lat_key = k
            break
    for k in keys:
        kl = k.lower()
        if kl.endswith('lng') or kl.endswith('lon') or '_lng' in kl or '_lon' in kl or kl.endswith('.lng'):
            lon_key = k
            break
    # Fallback: loose match (legacy)
    if not lat_key or not lon_key:
        for k in keys:
            kl = k.lower()
            if 'lat' in kl and not lat_key:
                lat_key = k
            if ('lng' in kl or 'lon' in kl) and not lon_key:
                lon_key = k
    if lat_key and lon_key:
        try:
            lat = float(st.get(lat_key))
            lon = float(st.get(lon_key))
            return [lon, lat]
        except Exception:
            return None
    return None


def extract_trace_coords(st, schema):
    trace = _get_any(st, schema.get('trace', []))
    if not trace:
        # sometimes trace is empty string
        return []
    if isinstance(trace, list):
        # list of pairs or strings
        coords = []
        for p in trace:
            c = _normalize_coords(p)
            if c:
                coords.append(c)
        return coords
    if isinstance(trace, str):
        coords = []
        for pair in trace.split(';'):
            c = _normalize_coords(pair)
            if c:
                coords.append(c)
        return coords
    return []


def map_transport_type(ds):
    if not ds:
        return ''
    s = str(ds).upper()
    if 'BODS' in s or 'BODSUK' in s:
        return TripLog.TRANSPORT_BUS
    if 'NETRAL' in s or 'RAIL' in s or 'TRAIN' in s:
        return TripLog.TRANSPORT_RAIL
    return ''


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

        for i, item in enumerate(data):
            try:
                schema_name = detect_schema(item)
                schema = SCHEMAS.get(schema_name, SCHEMAS['v1'])

                stops = get_stops(item, schema)
                if not stops:
                    failed += 1
                    continue

                origin = get_stop_name(stops[0], schema)
                destination = get_stop_name(stops[-1], schema)

                # Operator and transport type (schema-driven)
                operator_name = _get_any(item, schema.get('operator', [])) or item.get('agency8e0347') or ''
                transport_ds = _get_any(item, schema.get('dataSources', [])) or ''
                transport_type = map_transport_type(transport_ds)

                # Time extraction
                service_date = None
                scheduled_departure = None
                scheduled_arrival = None

                sd_date, sd_time = extract_time_from_stop(stops[0], schema)
                if sd_time:
                    service_date = sd_date
                    scheduled_departure = sd_time

                sa_date, sa_time = extract_time_from_stop(stops[-1], schema)
                if sa_time:
                    scheduled_arrival = sa_time

                if not scheduled_departure:
                    dep = stops[0].get('departure_time') or stops[0].get('departure')
                    if isinstance(dep, str) and ':' in dep:
                        scheduled_departure = parse_time(dep)

                if not scheduled_arrival:
                    arr = stops[-1].get('departure_time') or stops[-1].get('departure')
                    if isinstance(arr, str) and ':' in arr:
                        scheduled_arrival = parse_time(arr)

                # Fallback: top-level service date (e.g. dispatchDate for v2)
                if not service_date:
                    sd_val = _get_any(item, schema.get('service_date', []))
                    if isinstance(sd_val, str):
                        sd_parsed_date, _ = parse_human_datetime(sd_val)
                        if sd_parsed_date:
                            service_date = sd_parsed_date

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

                # Locations
                full_locations = []
                for st in stops:
                    coords_raw = (
                        _get_any(st, schema.get('coordinates', []))
                        or _get_any(st, schema.get('position', []))
                        or st.get('latlon')
                    )
                    coords = _normalize_coords(coords_raw)
                    if not coords:
                        coords = extract_latlon_from_stop(st)
                    full_locations.append({
                        'name': get_stop_name(st, schema),
                        'crs': st.get('crs') or '',
                        'tiploc': st.get('tiploc') or '',
                        'arrival': st.get('arrival_time') or st.get('arrival') or '',
                        'departure': st.get('departure_time') or st.get('departure') or _get_any(st, schema.get('node_dispatch', [])) or '',
                        'coordinates': coords,
                    })

                # Route geometry
                route_coords = []
                for st in stops:
                    route_coords.extend(extract_trace_coords(st, schema))

                if not route_coords:
                    poly = item.get('polyline') or []
                    for seg in poly:
                        for p in seg:
                            c = _normalize_coords(p)
                            if c:
                                route_coords.append(c)

                if not route_coords:
                    route_coords = [l['coordinates'] for l in full_locations if l['coordinates']]

                vfleet, vreg, vtype, vlivery, vlivery_name = detect_vehicle(item, schema, stops=stops, transport_type=transport_type)

                svc_head = (
                    _get_any(item, schema.get('service_name', []))
                    or item.get('service_name')
                    or item.get('service')
                    or item.get('trip')
                    or ''
                )

                if is_dup and policy == 'overwrite':
                    trip = existing_qs.first()
                else:
                    trip = TripLog(user=job.user)

                trip.headcode = _trim_headcode(svc_head)
                trip.origin_name = origin
                trip.destination_name = destination
                trip.operator = operator_name or ''
                trip.transport_type = transport_type or ''
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