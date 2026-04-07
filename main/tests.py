from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from main.models import Operator, Trains
from Social.models import UserProfile


class OperatorModelTests(TestCase):
    def test_save_generates_unique_slug(self):
        first = Operator.objects.create(name="Great Western Railway", code="GWR")
        second = Operator.objects.create(name="Great Western Railway", code="GWR2")

        self.assertEqual(first.slug, "great-western-railway")
        self.assertEqual(second.slug, "great-western-railway-1")

    def test_str(self):
        op = Operator.objects.create(name="Avanti West Coast", code="AWC")
        self.assertEqual(str(op), "Avanti West Coast (AWC)")


class TrainsModelTests(TestCase):
    def test_str(self):
        train = Trains.objects.create(fleetnumber="390001", type="Pendolino")
        self.assertEqual(str(train), "390001 - Pendolino")


class AuthViewsTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()

    def test_register_get(self):
        response = self.client.get(reverse("register"))
        self.assertEqual(response.status_code, 200)

    def test_register_post_creates_user_and_redirects(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "newuser",
                "password1": "StrongTestPass123!",
                "password2": "StrongTestPass123!",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse("onboarding_import"))
        self.assertTrue(self.user_model.objects.filter(username="newuser").exists())
        user = self.user_model.objects.get(username="newuser")
        self.assertTrue(UserProfile.objects.filter(user=user).exists())

    def test_onboarding_import_page(self):
        response = self.client.get(reverse("onboarding_import"))
        self.assertEqual(response.status_code, 200)
