"""
Django settings for TransportStatistics project.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
try:
    import pymysql
except ImportError:
    pymysql = None

if pymysql is not None:
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
]

DATA_UPLOAD_MAX_NUMBER_FIELDS = 10000

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'main.middleware.ViewAsMiddleware',
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
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME':   BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE     = 'Europe/London'
USE_I18N      = True
USE_TZ        = True

STATIC_URL      = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT     = BASE_DIR / 'staticfiles'

REST_FRAMEWORK = {
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
}

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
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'transportstatistics-local',
        }
    }

LOGGING_ENABLED = os.getenv('LOGGING_ENABLED', 'True').lower() in ('1', 'true', 'yes', 'on')
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()

if LOGGING_ENABLED:
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'standard': {
                'format': '%(asctime)s %(levelname)s [%(name)s] %(message)s',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'formatter': 'standard',
            },
        },
        'root': {
            'handlers': ['console'],
            'level': LOG_LEVEL,
        },
    }
else:
    logging.disable(logging.CRITICAL)

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGIN_URL           = '/accounts/login/'
LOGIN_REDIRECT_URL  = '/'
LOGOUT_REDIRECT_URL = '/'
