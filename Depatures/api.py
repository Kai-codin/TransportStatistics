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


def _to_seconds_from_raw(raw_time: Optional[str]) -> Optional[int]:
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
    return {
        "name":   stop_obj.name,
        "crs":    stop_obj.crs,
        "tiploc": stop_obj.tiploc,
        "lat":    stop_obj.lat,
        "lon":    stop_obj.lon,
        "link":   request.build_absolute_uri(f"/api/departures/?crs={stop_obj.crs}") if stop_obj.crs else None,
    }


def _rtt_link(CIF_train_uid: str, date: str) -> Optional[str]:
    if not CIF_train_uid:
        return None
    return f"https://www.realtimetrains.co.uk/service/gb-nr:{CIF_train_uid}/{date}/detailed"


def _time_info(loc) -> dict:
    """
    Build the rich time block for a ScheduleLocation.

    Returns
    -------
    {
        "arrival":   "HH:MM:SS" | null,
        "departure": "HH:MM:SS" | null,
        "pass":      "HH:MM:SS" | null,
        "display":   human-readable summary string,
        "sort_time": "HH:MM:SS" - time used for ordering (dep > arr > pass),
        "type":      "stopping" | "passing",
    }

    display format examples
    -----------------------
      Both arrival + departure  →  "13:21 - 13:23 | arr-dep"
      Departure only            →  "13:21 | dep"
      Arrival only              →  "13:21 | arr"
      Pass only                 →  "13:21 | pass"
      Nothing                   →  "-"

    type rules
    ----------
      "passing"  - pass time present, no arrival, no departure
      "stopping" - everything else (has arr, dep, or both)
    """
    arr = _format_time(loc.arrival_time)
    dep = _format_time(loc.departure_time)
    pas = _format_time(loc.pass_time)

    def _hhmm(t: Optional[str]) -> Optional[str]:
        """Trim HH:MM:SS → HH:MM for display."""
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


_WEEKDAY_CHAR = {i: i for i in range(7)}


