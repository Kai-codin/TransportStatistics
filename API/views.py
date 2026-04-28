import logging
from django.db.models import Q
from urllib.parse import urlencode
import time
from datetime import timedelta
import threading

import requests
from django.db import transaction
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status
from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from django.utils import timezone
from django.core.cache import cache
from django.http import JsonResponse
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from django.db.models import F

from .serializers import StopSerializer, FleetSerializer, TrainFleetVehicleSerializer
from Stops.models import Stop
from main.models import Operator, Trains, TrainRID

logger = logging.getLogger(__name__)


class StopPagination(LimitOffsetPagination):
    default_limit = 100
    max_limit = 1000000


class StopViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only Stops API with text, type, active-state, and bbox filters."""

    serializer_class   = StopSerializer
    pagination_class   = StopPagination
    filter_backends    = (DjangoFilterBackend, SearchFilter, OrderingFilter)
    filterset_fields   = ('active', 'crs', 'atco_code', 'naptan_code', 'tiploc')
    search_fields      = ('name',)
    ordering_fields    = ('id', 'name', 'lat', 'lon')

    def get_queryset(self):
        p  = self.request.query_params
        qs = Stop.objects.select_related('stop_type').all()

        q = p.get('q')
        if q:
            qs = qs.filter(name__icontains=q)

        for field in ('crs', 'atco_code', 'naptan_code', 'tiploc'):
            val = p.get(field)
            if val:
                qs = qs.filter(**{field: val})

        # Accept comma-separated stop type IDs/codes.
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

        active_param = p.get('active')
        if active_param is None:
            qs = qs.filter(show_on_map=True)
        else:
            ap = active_param.lower()
            if ap in ('all', '*'):
                pass
            elif ap in ('1', 'true', 't', 'yes', 'y'):
                qs = qs.filter(show_on_map=True)
            elif ap in ('0', 'false', 'f', 'no', 'n'):
                qs = qs.filter(show_on_map=False)

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


# ── Signalbox endpoints ────────────────────────────────────────────────────────
_SB_LOCATIONS_URL = "https://map-api.production.signalbox.io/api/locations"
_SB_TRAIN_INFO_URL = "https://map-api.production.signalbox.io/api/train-information/{rid}"
 
RID_MAX_AGE_HOURS = 6
_RATE_LIMIT_DELAY = 0.5   # 2 req/s
_ENRICH_TIMEOUT   = 0.1   # seconds before we give up waiting and return what we have
 
 
# ── helpers ────────────────────────────────────────────────────────────────────
 
def _parse_rid_payload(data: dict) -> dict:
    return dict(
        headcode=data.get("headcode") or "",
        uid=data.get("uid") or "",
        toc_code=data.get("toc_code") or "",
        train_operator=data.get("train_operator") or "",
        origin_crs=data.get("origin_crs") or "",
        origin_name=data.get("origin_name") or "",
        origin_departure=data.get("origin_departure") or None,
        destination_crs=data.get("destination_crs") or "",
        destination_name=data.get("destination_name") or "",
        destination_arrival=data.get("destination_arrival") or None,
    )
 
 
def _fetch_and_cache_rid(rid: str) -> "TrainRID | None":
    url = _SB_TRAIN_INFO_URL.format(rid=rid)
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch RID %s from Signalbox: %s", rid, exc)
        return None
 
    defaults = _parse_rid_payload(data)
    obj, _ = TrainRID.objects.update_or_create(rid=rid, defaults=defaults)
    return obj


def _serialize_rid_detail(detail: "TrainRID") -> dict:
    return dict(
        rid=detail.rid,
        headcode=detail.headcode,
        uid=detail.uid,
        toc_code=detail.toc_code,
        train_operator=detail.train_operator,
        origin_crs=detail.origin_crs,
        origin_name=detail.origin_name,
        origin_departure=_dt_to_str(detail.origin_departure),
        destination_crs=detail.destination_crs,
        destination_name=detail.destination_name,
        destination_arrival=_dt_to_str(detail.destination_arrival),
        fetched_at=_dt_to_str(detail.fetched_at),
    )


def _merge_rid_into_live_cache(detail: "TrainRID") -> None:
    cached = cache.get("live_trains_data")
    if not cached:
        return

    if isinstance(cached, dict) and "train_locations" in cached:
        _apply_detail_to_locations(cached["train_locations"], {detail.rid: detail})
    elif isinstance(cached, list):
        _apply_detail_to_locations(cached, {detail.rid: detail})
    else:
        return

    cache.set("live_trains_data", cached, 10)
 
 
def _dt_to_str(value) -> "str | None":
    """
    Safely convert a datetime field value to an ISO string.
    Django DateTimeField values are datetime objects when freshly queried,
    but may already be strings if they were stored as raw ISO strings
    (e.g. the Signalbox API returns '2026-04-28T19:49:00+01:00').
    Returns None for falsy values.
    """
    if not value:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()
 
 
def _apply_detail_to_locations(train_locations: list, cached_map: dict) -> list:
    """Merge whatever is in cached_map into the location dicts in-place."""
    for train in train_locations:
        rid = train.get("rid")
        if not rid:
            continue
        detail = cached_map.get(rid)
        if not detail:
            continue
        train.update(
            headcode=detail.headcode,
            uid=detail.uid,
            toc_code=detail.toc_code,
            train_operator=detail.train_operator,
            origin={
                "crs": detail.origin_crs,
                "name": detail.origin_name,
                "departure": _dt_to_str(detail.origin_departure),
            },
            destination={
                "crs": detail.destination_crs,
                "name": detail.destination_name,
                "arrival": _dt_to_str(detail.destination_arrival),
            },
        )
    return train_locations


def _enrich_train_locations(train_locations: list, deadline: float) -> list:
    """
    Enrich train_locations with RID detail.
 
    - Already-cached RIDs are merged immediately.
    - Missing RIDs are fetched from Signalbox at ≤ 2 req/s, but only until
      `deadline` (a time.monotonic() value) is reached – after which we return
      whatever has been enriched so far and let the background thread finish.
    """
    if not train_locations:
        return train_locations
 
    rids = [t["rid"] for t in train_locations if t.get("rid")]
    if not rids:
        return train_locations
 
    # ── 1. pull what we already have in the DB ─────────────────────────────
    stale_cutoff = timezone.now() - timedelta(hours=RID_MAX_AGE_HOURS)
    cached_qs = TrainRID.objects.filter(rid__in=rids, fetched_at__gte=stale_cutoff)
    cached_map: dict = {obj.rid: obj for obj in cached_qs}
 
    missing_rids = [r for r in rids if r not in cached_map]
    logger.debug(
        "RID enrich: %d total, %d cached, %d to fetch",
        len(rids), len(cached_map), len(missing_rids),
    )
 
    # ── 2. fetch missing RIDs – stop if we're past the deadline ────────────
    for i, rid in enumerate(missing_rids):
        if time.monotonic() >= deadline:
            logger.info(
                "RID enrich: deadline reached after %d/%d fetches – handing off to background",
                i, len(missing_rids),
            )
            break
        if i > 0:
            time.sleep(_RATE_LIMIT_DELAY)
        obj = _fetch_and_cache_rid(rid)
        if obj:
            cached_map[rid] = obj
 
    # ── 3. merge whatever we managed to fetch ──────────────────────────────
    return _apply_detail_to_locations(train_locations, cached_map)
 
 
def _background_enrich_and_cache(data: "dict | list", cache_key: str, cache_timeout: int) -> None:
    """
    Runs in a daemon thread after the response has already been sent.
    Finishes enriching any remaining missing RIDs (no deadline), then
    overwrites the Django cache so the next request gets complete data.
    """
    try:
        locations = data.get("train_locations", []) if isinstance(data, dict) else data
 
        rids = [t["rid"] for t in locations if t.get("rid")]
        if not rids:
            return
 
        stale_cutoff = timezone.now() - timedelta(hours=RID_MAX_AGE_HOURS)
        cached_qs = TrainRID.objects.filter(rid__in=rids, fetched_at__gte=stale_cutoff)
        cached_map: dict = {obj.rid: obj for obj in cached_qs}
        missing_rids = [r for r in rids if r not in cached_map]
 
        for i, rid in enumerate(missing_rids):
            if i > 0:
                time.sleep(_RATE_LIMIT_DELAY)
            obj = _fetch_and_cache_rid(rid)
            if obj:
                cached_map[rid] = obj
 
        _apply_detail_to_locations(locations, cached_map)
 
        # Overwrite the cache with the now-fully-enriched payload
        cache.set(cache_key, data, cache_timeout)
        logger.debug(
            "Background RID enrich complete – cache updated (%d RIDs, %d were missing)",
            len(rids), len(missing_rids),
        )
 
    except Exception:
        logger.exception("Background RID enrich thread raised an exception")
 
 
# ── view ───────────────────────────────────────────────────────────────────────
 
class live_trains_proxy(APIView):
    API_URL       = _SB_LOCATIONS_URL
    CACHE_KEY     = "live_trains_data"
    CACHE_TIMEOUT = 10   # seconds
 
    def get(self, request, *args, **kwargs):
        force_refresh = str(request.GET.get("refresh", "")).lower() in ("1", "true", "yes", "on")

        cached = cache.get(self.CACHE_KEY)
        if cached and not force_refresh:
            return Response(cached)
 
        # ── fetch raw locations from Signalbox ─────────────────────────────
        try:
            res = requests.get(self.API_URL, timeout=5)
            res.raise_for_status()
            data = res.json()
        except requests.RequestException:
            return Response({"error": "Failed to fetch train data"}, status=502)
 
        # ── enrich synchronously up to the timeout ─────────────────────────
        deadline = time.monotonic() + _ENRICH_TIMEOUT
 
        if isinstance(data, dict) and "train_locations" in data:
            data["train_locations"] = _enrich_train_locations(
                data["train_locations"], deadline
            )
        elif isinstance(data, list):
            data = _enrich_train_locations(data, deadline)
 
        # ── cache whatever we have so concurrent requests don't pile in ────
        cache.set(self.CACHE_KEY, data, self.CACHE_TIMEOUT)
 
        # ── if deadline fired, finish the rest in the background ───────────
        if time.monotonic() >= deadline:
            threading.Thread(
                target=_background_enrich_and_cache,
                args=(data, self.CACHE_KEY, self.CACHE_TIMEOUT),
                daemon=True,
            ).start()
 
        return Response(data)


@api_view(["GET"])
def refresh_train_detail(request):
    rid = (request.query_params.get("rid") or "").strip()
    if not rid:
        return Response({"detail": "Missing rid parameter"}, status=status.HTTP_400_BAD_REQUEST)

    detail = _fetch_and_cache_rid(rid)
    if not detail:
        return Response({"detail": "Failed to fetch RID details"}, status=status.HTTP_502_BAD_GATEWAY)

    _merge_rid_into_live_cache(detail)
    return Response({"updated": True, "detail": _serialize_rid_detail(detail)}, status=status.HTTP_200_OK)
 
class GetTrainOperatorsViewSet(ViewSet):
    def list(self, request):
        operators = (
            Operator.objects
            .values("slug", "name", "code")
            .order_by("name")
        )
        return Response(operators, status=status.HTTP_200_OK)
    
@api_view(['GET', 'POST'])
def enrich_stop(request):
    """Fetch bustimes.org for a single stop (by ATCO) and persist updates.

    Accepts either GET ?atco=... or POST { atco: '...' }.
    Returns the serialized Stop and any applied updates.
    """
    atco = None
    logger.debug("enrich_stop called method=%s", request.method)
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


@api_view(['GET'])
def train_fleet(request):
    params = request.query_params
    q = (params.get('q') or '').strip()
    operator = (params.get('operator') or '').strip()
    operator_id = (params.get('operator_id') or '').strip()

    try:
        limit = int(params.get('limit', 100))
    except ValueError:
        limit = 100
    try:
        offset = int(params.get('offset', 0))
    except ValueError:
        offset = 0

    limit = max(1, min(limit, 1000))
    offset = max(0, offset)

    qs = Trains.objects.select_related('operator').all().order_by('fleetnumber')

    if operator_id.isdigit():
        qs = qs.filter(operator_id=int(operator_id))
    elif operator:
        qs = qs.filter(operator__name__iexact=operator)

    if q:
        qs = qs.filter(
            Q(fleetnumber__icontains=q)
            | Q(type__icontains=q)
            | Q(livery_name__icontains=q)
            | Q(operator__name__icontains=q)
        )

    total = qs.count()
    page_qs = qs[offset:offset + limit]
    serializer = TrainFleetVehicleSerializer(page_qs, many=True)

    def build_link(new_offset: int) -> str | None:
        if new_offset < 0 or new_offset >= total:
            return None
        query = params.copy()
        query['limit'] = str(limit)
        query['offset'] = str(new_offset)
        return request.build_absolute_uri(f"{request.path}?{urlencode(query, doseq=True)}")

    payload = {
        'count': total,
        'next': build_link(offset + limit),
        'previous': build_link(offset - limit),
        'results': serializer.data,
    }
    return Response(payload, status=status.HTTP_200_OK)
