from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Coalesce
from django.db.models import Count, F, Max, Q
from django.contrib.auth import get_user_model
from django.http import JsonResponse, Http404
from .forms import FriendSearchForm
from .models import Friend
from Trips.models import TripLog
from main.models import Trains, Operator
import requests
import re

from itertools import groupby


User = get_user_model()

def friends_page(request):
    form = FriendSearchForm(request.POST or None)
    results = []
    existing_friend_ids = []
    outgoing_pending_ids = []
    incoming_pending = []

    if request.user.is_authenticated:
        existing_friend_ids = Friend.objects.filter(
            user=request.user
        ).values_list("friend_id", flat=True)
        outgoing_pending_ids = Friend.objects.filter(
            user=request.user, status='pending'
        ).values_list('friend_id', flat=True)
        # incoming pending requests (other users who requested current user)
        incoming_pending = Friend.objects.filter(
            friend=request.user, status='pending'
        ).select_related('user')
        # accepted friends (users I have added and are accepted)
        friends_list = Friend.objects.filter(user=request.user, status='accepted').select_related('friend')

    if request.method == "POST" and form.is_valid():
        username = form.cleaned_data["username"]

        results = User.objects.filter(
            username__icontains=username
        ).exclude(id=request.user.id)[:20]

    return render(request, "friends.html", {
        "form": form,
        "results": results,
        "existing_friend_ids": existing_friend_ids,
        "outgoing_pending_ids": list(outgoing_pending_ids),
        "incoming_pending": incoming_pending,
        "friends_list": friends_list if request.user.is_authenticated else [],
    })

@login_required
def add_friend(request, user_id):
    user_to_add = get_object_or_404(User, id=user_id)

    if user_to_add != request.user:
        fr, created = Friend.objects.get_or_create(
            user=request.user,
            friend=user_to_add,
            defaults={'status': 'pending'}
        )
        if not created and fr.status != 'pending':
            fr.status = 'pending'
            fr.save()

    return redirect("friends")


@login_required
def accept_friend(request, user_id):
    # user_id is the id of the user who sent the request
    try:
        fr = Friend.objects.get(user__id=user_id, friend=request.user)
        fr.status = 'accepted'
        fr.save()
        # create reciprocal friend relation if not exists
        Friend.objects.get_or_create(user=request.user, friend=fr.user, defaults={'status': 'accepted'})
    except Friend.DoesNotExist:
        pass
    return redirect('friends')


@login_required
def decline_friend(request, user_id):
    try:
        fr = Friend.objects.get(user__id=user_id, friend=request.user)
        fr.status = 'rejected'
        fr.save()
    except Friend.DoesNotExist:
        pass
    return redirect('friends')

@login_required
def completion_home(request):
    trips = (
        TripLog.objects
        .filter(Q(user=request.user) | Q(on_trip_trip=request.user))
        .exclude(operator__isnull=True)
        .exclude(operator__exact='')
        .values_list('operator', flat=True)
    )
    # normalize and drop any empty/whitespace-only operator names
    operators_map = {}

    for op in trips:
        if not op:
            continue

        clean = op.strip()
        if not clean:
            continue

        key = clean.lower()

        # keep the "best" version (e.g. first seen or title case)
        if key not in operators_map:
            operators_map[key] = clean

    operators = sorted(operators_map.values())
    
    return render(request, 'completion.html', {'operators': operators})

def fetch_full_fleet(noc, withdrawn_param):
    url = "https://bustimes.org/api/vehicles/"
    params = {"operator": noc, "limit": 100, "withdrawn": withdrawn_param}
    all_results = []
    while url:
        res = requests.get(url, params=params if url.endswith("/vehicles/") else None).json()
        all_results.extend(res["results"])
        url = res["next"]
        params = None
    return all_results


def fleet_sort_key(v):
    fn = v.get("fleet_number")
    if fn is None or fn == "":
        return (2, 999999, "")
    try:
        return (0, int(fn), "")
    except:
        return (1, 0, str(fn))


def fetch_full_services(noc):
    url = "https://bustimes.org/api/services/"
    params = {"operator": noc, "limit": 100}
    all_results = []
    while url:
        res = requests.get(url, params=params if url.endswith("/services/") else None).json()
        all_results.extend(res["results"])
        url = res["next"]
        params = None
    return all_results


