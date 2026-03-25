from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Coalesce
from django.db.models import Count, Case, When, F, CharField
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
    operators = sorted({op.strip() for op in trips if (op and op.strip())})
    
    return render(request, 'completion.html', {'operators': operators})

def fetch_full_fleet(noc):
    url = "https://bustimes.org/api/vehicles/"
    params = {"operator": noc, "limit": 100, "withdrawn": "false"}

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
    
@login_required
def completion_fleet(request, operator_name):

    # ── 1. DETECT TRANSPORT TYPE ──────────────────────────────
    transport_type = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .values_list("transport_type", flat=True)
        .first()
    )

    # ── 2. RAIL MODE (NO API) ─────────────────────────────────
    if transport_type == "rail":
        vehicles = (
            TripLog.objects
            .filter(user=request.user, operator__iexact=operator_name)
            .annotate(
                vehicle_id_final=Coalesce(
                    'train_fleet_number',
                    'train_type'
                ),
                vehicle_type=F('train_type'),
                fleet_number=F('train_fleet_number'),
            )
            .exclude(vehicle_id_final__isnull=True)
            .exclude(vehicle_id_final__exact='')
            .values(
                'vehicle_id_final',
                'vehicle_type',
                'fleet_number',
                'transport_type'
            )
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # add ridden flag for template consistency
        vehicles = [
            {
                **v,
                "bus_livery": None,
                "bus_livery_name": None,
                "ridden": True,
            }
            for v in vehicles
        ]

        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name
        })

    # ── 3. BUS MODE (API) ─────────────────────────────────────

    # USER RIDES
    ridden_qs = (
        TripLog.objects
        .filter(user=request.user, operator__iexact=operator_name)
        .annotate(
            vehicle_id=Coalesce(
                'bus_registration',
                'bus_fleet_number'
            )
        )
        .exclude(vehicle_id__isnull=True)
        .exclude(vehicle_id__exact='')
        .values('vehicle_id')
        .annotate(count=Count('id'))
    )

    ridden_map = {
        v['vehicle_id'].upper(): v['count']
        for v in ridden_qs
    }

    # OPERATOR API
    operator_api = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name": operator_name}
    ).json()

    if not operator_api["results"]:
        # fallback → show ridden only (important!)
        vehicles = [
            {
                "vehicle_id": k,
                "fleet_number": "",
                "vehicle_type": "",
                "bus_livery": None,
                "bus_livery_name": None,
                "count": v,
                "ridden": True,
                "transport_type": "bus",
            }
            for k, v in ridden_map.items()
        ]

        return render(request, "completion_fleet.html", {
            "vehicles": vehicles,
            "operator_name": operator_name
        })

    noc = operator_api["results"][0]["noc"]

    # FULL FLEET
    fleet_data = fetch_full_fleet(noc)

    vehicles = []

    for vehicle in fleet_data:
        reg = (vehicle.get("reg") or "").upper()
        fleet_no = vehicle.get("fleet_number") or ""

        key = reg or str(fleet_no)
        count = ridden_map.get(key, 0)

        vt = vehicle.get("vehicle_type") or {}
        livery = vehicle.get("livery") or {}

        vehicles.append({
            "vehicle_id_final": reg or fleet_no,
            "vehicle_id": reg or fleet_no,
            "fleet_number": fleet_no,
            "vehicle_type": vt.get("name"),
            "bus_livery_name": livery.get("name"),
            "bus_livery": livery.get("left"),
            "count": count,
            "ridden": count > 0,
            "transport_type": "bus",
        })

    # SORT
    vehicles.sort(
        key=lambda x: (
            -x["ridden"],
            fleet_sort_key(x),
            -x["count"],
        )
    )

    return render(request, "completion_fleet.html", {
        "vehicles": vehicles,
        "operator_name": operator_name
    })

@login_required
def completion_route(request, operator_name):

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