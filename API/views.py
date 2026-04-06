from django.db.models import Q
from rest_framework import viewsets
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.filters import SearchFilter, OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend
from .serializers import StopSerializer, FleetSerializer
from Stops.models import Stop
from main.models import Trains

import requests
from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status


class StopPagination(LimitOffsetPagination):
    default_limit = 100
    max_limit = 1000000


class StopViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only API for Stops with search and filters.

    ── Lookup ──────────────────────────────────────────────────────────────
      q              Partial name search.                        e.g. Manch
      crs            Exact CRS code.                             e.g. MAN
      tiploc         Exact TIPLOC.                               e.g. MNCRPIC
      atco_code      Exact ATCO code.
      naptan_code    Exact NaPTAN code.
      stop_type      ID, code, or comma-separated IDs/codes.    e.g. 1,13,9
      stop_types     Alias for stop_type (comma-separated IDs). e.g. 1,2,8,10
    active         Boolean: 1/true/yes or 0/false/no. Use `all` to return both active and inactive.
               Default: active=true (unless `active=all` is passed).

    ── Bounding box (two formats, pick one) ────────────────────────────────
      bbox           Comma-separated: min_lon,min_lat,max_lon,max_lat
                                                    e.g. -2.34,53.47,-2.22,53.48
      min_lat / max_lat / min_lon / max_lon
                     Individual bbox params (used by the map frontend).

    ── Ordering ────────────────────────────────────────────────────────────
      ordering       id | name | lat | lon  (prefix - for descending)
    """

    serializer_class   = StopSerializer
    pagination_class   = StopPagination
    filter_backends    = (DjangoFilterBackend, SearchFilter, OrderingFilter)
    # stop_type/stop_types handled manually below - removed from filterset_fields
    # to prevent DjangoFilterBackend rejecting comma-separated values with a 400
    filterset_fields   = ('active', 'crs', 'atco_code', 'naptan_code', 'tiploc')
    search_fields      = ('name',)
    ordering_fields    = ('id', 'name', 'lat', 'lon')

    def get_queryset(self):
        p  = self.request.query_params
        qs = Stop.objects.select_related('stop_type').all()

        # ── name search ───────────────────────────────────────────────────
        q = p.get('q')
        if q:
            qs = qs.filter(name__icontains=q)

        # ── exact field matches ───────────────────────────────────────────
        for field in ('crs', 'atco_code', 'naptan_code', 'tiploc'):
            val = p.get(field)
            if val:
                qs = qs.filter(**{field: val})

        # ── stop_type / stop_types ────────────────────────────────────────
        # Accepts any of:
        #   single ID:            stop_type=1
        #   single code:          stop_type=RLS
        #   comma-separated IDs:  stop_type=1,13,9   or  stop_types=1,13,9
        #   mixed:                stop_type=1,RLS,9
        # stop_types is checked first; falls back to stop_type
        raw = p.get('stop_types') or p.get('stop_type')
        if raw:
            parts = [v.strip() for v in raw.split(',') if v.strip()]
            ids   = [int(v) for v in parts if v.isdigit()]
            codes = [v for v in parts if not v.isdigit()]
            if ids and codes:
                qs = qs.filter(Q(stop_type_id__in=ids) | Q(stop_type__code__in=codes))
            elif ids:
                qs = qs.filter(stop_type_id__in=ids)
            elif codes:
                qs = qs.filter(stop_type__code__in=codes)

        # ── active ────────────────────────────────────────────────────────
        active_param = p.get('active')
        # Default behaviour: only return active stops unless caller requests otherwise.
        if active_param is None:
            qs = qs.filter(show_on_map=True)
        else:
            ap = active_param.lower()
            if ap in ('all', '*'):
                # no filtering, return both active and inactive
                pass
            elif ap in ('1', 'true', 't', 'yes', 'y'):
                qs = qs.filter(show_on_map=True)
            elif ap in ('0', 'false', 'f', 'no', 'n'):
                qs = qs.filter(show_on_map=False)

        # ── bounding box ──────────────────────────────────────────────────
        # Format A: individual params  min_lat=, max_lat=, min_lon=, max_lon=
        # Format B: combined param     bbox=min_lon,min_lat,max_lon,max_lat
        min_lat = max_lat = min_lon = max_lon = None

        if p.get('min_lat') or p.get('max_lat') or p.get('min_lon') or p.get('max_lon'):
            try:
                min_lat = float(p['min_lat'])
                max_lat = float(p['max_lat'])
                min_lon = float(p['min_lon'])
                max_lon = float(p['max_lon'])
            except (KeyError, ValueError, TypeError):
                pass

        elif p.get('bbox'):
            parts = p['bbox'].split(',')
            if len(parts) == 4:
                try:
                    min_lon, min_lat, max_lon, max_lat = map(float, parts)
                except ValueError:
                    pass

        if None not in (min_lat, max_lat, min_lon, max_lon):
            qs = qs.filter(
                lat__gte=min_lat, lat__lte=max_lat,
                lon__gte=min_lon, lon__lte=max_lon,
            )

        return qs


@api_view(['GET', 'POST'])
def enrich_stop(request):
    print('enrich_stop called with method', request.method)
    """Fetch bustimes.org for a single stop (by ATCO) and persist updates.

    Accepts either GET ?atco=... or POST { atco: '...' }.
    Returns the serialized Stop and any applied updates.
    """
    atco = None
    if request.method == 'POST':
        atco = request.data.get('atco') or request.data.get('atco_code')
    if not atco:
        atco = request.query_params.get('atco')

    if not atco:
        return Response({'detail': 'Missing atco parameter'}, status=status.HTTP_400_BAD_REQUEST)

    atco = atco.strip()
    try:
        stop = Stop.objects.get(atco_code__iexact=atco)
    except Stop.DoesNotExist:
        return Response({'detail': 'Stop not found'}, status=status.HTTP_404_NOT_FOUND)

    url = f'https://bustimes.org/api/stops/{atco}'
    session = requests.Session()
    session.headers.update({'User-Agent': 'TransportStatistics/1.0'})
    try:
        resp = session.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return Response({'detail': f'Failed to fetch bustimes: {e}'}, status=status.HTTP_502_BAD_GATEWAY)

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

    updates = {}
    if item:
        ln = item.get('line_names') or item.get('lines') or None
        if isinstance(ln, list):
            ln_val = ','.join([str(x) for x in ln if x])
        elif isinstance(ln, str):
            ln_val = ln
        else:
            ln_val = None
        if ln_val and (stop.lines or '') != ln_val:
            updates['lines'] = ln_val

        icon = item.get('icon')
        if icon and (stop.icon or '') != icon:
            updates['icon'] = icon

        name_val = item.get('name')
        if name_val and (stop.common_name or '') != name_val:
            updates['common_name'] = name_val

        long_name = item.get('long_name')
        if long_name and (stop.long_name or '') != long_name:
            updates['long_name'] = long_name

    if updates:
        for k, v in updates.items():
            setattr(stop, k, v)
        try:
            with transaction.atomic():
                stop.save()
        except Exception as e:
            return Response({'detail': f'Failed to save: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    serializer = StopSerializer(stop)
    return Response({'stop': serializer.data, 'updates': updates, 'updated': bool(updates)}, status=status.HTTP_200_OK)


@api_view(['GET'])
def fleet_search(request):
    q = (request.query_params.get('q') or '').strip()

    qs = Trains.objects.all().order_by('fleetnumber')
    if q:
        qs = qs.filter(fleetnumber__icontains=q)

    serializer = FleetSerializer(qs[:500], many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)
