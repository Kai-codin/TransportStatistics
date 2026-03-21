import time
import requests
from django.core.management.base import BaseCommand
from django.db import transaction

from Stops.models import Stop


class Command(BaseCommand):
    help = "Enrich Stop records from bustimes.org API using atco_code"

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true', help='Persist changes')
        parser.add_argument('--limit', '-n', type=int, default=0, help='Limit processed stops (0 = all)')
        parser.add_argument('--sleep', type=float, default=0.05, help='Seconds to sleep between requests (rate limit)')

    def handle(self, *args, **options):
        commit = options.get('commit')
        limit = options.get('limit') or 0
        sleep = options.get('sleep')

        qs = Stop.objects.filter(atco_code__isnull=False).exclude(atco_code__exact='')
        total = qs.count()
        self.stdout.write(f'Found {total} stops with atco_code')

        changed = []
        processed = 0

        session = requests.Session()
        session.headers.update({'User-Agent': 'TransportStatistics/1.0'})

        for stop in qs.iterator():
            if limit and processed >= limit:
                break
            processed += 1
            atco = stop.atco_code.strip()
            if not atco:
                continue

            url = f'https://bustimes.org/api/stops/'
            params = {'atco_code': atco}
            try:
                resp = session.get(url, params=params, timeout=10)
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                self.stderr.write(f'[{stop.pk}] Failed to fetch {atco}: {e}')
                time.sleep(sleep)
                continue

            # API may return {'count':..., 'results': [...]}
            item = None
            if isinstance(data, dict) and 'results' in data:
                results = data.get('results') or []
                if results:
                    item = results[0]
            elif isinstance(data, list) and data:
                item = data[0]
            elif isinstance(data, dict):
                # single object
                item = data

            if not item:
                self.stdout.write(f'[{stop.pk}] No data for atco {atco}')
                time.sleep(sleep)
                continue

            updated = {}
            # Map line_names -> lines (comma separated)
            ln = item.get('line_names') or item.get('lines') or None
            if isinstance(ln, list):
                ln_val = ','.join([str(x) for x in ln if x])
            elif isinstance(ln, str):
                ln_val = ln
            else:
                ln_val = None

            if ln_val:
                if (stop.lines or '') != ln_val:
                    updated['lines'] = ln_val

            # icon
            icon = item.get('icon')
            if icon and (stop.icon or '') != icon:
                updated['icon'] = icon

            # name -> common_name
            name = item.get('name')
            if name and (stop.common_name or '') != name:
                updated['common_name'] = name

            # long_name
            long_name = item.get('long_name')
            if long_name and (stop.long_name or '') != long_name:
                updated['long_name'] = long_name

            if updated:
                changed.append((stop.pk, stop.atco_code, updated))
                if commit:
                    for k, v in updated.items():
                        setattr(stop, k, v)
                    try:
                        with transaction.atomic():
                            stop.save()
                    except Exception as e:
                        self.stderr.write(f'[{stop.pk}] Failed to save: {e}')

            # rate limit
            time.sleep(sleep)

        if not changed:
            self.stdout.write('No updates found.')
            return

        self.stdout.write(f'Planned/Applied updates: {len(changed)}')
        for pk, atco, upd in changed:
            self.stdout.write(f'- {pk} ({atco}): {upd}')

        if not commit:
            self.stdout.write(self.style.WARNING('Dry-run. Use --commit to persist changes.'))
        else:
            self.stdout.write(self.style.SUCCESS('Enrichment complete.'))
