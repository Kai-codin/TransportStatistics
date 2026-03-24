from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL

class Friend(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="friends")
    friend = models.ForeignKey(User, on_delete=models.CASCADE, related_name="friend_of")
    status = models.CharField(max_length=20, default="pending")  # pending, accepted, rejected
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "friend")


class UserProfile(models.Model):
    PRIVACY_PUBLIC = 'public'
    PRIVACY_FRIENDS = 'friends'
    PRIVACY_PRIVATE = 'private'
    PRIVACY_CHOICES = [
        (PRIVACY_PUBLIC, 'Public'),
        (PRIVACY_FRIENDS, 'Friends only'),
        (PRIVACY_PRIVATE, 'Private'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    privacy = models.CharField(max_length=10, choices=PRIVACY_CHOICES, default=PRIVACY_FRIENDS)

    def __str__(self):
        return f"Profile({self.user}, {self.privacy})"


from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)