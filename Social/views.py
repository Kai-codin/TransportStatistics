from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Coalesce
from django.db.models import Count, F, Max
from django.contrib.auth import get_user_model
from .forms import FriendSearchForm
from .models import Friend
from Trips.models import TripLog
import requests


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
        .filter(user=request.user)
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


@login_required
def completion_fleet(request, operator_name):
    operator_name = get_canonical_operator(request.user, operator_name)
    show_withdrawn = request.GET.get("show_withdrawn") == "on"
    withdrawn_param = "unknown" if show_withdrawn else "false"

    print(f"\n{'='*60}")
    print(f"completion_fleet: operator={operator_name} show_withdrawn={show_withdrawn}")

    # ── 1. DETECT TRANSPORT TYPE ──────────────────────────────
    transport_type = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .values_list("transport_type", flat=True)
        .first()
    )
    print(f"transport_type: {transport_type}")

    # ── 2. RAIL MODE (NO API) ─────────────────────────────────
    if transport_type == "rail":
        vehicles = (
            TripLog.objects
            .filter(user=request.user, operator__iexact=operator_name)
            .annotate(
                vehicle_id_final=Coalesce('train_fleet_number', 'train_type'),
                vehicle_type=F('train_type'),
                fleet_number=F('train_fleet_number'),
            )
            .exclude(vehicle_id_final__isnull=True)
            .exclude(vehicle_id_final__exact='')
            .values('vehicle_id_final', 'vehicle_type', 'fleet_number', 'transport_type')
            .annotate(count=Count('id'))
            .order_by('-count')
        )
        vehicles = [
            {**v, "bus_livery": None, "bus_livery_name": None, "ridden": True}
            for v in vehicles
        ]
        print(f"rail mode: {len(vehicles)} vehicles")
        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name,
        })

    # ── 3. BUS MODE (API) ─────────────────────────────────────

    # Build ridden map: normalised_reg -> {livery_name -> {count, last_seen, css}}
    ridden_qs = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .annotate(
            vehicle_id=Coalesce('bus_registration', 'bus_fleet_number')
        )
        .exclude(vehicle_id__isnull=True)
        .exclude(vehicle_id__exact='')
        .values('vehicle_id', 'bus_livery_name', 'bus_livery')
        .annotate(count=Count('id'), last_seen=Max('service_date'))
    )

    ridden_map = {}
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

    print(f"ridden_map: {len(ridden_map)} unique vehicles ridden")
    for k, v in ridden_map.items():
        best = max(v.values(), key=lambda d: d['last_seen'])
        print(f"  {k}: {len(v)} liveries, most recent={best['last_seen']}")

    # ── OPERATOR API ──────────────────────────────────────────
    operator_api = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name": operator_name.strip()}
    ).json()

    if not operator_api["results"]:
        print("no operator API results — falling back to ridden only")
        vehicles = [
            {
                "vehicle_id": k,
                "vehicle_id_final": k,
                "fleet_number": "",
                "vehicle_type": "",
                "current_livery_name": None,
                "current_livery_css": None,
                "count": sum(d['count'] for d in v.values()),
                "ridden": True,
                "transport_type": "bus",
                "withdrawn": False,
                "ridden_liveries": v,
                "previous_regs": [],
            }
            for k, v in ridden_map.items()
        ]
        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name,
        })

    noc = operator_api["results"][0]["noc"]
    print(f"operator NOC: {noc}")

    # ── FULL FLEET ────────────────────────────────────────────
    fleet_data = fetch_full_fleet(noc, withdrawn_param)
    print(f"fleet_data: {len(fleet_data)} vehicles from API")

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

            print(f"  [{fleet_no}] reg={reg} prev={previous_reg} → display_reg={display_reg} livery={most_recent_livery_name} ({best_date}) prev_regs={prev_regs}")
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

    print(f"built {len(vehicles)} vehicle entries before dedupe")

    # ── DEDUPE on reg + fleet + type ─────────────────────────
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
                    print(f"    → updating reg from {existing['vehicle_id']} to {best_reg} (most recent ride {best_date})")
                    existing["previous_regs"] = list(set(existing["previous_regs"]) | {normalise_reg(existing["vehicle_id"])})
                    existing["vehicle_id"] = best_reg
                    existing["vehicle_id_final"] = best_reg
        else:
            dedup_key = (vid or fleet, fleet, vtype)
            seen[dedup_key] = v
            deduped.append(v)
            for r in all_regs:
                reg_index[r] = dedup_key

    print(f"after dedupe: {len(deduped)} vehicles")
    vehicles = deduped

    # ── POST-DEDUPE: re-sort ridden_liveries and clean up previous_regs ──
    for v in vehicles:
        if v["ridden_liveries"]:
            v["ridden_liveries"] = dict(
                sorted(v["ridden_liveries"].items(), key=lambda x: x[1]['last_seen'], reverse=True)
            )
        current = normalise_reg(v["vehicle_id"])
        v["previous_regs"] = [r for r in v["previous_regs"] if normalise_reg(r) != current]

        print(f"  FINAL [{v['fleet_number']}] id={v['vehicle_id']} livery={v['current_livery_name']} prev_regs={v['previous_regs']} ridden_liveries={list(v['ridden_liveries'].keys())}")

    # ── SORT ──────────────────────────────────────────────────
    vehicles.sort(key=lambda x: (-x["ridden"], fleet_sort_key(x), -x["count"]))

    print(f"{'='*60}\n")

    return render(request, "completion_fleet.html", {
        "vehicles": vehicles,
        "show_withdrawn": show_withdrawn,
        "operator_name": operator_name,
    })

@login_required
def completion_route(request, operator_name):
    operator_name = get_canonical_operator(request.user, operator_name)

    # ── detect mode ──────────────────────────────────────────
    transport_type = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .values_list("transport_type", flat=True)
        .first()
    )

    # ── 🚆 RAIL (no API) ─────────────────────────────────────
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

    # ── 🚌 BUS (API) ─────────────────────────────────────────

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

    # ── 🔥 dedupe routes (IMPORTANT) ─────────────────────────
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

    # ── sorting ─────────────────────────────────────────────
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
def completion_details(request, operator_name):

    qs = TripLog.objects.filter(
        user=request.user,
        operator__iexact=operator_name
    )

    # ── VEHICLES ───────────────────────────────────────────
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

    # ── ROUTES ─────────────────────────────────────────────
    routes = (
        qs.exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .distinct()
        .count()
    )

    # ── LIVERIES (bus only really) ─────────────────────────
    liveries = (
        qs.exclude(bus_livery_name__isnull=True)
        .exclude(bus_livery_name__exact='')
        .values('bus_livery_name', 'bus_livery')
        .annotate(count=Count('id'))
        .order_by('-count')
    )

    # ── VEHICLE TYPES ──────────────────────────────────────
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

    # ── TOP TYPES (top 5) ──────────────────────────────────
    top_types = list(types[:5])

    # ── EXTRA NICE STATS ───────────────────────────────────
    total_trips = qs.count()

    most_used_route = (
        qs.exclude(headcode__isnull=True)
        .exclude(headcode__exact='')
        .values('headcode')
        .annotate(count=Count('id'))
        .order_by('-count')
        .first()
    )

    # ── ROUTE LIST (for display) ─────────────────────────
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