from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from API.serializers import FleetSerializer, TrainFleetVehicleSerializer
from Stops.models import Stop, StopType
from main.models import Operator, Trains


class SerializerTests(TestCase):
    def test_fleet_serializer_livery_shape(self):
        train = Trains.objects.create(
            fleetnumber="700001",
            type="Class 700",
            livery_name="Thameslink",
            livery_css="#112233",
        )

        data = FleetSerializer(train).data

        self.assertEqual(data["fleetnumber"], "700001")
        self.assertEqual(data["livery"], {"name": "Thameslink", "css": "#112233"})

    def test_train_fleet_vehicle_serializer_operator_payload(self):
        op = Operator.objects.create(name="Northern", code="NT")
        train = Trains.objects.create(fleetnumber="331001", type="Class 331", operator=op)

        data = TrainFleetVehicleSerializer(train).data

        self.assertEqual(data["fleet_number"], "331001")
        self.assertEqual(data["operator"]["name"], "Northern")
        self.assertEqual(data["reg"], None)
        self.assertEqual(data["withdrawn"], False)


class ApiViewsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.stop_type = StopType.objects.create(name="Rail", code="RLY")
        self.mapped_stop = Stop.objects.create(
            name="Mapped Stop",
            atco_code="ATCO1",
            crs="AAA",
            tiploc="AAA1",
            stop_type=self.stop_type,
            show_on_map=True,
            active=True,
            lat=53.0,
            lon=-2.0,
        )
        self.hidden_stop = Stop.objects.create(
            name="Hidden Stop",
            atco_code="ATCO2",
            show_on_map=False,
            active=True,
            lat=52.0,
            lon=-1.0,
        )

    def test_stops_endpoint_defaults_to_show_on_map(self):
        response = self.client.get("/api/stops/")
        self.assertEqual(response.status_code, 200)
        names = [item["name"] for item in response.data["results"]]
        self.assertIn("Mapped Stop", names)
        self.assertNotIn("Hidden Stop", names)

    def test_stops_endpoint_bbox_filters_results(self):
        response = self.client.get("/api/stops/", {"bbox": "-2.1,52.9,-1.9,53.1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "Mapped Stop")

    def test_enrich_stop_requires_atco(self):
        response = self.client.get("/api/stops/enrich/")
        self.assertEqual(response.status_code, 400)

    def test_enrich_stop_not_found(self):
        response = self.client.get("/api/stops/enrich/", {"atco": "missing"})
        self.assertEqual(response.status_code, 404)

    @patch("API.views.requests.Session")
    def test_enrich_stop_updates_fields_from_bustimes(self, session_cls):
        response_payload = {
            "name": "Updated Name",
            "long_name": "Updated Long Name",
            "icon": "bus",
            "line_names": ["10", "20"],
        }
        mock_response = MagicMock()
        mock_response.json.return_value = response_payload
        mock_response.raise_for_status.return_value = None
        mock_session = MagicMock()
        mock_session.get.return_value = mock_response
        session_cls.return_value = mock_session

        response = self.client.get("/api/stops/enrich/", {"atco": "ATCO1"})

        self.assertEqual(response.status_code, 200)
        self.mapped_stop.refresh_from_db()
        self.assertEqual(self.mapped_stop.common_name, "Updated Name")
        self.assertEqual(self.mapped_stop.long_name, "Updated Long Name")
        self.assertEqual(self.mapped_stop.icon, "bus")
        self.assertEqual(self.mapped_stop.lines, "10,20")
        self.assertTrue(response.data["updated"])

    def test_fleet_search_returns_filtered_results(self):
        Trains.objects.create(fleetnumber="390001", type="Pendolino")
        Trains.objects.create(fleetnumber="700001", type="Desiro")

        response = self.client.get("/api/fleet/", {"q": "390"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["fleetnumber"], "390001")

    def test_train_fleet_returns_count_and_pagination(self):
        operator = Operator.objects.create(name="Avanti", code="AWC")
        for n in range(5):
            Trains.objects.create(fleetnumber=f"39000{n}", type="Pendolino", operator=operator)

        response = self.client.get("/api/train-fleet/", {"operator_id": operator.id, "limit": 2, "offset": 0})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 5)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])

    def test_train_fleet_invalid_limit_falls_back(self):
        operator = Operator.objects.create(name="CrossCountry", code="XC")
        Trains.objects.create(fleetnumber="220001", type="Voyager", operator=operator)

        response = self.client.get("/api/train-fleet/", {"operator": "CrossCountry", "limit": "nope"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
