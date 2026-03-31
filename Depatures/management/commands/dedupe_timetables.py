from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Max
from Depatures.models import Timetable


class Command(BaseCommand):
    help = 'Deduplicate Timetable records safely (handles FK constraints).'

    CHUNK_SIZE = 500

    def handle(self, *args, **options):
        self.stdout.write("Finding unique timetable groups...")

        duplicates = (
            Timetable.objects
            .values(
                'headcode',
                'train_service_code',
                'schedule_start_date',
                'schedule_end_date',
                'schedule_days_runs',
                'CIF_train_uid',
            )
            .annotate(max_id=Max('id'))
        )

        ids_to_keep = set(d['max_id'] for d in duplicates)

        self.stdout.write("Collecting IDs to delete...")

        to_delete = list(
            Timetable.objects
            .exclude(id__in=ids_to_keep)
            .values_list('id', flat=True)
        )

        count = len(to_delete)

        if count == 0:
            self.stdout.write(self.style.SUCCESS('No duplicates found.'))
            return

        self.stdout.write(
            f'Deleting {count} duplicate Timetable(s) in chunks of {self.CHUNK_SIZE}...'
        )

        deleted_total = 0

        timetable_table = Timetable._meta.db_table
        schedulelocation_table = "Depatures_schedulelocation"

        with connection.cursor() as cursor:
            for i in range(0, count, self.CHUNK_SIZE):
                chunk = to_delete[i:i + self.CHUNK_SIZE]
                ids_sql = ",".join(str(i) for i in chunk)

                # 🔥 STEP 1: delete child rows FIRST
                cursor.execute(
                    f"DELETE FROM {schedulelocation_table} WHERE timetable_id IN ({ids_sql})"
                )

                # 🔥 STEP 2: delete parent rows
                cursor.execute(
                    f"DELETE FROM {timetable_table} WHERE id IN ({ids_sql})"
                )

                deleted = cursor.rowcount
                deleted_total += deleted

                self.stdout.write(
                    f'  Deleted chunk {i // self.CHUNK_SIZE + 1}: {deleted} timetable(s)'
                )

        self.stdout.write(
            self.style.SUCCESS(f'Done. Deleted {deleted_total} total timetable(s).')
        )