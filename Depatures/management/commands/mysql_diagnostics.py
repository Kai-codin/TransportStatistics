from django.core.management.base import BaseCommand
from django.db import connection

KEY_VARIABLES = [
    'innodb_buffer_pool_size', 'innodb_buffer_pool_instances', 'innodb_log_file_size',
    'max_connections', 'sort_buffer_size', 'join_buffer_size', 'read_buffer_size',
    'read_rnd_buffer_size', 'tmp_table_size', 'max_heap_table_size', 'key_buffer_size'
]


class Command(BaseCommand):
    help = 'Print MySQL memory-related variables and current processlist to help diagnose memory usage.'

    def handle(self, *args, **options):
        self.stdout.write('Collecting MySQL variables...')
        with connection.cursor() as cur:
            # Variables
            cur.execute("SHOW VARIABLES WHERE Variable_name IN (%s)" % ','.join(['%s']*len(KEY_VARIABLES)), KEY_VARIABLES)
            vars_rows = cur.fetchall()

            # Status related to InnoDB buffer pool
            cur.execute("SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%'")
            status_rows = cur.fetchall()

            # Process list
            try:
                cur.execute('SHOW FULL PROCESSLIST')
                proc_rows = cur.fetchall()
            except Exception:
                proc_rows = None

        self.stdout.write('\n== Key Variables ==')
        for name, value in vars_rows:
            self.stdout.write(f'{name}: {value}')

        self.stdout.write('\n== InnoDB Buffer Pool Status ==')
        for name, value in status_rows:
            self.stdout.write(f'{name}: {value}')

        if proc_rows is not None:
            self.stdout.write('\n== Processlist (first 50) ==')
            # columns vary by server version; print rows up to 50
            for r in proc_rows[:50]:
                try:
                    id_, user, host, db, command, time_, state, info = r
                    self.stdout.write(f'ID={id_} USER={user} HOST={host} DB={db} CMD={command} TIME={time_} STATE={state} INFO={info[:120] if info else None}')
                except Exception:
                    self.stdout.write(str(r))
        else:
            self.stdout.write('\nCould not fetch process list.')

        self.stdout.write('\nDiagnostic tips:')
        self.stdout.write('- Check `innodb_buffer_pool_size` relative to system RAM; large values (hundreds of MB) are normal on DB servers but heavy on dev machines.')
        self.stdout.write("- Reduce `innodb_buffer_pool_size` or `max_connections` in MySQL config (my.cnf) for low-RAM hosts.")
        self.stdout.write('- Use `SHOW ENGINE INNODB STATUS` for more details on memory/locks.')
