import requests
from tqdm import tqdm
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.contrib.auth import get_user_model
from Trips.models import TripLog

User = get_user_model()


def fetch_all_services(noc):
    services = []
    url = "https://bustimes.org/api/services/"
    params = {"operator": noc, "limit": 100}
    while url:
        resp = requests.get(url, params=params, timeout=10).json()
        services.extend(resp["results"])
        url = resp.get("next")
        params = {}
    return services


def search_fetch_services(noc, line_name):
    services = []
    url = "https://bustimes.org/api/services/"
    params = {"operator": noc, "search": line_name, "limit": 100}
    while url:
        resp = requests.get(url, params=params, timeout=10).json()
        services.extend(resp["results"])
        url = resp.get("next")
        params = {}
    return services


def get_noc(operator_name):
    resp = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name": operator_name},
        timeout=10,
    ).json()
    results = resp.get("results", [])
    if results:
        return results[0]["noc"]
    resp = requests.get(
        "https://bustimes.org/api/operators/",
        params={"name__icontains": operator_name},
        timeout=10,
    ).json()
    results = resp.get("results", [])
    return results[0]["noc"] if results else None


def fetch_service_stops(service_id):
    """
    Fetch a sample of trips for a service and collect all unique stop ATCOs
    and stop names. Returns (set of atco_codes, set of stop name fragments).
    """
    atcos = set()
    names = set()
    try:
        trips_resp = requests.get(
            "https://bustimes.org/api/trips/",
            params={"service": service_id, "limit": 3},
            timeout=10,
        ).json()
        for t in trips_resp.get("results", []):
            detail = requests.get(
                f"https://bustimes.org/api/trips/{t['id']}/",
                timeout=10,
            ).json()
            for stop in detail.get("times", []):
                atcos.add(stop["stop"]["atco_code"])
                names.add(stop["stop"]["name"].lower())
    except Exception:
        pass
    return atcos, names


# ── tqdm bar style ────────────────────────────────────────────────────────────
BAR_FMT = "{l_bar}{bar:30}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]"


