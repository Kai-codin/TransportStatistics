import json
import logging
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from Stops.models import Stop

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Read TiplocV1 NDJSON and assign tiploc to Stop records matching CRS codes when tiploc is empty.'

    def add_arguments(self, parser):
        parser.add_argument('--file', type=str, help='Path to TiplocV1.ndjson', default='data/TiplocV1.ndjson')
        parser.add_argument('--batch-size', type=int, help='Number of updates to bulk commit at once', default=500)
        parser.add_argument('--dry-run', action='store_true', help="Don't write changes, just report what would be done")
        parser.add_argument(
            '--update',
            action='store_true',
            help='Also update tiploc on stops that already have one (overwrite existing values)',
        )

    def handle(self, *args, **options):
        file_path = Path(options['file'])
        batch_size = int(options.get('batch_size') or 500)
        dry_run = options.get('dry_run')
        allow_update = options.get('update')

        self.stdout.write(self.style.MIGRATE_HEADING('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
        self.stdout.write(self.style.MIGRATE_HEADING('   TiplocV1 Import'))
        self.stdout.write(self.style.MIGRATE_HEADING('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))
        self.stdout.write(f'  File:       {file_path}')
        self.stdout.write(f'  Batch size: {batch_size}')
        self.stdout.write(f'  Dry run:    {dry_run}')
        self.stdout.write(f'  Update:     {allow_update}')
        self.stdout.write('')

        if dry_run:
            logger.info('Dry-run mode enabled - no database writes will occur')
            self.stdout.write(self.style.WARNING('⚠  Dry-run mode: no changes will be written\n'))

        if allow_update:
            logger.info('--update flag set: existing tiploc values will be overwritten')
            self.stdout.write(self.style.WARNING('⚠  --update flag: existing tiploc values will be overwritten\n'))

        if not file_path.exists():
            logger.error('File not found: %s', file_path)
            self.stderr.write(self.style.ERROR(f'✘  File not found: {file_path}'))
            return

        logger.info('Starting import from %s (batch_size=%d)', file_path, batch_size)
        self.stdout.write(f'Reading {file_path} …\n')

        processed = 0
        skipped_parse = 0
        no_crs = 0
        matched = 0
        updated = 0
        created = 0
        skipped_has_tiploc = 0

        to_update = []
        to_create = []

        with file_path.open('r', encoding='utf-8', errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                processed += 1

                if processed % 1000 == 0:
                    self.stdout.write(
                        f'  … {processed} lines processed '
                        f'(updated={updated}, created={created}, skipped={skipped_has_tiploc})'
                    )

                try:
                    obj = json.loads(line)
                except Exception as exc:
                    skipped_parse += 1
                    logger.warning('Line %d: JSON parse error (%s) - skipping', processed, exc)
                    self.stderr.write(self.style.ERROR(f'  ✘ Line {processed}: JSON parse error ({exc}) - skipping'))
                    continue

                # Support both {"tiploc_code":...} or nested wrapper {"TiplocV1": {...}}
                if 'TiplocV1' in obj and isinstance(obj['TiplocV1'], dict):
                    rec = obj['TiplocV1']
                else:
                    rec = obj

                crs_code = rec.get('crs_code') or rec.get('crs')
                tiploc_code = rec.get('tiploc_code') or rec.get('tiploc')
                tps_description = rec.get('tps_description') or rec.get('description')

                # ------------------------------------------------------------------ #
                #  No CRS: match by name or create                                   #
                # ------------------------------------------------------------------ #
                if not crs_code or not str(crs_code).strip():
                    no_crs += 1

                    if not tps_description:
                        logger.debug(
                            'Line %d: no CRS and no tps_description (tiploc=%s) - skipping',
                            processed, tiploc_code,
                        )
                        self.stdout.write(
                            self.style.WARNING(
                                f'  ⚠ Line {processed}: no CRS and no tps_description '
                                f'(tiploc={tiploc_code}) - skipping'
                            )
                        )
                        continue

                    tps_description = str(tps_description).strip()
                    name_qs = Stop.objects.filter(name__iexact=tps_description)

                    if name_qs.exists():
                        if allow_update:
                            stops = list(name_qs)
                        else:
                            stops = list(
                                name_qs.filter(tiploc__isnull=True) | name_qs.filter(tiploc__exact='')
                            )

                        for s in stops:
                            old = s.tiploc
                            s.tiploc = tiploc_code
                            logger.debug(
                                'Queuing update (name match) stop pk=%s name=%r tiploc: %r → %r',
                                s.pk, s.name, old, tiploc_code,
                            )
                            self.stdout.write(
                                f'  ~ Queuing update (name match) '
                                f'pk={s.pk} name={s.name!r} '
                                f'tiploc: {old!r} → {tiploc_code!r}'
                            )
                            to_update.append(s)

                        skipped_count = name_qs.count() - len(stops)
                        if skipped_count:
                            skipped_has_tiploc += skipped_count
                            logger.debug(
                                '%d stop(s) with name=%r already have a tiploc - skipped',
                                skipped_count, tps_description,
                            )
                            self.stdout.write(
                                self.style.WARNING(
                                    f'  ⚠ {skipped_count} stop(s) named {tps_description!r} '
                                    f'already have a tiploc - skipped (use --update to overwrite)'
                                )
                            )
                    else:
                        logger.debug(
                            'No stop found for name=%r - queuing create with tiploc=%r',
                            tps_description, tiploc_code,
                        )
                        self.stdout.write(
                            self.style.SUCCESS(
                                f'  + No stop found for {tps_description!r} '
                                f'- queuing create (tiploc={tiploc_code!r}, crs=blank)'
                            )
                        )
                        to_create.append(Stop(
                            name=tps_description,
                            tiploc=tiploc_code,
                            crs='',
                            lat=0.0,
                            lon=0.0,
                        ))

                    to_update, updated = self._maybe_flush_updates(to_update, updated, batch_size, dry_run)
                    to_create, created = self._maybe_flush_creates(to_create, created, batch_size, dry_run)
                    continue

                # ------------------------------------------------------------------ #
                #  Has CRS: original logic                                            #
                # ------------------------------------------------------------------ #
                crs_code = str(crs_code).strip().upper()
                qs = Stop.objects.filter(crs__iexact=crs_code)
                cnt = qs.count()

                if cnt == 0:
                    logger.debug('Line %d: no stops found for CRS=%s - skipping', processed, crs_code)
                    self.stdout.write(f'  - Line {processed}: no stops found for CRS={crs_code} - skipping')
                    continue

                matched += cnt

                if allow_update:
                    stops = list(qs)
                else:
                    stops = list(qs.filter(tiploc__isnull=True) | qs.filter(tiploc__exact=''))

                skipped_count = cnt - len(stops)
                if skipped_count:
                    skipped_has_tiploc += skipped_count
                    logger.debug(
                        '%d stop(s) with CRS=%s already have a tiploc - skipped',
                        skipped_count, crs_code,
                    )
                    self.stdout.write(
                        self.style.WARNING(
                            f'  ⚠ {skipped_count} stop(s) with CRS={crs_code} '
                            f'already have a tiploc - skipped (use --update to overwrite)'
                        )
                    )

                if not stops:
                    continue

                for s in stops:
                    old = s.tiploc
                    s.tiploc = tiploc_code
                    logger.debug(
                        'Queuing update (CRS match) stop pk=%s crs=%s tiploc: %r → %r',
                        s.pk, crs_code, old, tiploc_code,
                    )
                    self.stdout.write(
                        f'  ~ Queuing update (CRS match) '
                        f'pk={s.pk} crs={crs_code} '
                        f'tiploc: {old!r} → {tiploc_code!r}'
                    )
                    to_update.append(s)

                to_update, updated = self._maybe_flush_updates(to_update, updated, batch_size, dry_run)

        # ------------------------------------------------------------------ #
        #  Final flush                                                         #
        # ------------------------------------------------------------------ #
        self.stdout.write('\nFlushing remaining records…')

        if to_update:
            if dry_run:
                logger.info('DRY RUN: would update %d stops (final flush)', len(to_update))
                self.stdout.write(self.style.WARNING(f'  DRY RUN: would update {len(to_update)} stops (final flush)'))
            else:
                with transaction.atomic():
                    Stop.objects.bulk_update(to_update, ['tiploc'])
                logger.info('Final flush: updated %d stops', len(to_update))
                self.stdout.write(self.style.SUCCESS(f'  ✔ Final flush: updated {len(to_update)} stops'))
            updated += len(to_update)

        if to_create:
            if dry_run:
                logger.info('DRY RUN: would create %d stops (final flush)', len(to_create))
                self.stdout.write(self.style.WARNING(f'  DRY RUN: would create {len(to_create)} stops (final flush)'))
            else:
                with transaction.atomic():
                    Stop.objects.bulk_create(to_create)
                logger.info('Final flush: created %d stops', len(to_create))
                self.stdout.write(self.style.SUCCESS(f'  ✔ Final flush: created {len(to_create)} stops'))
            created += len(to_create)

        # ------------------------------------------------------------------ #
        #  Summary                                                             #
        # ------------------------------------------------------------------ #
        summary_lines = [
            ('Lines processed',               processed),
            ('Lines skipped (parse error)',    skipped_parse),
            ('Lines without CRS',             no_crs),
            ('Matching stops found (CRS)',     matched),
            ('Stops skipped (tiploc existed)', skipped_has_tiploc),
            ('Stops updated',                 updated),
            ('Stops created (no-CRS/no-name)', created),
        ]

        logger.info('Import complete. %s', ' | '.join(f'{k}={v}' for k, v in summary_lines))

        self.stdout.write(self.style.MIGRATE_HEADING('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
        self.stdout.write(self.style.MIGRATE_HEADING('   Summary'))
        self.stdout.write(self.style.MIGRATE_HEADING('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
        for label, value in summary_lines:
            colour = self.style.SUCCESS if value > 0 and label.startswith('Stops') else str
            self.stdout.write(f'  {label:<35} {value}')
        self.stdout.write(self.style.MIGRATE_HEADING('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))
        self.stdout.write(self.style.SUCCESS('✔  Done'))

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #
    def _maybe_flush_updates(self, to_update, updated, batch_size, dry_run):
        if len(to_update) < batch_size:
            return to_update, updated

        if dry_run:
            logger.info('DRY RUN: would update %d stops (batch)', len(to_update))
            self.stdout.write(self.style.WARNING(f'\n  DRY RUN: would update {len(to_update)} stops (batch)\n'))
        else:
            with transaction.atomic():
                Stop.objects.bulk_update(to_update, ['tiploc'])
            updated += len(to_update)
            logger.info('Batch flushed: updated %d stops (%d total)', len(to_update), updated)
            self.stdout.write(self.style.SUCCESS(f'\n  ✔ Batch committed: updated {len(to_update)} stops ({updated} total)\n'))

        return [], updated

    def _maybe_flush_creates(self, to_create, created, batch_size, dry_run):
        if len(to_create) < batch_size:
            return to_create, created

        if dry_run:
            logger.info('DRY RUN: would create %d stops (batch)', len(to_create))
            self.stdout.write(self.style.WARNING(f'\n  DRY RUN: would create {len(to_create)} stops (batch)\n'))
        else:
            with transaction.atomic():
                Stop.objects.bulk_create(to_create)
            created += len(to_create)
            logger.info('Batch flushed: created %d stops (%d total)', len(to_create), created)
            self.stdout.write(self.style.SUCCESS(f'\n  ✔ Batch committed: created {len(to_create)} stops ({created} total)\n'))

        return [], created