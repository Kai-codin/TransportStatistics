import json
import logging
import os
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from .models import ImportJob, TripLog

logger = logging.getLogger(__name__)


# ============================================================================
# SCHEMA CONFIGURATION
# ============================================================================
# Centralized schema definitions with field mappings and format flags
# Field paths support dot notation for nested access (e.g., 'vehicle.vehicle_data.reg')
SCHEMAS = {
    'v3': {
        # De-obfuscated markers
        'markers': ['stations', 'fleetItem', 'traverseName'],
        
        'fields': {
            # Core structure
            'stops': ['stations'],
            
            # Stop-level fields
            'stop_name': ['berthName'],
            'from_time': ['fromTime'],
            'trace': ['traceToBerth'],
            'position': ['position'],
            'coordinates': ['position'],
            
            # Fleet / vehicle
            'fleet': ['fleetItem'],
            'unitReg': ['unitReg', 'fleetItemData.reg'],
            'unitName': ['unitName', 'fleetItemData.fleet_number', 'fleetItemData.fleet_code'],
            'fleetData': ['fleetItemData'],
            
            # Service info
            'service_name': ['traverseName'],
            'operator': ['agency'],
            'dataSources': ['dataSourcesId'],
            
            # Optional
            'node_platform': ['berthName'],
            'node_dispatch': ['fromTime'],
            
            # Service date
            'service_date': ['fromDate', 'createdAt'],
        },
        
        'flags': {
            'coord_order': 'lat_lon',
            'datetime_format': 'epoch',
            'date_format': None,
            'time_format': None,
        }
    },
    
    'v2': {
        'markers': ['excursion', 'runType', 'updatedAt', 'dataSourcesId'],
        
        'fields': {
            'stops': ['stops', 'stations', 'nodes'],
            'stop_name': ['excursionName', 'platformName', 'name', 'stop_name'],
            'from_time': ['fromTime', 'from_time', 'depart_at'],
            'trace': ['traceToBerth', 'trace'],
            'position': ['position'],
            'coordinates': ['coordinates', 'latlon'],
            'fleet': ['fleetItem', 'vehicle', 'equipment'],
            'unitReg': ['unitReg'],
            'unitName': ['unitName'],
            'fleetData': ['fleetItemData', 'equipmentData'],
            'service_name': ['excursionName', 'service', 'name'],
            'operator': ['undertaking', 'undertaking.name'],
            'dataSources': ['dataSources', 'dataSourcesId'],
            'node_platform': ['platformName'],
            'node_dispatch': ['dispatchTime', 'alightTime'],
            'service_date': ['dispatchDate'],
        },
        
        'flags': {
            'coord_order': 'lat_lon',
            'datetime_format': 'human',
            'date_format': 'human',
            'time_format': 'human',
        }
    },
    
    'v1': {
        'markers': ['id', 'vehicle', 'data_sources_id'],
        
        'fields': {
            'stops': ['stops'],
            'stop_name': ['stop_name'],
            'from_time': ['departure_time'],
            'trace': ['polyline_to_stop'],
            'position': ['coordinates'],
            'coordinates': ['coordinates'],
            'fleet': ['vehicle'],
            'unitReg': ['fleet_reg', 'vehicle.vehicle_data.reg'],
            'unitName': ['fleet_name', 'vehicle.vehicle_data.fleet_number', 'vehicle.vehicle_data.fleet_code'],
            'fleetData': ['vehicle_data', 'vehicle.vehicle_data'],
            'service_name': ['service_name'],
            'operator': ['operator'],
            'dataSources': ['data_sources_id'],
            'node_platform': ['stop_name'],
            'node_dispatch': ['departure_time'],
            'service_date': ['departure_date'],
        },
        
        'flags': {
            'coord_order': 'lon_lat',
            'datetime_format': 'iso',
            'date_format': 'iso',
            'time_format': 'iso',
        }
    }
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _trim_headcode(val):
    if not isinstance(val, str):
        return str(val)[:20]
    return val[:20]


def _get_nested(obj, path):
    """
    Get value from nested object using dot notation path.
    
    Examples:
        _get_nested({'a': {'b': {'c': 1}}}, 'a.b.c') -> 1
        _get_nested({'vehicle': {'vehicle_data': {'reg': 'ABC123'}}}, 'vehicle.vehicle_data.reg') -> 'ABC123'
    
    Args:
        obj: Dictionary object
        path: Dot-separated path string
    
    Returns:
        Value at path or None
    """
    if not isinstance(obj, dict):
        return None
    
    keys = path.split('.')
    current = obj
    
    for key in keys:
        if not isinstance(current, dict):
            return None
        
        # First try exact match
        if key in current:
            current = current[key]
            continue
        
        # Try case-insensitive prefix match for obfuscated keys
        key_lower = key.lower()
        found = False
        for k, v in current.items():
            if k.lower().startswith(key_lower) or key_lower in k.lower():
                current = v
                found = True
                break
        
        if not found:
            return None
    
    return current


def _get_any(obj, candidates):
    """
    Try several candidate keys/paths and return the first found value.
    Supports both simple keys and dot-notation nested paths.
    
    Args:
        obj: Dictionary object
        candidates: List of key strings or dot-notation paths
    
    Returns:
        First found value or None
    """
    if not isinstance(obj, dict):
        return None
    
    for path in candidates:
        if '.' in path:
            # Nested path
            val = _get_nested(obj, path)
            if val is not None:
                return val
        else:
            # Simple key - exact match
            if path in obj:
                return obj[path]
            
            # Prefix match for obfuscated keys
            path_lower = path.lower()
            for k, v in obj.items():
                if k.lower().startswith(path_lower):
                    return v
    
    return None


def _find_list_of_dicts(obj):
    if not isinstance(obj, dict):
        return None
    for v in obj.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    return None


def _normalize_coords(coords, coord_order='lat_lon'):
    """
    Normalize coordinates to [lon, lat] format.
    
    Args:
        coords: Input coordinates (string, dict, list, or tuple)
        coord_order: Either 'lat_lon' or 'lon_lat' to indicate input format
    
    Returns:
        [lon, lat] or None
    """
    if coords is None:
        return None

    if isinstance(coords, str) and ',' in coords:
        try:
            a, b = coords.split(',')
            a, b = float(a), float(b)
            if coord_order == 'lat_lon':
                return [b, a]  # input is lat,lon -> return lon,lat
            else:
                return [a, b]  # input is lon,lat -> return lon,lat
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
            
            if coord_order == 'lat_lon':
                return [b, a]  # input is [lat, lon] -> return [lon, lat]
            else:
                # For lon_lat, data is already in correct format
                return [a, b]  # input is [lon, lat] -> return [lon, lat]
        except Exception:
            return None

    return None


def _parse_timestamp(ts, datetime_format='epoch'):
    """
    Parse timestamp according to schema format specification.
    
    Args:
        ts: Timestamp value
        datetime_format: 'epoch', 'iso', or 'human'
    
    Returns:
        (date, time) tuple or (None, None)
    """
    if datetime_format == 'epoch':
        try:
            dt = datetime.fromtimestamp(int(ts))
            return dt.date(), dt.time()
        except Exception:
            pass
    
    if datetime_format == 'iso':
        if isinstance(ts, str):
            try:
                dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                return dt.date(), dt.time()
            except Exception:
                pass
    
    if datetime_format == 'human':
        if isinstance(ts, str):
            return parse_human_datetime(ts)
    
    # Fallback: try all formats
    if isinstance(ts, str) and any(c.isalpha() for c in ts):
        return parse_human_datetime(ts)
    
    try:
        dt = datetime.fromtimestamp(int(ts))
        return dt.date(), dt.time()
    except Exception:
        pass
    
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


# ============================================================================
# SCHEMA DETECTION AND EXTRACTION
# ============================================================================

def detect_schema(item):
    """Pick a schema version for an item by looking for marker keys."""
    if not isinstance(item, dict):
        return 'v1'
    keys = [k.lower() for k in item.keys()]
    
    # Check for V1 specific markers first (most specific)
    if 'data_sources_id' in keys or ('id' in keys and 'vehicle' in keys and 'departure_date' in keys):
        return 'v1'
    
    # Check other schemas
    for name, schema in SCHEMAS.items():
        if name == 'v1':  # Already checked above
            continue
        for marker in schema.get('markers', []):
            for k in keys:
                if k.startswith(marker.lower()):
                    return name
    
    # fallback
    return 'v1'


def get_stops(item, schema):
    """Return list of stop dicts for an item using schema hints."""
    # try explicit candidates
    stops = _get_any(item, schema['fields'].get('stops', []))
    if isinstance(stops, list):
        return stops

    # sometimes stops are nested in a single top-level key
    found = _find_list_of_dicts(item)
    if isinstance(found, list):
        return found

    return []


def get_stop_name(st, schema):
    return (
        _get_any(st, schema['fields'].get('stop_name', []))
        or st.get('stop_name')
        or st.get('name')
        or ''
    )


def detect_vehicle(item, schema, stops=None, transport_type=''):
    """Detect vehicle/equipment info. Search top-level, nested lists, and stops.
    Prefer vehicle_type/fleetNumber for trains; keep livery mapping consistent."""
    candidates = []
    top = _get_any(item, schema['fields'].get('fleet', []))
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
            vdata = _get_any(v, schema['fields'].get('fleetData', [])) or v.get('equipmentData') or v.get('fleetData') or v.get('vehicle_data') or {}
            # Heuristics: prefer items with vehicle_type or fleetNumber or unitName/unitReg
            has_vehicle_type = isinstance(vdata, dict) and (vdata.get('vehicle_type') or vdata.get('type'))
            has_fleetnum = bool(v.get('fleetNumber') or v.get('fleet_number') or v.get('fleet'))
            has_reg = bool(_get_any(v, schema['fields'].get('unitReg', [])) or v.get('unitReg') or v.get('vehicleRef'))

            if not (has_vehicle_type or has_fleetnum or has_reg):
                # keep searching
                continue

            vfleet = (
                _get_any(v, schema['fields'].get('unitName', []))
                or v.get('fleetNumber')
                or v.get('fleet_number')
                or v.get('fleet')
                or (vdata.get('fleet_number') if isinstance(vdata, dict) else None)
                or (vdata.get('fleet_code') if isinstance(vdata, dict) else None)
                or ''
            )

            vreg = (
                _get_any(v, schema['fields'].get('unitReg', []))
                or v.get('unitReg')
                or v.get('vehicleRef')
                or v.get('fleet_reg')
                or (vdata.get('reg') if isinstance(vdata, dict) else None)
                or ''
            )
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
                vtype_obj = vdata.get('vehicle_type')
                if isinstance(vtype_obj, dict):
                    vtype = vtype_obj.get('name') or ''
                else:
                    vtype = vdata.get('type') or ''
            
            # livery
            l = {}
            if isinstance(vdata, dict):
                l = vdata.get('livery') or {}
            vlivery = l.get('left') or l.get('colour') or ''
            vlivery_name = l.get('name') or ''
            return vfleet, vreg, vtype, vlivery, vlivery_name

    return '', '', '', '', ''


def extract_time_from_stop(st, schema):
    """Extract datetime from stop using schema-specific format hints."""
    datetime_format = schema['flags'].get('datetime_format', 'epoch')
    
    ts = _get_any(st, schema['fields'].get('from_time', []))

    if ts:
        if isinstance(ts, str):
            # ISO datetime
            if datetime_format == 'iso':
                try:
                    dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                    return dt.date(), dt.time()
                except Exception:
                    pass

            # Human readable
            if datetime_format == 'human' or any(c.isalpha() for c in ts):
                return parse_human_datetime(ts)

        return _parse_timestamp(ts, datetime_format)

    nd = _get_any(st, schema['fields'].get('node_dispatch', []))
    if nd and isinstance(nd, str):
        if datetime_format == 'iso':
            try:
                dt = datetime.strptime(nd, "%Y-%m-%d %H:%M:%S")
                return dt.date(), dt.time()
            except Exception:
                pass
        return parse_human_datetime(nd)

    return None, None


def extract_latlon_from_stop(st):
    """Detect separate lat/lng fields and return [lon, lat] or None."""
    if not isinstance(st, dict):
        return None
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
    """Extract trace/polyline coordinates using schema-specific coord order."""
    coord_order = schema['flags'].get('coord_order', 'lat_lon')
    
    trace = _get_any(st, schema['fields'].get('trace', []))
    if not trace:
        # sometimes trace is empty string
        return []
    if isinstance(trace, list):
        # list of pairs or strings
        coords = []
        for p in trace:
            c = _normalize_coords(p, coord_order)
            if c:
                coords.append(c)
        return coords
    if isinstance(trace, str):
        coords = []
        for pair in trace.split(';'):
            c = _normalize_coords(pair, coord_order)
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

        from django.utils.dateparse import parse_time

        for i, item in enumerate(data):
            try:
                schema_name = detect_schema(item)
                schema = SCHEMAS.get(schema_name, SCHEMAS['v1'])
                coord_order = schema['flags'].get('coord_order', 'lat_lon')
                date_format = schema['flags'].get('date_format', 'iso')

                stops = get_stops(item, schema)
                if not stops:
                    failed += 1
                    continue

                origin = get_stop_name(stops[0], schema)
                destination = get_stop_name(stops[-1], schema)

                # Operator (supports nested paths like 'operator.name')
                operator_raw = _get_any(item, schema['fields'].get('operator', [])) or ''

                if isinstance(operator_raw, dict):
                    operator_name = operator_raw.get('name') or ''
                else:
                    operator_name = str(operator_raw) if operator_raw else ''

                transport_ds = (
                    _get_any(item, schema['fields'].get('dataSources', []))
                    or ''
                )
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

                # Fallback: top-level service date
                if not service_date:
                    sd_val = _get_any(item, schema['fields'].get('service_date', []))

                    if isinstance(sd_val, str):
                        # ISO format
                        if date_format == 'iso':
                            try:
                                service_date = datetime.strptime(sd_val, "%Y-%m-%d").date()
                            except Exception:
                                pass
                        
                        # Human readable
                        if not service_date and (date_format == 'human' or any(c.isalpha() for c in sd_val)):
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
                        _get_any(st, schema['fields'].get('coordinates', []))
                        or _get_any(st, schema['fields'].get('position', []))
                        or st.get('latlon')
                    )
                    coords = _normalize_coords(coords_raw, coord_order)
                    if not coords:
                        coords = extract_latlon_from_stop(st)
                    full_locations.append({
                        'name': get_stop_name(st, schema),
                        'crs': st.get('crs') or '',
                        'tiploc': st.get('tiploc') or '',
                        'arrival': st.get('arrival_time') or st.get('arrival') or '',
                        'departure': st.get('departure_time') or st.get('departure') or _get_any(st, schema['fields'].get('node_dispatch', [])) or '',
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
                            c = _normalize_coords(p, coord_order)
                            if c:
                                route_coords.append(c)

                if not route_coords:
                    route_coords = [l['coordinates'] for l in full_locations if l['coordinates']]

                vfleet, vreg, vtype, vlivery, vlivery_name = detect_vehicle(item, schema, stops=stops, transport_type=transport_type)

                svc_head = _get_any(item, schema['fields'].get('service_name', [])) or ''

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