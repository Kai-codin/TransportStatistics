from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Min, Max
from Depatures.models import Timetable, ScheduleLocation, Route


class Command(BaseCommand):
    help = 'Creates Route entries for each unique timetable based on start and end stops'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Run without making any changes to the database',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear existing routes before creating new ones',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Number of timetables to process per batch (default: 1000)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        clear_existing = options['clear']
        batch_size = options['batch_size']

        self.stdout.write('='*70)
        self.stdout.write(self.style.SUCCESS('ROUTE POPULATION COMMAND STARTED'))
        self.stdout.write('='*70)
        
        if dry_run:
            self.stdout.write(self.style.WARNING('⚠️  Running in DRY RUN mode - no changes will be saved'))
        
        self.stdout.write(f'📦 Batch size: {batch_size}')
        self.stdout.write('')

        # Clear existing routes if requested
        if clear_existing:
            self.stdout.write('🗑️  Clearing existing routes...')
            if dry_run:
                route_count = Route.objects.count()
                self.stdout.write(f'   Would delete {route_count:,} existing routes')
            else:
                route_count = Route.objects.count()
                self.stdout.write(f'   Found {route_count:,} existing routes')
                Route.objects.all().delete()
                self.stdout.write(self.style.SUCCESS(f'   ✓ Deleted {route_count:,} existing routes'))
            self.stdout.write('')

        # Get all timetables (defer datetime fields to avoid conversion issues)
        self.stdout.write('📊 Counting timetables...')
        timetables = Timetable.objects.all().defer('created_at', 'modified_at')
        total_timetables = timetables.count()
        
        self.stdout.write(self.style.SUCCESS(f'   Found {total_timetables:,} timetables to process'))
        self.stdout.write(f'   Processing in batches of {batch_size}...')
        self.stdout.write('')

        created_count = 0
        skipped_count = 0
        error_count = 0
        routes_to_create = []
        
        # Skip reason tracking
        skip_reasons = {
            'no_locations': 0,
            'single_location': 0,
            'missing_data': 0,
            'already_exists': 0,
        }

        self.stdout.write('🚂 Processing timetables...')
        self.stdout.write('')

        for idx, timetable in enumerate(timetables.iterator(chunk_size=batch_size), 1):
            # Progress reporting
            if idx % 1000 == 0:
                progress_pct = (idx / total_timetables) * 100
                self.stdout.write(
                    f'📈 Progress: {idx:,}/{total_timetables:,} ({progress_pct:.1f}%) | '
                    f'✓ Created: {created_count:,} | ⊘ Skipped: {skipped_count:,} | ✗ Errors: {error_count:,}'
                )
                if routes_to_create:
                    self.stdout.write(f'   💾 Pending bulk insert: {len(routes_to_create):,} routes')
                self.stdout.write('')

            try:
                # Get the first and last schedule locations for this timetable
                # Order by position to get start and end stops
                schedule_locations = ScheduleLocation.objects.filter(
                    timetable=timetable
                ).select_related('stop').defer(
                    'created_at', 'modified_at'
                ).order_by('position')

                if not schedule_locations.exists():
                    skipped_count += 1
                    skip_reasons['no_locations'] += 1
                    if options['verbosity'] >= 2:
                        self.stdout.write(
                            self.style.WARNING(f'  ⊘ Skipping timetable {timetable.id}: No schedule locations')
                        )
                    continue

                # Get first and last locations
                first_location = schedule_locations.first()
                last_location = schedule_locations.last()

                # Skip if start and end are the same (circular routes or single-stop entries)
                if first_location.id == last_location.id:
                    skipped_count += 1
                    skip_reasons['single_location'] += 1
                    if options['verbosity'] >= 2:
                        self.stdout.write(
                            self.style.WARNING(f'  ⊘ Skipping timetable {timetable.id}: Single location only')
                        )
                    continue

                # Prepare route data
                from_location = None
                to_location = None

                # Try to get stop name, fallback to tiploc_code
                if first_location.stop:
                    from_location = first_location.stop.name or first_location.tiploc_code
                else:
                    from_location = first_location.tiploc_code

                if last_location.stop:
                    to_location = last_location.stop.name or last_location.tiploc_code
                else:
                    to_location = last_location.tiploc_code

                # Skip if we don't have both start and end locations
                if not from_location or not to_location:
                    skipped_count += 1
                    skip_reasons['missing_data'] += 1
                    if options['verbosity'] >= 2:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  ⊘ Skipping timetable {timetable.id}: Missing location data '
                                f'(from: {from_location}, to: {to_location})'
                            )
                        )
                    continue

                if dry_run:
                    created_count += 1
                    if options['verbosity'] >= 2:
                        self.stdout.write(
                            f'  ✓ Would create route: {from_location} → {to_location} '
                            f'(Timetable: {timetable.id}, Headcode: {timetable.headcode})'
                        )
                else:
                    # Check if route already exists to avoid duplicates
                    existing_route = Route.objects.filter(
                        timetable=timetable,
                        from_location=from_location,
                        to_location=to_location,
                    ).exists()

                    if existing_route:
                        skipped_count += 1
                        skip_reasons['already_exists'] += 1
                        if options['verbosity'] >= 2:
                            self.stdout.write(
                                self.style.WARNING(f'  ⊘ Route already exists for timetable {timetable.id}')
                            )
                    else:
                        # Add to bulk create list
                        routes_to_create.append(Route(
                            timetable=timetable,
                            from_location=from_location,
                            to_location=to_location,
                            start_date=timetable.schedule_start_date,
                            end_date=timetable.schedule_end_date,
                            headcode=timetable.headcode,
                            run_by=timetable.operator.code if timetable.operator else None,
                        ))
                        created_count += 1
                        
                        if options['verbosity'] >= 2:
                            self.stdout.write(
                                self.style.SUCCESS(
                                    f'  Prepared route: {from_location} → {to_location} '
                                    f'(Headcode: {timetable.headcode})'
                                )
                            )
                        
                        # Bulk create when batch is full
                        if len(routes_to_create) >= batch_size:
                            Route.objects.bulk_create(routes_to_create, batch_size=batch_size)
                            self.stdout.write(
                                self.style.SUCCESS(f'  💾 Bulk created {len(routes_to_create):,} routes')
                            )
                            routes_to_create = []

            except Exception as e:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(
                        f'  ✗ Error processing timetable {timetable.id} '
                        f'({timetable.headcode or "No headcode"}): {str(e)}'
                    )
                )
                if options['verbosity'] >= 2:
                    import traceback
                    self.stdout.write(f'     {traceback.format_exc()}')

        # Create any remaining routes
        if routes_to_create and not dry_run:
            self.stdout.write('')
            self.stdout.write(f'💾 Bulk creating final {len(routes_to_create):,} routes...')
            Route.objects.bulk_create(routes_to_create, batch_size=batch_size)
            self.stdout.write(self.style.SUCCESS(f'   ✓ Bulk created final {len(routes_to_create):,} routes'))

        # Summary
        self.stdout.write('')
        self.stdout.write('='*70)
        if dry_run:
            self.stdout.write(self.style.SUCCESS('DRY RUN SUMMARY'))
        else:
            self.stdout.write(self.style.SUCCESS('EXECUTION SUMMARY'))
        self.stdout.write('='*70)
        
        if dry_run:
            self.stdout.write(f'✓ Would create:  {created_count:,} routes')
        else:
            self.stdout.write(f'✓ Created:       {created_count:,} routes')
        
        self.stdout.write(f'⊘ Skipped:       {skipped_count:,} timetables')
        
        # Skip reasons breakdown
        if skipped_count > 0:
            self.stdout.write('')
            self.stdout.write('Skip Reasons Breakdown:')
            if skip_reasons['no_locations'] > 0:
                self.stdout.write(f'  • No schedule locations:    {skip_reasons["no_locations"]:,}')
            if skip_reasons['single_location'] > 0:
                self.stdout.write(f'  • Single location only:     {skip_reasons["single_location"]:,}')
            if skip_reasons['missing_data'] > 0:
                self.stdout.write(f'  • Missing location data:    {skip_reasons["missing_data"]:,}')
            if skip_reasons['already_exists'] > 0:
                self.stdout.write(f'  • Already exists:           {skip_reasons["already_exists"]:,}')
        
        self.stdout.write('')
        if error_count > 0:
            self.stdout.write(self.style.ERROR(f'✗ Errors:        {error_count:,} timetables'))
        else:
            self.stdout.write(f'✗ Errors:        {error_count:,} timetables')
        
        self.stdout.write(f'📊 Total:         {total_timetables:,} timetables processed')
        self.stdout.write('='*70)
        
        # Success rate
        if total_timetables > 0:
            success_rate = (created_count / total_timetables) * 100
            self.stdout.write('')
            if success_rate >= 75:
                self.stdout.write(self.style.SUCCESS(f'✓ Success rate: {success_rate:.1f}%'))
            elif success_rate >= 50:
                self.stdout.write(self.style.WARNING(f'⚠ Success rate: {success_rate:.1f}%'))
            else:
                self.stdout.write(self.style.ERROR(f'✗ Success rate: {success_rate:.1f}%'))
        
        self.stdout.write('')
        self.stdout.write('='*70)
        self.stdout.write(self.style.SUCCESS('✓ COMMAND COMPLETED'))
        self.stdout.write('='*70)