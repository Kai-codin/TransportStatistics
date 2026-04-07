from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from Social.models import Friend, UserProfile


class SocialModelTests(TestCase):
    def test_profile_is_created_by_signal(self):
        user = get_user_model().objects.create_user(username="signal_user", password="x")
        self.assertTrue(UserProfile.objects.filter(user=user).exists())


class FriendViewsTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.alice = user_model.objects.create_user(username="alice", password="pass12345")
        self.bob = user_model.objects.create_user(username="bob", password="pass12345")

    def test_add_friend_creates_pending_relationship(self):
        self.client.force_login(self.alice)

        response = self.client.get(reverse("add_friend", args=[self.bob.id]))

        self.assertEqual(response.status_code, 302)
        rel = Friend.objects.get(user=self.alice, friend=self.bob)
        self.assertEqual(rel.status, "pending")

    def test_accept_friend_sets_accepted_and_creates_reciprocal(self):
        Friend.objects.create(user=self.alice, friend=self.bob, status="pending")
        self.client.force_login(self.bob)

        response = self.client.get(reverse("accept_friend", args=[self.alice.id]))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(Friend.objects.get(user=self.alice, friend=self.bob).status, "accepted")
        self.assertEqual(Friend.objects.get(user=self.bob, friend=self.alice).status, "accepted")

    def test_decline_friend_sets_rejected(self):
        Friend.objects.create(user=self.alice, friend=self.bob, status="pending")
        self.client.force_login(self.bob)

        response = self.client.get(reverse("decline_friend", args=[self.alice.id]))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(Friend.objects.get(user=self.alice, friend=self.bob).status, "rejected")

    def test_friends_page_search_returns_matching_users(self):
        self.client.force_login(self.alice)

        response = self.client.post(reverse("friends"), {"username": "bo"})

        self.assertEqual(response.status_code, 200)
        results = list(response.context["results"])
        self.assertEqual([u.username for u in results], ["bob"])
