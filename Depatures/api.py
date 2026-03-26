from itertools import groupby

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Timetable, ScheduleLocation
from django.db.models import Q, Prefetch
from rest_framework.viewsets import GenericViewSet
from django_filters.rest_framework import DjangoFilterBackend
import datetime
from typing import Optional
from rest_framework.viewsets import ViewSet
from .filters import DeparturesFilter
import datetime
import requests
from bs4 import BeautifulSoup
from django.core.cache import cache
import hashlib
import json
 
# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def _format_time(raw):
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    seconds = "00"
    if s.endswith("H"):
        s = s[:-1]
        seconds = "30"
    if ":" in s:
        parts = s.split(":")
        if len(parts) == 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{seconds}"
        if len(parts) >= 3:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"
    s = s.zfill(4)
    return f"{s[:2]}:{s[2:4]}:{seconds}"


def _to_seconds(raw_time: Optional[str]) -> Optional[int]:
    if not raw_time:
        return None
    formatted = _format_time(raw_time)
    if not formatted:
        return None
    try:
        hh, mm, ss = formatted.split(":")
        return int(hh) * 3600 + int(mm) * 60 + int(ss)
    except Exception:
        return None


def _readable_days(mask: str) -> Optional[str]:
    if not mask:
        return None
    s = str(mask).strip()
    if not s:
        return None
    s = s[:7].ljust(7, "0") if len(s) >= 7 else s.zfill(7)
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    picked = [days[i] for i, ch in enumerate(s) if ch == "1"]
    if not picked:
        return None
    if len(picked) == 7:
        return "Daily"
    idxs = [i for i, ch in enumerate(s) if ch == "1"]
    if len(idxs) > 1 and max(idxs) - min(idxs) + 1 == len(idxs):
        return f"{days[min(idxs)]} to {days[max(idxs)]}"
    return ", ".join(picked)


def _stop_info(stop_obj, request) -> Optional[dict]:
    if not stop_obj:
        return None
    # Cache stop metadata (excluding request-specific link) for 7 days to
    # reduce DB lookups. Build the link per-request so host/path are correct.
    try:
        cache_key = f"stop:{getattr(stop_obj, 'pk', None)}"
        cached = cache.get(cache_key)
    except Exception:
        cached = None

    if not cached:
        cached = {
            "name":   stop_obj.name,
            "crs":    stop_obj.crs,
            "tiploc": stop_obj.tiploc,
            "lat":    stop_obj.lat,
            "lon":    stop_obj.lon,
        }
        try:
            cache.set(cache_key, cached, 7 * 24 * 3600)  # 7 days
        except Exception:
            pass

    return {
        **cached,
        "link": request.build_absolute_uri(f"/api/departures/?crs={cached.get('crs')}") if cached.get('crs') else None,
    }


def _rtt_link(cif_uid: str, date: str) -> Optional[str]:
    if not cif_uid:
        return None
    return f"https://www.realtimetrains.co.uk/service/gb-nr:{cif_uid}/{date}/detailed"


def _time_info(loc) -> dict:
    arr = _format_time(loc.arrival_time)
    dep = _format_time(loc.departure_time)
    pas = _format_time(loc.pass_time)

    def _hhmm(t):
        return t[:5] if t else None

    if dep and arr:
        display = f"{_hhmm(arr)} - {_hhmm(dep)} | arr-dep"
    elif dep:
        display = f"{_hhmm(dep)} | dep"
    elif arr:
        display = f"{_hhmm(arr)} | arr"
    elif pas:
        display = f"{_hhmm(pas)} | pass"
    else:
        display = "-"

    sort_time = dep or arr or pas
    stop_type = "passing" if (pas and not arr and not dep) else "stopping"

    return {
        "arrival":   arr,
        "departure": dep,
        "pass":      pas,
        "display":   display,
        "sort_time": sort_time,
        "type":      stop_type,
    }


# ---------------------------------------------------------------------------
# Helpers to build the day-mask SQL filter
# ---------------------------------------------------------------------------

