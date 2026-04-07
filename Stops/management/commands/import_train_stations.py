from django.core.management.base import BaseCommand
from django.db import transaction
from django.core.cache import cache
from Stops.models import Stop, StopType

import json
import urllib.request
import time


STOPS_CACHE_KEY = 'all_stops'
STOPS_CACHE_TTL = 60 * 60 * 24  # 24 hours


def parse_float(value):
    try:
        return float(value) if value not in (None, '') else None
    except Exception:
        return None


class Command(BaseCommand):
    help = 'Download rail stations JSON and import as Stops with StopType RLS'

    def add_arguments(self, parser):
        parser.add_argument(
            '--url',
            type=str,
        )
        parser.add_argument('--file', type=str, default='stations.json')
        parser.add_argument(
            '--cache-ttl',
            type=int,
            default=STOPS_CACHE_TTL,
            help='Redis cache TTL in seconds (default: 86400 / 24h)'
        )

    def log(self, message):
        now = time.strftime('%H:%M:%S')
        self.stdout.write(f"[{now}] {message}")

    def handle(self, *args, **options):
        start_time = time.time()

        file_path = options.get('file')
        url = options.get('url')
        cache_ttl = options.get('cache_ttl')
        # LOAD DATA
        load_start = time.time()

        if file_path:
            self.log(f"Reading local file: {file_path}")
            with open(file_path, 'rb') as fh:
                data = fh.read()
        else:
            self.log(f"Downloading from: {url}")
            with urllib.request.urlopen(url, timeout=15) as resp:
                total = 0
                chunks = []

                while True:
                    chunk = resp.read(1024 * 1024)  # 1MB
                    if not chunk:
                        break
                    chunks.append(chunk)
                    total += len(chunk)
                    self.log(f"Downloaded {total / 1024 / 1024:.2f} MB")

                data = b''.join(chunks)

        self.log(f"Download complete: {len(data)} bytes")

        try:
            text = data.decode('utf-8-sig')
            stations = json.loads(text)
        except Exception as e:
            self.stderr.write(f"❌ Failed to parse JSON: {e}")
            return

        self.log(f"Loaded {len(stations)} stations")
        self.log(f"Load phase took {time.time() - load_start:.2f}s")
        # PREP DB
        db_start = time.time()

        rls_type, _ = StopType.objects.get_or_create(
            code='RLS',
            defaults={'name': 'Rail Station'}
        )

        existing = {
            s.crs: s
            for s in Stop.objects.all().only('id', 'crs')
            if s.crs
        }

        self.log(f"Loaded {len(existing)} existing stops from DB")

        to_create = []
        to_update = []
        skipped = 0
        # PROCESS DATA
        for i, st in enumerate(stations, start=1):
            name = st.get('stationName') or st.get('name')
            lat = parse_float(st.get('lat') or st.get('latitude') or st.get('y'))
            lon = parse_float(st.get('long') or st.get('longitude') or st.get('x'))
            crs = st.get('crsCode') or st.get('crs')
            tiploc = st.get('tiplocCode') or st.get('tiploc')

            if not crs:
                skipped += 1
                continue

            if lat is None or lon is None:
                lat = 0.0
                lon = 0.0

            try:
                if crs in existing:
                    obj = existing[crs]
                    obj.name = name
                    obj.lat = lat
                    obj.lon = lon
                    obj.tiploc = tiploc
                    obj.stop_type = rls_type
                    to_update.append(obj)
                else:
                    to_create.append(Stop(
                        name=name,
                        crs=crs,
                        lat=lat,
                        lon=lon,
                        tiploc=tiploc,
                        stop_type=rls_type,
                        active=True
                    ))
            except Exception as e:
                skipped += 1
                self.stderr.write(f"Row {i} error: {e}")

            if i % 100 == 0:
                self.log(f"Processed {i}/{len(stations)}")

        self.log(f"Prepared: {len(to_create)} creates, {len(to_update)} updates")
        # WRITE TO DB
        write_start = time.time()

        # Invalidate stale cache before writing so in-flight requests hit DB
        cache.delete(STOPS_CACHE_KEY)
        self.log(f"Invalidated cache key '{STOPS_CACHE_KEY}'")

        with transaction.atomic():
            if to_create:
                Stop.objects.bulk_create(to_create, batch_size=500)
                self.log(f"Inserted {len(to_create)} records")

            if to_update:
                Stop.objects.bulk_update(
                    to_update,
                    ['name', 'lat', 'lon', 'stop_type'],
                    batch_size=500
                )
                self.log(f"Updated {len(to_update)} records")

        self.log(f"DB phase took {time.time() - write_start:.2f}s")
        self.log(f"Total DB time: {time.time() - db_start:.2f}s")
        # UPDATE REDIS CACHE
        cache_start = time.time()
        self.log("Rebuilding Redis cache...")

        try:
            all_stops = list(
                Stop.objects.select_related('stop_type')
                .values('id', 'name', 'crs', 'lat', 'lon', 'tiploc', 'active', 'stop_type__code', 'stop_type__name')
            )
            cache.set(STOPS_CACHE_KEY, all_stops, cache_ttl)
            self.log(f"Cached {len(all_stops)} stops under key '{STOPS_CACHE_KEY}' (TTL: {cache_ttl}s)")
        except Exception as e:
            self.stderr.write(f"⚠️  Redis cache update failed (DB is still up to date): {e}")

        self.log(f"Cache phase took {time.time() - cache_start:.2f}s")
        # DONE
        total_time = time.time() - start_time

        self.stdout.write(
            self.style.SUCCESS(
                f"\n✅ Import complete\n"
                f"Created: {len(to_create)}\n"
                f"Updated: {len(to_update)}\n"
                f"Skipped: {skipped}\n"
                f"Total time: {total_time:.2f}s\n"
            )
        )