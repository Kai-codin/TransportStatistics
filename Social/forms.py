from django import forms

class FriendSearchForm(forms.Form):
    username = forms.CharField(
        max_length=150,
        required=True,
        label="Username"
    )


from .models import UserProfile


class ProfileForm(forms.ModelForm):
    class Meta:
        model = UserProfile
        fields = ('privacy',)