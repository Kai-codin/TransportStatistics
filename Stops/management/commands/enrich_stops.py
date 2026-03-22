import time
import re
import requests
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from Stops.models import Stop


class Command(BaseCommand):
    help = "Enrich Stop records: fetch bustimes data and/or append indicators to names"

    def add_arguments(self, parser):
        parser.add_argument('--commit',  default=True, action='store_true', help='Persist changes')
        parser.add_argument('--atco', '-a', type=str, default=None, help='Only process this ATCO code')
        parser.add_argument('--limit', '-n', type=int, default=0, help='Limit processed stops (0 = all)')
        parser.add_argument('--sleep', type=float, default=0.01, help='Seconds to sleep between requests (rate limit)')
        parser.add_argument('--indicators', default=True, action='store_true', help='Append indicators to names when missing')
        parser.add_argument('--bustimes', default=True, action='store_true', help='Fetch data from bustimes.org')

    def handle(self, *args, **options):
        commit = options.get('commit')
        atco_arg = options.get('atco')
        limit = options.get('limit') or 0
        sleep = options.get('sleep')
        do_indicators = options.get('indicators')
        do_bustimes = options.get('bustimes')

        # Default: if neither specified, do both
        if not do_indicators and not do_bustimes:
            do_indicators = True
            do_bustimes = True

        # Build queryset depending on requested operations
        qs = None
        if atco_arg:
            qs = Stop.objects.filter(atco_code__iexact=atco_arg.strip())
        else:
            filters = Q()
            if do_bustimes:
                filters |= Q(atco_code__isnull=False) & ~Q(atco_code__exact='')
            if do_indicators:
                filters |= Q(indicator__isnull=False) & ~Q(indicator__exact='')
            qs = Stop.objects.filter(filters)

        total = qs.count()
        self.stdout.write(f'Found {total} stops to process')
        mode = 'commit' if commit else 'dry-run'
        self.stdout.write(f'Running in {mode} mode; limit={limit or "none"}; indicators={do_indicators}; bustimes={do_bustimes}')

        session = requests.Session()
        session.headers.update({'User-Agent': 'TransportStatistics/1.0'})

        processed = 0
        skipped = 0
        changed = []

        for stop in qs.iterator():
            if limit and processed >= limit:
                break
            processed += 1
            # Per-stop progress so the command visibly advances
            self.stdout.write(f'Processing {processed}/{total}: pk={stop.pk} atco={stop.atco_code} name="{stop.name}" indicator="{stop.indicator}"')
            if processed % 50 == 0:
                self.stdout.write(f'Processed {processed}/{total}...')

            updates = {}

            # Indicator handling
            if do_indicators:
                ind = (stop.indicator or '').strip()
                name = (stop.name or '').strip()
                if ind and name:
                    try:
                        end_pat = re.compile(r"\(\s*" + re.escape(ind) + r"\s*\)\s*$", re.IGNORECASE)
                    except re.error:
                        end_pat = None
                    if not (end_pat and end_pat.search(name)):
                        # Insert after 'Bus Station' if present, else append
                        bs_re = re.compile(r'(Bus Station)(?!\s*\()', re.IGNORECASE)
                        if bs_re.search(name):
                            new_name = bs_re.sub(lambda m: f"{m.group(1)} ({ind})", name, count=1)
                        else:
                            new_name = f"{name} ({ind})"
                        if new_name != name:
                            updates['name'] = new_name

            # Bustimes enrichment
            if do_bustimes and stop.atco_code:
                atco = stop.atco_code.strip()
                if atco:
                    url = f'https://bustimes.org/api/stops/{atco}'
                    try:
                        self.stdout.write(f'[{stop.pk}] Fetching {url}')
                        resp = session.get(url, timeout=10)
                        resp.raise_for_status()
                        data = resp.json()
                    except Exception as e:
                        self.stderr.write(f'[{stop.pk}] Failed to fetch {atco}: {e}')
                        time.sleep(sleep)
                        continue

                    # Determine item
                    item = None
                    if isinstance(data, dict) and 'results' in data:
                        results = data.get('results') or []
                        if results:
                            item = results[0]
                    elif isinstance(data, list) and data:
                        item = data[0]
                    elif isinstance(data, dict):
                        item = data

                    if item:
                        # quick debug of returned keys to aid diagnosis
                        try:
                            self.stdout.write(f'[{stop.pk}] Bustimes returned keys: {list(item.keys())}')
                        except Exception:
                            pass
                        # lines
                        ln = item.get('line_names') or item.get('lines') or None
                        if isinstance(ln, list):
                            ln_val = ','.join([str(x) for x in ln if x])
                        elif isinstance(ln, str):
                            ln_val = ln
                        else:
                            ln_val = None
                        if ln_val and (stop.lines or '') != ln_val:
                            updates['lines'] = ln_val

                        # icon
                        icon = item.get('icon')
                        if icon and (stop.icon or '') != icon:
                            updates['icon'] = icon

                        # name -> common_name
                        name_val = item.get('name')
                        if name_val and (stop.common_name or '') != name_val:
                            updates['common_name'] = name_val

                        # long_name
                        long_name = item.get('long_name')
                        if long_name and (stop.long_name or '') != long_name:
                            updates['long_name'] = long_name

                    # rate limit
                    time.sleep(sleep)

            if not updates:
                skipped += 1
                self.stdout.write(f'[{stop.pk}] No updates; skipped')
                continue

            changed.append((stop.pk, stop.atco_code, updates))
            self.stdout.write(f'[{stop.pk}] Planned updates: {updates}')

            if commit:
                for k, v in updates.items():
                    setattr(stop, k, v)
                try:
                    with transaction.atomic():
                        stop.save()
                    self.stdout.write(f'Saved stop {stop.pk}: {updates}')
                except Exception as e:
                    self.stderr.write(f'[{stop.pk}] Failed to save: {e}')

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
