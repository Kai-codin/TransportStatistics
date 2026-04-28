import datetime
import json
import os
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from Trips.forms import TripLogForm
from Trips.models import ImportJob, TripLog
from Trips.tasks import detect_schema, run_import_job
from Social.models import Friend
from main.models import TrainRID


class TripLogModelTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="tripper", password="pass12345")

    def test_transport_properties(self):
        rail_trip = TripLog.objects.create(user=self.user, transport_type=TripLog.TRANSPORT_RAIL)
        bus_trip = TripLog.objects.create(user=self.user, transport_type=TripLog.TRANSPORT_BUS)

        self.assertTrue(rail_trip.is_rail)
        self.assertFalse(rail_trip.is_bus)
        self.assertTrue(bus_trip.is_bus)
        self.assertFalse(bus_trip.is_rail)

    def test_str_contains_core_fields(self):
        trip = TripLog.objects.create(
            user=self.user,
            headcode="1A23",
            origin_name="Manchester",
            destination_name="London",
            service_date=datetime.date(2026, 4, 1),
        )

        rendered = str(trip)
        self.assertIn("tripper", rendered)
        self.assertIn("1A23", rendered)
        self.assertIn("Manchester", rendered)
        self.assertIn("London", rendered)


class TripLogFormTests(TestCase):
    def test_bus_transport_hides_train_fields(self):
        form = TripLogForm(data={"transport_type": "bus"})

        self.assertEqual(form.fields["headcode"].label, "Route number")
        self.assertEqual(form.fields["train_fleet_number"].widget.__class__.__name__, "HiddenInput")

    def test_rail_transport_hides_bus_fields(self):
        form = TripLogForm(data={"transport_type": "rail"})

        self.assertEqual(form.fields["headcode"].label, "Headcode")
        self.assertEqual(form.fields["bus_fleet_number"].widget.__class__.__name__, "HiddenInput")


class TripViewsTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(username="owner", password="pass12345")
        self.other = user_model.objects.create_user(username="other", password="pass12345")
        self.trip = TripLog.objects.create(
            user=self.owner,
            headcode="2H41",
            origin_name="Origin",
            destination_name="Destination",
            service_date=datetime.date(2026, 4, 2),
        )

    def test_log_trip_post_creates_trip(self):
        self.client.force_login(self.owner)

        response = self.client.post(
            reverse("log_trip"),
            {
                "headcode": "3A10",
                "operator": "Test Operator",
                "transport_type": "rail",
                "origin_name": "Leeds",
                "destination_name": "York",
                "service_date": "2026-04-03",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse("home"))
        self.assertTrue(
            TripLog.objects.filter(
                user=self.owner,
                headcode="3A10",
                origin_name="Leeds",
                destination_name="York",
            ).exists()
        )

    @patch("Trips.views.requests.get")
    def test_log_trip_get_fetches_route_only_for_rail_logging(self, mock_get):
        cache.clear()
        TrainRID.objects.create(
            rid="RID123",
            uid="UID123",
            headcode="2H41",
        )

        mock_response = mock_get.return_value
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {"coordinates": [[-1.0, 50.0], [-1.1, 50.1]]}

        self.client.force_login(self.owner)
        response = self.client.get(
            reverse("log_trip"),
            {
                "transport_type": "rail",
                "cif_train_uid": "UID123",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["form"].initial["route_geometry"], [[-1.0, 50.0], [-1.1, 50.1]])
        self.assertEqual(response.context["form"].initial["full_route_geometry"], [[-1.0, 50.0], [-1.1, 50.1]])
        mock_get.assert_called_once()
        self.assertIn("/api/route/RID123", mock_get.call_args.args[0])

    def test_join_trip_toggles_membership(self):
        self.client.force_login(self.other)
        Friend.objects.create(user=self.owner, friend=self.other, status="accepted")

        url = reverse("join_trip", args=[self.trip.pk])
        add_response = self.client.post(url)
        self.assertEqual(add_response.status_code, 302)
        self.assertTrue(self.trip.on_trip_trip.filter(pk=self.other.pk).exists())

        remove_response = self.client.post(url)
        self.assertEqual(remove_response.status_code, 302)
        self.assertFalse(self.trip.on_trip_trip.filter(pk=self.other.pk).exists())

    def test_delete_trip_forbidden_for_non_owner(self):
        self.client.force_login(self.other)

        response = self.client.post(reverse("delete_trip", args=[self.trip.pk]))

        self.assertEqual(response.status_code, 403)
        self.assertTrue(TripLog.objects.filter(pk=self.trip.pk).exists())

    def test_edit_trip_owner_can_update(self):
        self.client.force_login(self.owner)

        response = self.client.post(
            reverse("edit_trip", args=[self.trip.pk]),
            {
                "headcode": "2H42",
                "operator": "",
                "transport_type": "rail",
                "origin_name": "Origin",
                "destination_name": "Destination",
                "service_date": "2026-04-02",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.headcode, "2H42")

    def test_trip_detail_private_profile_returns_403(self):
        self.owner.profile.privacy = self.owner.profile.PRIVACY_PRIVATE
        self.owner.profile.save(update_fields=["privacy"])
        self.client.force_login(self.other)

        response = self.client.get(reverse("trip_detail", args=[self.trip.pk]))

        self.assertEqual(response.status_code, 403)


class TripImportTaskTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="importer", password="pass12345")
        self.tempfiles = []

    def tearDown(self):
        for path in self.tempfiles:
            if os.path.exists(path):
                os.unlink(path)

    def _write_import_file(self, payload):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(payload, handle)
        handle.close()
        self.tempfiles.append(handle.name)
        return handle.name

    def test_run_import_job_supports_v4_obfuscated_payload(self):
        payload = [
            {
                "AGENCY_TIMEZONE_69BA37": "Europe/London",
                "ORGANISATION_CC0F85": "Gosport-Portsmouth Ferry",
                "ID_DC8DC0": "019b6f69-e456-71c0-83b1-0f3373fa2b61",
                "LEG_NAME_C7909D": "Gosport Ferry",
                "DATA_SOURCES_ID_42CA97": "BODSUK",
                "VEHICLE_FD401C": [
                    {
                        "ALLOCATION_NAME_6F8A9F": "FERRY",
                        "ALLOCATION_REG_D36C42": "",
                        "VEHICLE_DATA_3E273F": {
                            "livery": {
                                "ID_DC8DC0": "2934",
                                "left": "linear-gradient(#fff 25%,#2a6b31 25% 50%,#fff 50% 75%,#2a6b31 75%)",
                                "name": "Dews",
                            }
                        },
                    }
                ],
                "PORTS_9DEA7E": [
                    {
                        "STAND_NAME_BD7CF1": "Gosport Ferry Terminal",
                        "PIN_4EAEC9": "50.79484914811,-1.11612399657",
                        "DISPATCH_TIME_EF9FF7": "2025-12-30T10:45:00+00:00",
                        "STAND_ID_8B2187": "9300GOS1",
                    },
                    {
                        "STAND_ID_8B2187": "9300PMH1",
                        "ARRIVE_TIME_07587C": "2025-12-30T10:52:00+00:00",
                        "STAND_NAME_BD7CF1": "Portsea Portsmouth Harbour Station Pier",
                        "PIN_4EAEC9": "50.79701826163,-1.10927223367",
                        "LINESTRING_TO_STAND_B2D391": "50.79484914811,-1.11612399657;50.79701826163,-1.10927223367",
                    },
                ],
                "DISPATCH_DATE_FF0F0A": "2025-12-30T00:00:00+00:00",
            }
        ]

        job = ImportJob.objects.create(
            user=self.user,
            filepath=self._write_import_file(payload),
            status=ImportJob.STATUS_UPLOADED,
        )

        run_import_job(job.pk)

        job.refresh_from_db()
        trip = TripLog.objects.get(user=self.user)

        self.assertEqual(job.status, ImportJob.STATUS_COMPLETED)
        self.assertEqual(job.inserted, 1)
        self.assertEqual(trip.transport_type, TripLog.TRANSPORT_FERRY)
        self.assertEqual(trip.headcode, "Gosport Ferry")
        self.assertEqual(trip.operator, "Gosport-Portsmouth Ferry")
        self.assertEqual(trip.service_date, datetime.date(2025, 12, 30))
        self.assertEqual(trip.scheduled_departure, datetime.time(10, 45))
        self.assertEqual(trip.scheduled_arrival, datetime.time(10, 52))
        self.assertEqual(trip.boarded_stop_atco, "9300GOS1")
        self.assertEqual(trip.bus_fleet_number, "FERRY")
        self.assertEqual(trip.bus_livery_name, "Dews")
        self.assertEqual(len(trip.route_geometry), 2)
        self.assertAlmostEqual(trip.route_geometry[0][0], -1.11612399657)
        self.assertAlmostEqual(trip.route_geometry[0][1], 50.79484914811)

    def test_run_import_job_supports_v2_obfuscated_livery_payload(self):
        payload = [
            {
                "updatedAtB3cc7b": "Wednesday, January 21st 2026 at 7:47 AM",
                "createdAt2c8103": "Wednesday, January 21st 2026 at 7:47 AM",
                "excursionName856488": "7",
                "dispatchDate5bacc7": "Wednesday, January 21st 2026 at 12:00 AM",
                "undertakingAec361": "Arriva Midlands North",
                "dataSourcesId1e5d2c": "BODSUK",
                "equipment738677": [
                    {
                        "equipmentDatasourceBe1b6f": "BUSTIM",
                        "unitRegE0afbc": "MX59JZF",
                        "equipmentData78ca7f": {
                            "fleet_code": "3705",
                            "fleet_number": 3705,
                            "reg": "MX59JZF",
                            "livery": {
                                "left": "radial-gradient(circle at -20% 25%,#25b0cf 48%,#64cde5 48% 56%,#fff 56% 62%,#25b0cf 62%)",
                                "name": "Arriva Journey Mark",
                                "id5c7259": "28",
                            },
                            "vehicle_type": {
                                "name": "VDL SB200 Wright Pulsar 2",
                            },
                        },
                        "unitName37b907": "3705",
                    }
                ],
                "agencyTimezone7e18e2": "Europe/London",
                "nodes016d3d": [
                    {
                        "platformName084055": "Donnington Parade",
                        "location66899e_lng": -2.439988,
                        "location66899e_lat": 52.717232,
                        "dispatchTime285346": "Wednesday, January 21st 2026 at 7:53 AM",
                        "platformIdCcc4be": "3590E056900",
                    },
                    {
                        "platformName084055": "Telford Bus Station",
                        "location66899e_lng": -2.447896,
                        "location66899e_lat": 52.675526,
                        "trailToPlatformDc7c3e": [
                            [-2.439903, 52.717257],
                            [-2.447896, 52.675526],
                        ],
                        "alightTime02c3d3": "Wednesday, January 21st 2026 at 8:22 AM",
                        "platformIdCcc4be": "3590E105300",
                    },
                ],
            }
        ]

        job = ImportJob.objects.create(
            user=self.user,
            filepath=self._write_import_file(payload),
            status=ImportJob.STATUS_UPLOADED,
        )

        self.assertEqual(detect_schema(payload[0]), "v2")

        run_import_job(job.pk)

        job.refresh_from_db()
        trip = TripLog.objects.get(user=self.user)

        self.assertEqual(job.status, ImportJob.STATUS_COMPLETED)
        self.assertEqual(job.inserted, 1)
        self.assertEqual(trip.transport_type, TripLog.TRANSPORT_BUS)
        self.assertEqual(trip.headcode, "7")
        self.assertEqual(trip.operator, "Arriva Midlands North")
        self.assertEqual(trip.bus_fleet_number, "3705")
        self.assertEqual(trip.bus_registration, "MX59JZF")
        self.assertEqual(trip.bus_type, "VDL SB200 Wright Pulsar 2")
        self.assertEqual(trip.bus_livery_name, "Arriva Journey Mark")
        self.assertTrue(trip.bus_livery.startswith("radial-gradient("))
        self.assertEqual(trip.service_date, datetime.date(2026, 1, 21))
        self.assertEqual(trip.scheduled_departure, datetime.time(7, 53))
        self.assertEqual(trip.scheduled_arrival, datetime.time(8, 22))
        self.assertEqual(trip.boarded_stop_atco, "3590E056900")
        self.assertEqual(len(trip.route_geometry), 2)
        self.assertEqual(trip.full_locations[0]["coordinates"], [-2.439988, 52.717232])
        self.assertEqual(trip.route_geometry, [[-2.439903, 52.717257], [-2.447896, 52.675526]])
        self.assertEqual(trip.full_route_geometry, [[-2.439903, 52.717257], [-2.447896, 52.675526]])

    def test_run_import_job_supports_v2_flipped_trace_coordinates(self):
        payload = [
            {
                "updatedAtB3cc7b": "Wednesday, January 21st 2026 at 7:47 AM",
                "excursionName856488": "7",
                "dispatchDate5bacc7": "Wednesday, January 21st 2026 at 12:00 AM",
                "undertakingAec361": "Arriva Midlands North",
                "dataSourcesId1e5d2c": "BODSUK",
                "nodes016d3d": [
                    {
                        "platformName084055": "Donnington Parade",
                        "location66899e_lng": -2.439988,
                        "location66899e_lat": 52.717232,
                        "dispatchTime285346": "Wednesday, January 21st 2026 at 7:53 AM",
                        "platformIdCcc4be": "3590E056900",
                    },
                    {
                        "platformName084055": "Telford Bus Station",
                        "location66899e_lng": -2.447896,
                        "location66899e_lat": 52.675526,
                        "trailToPlatformDc7c3e": [
                            [52.717257, -2.439903],
                            [52.675526, -2.447896],
                        ],
                        "alightTime02c3d3": "Wednesday, January 21st 2026 at 8:22 AM",
                        "platformIdCcc4be": "3590E105300",
                    },
                ],
            }
        ]

        job = ImportJob.objects.create(
            user=self.user,
            filepath=self._write_import_file(payload),
            status=ImportJob.STATUS_UPLOADED,
        )

        run_import_job(job.pk)

        trip = TripLog.objects.get(user=self.user)

        self.assertEqual(trip.route_geometry, [[-2.439903, 52.717257], [-2.447896, 52.675526]])
        self.assertEqual(trip.full_route_geometry, [[-2.439903, 52.717257], [-2.447896, 52.675526]])

    def test_run_import_job_keeps_legacy_v1_payload_working(self):
        payload = [
            {
                "id": "legacy-1",
                "data_sources_id": "BODSUK",
                "service_name": "22",
                "agency": "Stagecoach South",
                "agency_timezone": "Europe/London",
                "departure_date": "2026-01-18",
                "vehicle": [
                    {
                        "fleet_name": "27869",
                        "fleet_reg": "GX13AOO",
                        "vehicle_data": {
                            "fleet_number": 27869,
                            "reg": "GX13AOO",
                            "vehicle_type": {"name": "ADL/TransBus Enviro300"},
                            "livery": {"left": "#0f6db4", "name": "Portsmouth 20"},
                        },
                    }
                ],
                "stops": [
                    {
                        "stop_name": "Leigh Park Crabwood Court",
                        "departure_time": "2026-01-18 13:35:00",
                        "coordinates": "-0.99888,50.87882",
                    },
                    {
                        "stop_name": "Havant Bus Station",
                        "arrival_time": "2026-01-18 13:55:00",
                        "coordinates": "-0.9839,50.85239",
                        "polyline_to_stop": "-0.99888,50.87882;-0.9839,50.85239",
                    },
                ],
            }
        ]

        job = ImportJob.objects.create(
            user=self.user,
            filepath=self._write_import_file(payload),
            status=ImportJob.STATUS_UPLOADED,
        )

        run_import_job(job.pk)

        job.refresh_from_db()
        trip = TripLog.objects.get(user=self.user)

        self.assertEqual(job.status, ImportJob.STATUS_COMPLETED)
        self.assertEqual(job.inserted, 1)
        self.assertEqual(trip.transport_type, TripLog.TRANSPORT_BUS)
        self.assertEqual(trip.headcode, "22")
        self.assertEqual(trip.operator, "Stagecoach South")
        self.assertEqual(trip.bus_registration, "GX13AOO")
        self.assertEqual(trip.bus_type, "ADL/TransBus Enviro300")
        self.assertEqual(trip.bus_livery_name, "Portsmouth 20")
        self.assertEqual(trip.service_date, datetime.date(2026, 1, 18))
        self.assertEqual(trip.scheduled_departure, datetime.time(13, 35))
        self.assertEqual(trip.scheduled_arrival, datetime.time(13, 55))
        self.assertEqual(trip.route_geometry, [[-0.99888, 50.87882], [-0.9839, 50.85239]])
