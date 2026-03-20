from django.db.models import Q
from rest_framework import viewsets
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.filters import SearchFilter, OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend
from .serializers import StopSerializer
from Stops.models import Stop


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
      active         Boolean: 1/true/yes or 0/false/no.

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
        if active_param is not None:
            if active_param.lower() in ('1', 'true', 't', 'yes', 'y'):
                qs = qs.filter(active=True)
            elif active_param.lower() in ('0', 'false', 'f', 'no', 'n'):
                qs = qs.filter(active=False)

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