# (filter docs live in the DeparturesView docstring below)


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
 
        # ── parse HTML ────────────────────────────────────────────────────────
        soup  = BeautifulSoup(resp.text, "html.parser")
        tbody = soup.find("tbody")
 
        if not tbody:
            return Response({
                "date":    date_val.isoformat(),
                "station": {"atco_code": atco_code},
                "results": [],
            })
 
        rows    = tbody.find_all("tr")
        results = []
 
        for row in rows:
            cells = row.find_all(["td", "th"])
 
            # skip header rows (contain <th> elements)
            if row.find("th"):
                continue
 
            # need at least 3 cells: service | destination | scheduled
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
            vehicle     = vehicle_div.get_text(strip=True) if vehicle_div else None
            if vehicle_div:
                vehicle_div.decompose()   # remove so remaining text is just destination
            destination = dest_cell.get_text(strip=True)
 
            # ── scheduled time + trip link ─────────────────────────────────
            sched_cell = cells[2]
            sched_link = sched_cell.find("a")
            scheduled  = sched_link.get_text(strip=True) if sched_link else sched_cell.get_text(strip=True)
            trip_href  = sched_link.get("href", "") if sched_link else ""
            trip_url   = f"https://bustimes.org{trip_href}" if trip_href else None
 
            # normalise time to HH:MM
            scheduled = scheduled.strip()
 
            # ── expected time (4th cell, present when live data available) ─
            expected = None
            if len(cells) >= 4:
                exp_cell = cells[3]
                exp_link = exp_cell.find("a")
                exp_text = (exp_link.get_text(strip=True) if exp_link else exp_cell.get_text(strip=True)).strip()
                if exp_text:
                    expected = exp_text
 
            # ── assemble result in same shape as DeparturesView ────────────
            results.append({
                "headcode":    headcode,
                "service_url": service_url,
                "rtt_link":    trip_url,          # frontend uses rtt_link for the headcode hyperlink
                "operator":    None,              # not available from bustimes table
                "platform":    None,
                "vehicle":     vehicle,
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
    Return upcoming departures for a station identified by CRS code or TIPLOC.

    All query parameters are optional unless marked required.
    Filters are additive (AND logic) - combine freely.

    ── Station (required, one of) ──────────────────────────────────────────
      crs        CRS code of the queried station.           e.g. MAN
      tiploc     TIPLOC of the queried station.             e.g. MNCRPIC

    ── Date / time window ──────────────────────────────────────────────────
      date       Timetable date (YYYY-MM-DD).               default: today
      time       Show services at or after this time        default: now
                 (HH:MM or HHMM).                           e.g. 14:30
      show_zz    Include ZZ engineering / ECS services.     default: hidden
                 Pass 1, true, or yes to enable.

    ── Service filters ─────────────────────────────────────────────────────
      headcode         Exact headcode match (case-insensitive).   e.g. 1A01
      operator         Partial operator name  OR  exact code.     e.g. Avanti
      day              Services running on a given day.
                       Accepts day name or index (Monday=0 … Sunday=6).
                                                                  e.g. Monday

    ── Origin / destination ────────────────────────────────────────────────
      origin_crs       CRS of the service's first stop.           e.g. EUS
      origin_name      Partial name of the service's first stop.  e.g. London
      destination_crs  CRS of the service's last stop.            e.g. GLC
      destination_name Partial name of the service's last stop.   e.g. Glasgow

    ── Stop type ───────────────────────────────────────────────────────────
      type       stopping  - service has an arrival and/or departure time.
                 passing   - pass time only; the train does not stop.
    """

    _CANDIDATE_ONLY = [
        "id",
        "stop_id",
        "timetable_id",
        "departure_time",
        "arrival_time",
        "pass_time",
        "platform",
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
        crs     = request.query_params.get("crs")
        tiploc  = request.query_params.get("tiploc")
        show_zz = request.query_params.get("show_zz", "").lower() in ("1", "true", "yes")

        if not crs and not tiploc:
            return Response(
                {"detail": "Provide crs or tiploc"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── date ─────────────────────────────────────────────────────────────
        date_str = request.query_params.get("date")
        if date_str:
            try:
                date_val = datetime.date.fromisoformat(date_str)
            except Exception:
                return Response(
                    {"detail": "Invalid date format, use YYYY-MM-DD"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            date_val = datetime.date.today()

        # ── time threshold ────────────────────────────────────────────────────
        time_str = request.query_params.get("time")
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
                threshold_seconds = hh * 3600 + mm * 60 + ss
            except Exception:
                return Response({"detail": "Invalid time format"}, status=status.HTTP_400_BAD_REQUEST)
        else:
            now = datetime.datetime.now()
            threshold_seconds = now.hour * 3600 + now.minute * 60 + now.second

        # ── optional type filter ──────────────────────────────────────────────
        type_filter = request.query_params.get("type", "").lower() or None
        if type_filter and type_filter not in ("stopping", "passing"):
            return Response(
                {"detail": "type must be 'stopping' or 'passing'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── base DB query ─────────────────────────────────────────────────────
        loc_q = Q()
        if crs:
            loc_q |= Q(stop__crs__iexact=crs)
        if tiploc:
            loc_q |= Q(tiploc_code__iexact=tiploc) | Q(stop__tiploc__iexact=tiploc)

        date_q = (
            (Q(timetable__schedule_start_date__lte=date_val) | Q(timetable__schedule_start_date__isnull=True))
            & (Q(timetable__schedule_end_date__gte=date_val)  | Q(timetable__schedule_end_date__isnull=True))
        )

        base_qs = (
            ScheduleLocation.objects
            .filter(loc_q & date_q)
            .select_related("stop", "timetable", "timetable__operator")
            .only(*self._CANDIDATE_ONLY)
        )

        # ── DeparturesFilter (headcode, operator, day, origin, destination) ───
        filtered_qs = DeparturesFilter(request.GET, queryset=base_qs).qs
        candidates  = filtered_qs.iterator(chunk_size=200)

        weekday = date_val.weekday()

        # ── Python-side filter ────────────────────────────────────────────────
        valid: list[tuple[int, ScheduleLocation, dict]] = []
        timetable_ids: set[int] = set()
        station_info: Optional[dict] = None

        for loc in candidates:
            tt = loc.timetable

            # ① Day-mask
            if tt:
                mask = (tt.schedule_days_runs or "").strip().zfill(7)[:7]
                if mask and mask[weekday] != "1":
                    continue

            # ② ZZ filter
            if not show_zz and tt:
                hc  = (tt.headcode or "").upper()
                opc = (tt.operator.code or "").upper() if tt.operator else ""
                if hc.startswith("ZZ") or opc.startswith("ZZ"):
                    continue

            # ③ Build time info (needed for both type filter and response)
            ti = _time_info(loc)

            # ④ type filter
            if type_filter and ti["type"] != type_filter:
                continue

            # ⑤ Time threshold (use sort_time which already picks dep > arr > pass)
            secs = _to_seconds_from_raw(
                loc.departure_time or loc.arrival_time or loc.pass_time
            )
            if secs is None or secs < threshold_seconds:
                continue

            if station_info is None and loc.stop:
                station_info = _stop_info(loc.stop, request)

            valid.append((secs, loc, ti))
            if loc.timetable_id:
                timetable_ids.add(loc.timetable_id)

            if len(valid) >= 50:
                break

        # ── sort and cap ──────────────────────────────────────────────────────
        valid.sort(key=lambda x: x[0])
        valid = valid[:10]

        timetable_ids = {loc.timetable_id for _, loc, _ti in valid if loc.timetable_id}

        # ── origin / destination ──────────────────────────────────────────────
        origin_map:      dict[int, Optional[dict]] = {}
        destination_map: dict[int, Optional[dict]] = {}

        if timetable_ids:
            all_service_locs = (
                ScheduleLocation.objects
                .filter(timetable_id__in=timetable_ids)
                .select_related("stop")
                .only("timetable_id", "position", "stop__name", "stop__crs",
                      "stop__tiploc", "stop__lat", "stop__lon")
                .order_by("timetable_id", "position")
            )
            for tt_id, grp in groupby(all_service_locs, key=lambda l: l.timetable_id):
                locs_list = list(grp)
                origin_map[tt_id]      = _stop_info(locs_list[0].stop, request)
                destination_map[tt_id] = _stop_info(locs_list[-1].stop, request)

        # ── build response ────────────────────────────────────────────────────
        results = []
        for secs, loc, ti in valid:
            tt    = loc.timetable
            tt_id = loc.timetable_id
            op    = None
            if tt and tt.operator:
                op = tt.operator.name or tt.operator.code

            results.append({
                "time":               ti,
                "platform":           loc.platform,
                "origin":             origin_map.get(tt_id) if origin_map.get(tt_id) else 'Unknown',
                "destination":        destination_map.get(tt_id) if destination_map.get(tt_id) else 'Unknown',
                "cif_train_uid":      tt.CIF_train_uid if tt else None,
                "headcode":           tt.headcode      if tt else None,
                "operator":           op,
                "schedule_days_runs": _readable_days(tt.schedule_days_runs) if tt else None,
                "rtt_link":           _rtt_link(tt.CIF_train_uid, date_val.isoformat()) if tt else None,
            })

        return Response({
            "date":       date_val.isoformat(),
            "time_after": threshold_seconds,
            "station":    station_info,
            "results":    results,
        })


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

        qs = Timetable.objects.all()
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
        locations = (
            timetable.location_entries.all()
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
            "locations":          results,
        })


class ServiceLocationsViewSet(ViewSet):
    def list(self, request):
        return ServiceLocationsView().get(request)

class BusDeparturesViewSet(ViewSet):
    def list(self, request):
        return BusDeparturesView().get(request)

class TrainDeparturesViewSet(ViewSet):
    def list(self, request):
        return TrainDeparturesView().get(request)