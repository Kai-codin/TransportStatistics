from django.shortcuts import render, get_object_or_404, redirect
from django.urls import reverse
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib import messages
from django.db import models
from django.utils import timezone
from django.core.paginator import Paginator
from django.http import JsonResponse
from .models import Trains, TrainEditRequest
from .forms import TrainEditRequestForm, RejectForm


@login_required
def train_edit_requests_list(request):
    # Pending requests (global)
    pending = TrainEditRequest.objects.filter(status=TrainEditRequest.STATUS_PENDING).select_related("train", "user", "proposed_operator")

    # Train list with simple search
    q = request.GET.get("q", "").strip()
    trains_qs = Trains.objects.select_related("operator").all()
    if q:
        trains_qs = trains_qs.filter(
            models.Q(fleetnumber__icontains=q) |
            models.Q(type__icontains=q) |
            models.Q(operator__name__icontains=q)
        )

    paginator = Paginator(trains_qs, 25)
    page = request.GET.get("page")
    trains_page = paginator.get_page(page)

    if request.headers.get('x-requested-with') == 'XMLHttpRequest':
        # return JSON minimal results for live search
        data = [
            {
                "id": t.id,
                "fleetnumber": t.fleetnumber,
                "type": t.type,
                "operator": t.operator.name if t.operator else "",
                "livery_name": t.livery_name or "",
                "livery_css": t.livery_css or "",
            }
            for t in trains_qs[:50]
        ]
        return JsonResponse({"results": data})

    return render(request, "trains_requests.html", {"pending": pending, "trains": trains_page, "q": q})


@login_required
def train_edit_request_new(request, train_id):
    train = get_object_or_404(Trains, pk=train_id)

    if request.method == "POST":
        form = TrainEditRequestForm(request.POST, train=train, user=request.user)
        if form.is_valid():
            req = form.save(commit=False)
            req.train = train
            req.user = request.user
            req.save()
            messages.success(request, "Request submitted")
            return redirect(reverse("trains_requests"))
    else:
        initial = {
            "proposed_operator": train.operator_id,
            "proposed_type": train.type,
            "proposed_livery_name": train.livery_name,
            "proposed_livery_css": train.livery_css,
        }
        form = TrainEditRequestForm(initial=initial, train=train, user=request.user)

    return render(request, "train_request_form.html", {"form": form, "train": train})


def staff_required(view_func):
    return user_passes_test(lambda u: u.is_staff)(view_func)


@login_required
@staff_required
def train_edit_request_approve(request, req_id):
    req = get_object_or_404(TrainEditRequest, pk=req_id)
    if req.status != TrainEditRequest.STATUS_PENDING:
        messages.warning(request, "Request already reviewed")
        return redirect(reverse("trains_requests"))

    # Apply proposed values
    t = req.train
    changed = False
    if req.proposed_operator_id and req.proposed_operator_id != t.operator_id:
        t.operator_id = req.proposed_operator_id
        changed = True
    if req.proposed_type and req.proposed_type != t.type:
        t.type = req.proposed_type
        changed = True
    if req.proposed_livery_name and req.proposed_livery_name != t.livery_name:
        t.livery_name = req.proposed_livery_name
        changed = True
    if req.proposed_livery_css and req.proposed_livery_css != t.livery_css:
        t.livery_css = req.proposed_livery_css
        changed = True

    if changed:
        t.save()

    req.status = TrainEditRequest.STATUS_APPROVED
    req.reviewed_by = request.user
    req.reviewed_at = timezone.now()
    req.save()
    messages.success(request, "Approved")
    return redirect(reverse("trains_requests"))


@login_required
@staff_required
def train_edit_request_reject(request, req_id):
    req = get_object_or_404(TrainEditRequest, pk=req_id)
    if req.status != TrainEditRequest.STATUS_PENDING:
        messages.warning(request, "Request already reviewed")
        return redirect(reverse("trains_requests"))

    if request.method == "POST":
        form = RejectForm(request.POST)
        if form.is_valid():
            req.status = TrainEditRequest.STATUS_REJECTED
            req.rejection_reason = form.cleaned_data.get("rejection_reason") or ""
            req.reviewed_by = request.user
            req.reviewed_at = timezone.now()
            req.save()
            messages.success(request, "Rejected")
            return redirect(reverse("trains_requests"))
    else:
        form = RejectForm()

    return render(request, "train_request_reject.html", {"form": form, "request_obj": req})
