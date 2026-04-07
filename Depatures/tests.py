import datetime

from django.test import TestCase

from Depatures.filters import DeparturesFilter
from Depatures.models import Timetable, ScheduleLocation
from Stops.models import Stop
from main.models import Operator


class ScheduleLocationModelTests(TestCase):
    def setUp(self):
        self.operator = Operator.objects.create(name="Operator A", code="OPA")
        self.stop = Stop.objects.create(name="Stop A", crs="STA", tiploc="STOPA", lat=1.0, lon=1.0)
        self.timetable = Timetable.objects.create(
            CIF_train_uid="C12345",
            operator=self.operator,
            headcode="1A01",
            schedule_start_date=datetime.date(2026, 1, 1),
            schedule_end_date=datetime.date(2026, 12, 31),
            schedule_days_runs="1111100",
        )

    def test_time_property_prefers_arrival_and_departure_combo(self):
        loc = ScheduleLocation.objects.create(
            timetable=self.timetable,
            stop=self.stop,
            arrival_time="10:01",
            departure_time="10:03",
            position=1,
        )
        self.assertEqual(loc.time, "10:01 - 10:03 | arr-dep")

    def test_time_property_falls_back_to_pass(self):
        loc = ScheduleLocation.objects.create(
            timetable=self.timetable,
            stop=self.stop,
            pass_time="11:20",
            position=2,
        )
        self.assertEqual(loc.time, "11:20 | pass")


class DeparturesFilterTests(TestCase):
    def setUp(self):
        self.operator = Operator.objects.create(name="Operator A", code="OPA")
        self.origin = Stop.objects.create(name="Origin Stop", crs="ORG", tiploc="ORIGIN", lat=2.0, lon=2.0)
        self.mid = Stop.objects.create(name="Mid Stop", crs="MID", tiploc="MIDSTP", lat=3.0, lon=3.0)
        self.dest = Stop.objects.create(name="Destination Stop", crs="DST", tiploc="DESTN", lat=4.0, lon=4.0)

        self.timetable = Timetable.objects.create(
            CIF_train_uid="U10000",
            operator=self.operator,
            headcode="2B10",
            schedule_days_runs="1000000",
        )
        ScheduleLocation.objects.create(timetable=self.timetable, stop=self.origin, position=1, departure_time="09:00")
        ScheduleLocation.objects.create(timetable=self.timetable, stop=self.mid, position=2, pass_time="09:20")
        ScheduleLocation.objects.create(timetable=self.timetable, stop=self.dest, position=3, arrival_time="09:40")

        other_timetable = Timetable.objects.create(
            CIF_train_uid="U20000",
            operator=self.operator,
            headcode="2B11",
            schedule_days_runs="0100000",
        )
        ScheduleLocation.objects.create(timetable=other_timetable, stop=self.dest, position=1, departure_time="10:00")

        self.base_qs = ScheduleLocation.objects.all()

    def test_filter_operator_matches_name_and_code(self):
        by_name = DeparturesFilter({"operator": "operator"}, queryset=self.base_qs).qs
        by_code = DeparturesFilter({"operator": "OPA"}, queryset=self.base_qs).qs

        self.assertGreaterEqual(by_name.count(), 1)
        self.assertGreaterEqual(by_code.count(), 1)

    def test_filter_day_uses_bitmask(self):
        monday_qs = DeparturesFilter({"day": "monday"}, queryset=self.base_qs).qs
        tuesday_qs = DeparturesFilter({"day": "1"}, queryset=self.base_qs).qs

        self.assertTrue(monday_qs.filter(timetable=self.timetable).exists())
        self.assertFalse(tuesday_qs.filter(timetable=self.timetable).exists())

    def test_filter_origin_and_destination(self):
        origin_filtered = DeparturesFilter({"origin_crs": "ORG"}, queryset=self.base_qs).qs
        destination_filtered = DeparturesFilter({"destination_name": "Destination"}, queryset=self.base_qs).qs

        self.assertTrue(origin_filtered.filter(timetable=self.timetable).exists())
        self.assertTrue(destination_filtered.filter(timetable=self.timetable).exists())