class Command(BaseCommand):
    help = "Backfill bustimes_service_id on existing bus TripLog entries"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Print matches without saving",
        )
        parser.add_argument(
            "--user", type=int, nargs="+",
            help="Only process trips by these user IDs (space-separated)",
        )
        parser.add_argument(
            "--operator", type=str, nargs="+",
            help="Only process trips by these operators (space-separated, case-insensitive)",
        )
        parser.add_argument(
            "--headcode", type=str, nargs="+",
            help="Only process trips with these headcodes (space-separated, case-insensitive)",
        )
        parser.add_argument(
            "--update-all", action="store_true",
            help="Update all matching trips (not just those with null bustimes_service_id)",
        )

    def handle(self, *args, **options):
        dry_run    = options["dry_run"]
        user_ids   = options.get("user")
        op_vals    = options.get("operator")
        hc_vals    = options.get("headcode")
        update_all = options.get("update_all")

        # ── build queryset ────────────────────────────────────────────────────
        if update_all:
            trips = TripLog.objects.filter(transport_type=TripLog.TRANSPORT_BUS)
        else:
            trips = (
                TripLog.objects
                .filter(transport_type=TripLog.TRANSPORT_BUS)
                .filter(Q(bustimes_service_id__isnull=True) | Q(bustimes_service_slug__isnull=True))
            )

        if user_ids:
            trips = trips.filter(user__in=user_ids)

        if op_vals:
            q = None
            for v in op_vals:
                p = Q(operator__iexact=v)
                q = p if q is None else (q | p)
            trips = trips.filter(q)

        if hc_vals:
            q = None
            for v in hc_vals:
                p = Q(headcode__iexact=v)
                q = p if q is None else (q | p)
            trips = trips.filter(q)

        trips = trips.exclude(Q(headcode="")  | Q(headcode__isnull=True))
        trips = trips.exclude(Q(operator="") | Q(operator__isnull=True))
        trips = trips.order_by("operator", "headcode")

        total_trips = trips.count()
        self.stdout.write(
            f"\n{'DRY RUN — ' if dry_run else ''}Backfilling {total_trips} bus trip(s)\n"
        )

        if total_trips == 0:
            self.stdout.write(self.style.SUCCESS("Nothing to do."))
            return

        # ── Step 1: resolve NOCs & fetch operator service lists ───────────────
        distinct_operators = list(trips.values_list("operator", flat=True).distinct())

        operator_service_map = {}   # op_key  → { LINE_UPPER: [service, …] }
        operator_noc_cache   = {}   # op_key  → noc
        fetched_nocs         = {}   # noc     → grouped map (dedup)

        with tqdm(
            distinct_operators,
            desc="Fetching operator services",
            unit="op",
            bar_format=BAR_FMT,
            leave=True,
        ) as op_bar:
            for op_name in op_bar:
                op_key = op_name.upper()
                op_bar.set_postfix_str(op_name[:30])

                noc = get_noc(op_name)
                operator_noc_cache[op_key] = noc

                if not noc:
                    tqdm.write(self.style.WARNING(f"  ⚠  No NOC found for: {op_name}"))
                    operator_service_map[op_key] = {}
                    continue

                if noc in fetched_nocs:
                    operator_service_map[op_key] = fetched_nocs[noc]
                    continue

                services = fetch_all_services(noc)
                grouped = {}
                for s in services:
                    line = (s.get("line_name") or "").upper()
                    if line:
                        grouped.setdefault(line, []).append(s)

                fetched_nocs[noc] = grouped
                operator_service_map[op_key] = grouped

        # ── Step 2: fetch stops for ambiguous services ────────────────────────
        ambiguous_service_ids = set()
        for trip in trips:
            op_key     = trip.operator.upper()
            line       = (trip.headcode or "").upper()
            candidates = operator_service_map.get(op_key, {}).get(line, [])
            if len(candidates) > 1:
                for s in candidates:
                    ambiguous_service_ids.add(s["id"])

        service_stop_cache = {}
        if ambiguous_service_ids:
            with tqdm(
                sorted(ambiguous_service_ids),
                desc="Fetching ambiguous stops ",
                unit="svc",
                bar_format=BAR_FMT,
                leave=True,
            ) as sid_bar:
                for sid in sid_bar:
                    sid_bar.set_postfix_str(f"id={sid}")
                    service_stop_cache[sid] = fetch_service_stops(sid)

        # ── Step 3: match trips ───────────────────────────────────────────────
        matched = unmatched = ambiguous = 0
        warnings = []   # collected so they print neatly after the bar finishes

        with tqdm(
            trips.iterator(),
            desc="Matching trips         ",
            total=total_trips,
            unit="trip",
            bar_format=BAR_FMT,
            leave=True,
        ) as trip_bar:
            for trip in trip_bar:
                op_key     = trip.operator.upper()
                line       = (trip.headcode or "").upper()
                candidates = operator_service_map.get(op_key, {}).get(line, [])

                # ── search fallback for grouped routes (e.g. 402A → 401/402/403) ──
                if not candidates:
                    try:
                        noc = operator_noc_cache.get(op_key) or get_noc(trip.operator)
                        if noc:
                            search_results = search_fetch_services(noc, trip.headcode)
                            if search_results:
                                candidates = search_results
                    except Exception as e:
                        warnings.append(self.style.WARNING(
                            f"  ⚠  Search fallback failed — trip {trip.id}: {e}"
                        ))

                if not candidates:
                    unmatched += 1
                    warnings.append(self.style.WARNING(
                        f"  ✗  No match: trip {trip.id} — {trip.operator} / {trip.headcode}"
                    ))
                    trip_bar.set_postfix_str(f"✓{matched} ✗{unmatched} ?{ambiguous}")
                    continue

                best = candidates[0] if len(candidates) == 1 else self._disambiguate(
                    trip, candidates, service_stop_cache
                )

                if best:
                    matched += 1
                    if dry_run:
                        tqdm.write(
                            f"  [DRY RUN] Trip {trip.id} → {best['id']} "
                            f"({best.get('description', '')})"
                            f"{' [disambiguated]' if len(candidates) > 1 else ''}"
                            f"{' [grouped]' if best.get('line_name','').upper() != line else ''}"
                        )
                    else:
                        trip.bustimes_service_id   = best["id"]
                        trip.bustimes_service_slug = best["slug"]
                        trip.save(update_fields=["bustimes_service_id", "bustimes_service_slug"])
                else:
                    ambiguous += 1
                    descs = ", ".join(
                        f"{s['id']}:{s.get('description','?')}" for s in candidates
                    )
                    warnings.append(self.style.WARNING(
                        f"  ?  Ambiguous: trip {trip.id} — {trip.operator} / "
                        f"{trip.headcode} → [{descs}]"
                    ))

                trip_bar.set_postfix_str(f"✓{matched} ✗{unmatched} ?{ambiguous}")

        # ── print collected warnings ──────────────────────────────────────────
        if warnings:
            self.stdout.write("")
            for w in warnings:
                self.stdout.write(w)

        # ── summary ───────────────────────────────────────────────────────────
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Done — matched: {matched}  |  ambiguous: {ambiguous}  |  unmatched: {unmatched}"
        ))

    def _disambiguate(self, trip, candidates, service_stop_cache):
        boarded_atco = trip.boarded_stop_atco or ""
        origin_name  = (trip.origin_name or "").lower()
        dest_name    = (trip.destination_name or "").lower()

        if not boarded_atco and not origin_name and not dest_name:
            return None

        scored = []
        for service in candidates:
            sid          = service["id"]
            atcos, names = service_stop_cache.get(sid, (set(), set()))
            score        = 0

            if boarded_atco and boarded_atco in atcos:
                score += 10
            if origin_name and any(origin_name in n for n in names):
                score += 3
            if dest_name and any(dest_name in n for n in names):
                score += 3

            scored.append((score, service))

        scored.sort(key=lambda x: -x[0])

        if scored[0][0] == 0:
            return None
        if len(scored) > 1 and scored[0][0] == scored[1][0]:
            return None  # tied — don't guess

        return scored[0][1]