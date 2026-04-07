from django.test import TestCase

from Stops.models import Stop, StopType


class StopTypeModelTests(TestCase):
    def test_str(self):
        stop_type = StopType.objects.create(name="Rail Station", code="RLY")
        self.assertEqual(str(stop_type), "Rail Station")


class StopModelTests(TestCase):
    def test_str_uses_atco_when_present(self):
        stop = Stop.objects.create(name="Piccadilly", atco_code="1800MCR123", lat=53.0, lon=-2.0)
        self.assertEqual(str(stop), "Piccadilly - 1800MCR123")

    def test_str_uses_naptan_when_atco_missing(self):
        stop = Stop.objects.create(name="Victoria", naptan_code="manjptad", lat=53.1, lon=-2.1)
        self.assertEqual(str(stop), "Victoria - manjptad")

    def test_str_uses_crs_and_tiploc_when_present(self):
        stop = Stop.objects.create(name="Euston", crs="EUS", tiploc="EUSTON", lat=51.5, lon=-0.1)
        self.assertEqual(str(stop), "Euston - EUS / EUSTON")

    def test_str_falls_back_to_pk(self):
        stop = Stop.objects.create(lat=50.0, lon=0.0)
        self.assertEqual(str(stop), f"Stop {stop.pk}")
