from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
from .forms import FriendSearchForm
from .models import Friend

User = get_user_model()

def friends_page(request):
    form = FriendSearchForm(request.POST or None)
    results = []
    existing_friend_ids = []
    outgoing_pending_ids = []
    incoming_pending = []

    if request.user.is_authenticated:
        existing_friend_ids = Friend.objects.filter(
            user=request.user
        ).values_list("friend_id", flat=True)
        outgoing_pending_ids = Friend.objects.filter(
            user=request.user, status='pending'
        ).values_list('friend_id', flat=True)
        # incoming pending requests (other users who requested current user)
        incoming_pending = Friend.objects.filter(
            friend=request.user, status='pending'
        ).select_related('user')
        # accepted friends (users I have added and are accepted)
        friends_list = Friend.objects.filter(user=request.user, status='accepted').select_related('friend')

    if request.method == "POST" and form.is_valid():
        username = form.cleaned_data["username"]

        results = User.objects.filter(
            username__icontains=username
        ).exclude(id=request.user.id)[:20]

    return render(request, "friends.html", {
        "form": form,
        "results": results,
        "existing_friend_ids": existing_friend_ids,
        "outgoing_pending_ids": list(outgoing_pending_ids),
        "incoming_pending": incoming_pending,
        "friends_list": friends_list if request.user.is_authenticated else [],
    })

@login_required
def add_friend(request, user_id):
    user_to_add = get_object_or_404(User, id=user_id)

    if user_to_add != request.user:
        fr, created = Friend.objects.get_or_create(
            user=request.user,
            friend=user_to_add,
            defaults={'status': 'pending'}
        )
        if not created and fr.status != 'pending':
            fr.status = 'pending'
            fr.save()

    return redirect("friends")


@login_required
def accept_friend(request, user_id):
    # user_id is the id of the user who sent the request
    try:
        fr = Friend.objects.get(user__id=user_id, friend=request.user)
        fr.status = 'accepted'
        fr.save()
        # create reciprocal friend relation if not exists
        Friend.objects.get_or_create(user=request.user, friend=fr.user, defaults={'status': 'accepted'})
    except Friend.DoesNotExist:
        pass
    return redirect('friends')


@login_required
def decline_friend(request, user_id):
    try:
        fr = Friend.objects.get(user__id=user_id, friend=request.user)
        fr.status = 'rejected'
        fr.save()
    except Friend.DoesNotExist:
        pass
    return redirect('friends')