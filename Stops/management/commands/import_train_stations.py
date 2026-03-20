from django.core.management.base import BaseCommand
from django.db import transaction
from Stops.models import Stop, StopType

import json
import urllib.request
import io


def parse_float(value):
    try:
        return float(value) if value not in (None, '') else None
    except Exception:
        return None


class Command(BaseCommand):
    help = 'Download rail stations JSON and import as Stops with StopType RLS'

    def add_arguments(self, parser):
        parser.add_argument('--url', type=str, help='Stations JSON URL', default='https://raw.githubusercontent.com/davwheat/uk-railway-stations/refs/heads/main/stations.json')
        parser.add_argument('--file', type=str, help='Local JSON file path to import (overrides --url)')

    def handle(self, *args, **options):
        file_path = options.get('file')
        url = options.get('url')

        # Load JSON data
        if file_path:
            self.stdout.write(f'Reading local JSON file {file_path} ...')
            with open(file_path, 'rb') as fh:
                data = fh.read()
            text = data.decode('utf-8-sig')
            stations = json.loads(text)
        else:
            self.stdout.write(f'Downloading stations JSON from {url} ...')
            with urllib.request.urlopen(url) as resp:
                data = resp.read()
            text = data.decode('utf-8-sig')
            stations = json.loads(text)

        # Ensure RLS StopType exists
        rls_type, _ = StopType.objects.get_or_create(code='RLS', defaults={'name': 'RLS'})

        created = 0
        updated = 0
        skipped = 0

        with transaction.atomic():
            for i, st in enumerate(stations, start=1):
                name = st.get('stationName') or st.get('name') or None
                lat = parse_float(st.get('lat') or st.get('latitude') or st.get('y') )
                lon = parse_float(st.get('long') or st.get('longitude') or st.get('x'))
                crs = st.get('crsCode') or st.get('crs') or None

                defaults = {
                    'name': name,
                    'naptan_code': None,
                    'tiploc': None,
                    'crs': crs,
                    'stop_type': rls_type,
                    'active': True,
                    'bearing': None,
                    'lat': lat if lat is not None else None,
                    'lon': lon if lon is not None else None,
                    'lines': None,
                    'indicator': None,
                    'icon': None,
                }

                try:
                    if crs:
                        obj, was_created = Stop.objects.update_or_create(defaults=defaults, crs=crs)
                        if was_created:
                            created += 1
                        else:
                            updated += 1
                    else:
                        # No CRS - create a new stop record
                        Stop.objects.create(**defaults)
                        created += 1
                except Exception as e:
                    skipped += 1
                    self.stderr.write(f'Row {i}: failed to import ({e})')

                if i % 500 == 0:
                    self.stdout.write(f'Processed {i} stations...')

        self.stdout.write(self.style.SUCCESS(f'Train import complete: created={created} updated={updated} skipped={skipped}'))