def normalise_reg(reg):
    return (reg or "").upper().replace(" ", "")


def get_canonical_operator(user, operator_name):
    return (
        TripLog.objects
        .filter(user=user, operator__iexact=operator_name)
        .values_list('operator', flat=True)
        .first()
    ) or operator_name


def split_train_units(raw_value: str) -> list[str]:
    """
    Split coupled train fleet strings into individual unit numbers.
    Examples:
      "220029 + 220022" -> ["220029", "220022"]
      "390115/390005"   -> ["390115", "390005"]
    """
    if not raw_value:
        return []

    text = str(raw_value).strip()
    if not text:
        return []

    # Split on common coupling separators.
    parts = re.split(r"\s*(?:\+|/|,|&| and )\s*", text, flags=re.IGNORECASE)
    units: list[str] = []
    for part in parts:
        unit = part.strip()
        if not unit:
            continue
        # Keep only plausible fleet tokens (letters/digits), strip punctuation noise.
        cleaned = "".join(ch for ch in unit if ch.isalnum())
        if cleaned:
            units.append(cleaned)

    # preserve order while deduplicating
    seen = set()
    unique_units: list[str] = []
    for u in units:
        if u in seen:
            continue
        seen.add(u)
        unique_units.append(u)
    return unique_units


@login_required
def completion_fleet(request, operator_name):
    operator_name = get_canonical_operator(request.user, operator_name)
    show_withdrawn = request.GET.get("show_withdrawn") == "on"
    withdrawn_param = "unknown" if show_withdrawn else "false"
    transport_type = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .values_list("transport_type", flat=True)
        .first()
    )
    if transport_type == "rail":
        ridden_trip_rows = (
            TripLog.objects
            .filter(user=request.user, operator__iexact=operator_name)
            .exclude(train_fleet_number__isnull=True)
            .exclude(train_fleet_number__exact='')
            .values('train_fleet_number', 'service_date', 'train_type')
        )

        ridden_map: dict[str, dict] = {}
        for row in ridden_trip_rows:
            raw_units = str(row.get('train_fleet_number') or '').strip()
            units = split_train_units(raw_units)
            if not units:
                continue

            service_date = row.get('service_date')
            train_type = (row.get('train_type') or '').strip()
            for unit in units:
                entry = ridden_map.setdefault(
                    unit,
                    {'count': 0, 'last_seen': None, 'vehicle_type': ''},
                )
                entry['count'] += 1
                if service_date and (entry['last_seen'] is None or service_date > entry['last_seen']):
                    entry['last_seen'] = service_date
                if train_type and not entry['vehicle_type']:
                    entry['vehicle_type'] = train_type

        fleet_rows = (
            Trains.objects
            .select_related('operator')
            .filter(operator__name__iexact=operator_name)
            .order_by('fleetnumber')
        )

        vehicles = []
        seen_fleets = set()
        
        for t in fleet_rows:
            fleet = str(t.fleetnumber).strip()
            seen_fleets.add(fleet)
            ride = ridden_map.get(fleet)
            count = ride['count'] if ride else 0
            vehicles.append({
                'vehicle_id_final': fleet,
                'fleet_number': fleet,
                'vehicle_type': t.type,
                'transport_type': 'rail',
                'current_livery_name': t.livery_name or None,
                'current_livery_css': t.livery_css or None,
                'ridden_liveries': {},
                'count': count,
                'ridden': count > 0,
                'withdrawn': False,
                'previous_regs': [],
            })

        # Include ridden trains not present in catalog so no data is hidden.
        for fleet, ride in ridden_map.items():
            if fleet in seen_fleets:
                continue
            vehicles.append({
                'vehicle_id_final': fleet,
                'fleet_number': fleet,
                'vehicle_type': ride.get('vehicle_type') or '',
                'transport_type': 'rail',
                'current_livery_name': None,
                'current_livery_css': None,
                'ridden_liveries': {},
                'count': ride['count'],
                'ridden': True,
                'withdrawn': False,
                'previous_regs': [],
            })

        vehicles.sort(key=lambda x: (-int(bool(x.get("ridden"))), fleet_sort_key(x), -x.get("count", 0)))
        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name,
            "show_withdrawn": show_withdrawn,
            "is_rail_completion": True,
        })

    # Build ridden map: normalised_reg -> {livery_name -> {count, last_seen, css}}
    ridden_qs = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .annotate(
            vehicle_id=Coalesce('bus_registration', 'bus_fleet_number')
        )
        .exclude(vehicle_id__isnull=True)
        .exclude(vehicle_id__exact='')
        .values('vehicle_id', 'bus_livery_name', 'bus_livery', 'transport_type', 'bus_type', 'train_type', 'bus_fleet_number')
        .annotate(count=Count('id'), last_seen=Max('service_date'))
    )

    ridden_map = {}
    # track the most-recent transport_type and vehicle_type observed for each vehicle id
    transport_by_vid = {}
    vehicle_type_by_vid = {}
    fleet_by_vid = {}
    for r in ridden_qs:
        vid = normalise_reg(r['vehicle_id'])
        livery_name = r['bus_livery_name'] or None
        livery_css = r['bus_livery'] or None
        if vid not in ridden_map:
            ridden_map[vid] = {}
        ridden_map[vid][livery_name] = {
            'count': r['count'],
            'last_seen': r['last_seen'],
            'css': livery_css,
        }

        # derive a candidate vehicle_type from TripLog fields
        cand_type = ''
        ttype = (r.get('transport_type') or '').strip()
        if ttype == 'rail':
            cand_type = (r.get('train_type') or '').strip()
        else:
            cand_type = (r.get('bus_type') or '').strip()

        prev = transport_by_vid.get(vid)
        if prev is None or (r['last_seen'] and (prev[0] is None or r['last_seen'] > prev[0])):
            transport_by_vid[vid] = (r['last_seen'], ttype or 'bus')
            vehicle_type_by_vid[vid] = cand_type or ''
            # capture bus_fleet_number seen most recently for this vid
            fleet_val = (r.get('bus_fleet_number') or '')
            fleet_by_vid[vid] = str(fleet_val).strip()

    for k, v in ridden_map.items():
        best = max(v.values(), key=lambda d: d['last_seen'])
    operator_api = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name": operator_name.strip()}
    ).json()

    if not operator_api["results"]:
        # Operator not found in bustimes — include any ridden vehicles but
        # mark them as withdrawn since they don't appear in the external API.
        vehicles = []
        if show_withdrawn:
            for k, v in ridden_map.items():
                tt = transport_by_vid.get(k, (None, 'bus'))[1]
                vtype = vehicle_type_by_vid.get(k, '')
                vehicles.append({
                    "vehicle_id": k,
                    "vehicle_id_final": k,
                    "fleet_number": "",
                    "vehicle_type": vtype,
                    "current_livery_name": None,
                    "current_livery_css": None,
                    "count": sum(d['count'] for d in v.values()),
                    "ridden": True,
                    "transport_type": tt or 'bus',
                    "withdrawn": True,
                    "ridden_liveries": v,
                    "previous_regs": [],
                })
        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name,
            "is_rail_completion": False,
        })

    noc = operator_api["results"][0]["noc"]
    fleet_data = fetch_full_fleet(noc, withdrawn_param)

    vehicles = []
    for vehicle in fleet_data:
        reg = normalise_reg(vehicle.get("reg"))
        previous_reg = normalise_reg(vehicle.get("previous_reg"))
        fleet_no = vehicle.get("fleet_number") or ""
        withdrawn = vehicle.get("withdrawn")

        vt = vehicle.get("vehicle_type") or {}
        livery = vehicle.get("livery") or {}
        api_livery_name = livery.get("name")
        api_livery_css = livery.get("left")

        # look up rides against current reg, previous reg, fleet number
        rides_by_reg = ridden_map.get(reg) or {}
        rides_by_prev = ridden_map.get(previous_reg) or {} if previous_reg else {}
        rides_by_fleet = ridden_map.get(normalise_reg(str(fleet_no))) or {} if fleet_no else {}

        # merge all rides across all known regs for this vehicle
        all_rides = {}
        for source_rides in [rides_by_reg, rides_by_prev, rides_by_fleet]:
            for livery_name, data in source_rides.items():
                if livery_name not in all_rides:
                    all_rides[livery_name] = data.copy()
                else:
                    all_rides[livery_name]['count'] += data['count']
                    if data['last_seen'] > all_rides[livery_name]['last_seen']:
                        all_rides[livery_name]['last_seen'] = data['last_seen']

        total_count = sum(d['count'] for d in all_rides.values())

        # sort liveries by last_seen desc — most recently ridden first
        sorted_liveries = dict(
            sorted(all_rides.items(), key=lambda x: x[1]['last_seen'], reverse=True)
        )

        if sorted_liveries:
            # most recently ridden livery = first entry after sort
            most_recent_livery_name = next(iter(sorted_liveries))
            most_recent_livery_css = sorted_liveries[most_recent_livery_name]['css']

            # find which reg had the most recent trip overall
            best_reg = None
            best_date = None
            for r, rides in [(reg, rides_by_reg), (previous_reg, rides_by_prev)]:
                if r and rides:
                    for d in rides.values():
                        if best_date is None or d['last_seen'] > best_date:
                            best_date = d['last_seen']
                            best_reg = r

            display_reg = best_reg or reg or str(fleet_no)
            prev_regs = list({
                r for r in
                ([previous_reg] if previous_reg else []) +
                ([reg] if reg and reg != display_reg else [])
                if r and r != display_reg
            })

        else:
            # unridden — fall back to API data
            most_recent_livery_name = api_livery_name
            most_recent_livery_css = api_livery_css
            display_reg = reg or str(fleet_no)
            prev_regs = [previous_reg] if previous_reg else []

        vehicles.append({
            "vehicle_id_final": display_reg,
            "vehicle_id": display_reg,
            "fleet_number": fleet_no,
            "vehicle_type": vt.get("name"),
            "count": total_count,
            "ridden": total_count > 0,
            "transport_type": "bus",
            "withdrawn": withdrawn,
            "current_livery_name": most_recent_livery_name,
            "current_livery_css": most_recent_livery_css,
            "ridden_liveries": sorted_liveries,
            "previous_regs": prev_regs,
        })
    seen = {}
    reg_index = {}
    deduped = []

    for v in vehicles:
        vid = normalise_reg(v.get("vehicle_id"))
        fleet = str(v.get("fleet_number") or "").strip()
        vtype = str(v.get("vehicle_type") or "").strip()
        all_regs = [normalise_reg(k) for k in [vid] + v.get("previous_regs", []) if k]

        matched_dedup_key = next((reg_index[r] for r in all_regs if r in reg_index), None)

        if matched_dedup_key and matched_dedup_key in seen:
            existing = seen[matched_dedup_key]
            existing["count"] += v["count"]
            existing["ridden"] = existing["ridden"] or v["ridden"]
            if not v.get("withdrawn"):
                existing["withdrawn"] = False

            merged_regs = set(existing["previous_regs"]) | set(v["previous_regs"])
            if vid != normalise_reg(existing["vehicle_id"]):
                merged_regs.add(vid)
            existing["previous_regs"] = list(merged_regs)

            for r in all_regs:
                reg_index[r] = matched_dedup_key

            # merge ridden_liveries first
            for livery_name, data in v["ridden_liveries"].items():
                if livery_name in existing["ridden_liveries"]:
                    existing["ridden_liveries"][livery_name]["count"] += data["count"]
                    if data["last_seen"] > existing["ridden_liveries"][livery_name]["last_seen"]:
                        existing["ridden_liveries"][livery_name]["last_seen"] = data["last_seen"]
                else:
                    existing["ridden_liveries"][livery_name] = data

            # NOW determine best reg and livery from the fully merged ridden_liveries
            if existing["ridden_liveries"]:
                # find the overall most recent livery across all merged data
                best_livery = max(existing["ridden_liveries"], key=lambda k: existing["ridden_liveries"][k]['last_seen'])
                existing["current_livery_name"] = best_livery
                existing["current_livery_css"] = existing["ridden_liveries"][best_livery]['css']

                # find which reg had the most recent trip
                all_known_regs = [normalise_reg(existing["vehicle_id"])] + [normalise_reg(r) for r in existing["previous_regs"]]
                best_reg = None
                best_date = None
                for r in all_known_regs:
                    if r in ridden_map:
                        for d in ridden_map[r].values():
                            if best_date is None or d['last_seen'] > best_date:
                                best_date = d['last_seen']
                                best_reg = r
                if best_reg and best_reg != normalise_reg(existing["vehicle_id"]):
                    existing["previous_regs"] = list(set(existing["previous_regs"]) | {normalise_reg(existing["vehicle_id"])})
                    existing["vehicle_id"] = best_reg
                    existing["vehicle_id_final"] = best_reg
        else:
            dedup_key = (vid or fleet, fleet, vtype)
            seen[dedup_key] = v
            deduped.append(v)
            for r in all_regs:
                reg_index[r] = dedup_key

    vehicles = deduped
    for v in vehicles:
        if v["ridden_liveries"]:
            v["ridden_liveries"] = dict(
                sorted(v["ridden_liveries"].items(), key=lambda x: x[1]['last_seen'], reverse=True)
            )
        current = normalise_reg(v["vehicle_id"])
        v["previous_regs"] = [r for r in v["previous_regs"] if normalise_reg(r) != current]
    # Include any ridden registrations that weren't present in the API/fleet
    # data. Mark these as withdrawn so they're still visible to the user but
    # clearly indicated as missing from bustimes.
    known_regs = set(reg_index.keys())
    for reg, liveries in ridden_map.items():
        nreg = normalise_reg(reg)
        if not nreg or nreg in known_regs:
            continue
        # don't append missing/withdrawn regs unless the user requested withdrawn
        if not show_withdrawn:
            continue
        total_count = sum(d['count'] for d in liveries.values())
        sorted_liveries = dict(sorted(liveries.items(), key=lambda x: x[1]['last_seen'], reverse=True))
        tt = transport_by_vid.get(nreg, (None, 'bus'))[1]
        vtype = vehicle_type_by_vid.get(nreg, '')
        fleet_no = fleet_by_vid.get(nreg, '')
        # debug output to help trace missing-reg handling
        print(f"Appending missing reg {nreg}: transport={tt!r}, fleet={fleet_no!r}, type={vtype!r}")
        vehicles.append({
            "vehicle_id": nreg,
            "vehicle_id_final": nreg,
            "fleet_number": fleet_no,
            "vehicle_type": vtype,
            "count": total_count,
            "ridden": True,
            "transport_type": tt,
            "withdrawn": True,
            "current_livery_name": next(iter(sorted_liveries)) if sorted_liveries else None,
            "current_livery_css": sorted_liveries[next(iter(sorted_liveries))]['css'] if sorted_liveries else None,
            "ridden_liveries": sorted_liveries,
            "previous_regs": [],
        })

    vehicles.sort(key=lambda x: (-x["ridden"], fleet_sort_key(x), -x["count"]))

    return render(request, "completion_fleet.html", {
        "vehicles": vehicles,
        "show_withdrawn": show_withdrawn,
        "operator_name": operator_name,
        "is_rail_completion": False,
    })

