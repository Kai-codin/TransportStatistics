from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.db.models import Q
from Stops.models import Stop, StopType

import csv
import io
import urllib.request
from datetime import datetime

# try to import pyproj for Easting/Northing -> lat/lon conversion
try:
    from pyproj import Transformer
    _transformer = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
except Exception:
    _transformer = None
from django.utils import timezone as dj_timezone


def parse_float(value):
    try:
        return float(value) if value not in (None, '') else None
    except Exception:
        return None


def parse_datetime(value):
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        # Handle trailing Z
        if value.endswith('Z'):
            value = value[:-1] + '+00:00'
        dt = datetime.fromisoformat(value)
    except Exception:
        try:
            # fallback: parse date only
            dt = datetime.strptime(value, '%Y-%m-%d')
        except Exception:
            try:
                dt = datetime.strptime(value, '%Y-%m-%d %H:%M:%S')
            except Exception:
                return None

    # Ensure datetime is timezone-aware when Django timezone support is active
    try:
        if dj_timezone.is_naive(dt):
            dt = dj_timezone.make_aware(dt, timezone=dj_timezone.get_current_timezone())
    except Exception:
        pass

    return dt

class Command(BaseCommand):
    help = 'Download NaPTAN CSV and import bus stops into the Stops app'

    def add_arguments(self, parser):
        parser.add_argument('--url', type=str, help='CSV URL', default='https://beta-naptan.dft.gov.uk/Download/National/csv')
        parser.add_argument('--file', type=str, help='Local CSV file path to import (overrides --url)')
        parser.add_argument('--batch-size', type=int, help='Number of rows to process per DB batch', default=2000)

    def handle(self, *args, **options):
        file_path = options.get('file')
        url = options['url']
        batch_size = int(options.get('batch_size') or 2000)
        # Cache StopType objects by code to avoid repeated DB hits
        stop_type_cache = {st.code: st for st in StopType.objects.all() if st.code}

        self.stdout.write(f'Cached {len(stop_type_cache)} StopType entries')

        created = 0
        updated = 0
        skipped = 0
        total_rows = 0

        def ensure_stoptype(code, parent_code=None):
            if not code:
                return None
            st = stop_type_cache.get(code)
            if st:
                return st
            st, created_flag = StopType.objects.get_or_create(code=code, defaults={'name': code})
            stop_type_cache[code] = st
            self.stdout.write(f'Created StopType {code}')
            # if parent provided and st.sub_of is not set
            if parent_code:
                parent = stop_type_cache.get(parent_code)
                if parent and st.sub_of_id != parent.id:
                    st.sub_of = parent
                    st.save()
            return st

        def process_batch(batch_rows):
            nonlocal created, updated, skipped
            nonlocal total_rows

            self.stdout.write(f'Processing batch of {len(batch_rows)} rows...')

            # gather keys
            atco_set = set()
            naptan_set = set()
            tiploc_set = set()
            for r in batch_rows:
                if r.get('ATCOCode'):
                    atco_set.add(r.get('ATCOCode'))
                if r.get('NaptanCode'):
                    naptan_set.add(r.get('NaptanCode'))
                if r.get('PlateCode'):
                    tiploc_set.add(r.get('PlateCode'))

            # bulk fetch existing stops
            existing_q = Q()
            if atco_set:
                existing_q |= Q(atco_code__in=atco_set)
            if naptan_set:
                existing_q |= Q(naptan_code__in=naptan_set)
            if tiploc_set:
                existing_q |= Q(tiploc__in=tiploc_set)

            existing_map = {}
            if existing_q:
                for s in Stop.objects.filter(existing_q):
                    if s.atco_code:
                        existing_map[('atco', s.atco_code)] = s
                    if s.naptan_code:
                        existing_map[('naptan', s.naptan_code)] = s
                    if s.tiploc:
                        existing_map[('tiploc', s.tiploc)] = s

            to_create = []
            to_update = []

            now = timezone.now()

            for r in batch_rows:
                try:
                    if r.get('CommonName'):
                        stop_name = r.get('CommonName').strip()
                    elif r.get('name'):
                        stop_name = r.get('name').strip()
                    else:
                        stop_name = None

                    if r.get('Indicator'):
                        stop_name += ' (' + r.get('Indicator').strip() + ')'

                    name = stop_name
                    atco = r.get('ATCOCode') or None
                    naptan = r.get('NaptanCode') or None
                    plate = r.get('PlateCode') or None
                    crs = r.get('CRS') or r.get('CleardownCode') or None

                    stop_type_code = (r.get('StopType') or None)
                    bus_type_code = (r.get('BusStopType') or None)

                    parent_type = ensure_stoptype(stop_type_code) if stop_type_code else None
                    if bus_type_code:
                        bus_type = ensure_stoptype(bus_type_code, parent_code=stop_type_code)

                    bearing = parse_float(r.get('Bearing'))
                    lat = parse_float(r.get('Latitude'))
                    lon = parse_float(r.get('Longitude'))

                    # if lat/lon missing, try to convert from Easting/Northing
                    if (lat is None or lon is None) and r.get('Easting') and r.get('Northing'):
                        try:
                            easting = parse_float(r.get('Easting'))
                            northing = parse_float(r.get('Northing'))
                            if easting is not None and northing is not None and _transformer is not None:
                                # pyproj transformer returns (lon, lat)
                                lon_conv, lat_conv = _transformer.transform(easting, northing)
                                lat = lat or lat_conv
                                lon = lon or lon_conv
                            elif _transformer is None:
                                self.stdout.write('pyproj not installed; cannot convert Easting/Northing to lat/lon')
                        except Exception as e:
                            self.stderr.write(f'Failed converting Easting/Northing: {e}')

                    # Skip rows that don't have coordinates - our model requires lat/lon
                    if lat is None or lon is None:
                        skipped += 1
                        self.stdout.write(f"Skipping row without lat/lon (ATCO={atco} Naptan={naptan} tiploc={plate})")
                        continue

                    # Skip rows without a CommonName
                    common_name = (r.get('CommonName') or '').strip()
                    if not common_name:
                        skipped += 1
                        self.stdout.write(f"Skipping row with no CommonName (ATCO={atco} Naptan={naptan} tiploc={plate})")
                        continue

                    # Skip rows that don't have coordinates - our model requires lat/lon
                    if lat is None or lon is None:
                        skipped += 1
                        self.stdout.write(f"Skipping row without lat/lon (ATCO={atco} Naptan={naptan} tiploc={plate})")
                        continue

                    indicator = r.get('Indicator') or None
                    lines = r.get('Lines') or None
                    icon = r.get('Icon') or None

                    status = (r.get('Status') or '').strip().lower()
                    active_flag = True if status == 'active' else False

                    created_at = parse_datetime(r.get('CreationDateTime') or r.get('CreationDate'))
                    modified_at = parse_datetime(r.get('ModificationDateTime') or r.get('ModificationDate'))

                    # find existing
                    existing = None
                    if atco and ('atco', atco) in existing_map:
                        existing = existing_map[('atco', atco)]
                    elif naptan and ('naptan', naptan) in existing_map:
                        existing = existing_map[('naptan', naptan)]
                    elif plate and ('tiploc', plate) in existing_map:
                        existing = existing_map[('tiploc', plate)]

                    if existing:
                        # update fields
                        existing.name = name
                        existing.naptan_code = naptan
                        existing.tiploc = plate
                        existing.crs = crs
                        existing.stop_type = parent_type
                        existing.active = active_flag
                        existing.bearing = bearing
                        # only update lat/lon when provided (avoid overwriting with None)
                        if lat is not None:
                            existing.lat = lat
                        if lon is not None:
                            existing.lon = lon
                        existing.lines = lines
                        existing.indicator = indicator
                        existing.icon = icon
                        existing.modified_at = modified_at or now
                        to_update.append(existing)
                    else:
                        obj = Stop(
                            name=name,
                            atco_code=atco,
                            naptan_code=naptan,
                            tiploc=plate,
                            crs=crs,
                            stop_type=parent_type,
                            active=active_flag,
                            bearing=bearing,
                            lat=lat if lat is not None else None,
                            lon=lon if lon is not None else None,
                            lines=lines,
                            indicator=indicator,
                            icon=icon,
                        )
                        if created_at:
                            obj.created_at = created_at
                        if modified_at:
                            obj.modified_at = modified_at
                        to_create.append(obj)
                except Exception as e:
                    skipped += 1
                    self.stderr.write(f'Failed to process row ({e})')

            # write to DB
            if to_create:
                Stop.objects.bulk_create(to_create, batch_size=1000)
                created += len(to_create)
            if to_update:
                # choose fields to update
                fields = ['naptan_code', 'tiploc', 'crs', 'stop_type', 'active', 'bearing', 'lat', 'lon', 'lines', 'indicator', 'icon', 'modified_at']
                Stop.objects.bulk_update(to_update, fields=fields, batch_size=1000)
                updated += len(to_update)
            total_rows += len(batch_rows)
            # progress output
            if total_rows % (batch_size) == 0:
                self.stdout.write(f'Processed ~{total_rows} rows (created={created} updated={updated} skipped={skipped})')

        # read and stream CSV in batches
        try:
            if file_path:
                import os
                try:
                    size = os.path.getsize(file_path)
                    self.stdout.write(f'Reading local CSV file {file_path} ({size//1024//1024} MB) ...')
                except Exception:
                    self.stdout.write(f'Reading local CSV file {file_path} ...')
                with open(file_path, 'r', encoding='utf-8-sig', newline='') as fh:
                    # sniff delimiter from a small sample to handle different CSV formats
                    sample = fh.read(8192)
                    fh.seek(0)
                    try:
                        dialect = csv.Sniffer().sniff(sample, delimiters=[',','\t',';','|'])
                        delim = dialect.delimiter
                    except Exception:
                        delim = ','
                    reader = csv.DictReader(fh, delimiter=delim)
                    self.stdout.write(f'CSV columns: {reader.fieldnames}')
                    batch = []
                    for row in reader:
                        batch.append(row)
                        if len(batch) >= batch_size:
                            process_batch(batch)
                            batch = []
                    if batch:
                        process_batch(batch)
            else:
                self.stdout.write(f'Downloading CSV from {url} ...')
                with urllib.request.urlopen(url) as resp:
                    text_fh = io.TextIOWrapper(resp, encoding='utf-8-sig')
                    reader = csv.DictReader(text_fh, delimiter=',')
                    batch = []
                    for row in reader:
                        batch.append(row)
                        if len(batch) >= batch_size:
                            process_batch(batch)
                            batch = []
                    if batch:
                        process_batch(batch)
        except Exception as e:
            self.stderr.write(f'Import failed: {e}')
            return

        # final progress summary
        self.stdout.write(f'Processed total rows: {total_rows}')

        self.stdout.write(self.style.SUCCESS(f'Import complete: created={created} updated={updated} skipped={skipped}'))
