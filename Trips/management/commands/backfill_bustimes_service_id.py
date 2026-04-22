import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.contrib.auth import get_user_model
from Trips.models import TripLog

User = get_user_model()

MAX_WORKERS = 20  # tune to taste / rate-limit headroom


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
    atcos = set()
    names = set()
    try:
        url = "https://bustimes.org/api/stops/"
        params = {"service": service_id, "limit": 100}
        while url:
            resp = requests.get(url, params=params, timeout=10).json()
            for stop in resp.get("results", []):
                atcos.add(stop["atco_code"])
                names.add(stop["name"].lower())
            url = resp.get("next")
            params = {}
    except Exception:
        pass
    return atcos, names

BAR_FMT = "{l_bar}{bar:30}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}]"


class Command(BaseCommand):
    help = "Backfill bustimes_service_id on existing bus TripLog entries"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--user", type=int, nargs="+")
        parser.add_argument("--operator", type=str, nargs="+")
        parser.add_argument("--headcode", type=str, nargs="+")
        parser.add_argument("--update-all", action="store_true")
        parser.add_argument(
            "--workers", type=int, default=MAX_WORKERS,
            help="Thread-pool size for parallel HTTP calls (default: %(default)s)",
        )

    def handle(self, *args, **options):
        dry_run    = options["dry_run"]
        user_ids   = options.get("user")
        op_vals    = options.get("operator")
        hc_vals    = options.get("headcode")
        update_all = options.get("update_all")
        workers    = options["workers"]

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

        trips = trips.exclude(Q(headcode="")   | Q(headcode__isnull=True))
        trips = trips.exclude(Q(operator="")   | Q(operator__isnull=True))
        trips = trips.order_by("operator", "headcode")

        total_trips = trips.count()
        self.stdout.write(
            f"\n{'DRY RUN — ' if dry_run else ''}Backfilling {total_trips} bus trip(s)\n"
        )
        if total_trips == 0:
            self.stdout.write(self.style.SUCCESS("Nothing to do."))
            return

        # ── Step 1: resolve NOCs & fetch operator service lists (parallel) ────
        distinct_operators = list(trips.values_list("operator", flat=True).distinct())
        operator_service_map = {}
        operator_noc_cache   = {}
        fetched_nocs         = {}

        def resolve_operator(op_name):
            noc = get_noc(op_name)
            if not noc:
                return op_name, noc, {}
            services = fetch_all_services(noc)
            grouped = {}
            for s in services:
                line = (s.get("line_name") or "").upper()
                if line:
                    grouped.setdefault(line, []).append(s)
            return op_name, noc, grouped

        with tqdm(
            total=len(distinct_operators),
            desc="Fetching operator services",
            unit="op",
            bar_format=BAR_FMT,
        ) as bar:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = {ex.submit(resolve_operator, op): op for op in distinct_operators}
                for fut in as_completed(futures):
                    op_name, noc, grouped = fut.result()
                    op_key = op_name.upper()
                    operator_noc_cache[op_key] = noc
                    if not noc:
                        tqdm.write(self.style.WARNING(f"  ⚠  No NOC found for: {op_name}"))
                        operator_service_map[op_key] = {}
                    else:
                        if noc in fetched_nocs:
                            operator_service_map[op_key] = fetched_nocs[noc]
                        else:
                            fetched_nocs[noc] = grouped
                            operator_service_map[op_key] = grouped
                    bar.update(1)
                    bar.set_postfix_str(op_name[:30])

        # ── Step 2: fetch stops for ambiguous services (parallel) ─────────────
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
            sid_list = sorted(ambiguous_service_ids)
            with tqdm(
                total=len(sid_list),
                desc="Fetching ambiguous stops ",
                unit="svc",
                bar_format=BAR_FMT,
            ) as bar:
                with ThreadPoolExecutor(max_workers=workers) as ex:
                    futures = {ex.submit(fetch_service_stops, sid): sid for sid in sid_list}
                    for fut in as_completed(futures):
                        sid = futures[fut]
                        service_stop_cache[sid] = fut.result()
                        bar.update(1)
                        bar.set_postfix_str(f"id={sid}")

        # ── Step 3: match trips ───────────────────────────────────────────────

        # Pre-compute which (noc, headcode) pairs need a search fallback,
        # deduplicate, fetch them all in parallel, then loop without any HTTP.
        fallback_keys = set()
        for trip in trips.iterator():
            op_key = trip.operator.upper()
            line   = (trip.headcode or "").upper()
            if not operator_service_map.get(op_key, {}).get(line):
                noc = operator_noc_cache.get(op_key)
                if noc:
                    fallback_keys.add((noc, trip.headcode))

        fallback_cache = {}   # (noc, headcode) → [service, …]
        if fallback_keys:
            def do_search(key):
                noc, headcode = key
                return key, search_fetch_services(noc, headcode)

            with tqdm(
                total=len(fallback_keys),
                desc="Search fallbacks       ",
                unit="q",
                bar_format=BAR_FMT,
            ) as bar:
                with ThreadPoolExecutor(max_workers=workers) as ex:
                    futures = {ex.submit(do_search, k): k for k in fallback_keys}
                    for fut in as_completed(futures):
                        key, results = fut.result()
                        fallback_cache[key] = results
                        bar.update(1)

        matched = unmatched = ambiguous = 0
        warnings  = []
        to_update = []   # collect dirty trips for bulk_update

        with tqdm(
            trips.iterator(),
            desc="Matching trips         ",
            total=total_trips,
            unit="trip",
            bar_format=BAR_FMT,
        ) as trip_bar:
            for trip in trip_bar:
                op_key     = trip.operator.upper()
                line       = (trip.headcode or "").upper()
                candidates = operator_service_map.get(op_key, {}).get(line, [])

                if not candidates:
                    noc = operator_noc_cache.get(op_key)
                    if noc:
                        candidates = fallback_cache.get((noc, trip.headcode), [])

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
                        to_update.append(trip)
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

        # Single bulk write instead of one UPDATE per trip
        if to_update and not dry_run:
            TripLog.objects.bulk_update(
                to_update,
                ["bustimes_service_id", "bustimes_service_slug"],
                batch_size=500,
            )
            
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
            return None
        return scored[0][1]