@login_required
def completion_route(request, operator_name):
    operator_name = get_canonical_operator(request.user, operator_name)
    transport_type = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .values_list("transport_type", flat=True)
        .first()
    )
    if transport_type == "rail":
        routes = (
            TripLog.objects
            .filter(user=request.user, operator__iexact=operator_name)
            .exclude(headcode__isnull=True)
            .exclude(headcode__exact='')
            .values('headcode')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        routes = [
            {
                "line_name": r["headcode"],
                "description": "",
                "count": r["count"],
                "ridden": True,
            }
            for r in routes
        ]

        return render(request, "completion_route.html", {
            "routes": routes,
            "operator_name": operator_name
        })

    # user rides
    ridden_qs = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .annotate(count=Count('id'))
    )

    ridden_map = {
        v['headcode'].upper(): v['count']
        for v in ridden_qs
    }

    # operator lookup
    operator_api = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name": operator_name}
    ).json()

    if not operator_api["results"]:
        return render(request, "completion_route.html", {
            "routes": [],
            "operator_name": operator_name
        })

    noc = operator_api["results"][0]["noc"]

    # full service list
    services = fetch_full_services(noc)
    route_map = {}

    for s in services:
        line = (s.get("line_name") or "").upper()
        desc = s.get("description") or ""

        if not line:
            continue

        if line not in route_map:
            route_map[line] = {
                "line_name": line,
                "description": desc,
                "count": ridden_map.get(line, 0),
            }

    routes = []

    for r in route_map.values():
        r["ridden"] = r["count"] > 0
        routes.append(r)
    def route_sort_key(name):
        try:
            return (0, int(name))
        except:
            return (1, name)

    routes.sort(
        key=lambda x: (
            -x["ridden"],
            route_sort_key(x["line_name"]),
            -x["count"],
        )
    )

    return render(request, "completion_route.html", {
        "routes": routes,
        "operator_name": operator_name
    })


