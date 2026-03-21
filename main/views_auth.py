from django.shortcuts import render, redirect
from django.contrib.auth.forms import UserCreationForm
from django.contrib import messages
from django.urls import reverse
from django.contrib.auth import login as auth_login


def register(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            auth_login(request, user)
            messages.success(request, 'Account created and signed in.')
            next_url = request.GET.get('next') or reverse('home')
            return redirect(next_url)
    else:
        form = UserCreationForm()
    return render(request, 'registration/register.html', {'form': form})
