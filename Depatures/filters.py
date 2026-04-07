import django_filters
from django.db.models import Q, Subquery, OuterRef

from .models import ScheduleLocation


_DAY_NAME_TO_INDEX = {
    "monday":    0,
    "tuesday":   1,
    "wednesday": 2,
    "thursday":  3,
    "friday":    4,
    "saturday":  5,
    "sunday":    6,
}


class DeparturesFilter(django_filters.FilterSet):
    """
    Filters for the Departures API.

    Supported query params
    ----------------------
    headcode        - exact match on timetable.headcode  (case-insensitive)
    operator        - partial match on operator name or exact on operator code
    day             - a day name ("Monday") or index (0-6); keeps only services
                      that run on that day according to the schedule_days_runs bitmask
    origin_crs      - CRS code of the first stop of the service
    origin_name     - partial match on the name of the first stop
    destination_crs - CRS code of the last stop of the service
    destination_name- partial match on the name of the last stop

    Usage in views.py
    -----------------
    from .filters import DeparturesFilter

    # Inside DeparturesView.get(), after building `candidates`:
    f = DeparturesFilter(request.GET, queryset=candidates_qs)
    candidates = f.qs.iterator(chunk_size=200)
    """

    headcode = django_filters.CharFilter(
        field_name="timetable__headcode",
        lookup_expr="iexact",
        label="Headcode",
    )

    operator = django_filters.CharFilter(
        method="filter_operator",
        label="Operator name or code (partial match)",
    )

    day = django_filters.CharFilter(
        method="filter_day",
        label='Day name ("Monday") or index 0-6',
    )

    origin_crs = django_filters.CharFilter(
        method="filter_origin_crs",
        label="Origin station CRS code",
    )
    origin_name = django_filters.CharFilter(
        method="filter_origin_name",
        label="Origin station name (partial match)",
    )

    destination_crs = django_filters.CharFilter(
        method="filter_destination_crs",
        label="Destination station CRS code",
    )
    destination_name = django_filters.CharFilter(
        method="filter_destination_name",
        label="Destination station name (partial match)",
    )

    class Meta:
        model  = ScheduleLocation
        fields: list = []

    def filter_operator(self, queryset, name, value):
        """Match operator name (partial, case-insensitive) OR operator code (exact)."""
        return queryset.filter(
            Q(timetable__operator__name__icontains=value)
            | Q(timetable__operator__code__iexact=value)
        )

    def filter_day(self, queryset, name, value):
        """
        Keep services that run on a given day.

        Accepts either a day name (case-insensitive) or a numeric index 0-6
        (Monday=0 … Sunday=6).  Looks at the 7-character bitmask stored in
        timetable.schedule_days_runs - the character at position <day_index>
        must be "1".

        Because the mask is stored as a plain string in the DB we can't filter
        it efficiently with a pure ORM expression on all databases, so we do a
        LIKE/contains check on the substring position using Django's
        __regex lookup, which works on PostgreSQL, MySQL, and SQLite.
        """
        value = value.strip().lower()
        if value.isdigit():
            idx = int(value)
        else:
            idx = _DAY_NAME_TO_INDEX.get(value)

        if idx is None or not (0 <= idx <= 6):
            # Unknown day - return unchanged queryset (don't 500)
            return queryset

        # Build a regex that matches a 7-char string where position <idx> is "1".
        # Positions before idx: any char ([01])
        # Position idx: "1"
        # Positions after idx: any char ([01])
        before = r"[01]" * idx
        after  = r"[01]" * (6 - idx)
        pattern = rf"^{before}1{after}$"

        return queryset.filter(timetable__schedule_days_runs__regex=pattern)

    def _origin_timetable_ids(self, crs=None, name=None):
        """
        Return a queryset of timetable IDs whose first ScheduleLocation stop
        matches the given CRS or name filter.

        Strategy: for each timetable, the origin is the ScheduleLocation with
        the lowest `position`.  We use a subquery to find that minimum position
        per timetable, then filter stop on it.
        """
        from django.db.models import Min

        # Subquery: minimum position for each timetable
        min_pos_sq = (
            ScheduleLocation.objects
            .filter(timetable=OuterRef("timetable"))
            .order_by("position")
            .values("position")[:1]
        )

        stop_q = Q()
        if crs:
            stop_q &= Q(stop__crs__iexact=crs)
        if name:
            stop_q &= Q(stop__name__icontains=name)

        return (
            ScheduleLocation.objects
            .filter(stop_q, position=Subquery(min_pos_sq))
            .values_list("timetable_id", flat=True)
        )

    def filter_origin_crs(self, queryset, name, value):
        ids = self._origin_timetable_ids(crs=value)
        return queryset.filter(timetable_id__in=ids)

    def filter_origin_name(self, queryset, name, value):
        ids = self._origin_timetable_ids(name=value)
        return queryset.filter(timetable_id__in=ids)

    def _destination_timetable_ids(self, crs=None, name=None):
        """
        Return timetable IDs whose last ScheduleLocation stop matches the filter.
        """
        max_pos_sq = (
            ScheduleLocation.objects
            .filter(timetable=OuterRef("timetable"))
            .order_by("-position")
            .values("position")[:1]
        )

        stop_q = Q()
        if crs:
            stop_q &= Q(stop__crs__iexact=crs)
        if name:
            stop_q &= Q(stop__name__icontains=name)

        return (
            ScheduleLocation.objects
            .filter(stop_q, position=Subquery(max_pos_sq))
            .values_list("timetable_id", flat=True)
        )

    def filter_destination_crs(self, queryset, name, value):
        ids = self._destination_timetable_ids(crs=value)
        return queryset.filter(timetable_id__in=ids)

    def filter_destination_name(self, queryset, name, value):
        ids = self._destination_timetable_ids(name=value)
        return queryset.filter(timetable_id__in=ids)