@login_required
def completion_liveries(request):
    """Show a grid of unique liveries the current user has ridden."""
    qs = (
        TripLog.objects
        .filter(Q(user=request.user) | Q(on_trip_trip=request.user))
        .exclude(bus_livery__isnull=True)
        .exclude(bus_livery__exact='')
        .values('bus_livery_name', 'bus_livery')
        .annotate(count=Count('id', distinct=True))
        .order_by('-count')
    )

    # De-duplicate by (name, css) — the queryset above already groups by those
    liveries = list(qs)

    return render(request, "completion_liveries.html", {
        "liveries": liveries,
    })

@login_required
def completion_livery_trips(request):
    """List every trip the current user has ridden in a selected livery."""
    css = (request.GET.get('css') or '').strip()
    name = request.GET.get('name')

    if not css:
        raise Http404("Missing livery css")

    trips_qs = (
        TripLog.objects
        .filter(Q(user=request.user) | Q(on_trip_trip=request.user))
        .distinct()
        .filter(bus_livery=css)
    )

    trips_qs = trips_qs.order_by('-service_date', '-scheduled_departure', '-logged_at')

    if not name:
        first_named_trip = trips_qs.exclude(bus_livery_name__isnull=True).exclude(bus_livery_name__exact='').first()
        name = first_named_trip.bus_livery_name if first_named_trip else ""

    days = []
    for service_date, group in groupby(trips_qs, key=lambda t: t.service_date):
        trip_list = list(group)
        days.append({'date': service_date, 'trips': trip_list})

    return render(request, "completion_livery_trips.html", {
        "css": css,
        "name": name or "",
        "days": days,
        "total_trips": trips_qs.count(),
    })


