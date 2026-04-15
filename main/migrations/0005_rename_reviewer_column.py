from django.db import migrations


def forwards(apps, schema_editor):
    conn = schema_editor.connection
    table = 'main_traineditrequest'
    cursor = conn.cursor()
    try:
        cols = []
        if conn.vendor == 'sqlite':
            cursor.execute(f"PRAGMA table_info('{table}')")
            cols = [row[1] for row in cursor.fetchall()]
        elif conn.vendor == 'mysql':
            cursor.execute(f"SHOW COLUMNS FROM {table}")
            cols = [row[0] for row in cursor.fetchall()]
        else:
            # Fallback: try sqlite pragma
            try:
                cursor.execute(f"PRAGMA table_info('{table}')")
                cols = [row[1] for row in cursor.fetchall()]
            except Exception:
                cols = []

        if 'reviewer_id' in cols:
            try:
                # Prefer standard rename where supported
                cursor.execute("ALTER TABLE main_traineditrequest RENAME COLUMN reviewer_id TO reviewed_by_id;")
            except Exception:
                # MySQL older versions may require CHANGE with type; attempt best-effort
                if conn.vendor == 'mysql':
                    cursor.execute("SHOW COLUMNS FROM main_traineditrequest LIKE 'reviewer_id'")
                    row = cursor.fetchone()
                    if row:
                        col_type = row[1]
                        cursor.execute(f"ALTER TABLE main_traineditrequest CHANGE COLUMN reviewer_id reviewed_by_id {col_type}")
    finally:
        cursor.close()


def reverse(apps, schema_editor):
    conn = schema_editor.connection
    table = 'main_traineditrequest'
    cursor = conn.cursor()
    try:
        cols = []
        if conn.vendor == 'sqlite':
            cursor.execute(f"PRAGMA table_info('{table}')")
            cols = [row[1] for row in cursor.fetchall()]
        elif conn.vendor == 'mysql':
            cursor.execute(f"SHOW COLUMNS FROM {table}")
            cols = [row[0] for row in cursor.fetchall()]
        else:
            try:
                cursor.execute(f"PRAGMA table_info('{table}')")
                cols = [row[1] for row in cursor.fetchall()]
            except Exception:
                cols = []

        if 'reviewed_by_id' in cols:
            try:
                cursor.execute("ALTER TABLE main_traineditrequest RENAME COLUMN reviewed_by_id TO reviewer_id;")
            except Exception:
                if conn.vendor == 'mysql':
                    cursor.execute("SHOW COLUMNS FROM main_traineditrequest LIKE 'reviewed_by_id'")
                    row = cursor.fetchone()
                    if row:
                        col_type = row[1]
                        cursor.execute(f"ALTER TABLE main_traineditrequest CHANGE COLUMN reviewed_by_id reviewer_id {col_type}")
    finally:
        cursor.close()


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0004_traineditrequest"),
    ]

    operations = [
        migrations.RunPython(forwards, reverse),
    ]
