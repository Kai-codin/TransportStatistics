from django.core.management.base import BaseCommand
from django.db import transaction
import re

from Stops.models import Stop


class Command(BaseCommand):
    help = "Ensure bus stop names include their indicator in brackets (e.g. 'Bus Station (Bay 1)')"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Dont persist changes to the database. With this flag the command runs in dry-run mode.'
        )
        parser.add_argument(
            '--limit', '-n', type=int, default=0,
            help='Limit number of modified stops to show/save (0 = no limit)'
        )
        parser.add_argument(
            '--atco', '-a', type=str, default=None,
            help='Only process the stop with this ATCO code (case-insensitive)'
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry-run')
        limit = options.get('limit') or 0

        qs = Stop.objects.exclude(indicator__isnull=True).exclude(indicator__exact='')
        atco = options.get('atco')
        if atco:
            atco = atco.strip()
            qs = qs.filter(atco_code__iexact=atco)
        total = qs.count()
        self.stdout.write(f'Found {total} stops with non-empty indicator')
        mode = 'dry-run' if dry_run else 'commit'
        self.stdout.write(f"Running in {mode} mode; limit={limit or 'none'}")

        processed = 0
        skipped_no_name = 0

        changed = []
        pattern_fmt = '({})$'

        for stop in qs.iterator():
            processed += 1
            if processed % 50 == 0:
                self.stdout.write(f'Processed {processed}/{total} stops...')

            ind = (stop.indicator or '').strip()
            if not ind:
                skipped_no_name += 1
                continue
            name = (stop.name or '').strip()
            if not name:
                skipped_no_name += 1
                continue

            # If the name already ends with the indicator in parentheses (case-insensitive), skip.
            # Match examples like '... (Bay 18)', allowing extra whitespace and case differences.
            # Use a robust regex: parentheses, optional surrounding whitespace, anchored to end.
            try:
                end_pat = re.compile(r"\(\s*" + re.escape(ind) + r"\s*\)\s*$", re.IGNORECASE)
            except re.error:
                # Fallback: simple endswith check (case-insensitive)
                if name.lower().endswith(f'({ind.lower()})'):
                    continue
                end_pat = None

            if end_pat and end_pat.search(name):
                continue

            original = name

            # If the name contains 'Bus Station' (case-insensitive), insert indicator after it
            bs_re = re.compile(r'(Bus Station)(?!\s*\()', re.IGNORECASE)
            if bs_re.search(name):
                name = bs_re.sub(lambda m: f"{m.group(1)} ({ind})", name, count=1)
            else:
                # Append indicator at end
                name = f"{name} ({ind})"

            if name != original:
                changed.append((stop.pk, original, name))
                if not dry_run:
                    stop.name = name
                    try:
                        with transaction.atomic():
                            stop.save()
                        self.stdout.write(f'Saved stop {stop.pk}: "{original}" -> "{name}"')
                    except Exception as e:
                        self.stderr.write(f'Failed to save stop {stop.pk}: {e}')
                # apply limit
                if limit and len(changed) >= limit:
                    break

        if not changed:
            self.stdout.write('No changes necessary.')
            return
        self.stdout.write(f'Planned changes: {len(changed)}')
        self.stdout.write(f'Skipped (no indicator/name): {skipped_no_name}')
        for pk, orig, new in changed:
            self.stdout.write(f'- {pk}: "{orig}" -> "{new}"')

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry-run complete. Rerun with --commit to persist changes.'))
        else:
            self.stdout.write(self.style.SUCCESS('Changes have been saved.'))