@login_required
def completion_update(request):
    """Page to inspect and replace liveries the user has logged.

    Flow:
    - GET: show dropdown of liveries (name, css, count).
    - POST action 'replace_local': replace all TripLog.bus_livery matching source_css
      with target_css/target_name.
    - POST action 'search_bustimes': call bustimes API with name__icontains=<name>
      and render results for selection.
    - POST action 'replace_api': replace by source_css with selected API CSS.
    """

    # gather user's liveries
    qs = (
        TripLog.objects
        .filter(Q(user=request.user) | Q(on_trip_trip=request.user))
        .exclude(bus_livery__isnull=True)
        .exclude(bus_livery__exact='')
        .values('bus_livery_name', 'bus_livery')
        .annotate(count=Count('id'))
        .order_by('-count', 'bus_livery_name', 'bus_livery')
    )

    liveries = list(qs)

    message = None
    api_results = None

    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'replace_local':
            # Accept multiple possible sources for the CSS values to be robust
            source_css = (request.POST.get('source_css') or
                          request.POST.get('form_source_css') or
                          '')
            target_css = (request.POST.get('target_css') or
                          request.POST.get('target_css_select') or
                          request.POST.get('api_left_css') or
                          '')
            target_name = request.POST.get('target_name') or ''
            if not source_css or not target_css:
                # helpful debug message so UI can be iterated if needed
                message = {
                    'kind': 'error',
                    'text': f'Source and target CSS required. (got source={source_css!r} target={target_css!r})'
                }
            else:
                qs_update = TripLog.objects.filter(user=request.user, bus_livery=source_css)
                affected = qs_update.count()
                qs_update.update(bus_livery=target_css, bus_livery_name=target_name)
                message = {'kind': 'success', 'text': f'Replaced {affected} rows.'}

        elif action == 'replace_api':
            # Expect explicit fields from the client-side form
            source_css = request.POST.get('source_css') or ''
            api_left_css = request.POST.get('api_left_css') or ''
            api_name = request.POST.get('api_name') or ''

            if not source_css or not api_left_css:
                message = {'kind': 'error', 'text': 'Missing source or API CSS.'}
            else:
                qs_update = TripLog.objects.filter(user=request.user, bus_livery=source_css)
                affected = qs_update.count()
                qs_update.update(bus_livery=api_left_css, bus_livery_name=api_name)
                message = {'kind': 'success', 'text': f'Replaced {affected} rows with bustimes selection.'}

        elif action == 'fill_trains_missing':
            rail_rows = (
                TripLog.objects
                .filter(Q(user=request.user) | Q(on_trip_trip=request.user), transport_type='rail')
                .exclude(train_fleet_number__isnull=True)
                .exclude(train_fleet_number__exact='')
            )

            fleet_set = set()
            trip_units = {}
            for trip in rail_rows:
                units = split_train_units(trip.train_fleet_number or '')
                trip_units[trip.id] = units
                fleet_set.update(units)

            trains_by_fleet = Trains.objects.in_bulk(list(fleet_set), field_name='fleetnumber')

            matched_trips = 0
            missing_trips = 0
            changed = 0
            to_update = []

            for trip in rail_rows:
                units = trip_units.get(trip.id) or []
                matched_train = None
                for unit in units:
                    t = trains_by_fleet.get(unit)
                    if t:
                        matched_train = t
                        break

                if not matched_train:
                    missing_trips += 1
                    continue

                matched_trips += 1
                row_changed = False

                # Update train type from trains catalog.
                new_type = (matched_train.type or '').strip()
                if new_type and (trip.train_type or '').strip() != new_type:
                    trip.train_type = new_type
                    row_changed = True

                # Set livery fields from trains catalog.
                new_livery_css = (matched_train.livery_css or '').strip()
                new_livery_name = (matched_train.livery_name or '').strip()
                if new_livery_css and (trip.bus_livery or '').strip() != new_livery_css:
                    trip.bus_livery = new_livery_css
                    row_changed = True
                if new_livery_name and (trip.bus_livery_name or '').strip() != new_livery_name:
                    trip.bus_livery_name = new_livery_name
                    row_changed = True

                if row_changed:
                    changed += 1
                    to_update.append(trip)

            if to_update:
                TripLog.objects.bulk_update(
                    to_update,
                    fields=['train_type', 'bus_livery', 'bus_livery_name'],
                    batch_size=1000,
                )

            message = {
                'kind': 'success',
                'text': (
                    f'Rail trip backfill complete. '
                    f'trips scanned: {rail_rows.count()} · '
                    f'trips matched to trains: {matched_trips} · '
                    f'trips with no train match: {missing_trips} · '
                    f'rows updated: {changed}.'
                ),
            }

    return render(request, 'completion_update.html', {
        'liveries': liveries,
        'message': message,
        'api_results': api_results,
    })


