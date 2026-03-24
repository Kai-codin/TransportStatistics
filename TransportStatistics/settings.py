"""
Django settings for TransportStatistics project.
"""

from pathlib import Path
from dotenv import load_dotenv
import pymysql
import os

# pymysql must be installed before any DB config so it acts as MySQLdb
pymysql.install_as_MySQLdb()

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv('SECRET_KEY', 'django-insecure-l+q+qn&@=w!g&xqhym7@@@1o=-e=r&*yrt&*vs0)znz30l)8(i')

DEBUG = os.getenv('DEBUG', 'True') == 'True'

ALLOWED_HOSTS = [h for h in os.getenv('ALLOWED_HOSTS', '').split(',') if h]
CSRF_TRUSTED_ORIGINS = [o for o in os.getenv('CSRF_TRUSTED_ORIGINS', '').split(',') if o]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'django_filters',
    'main',
    'API',
    'Depatures',
    'Social',
    'Stops',
    'Trips',
    'Web',
]

DATA_UPLOAD_MAX_NUMBER_FIELDS = 10000

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'TransportStatistics.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'Templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'TransportStatistics.wsgi.application'

# ── Database ──────────────────────────────────────────────────────────────────
#
# Reads DATABASE_URL from the environment. Examples:
#   mysql://user:pass@host:3306/dbname
#   mysql://user:pass@host:3306/dbname?charset=utf8mb4
#   postgres://user:pass@host:5432/dbname
#   sqlite:///db.sqlite3
#
# Falls back to a local SQLite database if DATABASE_URL is not set.

from urllib.parse import urlparse, parse_qs

_db_url = os.getenv('DATABASE_URL', '')

if _db_url:
    _parsed = urlparse(_db_url)
    _scheme = (_parsed.scheme or '').lower()

    if _scheme.startswith('mysql'):
        _query   = parse_qs(_parsed.query)
        _options = {
            'charset':               _query.get('charset', ['utf8mb4'])[0],
            'init_command':          "SET innodb_lock_wait_timeout=120, sql_mode='STRICT_TRANS_TABLES'",
        }
        DATABASES = {
            'default': {
                'ENGINE':   'django.db.backends.mysql',
                'NAME':     (_parsed.path or '').lstrip('/'),
                'USER':     _parsed.username or '',
                'PASSWORD': _parsed.password or '',
                'HOST':     _parsed.hostname or '',
                'PORT':     str(_parsed.port) if _parsed.port else '3306',
                'OPTIONS':  _options,
                'CONN_MAX_AGE': 600,
            }
        }

    elif _scheme.startswith('postgres'):
        DATABASES = {
            'default': {
                'ENGINE':       'django.db.backends.postgresql',
                'NAME':         (_parsed.path or '').lstrip('/'),
                'USER':         _parsed.username or '',
                'PASSWORD':     _parsed.password or '',
                'HOST':         _parsed.hostname or '',
                'PORT':         str(_parsed.port) if _parsed.port else '5432',
                'CONN_MAX_AGE': 600,
            }
        }

    else:
        # sqlite or unknown — fall through to file-based sqlite
        _path = _parsed.path or ''
        if _path in ('/:memory:', ':memory:'):
            _name = ':memory:'
        elif _db_url.startswith('sqlite:///') and not _db_url.startswith('sqlite:////'):
            _name = str(BASE_DIR / _path.lstrip('/'))
        else:
            _name = _path
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME':   _name,
            }
        }

else:
    # No DATABASE_URL — default to local SQLite
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME':   BASE_DIR / 'db.sqlite3',
        }
    }

# ── Password validation ───────────────────────────────────────────────────────

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ── Internationalisation ──────────────────────────────────────────────────────

LANGUAGE_CODE = 'en-us'
TIME_ZONE     = 'UTC'
USE_I18N      = True
USE_TZ        = True

# ── Static files ──────────────────────────────────────────────────────────────

STATIC_URL      = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT     = BASE_DIR / 'staticfiles'

# ── REST framework ────────────────────────────────────────────────────────────

REST_FRAMEWORK = {
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
}

# Cache configuration: prefer Redis if REDIS_URL is provided, otherwise fall
# back to Django's local-memory cache. Uses `django-redis` if available.
REDIS_URL = os.getenv('REDIS_URL', '')
if REDIS_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django_redis.cache.RedisCache',
            'LOCATION': REDIS_URL,
            'OPTIONS': {
                'CLIENT_CLASS': 'django_redis.client.DefaultClient',
                'IGNORE_EXCEPTIONS': True,
            }
        }
    }
else:
    # Local-memory cache for development if Redis not configured
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'transportstatistics-local',
        }
    }

# ── Misc ──────────────────────────────────────────────────────────────────────

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGIN_URL           = '/accounts/login/'
LOGIN_REDIRECT_URL  = '/'
LOGOUT_REDIRECT_URL = '/'