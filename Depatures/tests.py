import datetime
from unittest.mock import Mock, patch

import requests

from django.test import TestCase
from rest_framework.test import APIRequestFactory

from Depatures.filters import DeparturesFilter
from Depatures.models import Timetable, ScheduleLocation
from Depatures.api import BusDeparturesView, BusServiceView, TrainDeparturesView
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


class TrainDeparturesTimezoneTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = TrainDeparturesView.as_view()

    @patch("Depatures.api.timezone.now")
    def test_default_date_time_uses_uk_timezone_in_bst(self, mock_now):
        # 23:30 UTC in July is 00:30 in UK local time (BST, UTC+1).
        mock_now.return_value = datetime.datetime(2026, 7, 1, 23, 30, 0, tzinfo=datetime.timezone.utc)

        request = self.factory.get("/api/departures/", {"crs": "SOT"})
        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["date"], "2026-07-02")
        self.assertEqual(response.data["time_after"], 30 * 60)

    @patch("Depatures.api.timezone.now")
    def test_default_date_time_uses_uk_timezone_in_gmt(self, mock_now):
        # 00:30 UTC in December is 00:30 in UK local time (GMT, UTC+0).
        mock_now.return_value = datetime.datetime(2026, 12, 1, 0, 30, 0, tzinfo=datetime.timezone.utc)

        request = self.factory.get("/api/departures/", {"crs": "SOT"})
        response = self.view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["date"], "2026-12-01")
        self.assertEqual(response.data["time_after"], 30 * 60)


class BusDeparturesViewTests(TestCase):
        def setUp(self):
                self.factory = APIRequestFactory()
                self.view = BusDeparturesView.as_view()

        @patch("Depatures.api.requests.get")
        def test_extracts_trip_id_from_scheduled_link(self, mock_get):
                html = """
                <html>
                    <body>
                        <tbody>
                            <tr>
                                <td class="nowrap"><a href="/services/12e-burton-barton-fradley-lichfield">12E</a></td>
                                <td>Burton upon Trent</td>
                                <td><a href="/journeys/581688959">15:47</a></td>
                            </tr>
                        </tbody>
                    </body>
                </html>
                """
                response_mock = Mock()
                response_mock.text = html
                response_mock.raise_for_status.return_value = None
                mock_get.return_value = response_mock

                request = self.factory.get(
                        "/api/bus-departures/",
                        {"atco_code": "3890D001501", "date": "2026-05-25", "time": "15:00"},
                )
                response = self.view(request)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["results"][0]["trip_id"], "581688959")
                self.assertEqual(response.data["results"][0]["rtt_link"], "https://bustimes.org/journeys/581688959")


        class BusServiceViewTests(TestCase):
            def setUp(self):
                self.factory = APIRequestFactory()
                self.view = BusServiceView.as_view()

            @patch("Depatures.api.requests.get")
            def test_resolves_journey_id_to_trip_id(self, mock_get):
                journey_not_found = Mock()
                journey_error = requests.HTTPError("Not found")
                journey_error.response = Mock(status_code=404)
                journey_not_found.raise_for_status.side_effect = journey_error

                journey_lookup = Mock()
                journey_lookup.raise_for_status.return_value = None
                journey_lookup.json.return_value = {"id": 887045497, "trip_id": 616264382}

                trip_response = Mock()
                trip_response.raise_for_status.return_value = None
                trip_response.json.return_value = {
                    "id": 616264382,
                    "times": [
                        {
                            "aimed_departure_time": "15:47",
                            "stop": {
                                "name": "Stop A",
                                "atco_code": "123",
                                "location": [1.0, 2.0],
                            },
                        }
                    ],
                    "operator": {"name": "Operator", "noc": "OP", "slug": "operator"},
                    "service": {"slug": "service", "id": 1, "line_name": "12E", "mode": "bus"},
                    "headsign": "Destination",
                }

                vehiclejourney_response = Mock()
                vehiclejourney_response.raise_for_status.return_value = None
                vehiclejourney_response.json.return_value = {
                    "results": [{"vehicle": {"id": 99, "fleet_code": "12", "reg": "ABC123"}}]
                }

                vehicles_response = Mock()
                vehicles_response.raise_for_status.return_value = None
                vehicles_response.json.return_value = {
                    "results": [
                        {
                            "id": 99,
                            "fleet_code": "12",
                            "reg": "ABC123",
                            "vehicle_type": {"name": "Bus", "style": "Single", "double_decker": False, "electric": False},
                            "livery": {"name": "Blue", "left": "left", "right": "right"},
                            "special_features": ["wifi"],
                        }
                    ]
                }

                mock_get.side_effect = [
                    journey_not_found,
                    journey_lookup,
                    trip_response,
                    vehiclejourney_response,
                    vehicles_response,
                ]

                request = self.factory.get("/api/bus-service/", {"trip": "887045497"})
                response = self.view(request)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["trip_id"], 616264382)
                self.assertEqual(response.data["vehicle"]["id"], 99)
                self.assertEqual(response.data["locations"][0]["time"]["departure"], "15:47")
                self.assertEqual(
                    mock_get.call_args_list[3].kwargs["params"],
                    {"trip": 616264382, "datetime": "2026-05-25T15:47:00Z"},
                )