@login_required
def completion_update_search(request):
    """Proxy a bustimes liveries search. Accepts GET param `q` and returns JSON results."""
    q = request.GET.get('q', '')
    if not q:
        return JsonResponse({'results': []})

    try:
        res = requests.get('https://bustimes.org/api/liveries/', params={'name__icontains': q, 'limit': 50})
        data = res.json()
        results = data.get('results', [])
    except Exception:
        results = []

    return JsonResponse({'results': results})

@login_required
def completion_details(request, operator_name):

    qs = TripLog.objects.filter(
        (Q(user=request.user) | Q(on_trip_trip=request.user))
        & Q(operator__iexact=operator_name)
    )
    vehicles = (
        qs.annotate(
            vehicle=Coalesce(
                'bus_registration',
                'bus_fleet_number',
                'train_fleet_number'
            )
        )
        .exclude(vehicle__isnull=True)
        .exclude(vehicle__exact='')
        .values('vehicle')
        .distinct()
        .count()
    )
    routes = (
        qs.exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .distinct()
        .count()
    )
    liveries = (
        qs.values('bus_livery_name', 'bus_livery')
        .annotate(count=Count('id'))
        .order_by('-count')
    )
    types = (
        qs.annotate(
            vtype=Coalesce('bus_type', 'train_type')
        )
        .exclude(vtype__isnull=True)
        .exclude(vtype__exact='')
        .values('vtype')
        .annotate(count=Count('id'))
        .order_by('-count')
    )
    top_types = list(types[:5])
    total_trips = qs.count()

    most_used_route = (
        qs.exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .annotate(count=Count('id'))
        .order_by('-count')
        .first()
    )
    route_list = (
        qs.exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .annotate(count=Count('id'))
        .order_by('-count')
    )

    return render(request, "completion_details.html", {
        "operator_name": operator_name,
        "vehicle_count": vehicles,
        "route_count": routes,
        "liveries": liveries,
        "types": types,
        "total_trips": total_trips,
        "route_list": route_list,
        "most_used_route": most_used_route,
        "most_used_type": top_types[0] if top_types else None,
    })