def _day_mask_q(weekday: int) -> Q:
    # Allow any characters before position, just check the bit itself
    prefix = "." * weekday
    return Q(timetable__schedule_days_runs__regex=rf"^{prefix}1")


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

BUSTIMES_URL = "https://bustimes.org/stops/{atco_code}/departures"
 
# User-agent so bustimes.org doesn't reject the request
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TransportStatistics/1.0)",
    "Accept": "text/html",
}

class BusDeparturesView(APIView):
    """
    Return upcoming bus departures for a stop by ATCO code.
 
    Scrapes bustimes.org and returns the same JSON shape as DeparturesView
    so the frontend can treat both APIs identically.
 
    Query parameters
    ────────────────
      atco_code   (required)  ATCO code of the stop.  e.g. 3890D001501
      date        (optional)  YYYY-MM-DD              default: today
      time        (optional)  HH:MM                   default: now
    """
 
    def get(self, request):
        atco_code = request.query_params.get("atco_code", "").strip()
        if not atco_code:
            return Response(
                {"detail": "Provide atco_code"},
                status=status.HTTP_400_BAD_REQUEST,
            )
 
        # ── date ──────────────────────────────────────────────────────────────
        date_str = request.query_params.get("date", "")
        if date_str:
            try:
                date_val = datetime.date.fromisoformat(date_str)
            except ValueError:
                return Response(
                    {"detail": "Invalid date format, use YYYY-MM-DD"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            date_val = datetime.date.today()
 
        # ── time ──────────────────────────────────────────────────────────────
        time_str = request.query_params.get("time", "")
        if time_str:
            t = time_str.strip()
            try:
                if ":" in t:
                    hh, mm = int(t.split(":")[0]), int(t.split(":")[1])
                else:
                    nt = t.zfill(4)
                    hh, mm = int(nt[:2]), int(nt[2:4])
                time_display = f"{hh:02d}:{mm:02d}"
            except (ValueError, IndexError):
                return Response(
                    {"detail": "Invalid time format, use HH:MM"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            now = datetime.datetime.now()
            hh, mm = now.hour, now.minute
            time_display = f"{hh:02d}:{mm:02d}"
 
        # ── fetch bustimes.org ────────────────────────────────────────────────
        upstream_url = BUSTIMES_URL.format(atco_code=atco_code)

        if date_str and time_str:
            params = {
                "date": date_val.isoformat(),
                "time": time_display,
            }
        else:
            params = {}
 
        try:
            resp = requests.get(
                upstream_url,
                params=params,
                headers=HEADERS,
                timeout=10,
            )
            resp.raise_for_status()
            print(f"Fetched {resp.url} with status {resp.status_code}")
        except requests.RequestException as exc:
            return Response(
                {"detail": f"Failed to fetch bustimes.org: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # ── TfL two-pass merge ────────────────────────────────────────────────
        # The plain (no date/time) TfL response has cols: service | To | Expected
        # and only /vehicles/tfl/ links — no scheduled times.
        # The dated response has cols: service | To | Scheduled  and /trips/ links
        # but no expected times.
        # We fetch both and merge by normalised vehicle plate so each result
        # has both scheduled and expected.
        #
        # Vehicle normalisation: strip all spaces and uppercase.
        #   plain call  → "LV25VOU"        (already bare)
        #   dated call  → "MHV85 - BV66 VKF" → we take the LAST token after " - "
        #                 then strip spaces → "BV66VKF"

        def _normalise_plate(raw: str) -> str:
            """Return uppercased plate with spaces removed.  Handles 'fleet - PLATE' format."""
            if not raw:
                return ""
            part = raw.split(" - ")[-1]   # take plate half if fleet prefix present
            return part.replace(" ", "").upper()

        def _parse_tfl_expected(html_text: str) -> dict:
            """Parse expected-only TfL response → {normalised_plate: expected_time}"""
            s = BeautifulSoup(html_text, "html.parser")
            tb = s.find("tbody")
            mapping = {}
            if not tb:
                return mapping
            for row in tb.find_all("tr"):
                if row.find("th"):
                    continue
                cells = row.find_all(["td", "th"])
                if len(cells) < 3:
                    continue
                vdiv = cells[1].find("div", class_="vehicle")
                plate = _normalise_plate(vdiv.get_text(strip=True)) if vdiv else ""
                if not plate:
                    continue
                exp_link = cells[2].find("a")
                exp_time = (exp_link.get_text(strip=True) if exp_link else cells[2].get_text(strip=True)).strip()
                if plate and exp_time:
                    mapping[plate] = exp_time
            return mapping

        # expected_by_plate is only populated for TfL stops
        expected_by_plate: dict = {}

        is_tfl_stop = not params and "/vehicles/tfl/" in resp.text
        if is_tfl_stop:
            # Build expected lookup from the plain response BEFORE re-fetching
            expected_by_plate = _parse_tfl_expected(resp.text)
            tfl_params = {
                "date": date_val.isoformat(),
                "time": time_display,
            }
            try:
                tfl_resp = requests.get(
                    upstream_url,
                    params=tfl_params,
                    headers=HEADERS,
                    timeout=10,
                )
                tfl_resp.raise_for_status()
                print(f"TfL re-fetch {tfl_resp.url} with status {tfl_resp.status_code}")
                resp = tfl_resp   # swap to dated response for scheduled times + trip IDs
            except requests.RequestException as exc:
                # Non-fatal — fall through, parse original, no scheduled times available
                print(f"TfL re-fetch failed, using original response: {exc}")
                expected_by_plate = {}   # reset; original response only has expected

        # ── parse HTML ────────────────────────────────────────────────────────
        soup  = BeautifulSoup(resp.text, "html.parser")
        tbody = soup.find("tbody")
 
        if not tbody:
            return Response({
                "date":    date_val.isoformat(),
                "station": {"atco_code": atco_code},
                "results": [],
            })

        # ── detect layout from header ─────────────────────────────────────────
        # expected-only:  service | To | Expected        (TfL plain, re-fetch failed)
        # standard:       service | To | Scheduled       (TfL dated, or non-TfL with/without Expected col)
        header_row   = tbody.find("tr")
        header_texts = [th.get_text(strip=True).lower() for th in header_row.find_all("th")] if header_row else []
        tfl_expected_only = "expected" in header_texts and "scheduled" not in header_texts
 
        rows    = tbody.find_all("tr")
        results = []
 
        for row in rows:
            cells = row.find_all(["td", "th"])
 
            # skip header rows
            if row.find("th"):
                continue
 
            if len(cells) < 3:
                continue
 
            # ── service / headcode ─────────────────────────────────────────
            service_cell = cells[0]
            service_link = service_cell.find("a")
            headcode     = service_link.get_text(strip=True) if service_link else ""
            service_href = service_link.get("href", "") if service_link else ""
            service_url  = f"https://bustimes.org{service_href}" if service_href else None
 
            # ── destination + vehicle ──────────────────────────────────────
            dest_cell   = cells[1]
            vehicle_div = dest_cell.find("div", class_="vehicle")
            vehicle_raw = vehicle_div.get_text(strip=True) if vehicle_div else None
            if vehicle_div:
                vehicle_div.decompose()
            destination = dest_cell.get_text(strip=True)

            # Normalise plate for lookup (handles both plain and dated formats)
            plate_key = _normalise_plate(vehicle_raw) if vehicle_raw else ""

            # ── expected-only layout (TfL plain response, re-fetch failed) ─
            if tfl_expected_only:
                exp_cell  = cells[2]
                exp_link  = exp_cell.find("a")
                exp_text  = (exp_link.get_text(strip=True) if exp_link else exp_cell.get_text(strip=True)).strip()
                exp_href  = exp_link.get("href", "") if exp_link else ""

                scheduled = None
                expected  = exp_text or None
                trip_href = exp_href
                trip_url  = f"https://bustimes.org{trip_href}" if trip_href else None
                trip_id   = trip_href.split("/vehicles/tfl/")[-1] if "/vehicles/tfl/" in trip_href else None

            # ── standard layout: col 2 = Scheduled, optional col 3 = Expected
            else:
                sched_cell = cells[2]
                sched_link = sched_cell.find("a")
                scheduled  = (sched_link.get_text(strip=True) if sched_link else sched_cell.get_text(strip=True)).strip()
                trip_href  = sched_link.get("href", "") if sched_link else ""
                trip_url   = f"https://bustimes.org{trip_href}" if trip_href else None

                trip_id = trip_href.split("/trips/")[-1] if "/trips/" in trip_href else None
                if trip_id is None and "/vehicles/tfl/" in trip_href:
                    trip_id = trip_href.split("/vehicles/tfl/")[-1]

                # Try col 3 first, then fall back to expected_by_plate lookup
                expected = None
                if len(cells) >= 4:
                    exp_cell = cells[3]
                    exp_link = exp_cell.find("a")
                    exp_text = (exp_link.get_text(strip=True) if exp_link else exp_cell.get_text(strip=True)).strip()
                    if exp_text:
                        expected = exp_text

                # TfL dated response has no expected col — look up by plate
                if expected is None and plate_key and plate_key in expected_by_plate:
                    expected = expected_by_plate[plate_key]
 
            # ── assemble result in same shape as DeparturesView ────────────
            results.append({
                "headcode":    headcode,
                "service_url": service_url,
                "rtt_link":    trip_url,
                "trip_id":     trip_id,
                "operator":    None,
                "platform":    None,
                "vehicle":     plate_key or None,
                "destination": {"name": destination, "crs": None},
                "origin":      None,
                "time": {
                    "arrival":             None,
                    "departure":           scheduled,
                    "expected_departure":  expected,
                    "pass":                None,
                    "display":             scheduled,
                    "sort_time":           scheduled,
                    "type":                "stopping",
                },
                "schedule_days_runs": None,
                "cif_train_uid":      None,
            })
 
        return Response({
            "date":    date_val.isoformat(),
            "station": {"atco_code": atco_code},
            "results": results,
        })
 
class TrainDeparturesView(APIView):
    """
    Return the next 10 departures for a station identified by CRS or TIPLOC.

    Query parameters
    ────────────────
      crs              CRS code                    e.g. SOT
      tiploc           TIPLOC code                 e.g. STOKEOT
      date             YYYY-MM-DD                  default: today
      time             HH:MM or HHMM               default: now
      show_zz          1 / true / yes              default: hidden
      type             stopping | passing
      headcode         exact headcode match        e.g. 1V45
      operator         partial name or exact code  e.g. CrossCountry
    """

    _SELECT = [
        "id", "stop_id", "timetable_id",
        "departure_time", "arrival_time", "pass_time", "sort_time",
        "platform", "tiploc_code",
        "stop__name", "stop__crs", "stop__tiploc", "stop__lat", "stop__lon",
        "timetable__CIF_train_uid",
        "timetable__headcode",
        "timetable__schedule_days_runs",
        "timetable__schedule_start_date",
        "timetable__schedule_end_date",
        "timetable__operator__name",
        "timetable__operator__code",
    ]

    def get(self, request):
        crs     = request.query_params.get("crs", "").strip()
        show_passing = request.query_params.get("show_passing", "").lower() in ("1", "true", "yes")
        tiploc  = request.query_params.get("tiploc", "").strip()
        show_zz = request.query_params.get("show_zz", "").lower() in ("1", "true", "yes")
        show_arrivals = request.query_params.get("show_arrivals", "").lower() in ("1", "true", "yes")

        if show_zz:
            show_passing = True

        # ── optional filters (MOVE THIS UP — was breaking cache) ──
        type_filter     = request.query_params.get("type", "").lower() or None
        headcode_filter = request.query_params.get("headcode", "").strip()
        operator_filter = request.query_params.get("operator", "").strip()

        if not crs and not tiploc:
            return Response({"detail": "Provide crs or tiploc"}, status=400)

        if type_filter and type_filter not in ("stopping", "passing"):
            return Response({"detail": "type must be 'stopping' or 'passing'"}, status=400)

        # ── date ──────────────────────────────────────────────
        date_str = request.query_params.get("date", "")
        if date_str:
            try:
                date_val = datetime.date.fromisoformat(date_str)
            except ValueError:
                return Response({"detail": "Invalid date, use YYYY-MM-DD"}, status=400)
        else:
            date_val = datetime.date.today()

        # ── time ──────────────────────────────────────────────
        time_str = request.query_params.get("time", "")
        if time_str:
            t = time_str.strip()
            try:
                if ":" in t:
                    parts = t.split(":")
                    hh, mm = int(parts[0]), int(parts[1])
                    ss = int(parts[2]) if len(parts) > 2 else 0
                else:
                    nt = t.zfill(4)
                    hh, mm, ss = int(nt[:2]), int(nt[2:4]), 0
            except Exception:
                return Response({"detail": "Invalid time format"}, status=400)
        else:
            now = datetime.datetime.now()
            hh, mm, ss = now.hour, now.minute, now.second

        threshold_secs     = hh * 3600 + mm * 60 + ss
        threshold_sort_str = f"{hh:02d}:{mm:02d}:{ss:02d}"

        # ── caching ───────────────────────────────────────────
        try:
            cache_ttl = 30
            cache_params = {
                "crs": crs,
                "tiploc": tiploc,
                "date": date_val.isoformat(),
                "time": threshold_sort_str,
                "show_passing": show_passing,
                "show_zz": show_zz,
                "type": type_filter,
                "headcode": headcode_filter,
                "operator": operator_filter,
                "show_arrivals": show_arrivals,
            }
            cache_key_raw = "train_departures:" + json.dumps(cache_params, sort_keys=True, separators=(',',':'))
            cache_key = "tdv:" + hashlib.sha1(cache_key_raw.encode('utf-8')).hexdigest()

            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)
        except Exception:
            cache_key = None

        weekday = date_val.weekday()

        # ── DB filters ────────────────────────────────────────
        loc_q = Q()
        if crs:
            loc_q |= Q(stop__crs__iexact=crs)
        if tiploc:
            loc_q |= Q(tiploc_code__iexact=tiploc) | Q(stop__tiploc__iexact=tiploc)

        date_q = (
            Q(timetable__schedule_start_date__lte=date_val) | Q(timetable__schedule_start_date__isnull=True)
        ) & (
            Q(timetable__schedule_end_date__gte=date_val)   | Q(timetable__schedule_end_date__isnull=True)
        )

        time_q = Q(sort_time__gte=threshold_sort_str)

        extra_q = Q()
        if headcode_filter:
            extra_q &= Q(timetable__headcode__iexact=headcode_filter)
        if operator_filter:
            extra_q &= (
                Q(timetable__operator__name__icontains=operator_filter) |
                Q(timetable__operator__code__iexact=operator_filter)
            )
        if not show_zz:
            extra_q &= ~Q(timetable__headcode__istartswith="ZZ")
            extra_q &= ~Q(timetable__operator__code__istartswith="ZZ")

        # ⚠️ IMPORTANT: keep DB filter SIMPLE — do NOT try to be clever here
        if not show_passing:
            stop_q = Q(departure_time__isnull=False) | Q(arrival_time__isnull=False)
        else:
            stop_q = Q()

        qs = (
            ScheduleLocation.objects
            .filter(loc_q & date_q & time_q & extra_q & stop_q)
            .select_related("stop", "timetable", "timetable__operator")
            .only(*self._SELECT)
            .order_by("sort_time")
        )

        # ── Python filtering (SOURCE OF TRUTH) ─────────────────
        station_info = None
        valid = []

        for loc in qs.iterator(chunk_size=500):
            tt = loc.timetable

            # Day filter
            if tt:
                mask = (tt.schedule_days_runs or "").strip()
                mask = (mask + "0000000")[:7]
                if mask[weekday] != "1":
                    continue

            # ZZ filter
            if not show_zz and tt:
                hc  = (tt.headcode or "").upper()
                opc = (tt.operator.code or "").upper() if tt.operator else ""
                if hc.startswith("ZZ") or opc.startswith("ZZ"):
                    continue

            ti = _time_info(loc)

            if not show_passing and not show_zz and not show_arrivals and not ti.get("departure"):
                continue

            # Type filter
            if type_filter and ti["type"] != type_filter:
                continue

            if station_info is None and loc.stop:
                station_info = _stop_info(loc.stop, request)

            valid.append((loc, ti))
            if len(valid) >= 10:
                break

        # ── origin/destination ────────────────────────────────
        timetable_ids = {loc.timetable_id for loc, _ in valid if loc.timetable_id}

        origin_map = {}
        destination_map = {}

        if timetable_ids:
            all_locs = (
                ScheduleLocation.objects
                .filter(timetable_id__in=timetable_ids)
                .select_related("stop")
                .only(
                    "timetable_id", "position",
                    "stop__name", "stop__crs", "stop__tiploc", "stop__lat", "stop__lon",
                )
                .order_by("timetable_id", "position")
            )

            for tt_id, grp in groupby(all_locs, key=lambda l: l.timetable_id):
                locs_list = list(grp)
                origin_map[tt_id]      = _stop_info(locs_list[0].stop, request)
                destination_map[tt_id] = _stop_info(locs_list[-1].stop, request)

        # ── response ──────────────────────────────────────────
        results = []
        for loc, ti in valid:
            tt = loc.timetable
            tt_id = loc.timetable_id
            op = (tt.operator.name or tt.operator.code) if (tt and tt.operator) else None

            results.append({
                "time": ti,
                "platform": loc.platform,
                "origin": origin_map.get(tt_id) or "Unknown",
                "destination": destination_map.get(tt_id) or "Unknown",
                "cif_train_uid": tt.CIF_train_uid if tt else None,
                "headcode": tt.headcode if tt else None,
                "operator": op,
                "schedule_days_runs": _readable_days(tt.schedule_days_runs) if tt else None,
                "rtt_link": _rtt_link(tt.CIF_train_uid, date_val.isoformat()) if tt else None,
            })

        response_data = {
            "date": date_val.isoformat(),
            "time_after": threshold_secs,
            "station": station_info,
            "results": results,
        }

        if cache_key:
            cache.set(cache_key, response_data, cache_ttl)

        return Response(response_data)

# ---------------------------------------------------------------------------
# ServiceLocationsView
# ---------------------------------------------------------------------------

class ServiceLocationsView(APIView):
    def get(self, request):
        headcode = request.query_params.get("headcode")
        cif      = request.query_params.get("cif_train_uid")
        
        if not headcode and not cif:
            return Response(
                {"detail": "Provide headcode or cif_train_uid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Avoid fetching auto-managed datetime fields that may be returned
        # as strings by some DB connectors; defer them so Django doesn't
        # run timezone conversion on raw strings.
        qs = Timetable.objects.all().defer('created_at', 'modified_at')
        if cif:
            qs = qs.filter(CIF_train_uid=cif)
        if headcode:
            qs = qs.filter(headcode=headcode)

        count = qs.count()
        if count == 0:
            return Response({"detail": "Timetable not found"}, status=status.HTTP_404_NOT_FOUND)

        if count > 1:
            matches = []
            for t in qs.order_by("schedule_start_date"):
                op   = t.operator.name or t.operator.code if t.operator else None
                link = request.build_absolute_uri(
                    f"{request.path}?cif_train_uid={t.CIF_train_uid}"
                )
                matches.append({
                    "operator":           op,
                    "timetable":          t.CIF_train_uid,
                    "schedule_days_runs": _readable_days(t.schedule_days_runs),
                    "link":               link,
                })
            return Response({"detail": "more than one service found", "matches": matches})

        timetable = qs.first()
        # Coerce schedule date fields in case the DB returned strings
        def _coerce_date(value):
            if isinstance(value, str):
                try:
                    return datetime.date.fromisoformat(value)
                except Exception:
                    try:
                        return datetime.datetime.fromisoformat(value).date()
                    except Exception:
                        return value
            return value
        locations = (
            timetable.location_entries.all()
            .select_related('stop')
            .order_by("position", "departure_time", "arrival_time", "pass_time")
        )

        results = []
        for loc in locations:
            results.append({
                "stop":     _stop_info(loc.stop, request),
                "time":     _time_info(loc),
                "platform": loc.platform,
            })

        return Response({
            "timetable":          timetable.CIF_train_uid,
            "headcode":           timetable.headcode,
            "schedule_days_runs": _readable_days(timetable.schedule_days_runs),
            "schedule_start_date": _coerce_date(timetable.schedule_start_date),
            "schedule_end_date": _coerce_date(timetable.schedule_end_date),
            "locations":          results,
        })

class BusServiceView(APIView):
    """
    Return full trip details for a bustimes trip ID.
    Chains three bustimes API calls:
      1. /api/trips/{id}/           — stops/times/route
      2. /api/vehiclejourneys/?trip={id}&datetime={start}  — vehicle assignment
      3. /api/vehicles/?id={vehicle_id}  — full vehicle details

    Query parameters
    ────────────────
      trip    (required)  bustimes trip ID  e.g. 595082572
    """

    BUSTIMES_HEADERS = {
        "User-Agent": "Mozilla/5.0 (compatible; TransportStatistics/1.0)",
        "Accept": "application/json",
    }

    def _get(self, url: str, params: dict = None) -> dict:
        """Make a GET request to bustimes API, raise on failure."""
        resp = requests.get(url, params=params, headers=self.BUSTIMES_HEADERS, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get(self, request):
        trip_id = request.query_params.get("trip", "").strip()
        if not trip_id:
            return Response({"detail": "Provide trip"}, status=status.HTTP_400_BAD_REQUEST)

        # ── 1. Fetch trip ──────────────────────────────────────────────────
        try:
            trip = self._get(f"https://bustimes.org/api/trips/{trip_id}/")
            print(f"[BusService] Trip fetched OK: id={trip.get('id')} stops={len(trip.get('times') or [])}")
        except requests.RequestException as e:
            print(f"[BusService] Trip fetch FAILED: {e}")
            return Response({"detail": f"Failed to fetch trip: {e}"}, status=status.HTTP_502_BAD_GATEWAY)

        vehicle_info  = None
        vehicle_extra = None
        times = trip.get("times") or []

        # ── 2. Find start time ─────────────────────────────────────────────
        start_time_str = None
        for t in times:
            start_time_str = t.get("aimed_departure_time") or t.get("aimed_arrival_time")
            if start_time_str:
                break

        print(f"[BusService] Start time from first stop: {start_time_str!r}")

        if start_time_str:
            try:
                # Use ?date= param if provided, otherwise fall back to today
                date_str = request.query_params.get("date", "").strip() or datetime.date.today().isoformat()
                dt_param = f"{date_str}T{start_time_str}:00Z"
                print(f"[BusService] Fetching vehicle journeys: trip={trip_id} datetime={dt_param}")

                journey_data = self._get(
                    "https://bustimes.org/api/vehiclejourneys/",
                    params={"trip": trip_id, "datetime": dt_param},
                )
                print(f"[BusService] Vehicle journeys response: count={journey_data.get('count')} results={len(journey_data.get('results') or [])}")
                print(f"[BusService] Full journey response: {journey_data}")

                results = journey_data.get("results") or []
                if not results:
                    print("[BusService] WARNING: No vehicle journey results — vehicle will be null")
                else:
                    vehicle_info = results[0].get("vehicle")
                    print(f"[BusService] Vehicle info from journey: {vehicle_info}")

                    if not vehicle_info:
                        print("[BusService] WARNING: Journey result has no 'vehicle' field")
                    elif not vehicle_info.get("id"):
                        print(f"[BusService] WARNING: Vehicle has no id: {vehicle_info}")
                    else:
                        vid = vehicle_info["id"]
                        print(f"[BusService] Fetching vehicle details: id={vid}")
                        vehicle_data = self._get(
                            "https://bustimes.org/api/vehicles/",
                            params={"id": vid},
                        )
                        print(f"[BusService] Vehicle details response: count={vehicle_data.get('count')} results={len(vehicle_data.get('results') or [])}")
                        print(f"[BusService] Full vehicle response: {vehicle_data}")

                        v_results = vehicle_data.get("results") or []
                        if v_results:
                            vehicle_extra = v_results[0]
                            print(f"[BusService] Vehicle extra OK: fleet={vehicle_extra.get('fleet_code')} reg={vehicle_extra.get('reg')}")
                        else:
                            print(f"[BusService] WARNING: Vehicle API returned no results for id={vid}")

            except requests.RequestException as e:
                print(f"[BusService] Vehicle lookup FAILED with exception: {type(e).__name__}: {e}")
                logger.warning("Vehicle journey lookup failed for trip %s: %s", trip_id, e)

        # ── Build normalised locations list ────────────────────────────────
        # Matches the shape expected by the log-trip frontend (stop + time block)
        locations = []
        for entry in times:
            stop = entry.get("stop") or {}
            loc  = stop.get("location") or [None, None]

            arr = entry.get("aimed_arrival_time")
            dep = entry.get("aimed_departure_time")

            # Display string mirrors the train service API format
            if arr and dep and arr != dep:
                display = f"{arr} - {dep} | arr-dep"
            elif dep:
                display = f"{dep} | dep"
            elif arr:
                display = f"{arr} | arr"
            else:
                display = "-"

            locations.append({
                "stop": {
                    "name":      stop.get("name"),
                    "atco_code": stop.get("atco_code"),
                    "lat":       loc[1] if len(loc) > 1 else None,
                    "lon":       loc[0] if len(loc) > 0 else None,
                    "crs":       None,
                    "tiploc":    None,
                },
                "time": {
                    "arrival":   arr,
                    "departure": dep,
                    "pass":      None,
                    "display":   display,
                    "sort_time": dep or arr,
                    "type":      "stopping",
                },
                "platform":      None,
                "timing_status": entry.get("timing_status"),
                "pick_up":       entry.get("pick_up", True),
                "set_down":      entry.get("set_down", True),
                # Raw track geometry for the map (list of [lon, lat] pairs)
                "track":         entry.get("track"),
            })

        # ── Build vehicle block ────────────────────────────────────────────
        vehicle = None
        if vehicle_extra:
            print("Vehicle extra:", vehicle_extra)
            vt      = vehicle_extra.get("vehicle_type") or {}
            livery  = vehicle_extra.get("livery") or {}
            vehicle = {
                "id":           vehicle_extra.get("id"),
                "fleet_number": vehicle_extra.get("fleet_code") or vehicle_extra.get("fleet_number"),
                "reg":          vehicle_extra.get("reg"),
                "type":         vt.get("name"),
                "style":        vt.get("style"),
                "double_decker": vt.get("double_decker"),
                "electric":     vt.get("electric"),
                "livery_name":  livery.get("name"),
                "livery_left":  livery.get("left"),
                "livery_right": livery.get("right"),
                "special_features": vehicle_extra.get("special_features") or [],
            }
        elif vehicle_info:
            print("Vehicle info:", vehicle_info)
            # Fallback — only basic info from the journey endpoint
            vehicle = {
                "id":           vehicle_info.get("id"),
                "fleet_number": vehicle_info.get("fleet_code"),
                "reg":          vehicle_info.get("reg"),
            }

        # ── Operator block ─────────────────────────────────────────────────
        op_raw   = trip.get("operator") or {}
        service  = trip.get("service") or {}
        operator = {
            "name": op_raw.get("name"),
            "noc":  op_raw.get("noc"),
            "slug": op_raw.get("slug"),
        }

        return Response({
            "trip_id":   trip.get("id"),
            "headcode":  service.get("line_name"),
            "headsign":  trip.get("headsign"),
            "mode":      service.get("mode", "bus"),
            "operator":  operator,
            "vehicle":   vehicle,
            "locations": locations,
        })


class BusServiceViewSet(ViewSet):
    def list(self, request):
        return BusServiceView().get(request)

class ServiceLocationsViewSet(ViewSet):
    def list(self, request):
        return ServiceLocationsView().get(request)

class BusDeparturesViewSet(ViewSet):
    def list(self, request):
        return BusDeparturesView().get(request)

class TrainDeparturesViewSet(ViewSet):
    def list(self, request):
        return TrainDeparturesView().get(request)