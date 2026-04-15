from typing import Optional

from django import forms
from django.core.exceptions import ValidationError

from .models import TrainEditRequest, Trains


class TrainEditRequestForm(forms.ModelForm):
    class Meta:
        model = TrainEditRequest
        fields = [
            "proposed_operator",
            "proposed_type",
            "proposed_livery_name",
            "proposed_livery_css",
        ]

    def __init__(self, *args, train: Optional[Trains] = None, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.train = train
        self.user = user

    def clean(self):
        cleaned = super().clean()

        if not self.train:
            raise ValidationError("Invalid train")

        # Check at least one field changed
        changed = False
        if cleaned.get("proposed_operator") and cleaned.get("proposed_operator").id != self.train.operator_id:
            changed = True
        if cleaned.get("proposed_type") and cleaned.get("proposed_type") != (self.train.type or ""):
            changed = True
        if cleaned.get("proposed_livery_name") and cleaned.get("proposed_livery_name") != (self.train.livery_name or ""):
            changed = True
        if cleaned.get("proposed_livery_css") and cleaned.get("proposed_livery_css") != (self.train.livery_css or ""):
            changed = True

        if not changed:
            raise ValidationError("No changes detected — please update at least one field.")

        # Prevent duplicate pending request by same user for same train
        if self.user and TrainEditRequest.objects.filter(train=self.train, user=self.user, status=TrainEditRequest.STATUS_PENDING).exists():
            raise ValidationError("You already have a pending request for this train.")

        return cleaned


class RejectForm(forms.Form):
    rejection_reason = forms.CharField(widget=forms.Textarea, required=False, label="Reason for rejection")
