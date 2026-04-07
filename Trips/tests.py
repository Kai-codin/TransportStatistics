import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from Trips.forms import TripLogForm
from Trips.models import TripLog
from Social.models import Friend


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
