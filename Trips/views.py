from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect, get_object_or_404
from django.utils.dateparse import parse_time, parse_date
from django.contrib.auth import get_user_model
from Social.models import UserProfile, Friend
from Social.forms import ProfileForm

from .forms import TripLogForm, UploadServicesForm
from .models import TripLog, ImportJob

from django.conf import settings
from django.db import transaction
from django.db.models import Q
import os
import datetime
import threading
import json
from . import tasks

from itertools import groupby

import json

def trip_detail(request, pk):
    # Allow viewing based on the trip owner's privacy settings.
    trip = get_object_or_404(TripLog, pk=pk)
    owner = trip.user

    if request.user.is_authenticated and request.user == owner:
        trip_owner = True
    else:
        trip_owner = False

    # Owner always can view
    if request.user == owner:
        return render(request, 'trip_detail.html', {'trip': trip})

    # Load owner's profile (ensure exists)
    try:
        profile = owner.profile
    except Exception:
        from Social.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=owner)

    # Public: anyone can view (including anonymous)
    if profile.privacy == profile.PRIVACY_PUBLIC:
        return render(request, 'trip_detail.html', {'trip_owner': trip_owner, 'trip': trip})

    # Friends only: allow if the requester is an accepted friend
    if profile.privacy == profile.PRIVACY_FRIENDS:
        # If requester is anonymous, deny
        if not request.user.is_authenticated:
            return render(request, '403.html', {'message': 'This trip is friends-only. Please log in to request access.'}, status=403)
        is_friend = Friend.objects.filter(user=owner, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=owner, status='accepted').exists()
        if is_friend:
            return render(request, 'trip_detail.html', {'trip_owner': trip_owner, 'trip': trip})
        return render(request, '403.html', {'message': 'This trip is friends-only. You are not permitted to view this trip.'}, status=403)

    # Private: only owner can view (we already checked owner above)
    return render(request, '403.html', {'message': 'This trip is private.'}, status=403)


@login_required
def join_trip(request, pk):
    """Toggle that the requesting user was present on another user's trip.

    Only allowed when the requester is permitted to view the trip (public or friends),
    or when the requester is the trip owner.
    """
    trip = get_object_or_404(TripLog, pk=pk)
    owner = trip.user

    # Owner can always add/remove
    if request.user == owner:
        allowed = True
    else:
        try:
            profile = owner.profile
        except Exception:
            from Social.models import UserProfile
            profile, _ = UserProfile.objects.get_or_create(user=owner)

        if profile.privacy == profile.PRIVACY_PUBLIC:
            allowed = True
        elif profile.privacy == profile.PRIVACY_FRIENDS:
            is_friend = Friend.objects.filter(user=owner, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=owner, status='accepted').exists()
            allowed = bool(is_friend)
        else:
            allowed = False

    if not allowed:
        return render(request, '403.html', {'message': 'You are not permitted to mark attendance for this trip.'}, status=403)

    if request.method == 'POST':
        if request.user in trip.on_trip_trip.all():
            trip.on_trip_trip.remove(request.user)
        else:
            trip.on_trip_trip.add(request.user)
        trip.save()
        return redirect('trip_detail', pk=trip.pk)

    # On GET show a simple confirm page
    return render(request, 'trip_confirm_join.html', {'trip': trip})

def trip_date_map(request, date):
    # Allow viewing another user's map when permitted via query param `user_id` or `user`.
    target_user = None
    user_q = request.GET.get('user_id') or request.GET.get('user')
    User = get_user_model()
    if user_q:
        try:
            if user_q.isdigit():
                target_user = User.objects.get(pk=int(user_q))
            else:
                target_user = User.objects.get(username=user_q)
        except User.DoesNotExist:
            return render(request, 'trips_map.html', {'error': 'User not found.'}, status=404)
    else:
        # default to the requesting user if authenticated
        if request.user.is_authenticated:
            target_user = request.user
        else:
            return render(request, 'trips_map.html', {'error': 'Please log in or specify a user.'}, status=403)

    # permission check (mirror trip_detail rules)
    if request.user == target_user:
        allowed = True
    else:
        try:
            profile = target_user.profile
        except Exception:
            from Social.models import UserProfile
            profile, _ = UserProfile.objects.get_or_create(user=target_user)

        if profile.privacy == profile.PRIVACY_PUBLIC:
            allowed = True
        elif profile.privacy == profile.PRIVACY_FRIENDS:
            if not request.user.is_authenticated:
                return render(request, '403.html', {'message': 'This user\'s trips are friends-only. Please log in to request access.'}, status=403)
            is_friend = Friend.objects.filter(user=target_user, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=target_user, status='accepted').exists()
            if is_friend:
                allowed = True
            else:
                return render(request, '403.html', {'message': 'This user\'s trips are friends-only. You are not permitted to view this map.'}, status=403)
        else:
            return render(request, '403.html', {'message': 'This user\'s trips are private.'}, status=403)

    # At this point `target_user` is set and allowed
    if date == 'all':
        if request.user.is_authenticated and request.user == target_user:
            trips = TripLog.objects.filter(Q(user=target_user) | Q(on_trip_trip=target_user))
        else:
            trips = TripLog.objects.filter(user=target_user)
        service_date = None  # Map will show all dates, so no single date to highlight
    elif date == 'no-date':
        service_date = None
        if request.user.is_authenticated and request.user == target_user:
            trips = TripLog.objects.filter(
                Q(user=target_user) | Q(on_trip_trip=target_user), service_date=None
            ).order_by('scheduled_departure')
        else:
            trips = TripLog.objects.filter(user=target_user, service_date=None).order_by('scheduled_departure')
    else:
        try:
            service_date = parse_date(date)
        except ValueError:
            return render(request, 'trips_map.html', {'error': 'Invalid date format. Use YYYY-MM-DD.'})

        if request.user.is_authenticated and request.user == target_user:
            trips = TripLog.objects.filter(
                (Q(user=target_user) | Q(on_trip_trip=target_user)), service_date=service_date
            ).order_by('scheduled_departure')
        else:
            trips = TripLog.objects.filter(user=target_user, service_date=service_date).order_by('scheduled_departure')

    trips_data = [
        {
            'id': t.pk,
            'headcode': t.headcode,
            'origin': t.origin_name,
            'destination': t.destination_name,
            'transport_type': t.transport_type,
            'route_geometry': t.route_geometry,  # already [[lon,lat],...]
        }
        for t in trips
        if t.route_geometry
    ]

    return render(request, 'trips_map.html', {
        'trips': trips,
        'trips_json': json.dumps(trips_data),
        'service_date': service_date,
    })

@login_required
def profile(request):
    # Include trips the user logged themselves plus trips they were marked on by others
    trips = TripLog.objects.filter(
        Q(user=request.user) | Q(on_trip_trip=request.user)
    ).distinct().order_by('-service_date', '-scheduled_departure', '-logged_at')

    # Group by date
    days = []
    for date, group in groupby(trips, key=lambda t: t.service_date):
        trip_list = list(group)
        days.append({'date': date, 'trips': trip_list})

    return render(request, 'profile.html', {
        'days':        days,
        'total_trips': trips.count(),
        'total_days':  len(days),
        
        'viewing_user': None,
        'restricted': False,
    })


@login_required
def profile_settings(request):
    profile_obj, _ = UserProfile.objects.get_or_create(user=request.user)
    # profile form (ensure `pf` always exists to avoid UnboundLocalError)
    pf = ProfileForm(instance=profile_obj)
    upload_form = UploadServicesForm()
    jobs = ImportJob.objects.filter(user=request.user).order_by('-created_at')[:20]

    if request.method == 'POST':

        # Profile form save
        if 'privacy' in request.POST or 'display_name' in request.POST:
            pf = ProfileForm(request.POST, instance=profile_obj)
            if pf.is_valid():
                pf.save()
                return redirect('profile')
            else:
                # fall through to render with errors
                pass

        # Upload a services.json file
        if 'services_file' in request.FILES:
            upload_form = UploadServicesForm(request.POST, request.FILES)
            if upload_form.is_valid():
                services_file = upload_form.cleaned_data['services_file']
                dupe_policy = upload_form.cleaned_data.get('dupe_policy') or 'skip'

                imports_dir = os.path.join(settings.BASE_DIR, 'imports')
                os.makedirs(imports_dir, exist_ok=True)
                timestamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
                filename = f"{request.user.username}-{timestamp}-services.json"
                dest_path = os.path.join(imports_dir, filename)

                # Save uploaded file to disk
                with open(dest_path, 'wb') as out_f:
                    for chunk in services_file.chunks():
                        out_f.write(chunk)

                # Create ImportJob
                job = ImportJob.objects.create(
                    user=request.user,
                    filepath=dest_path,
                    status=ImportJob.STATUS_UPLOADED,
                    dupe_policy=dupe_policy,
                )

                # Quick scan: try to parse the file and build a small preview
                preview = []
                duplicates = 0
                total = 0
                try:
                    with open(dest_path, 'r', encoding='utf8') as fh:
                        data = json.load(fh)
                    if isinstance(data, list):
                        total = len(data)
                        for svc in data[:50]:
                            stops = svc.get('stops', [])
                            if not stops:
                                continue
                            origin = stops[0].get('stop_name') or stops[0].get('name') or ''
                            destination = stops[-1].get('stop_name') or stops[-1].get('name') or ''
                            departure = stops[0].get('departure_time') or ''

                            service_date = None
                            scheduled_time = None
                            if 'T' in departure:
                                try:
                                    date_part, time_part = departure.split('T', 1)
                                    service_date = parse_date(date_part)
                                    scheduled_time = parse_time(time_part)
                                except Exception:
                                    service_date = None
                                    scheduled_time = None

                            is_dup = False
                            if service_date and scheduled_time:
                                is_dup = TripLog.objects.filter(
                                    user=request.user,
                                    origin_name=origin,
                                    destination_name=destination,
                                    service_date=service_date,
                                    scheduled_departure=scheduled_time,
                                ).exists()
                            if is_dup:
                                duplicates += 1
                            preview.append({
                                'origin': origin,
                                'destination': destination,
                                'date': str(service_date),
                                'time': str(scheduled_time),
                                'duplicate': is_dup,
                            })

                except Exception as e:
                    job.status = ImportJob.STATUS_FAILED
                    job.result_log = {'error': f'Quick scan failed: {str(e)}'}
                    job.save()
                else:
                    job.total = total
                    job.duplicates = duplicates
                    job.result_log = {'preview': preview[:20]}
                    job.save()

                # refresh job list
                jobs = ImportJob.objects.filter(user=request.user).order_by('-created_at')[:20]

        # Start import background job
        if request.POST.get('start_import'):
            job_id = request.POST.get('job_id')
            policy = request.POST.get('policy') or 'skip'
            job = get_object_or_404(ImportJob, pk=job_id, user=request.user)
            job.dupe_policy = policy
            job.status = ImportJob.STATUS_QUEUED
            job.save()

            # spawn background thread
            t = threading.Thread(target=tasks.run_import_job, args=(job.pk,), kwargs={'policy': policy}, daemon=True)
            t.start()

            return redirect('profile_settings')

    return render(request, 'profile_settings.html', {
        'profile_form': pf,
        'upload_form': upload_form,
        'import_jobs': jobs,
    })



@login_required
def delete_trip(request, pk):
    """Allow a trip owner to delete their trip via POST."""
    trip = get_object_or_404(TripLog, pk=pk)
    if request.user != trip.user and not request.user.is_staff:
        return render(request, '403.html', {'message': 'You are not permitted to delete this trip.'}, status=403)

    if request.method == 'POST':
        trip.delete()
        return redirect('profile')

    # For GET requests, show a simple confirm page
    return render(request, 'trip_confirm_delete.html', {'trip': trip})
    

def view_profile(request, user_id):
    User = get_user_model()
    view_user = get_object_or_404(User, id=user_id)
    profile_obj, _ = UserProfile.objects.get_or_create(user=view_user)

    # enforce privacy
    restricted = False
    if request.user != view_user:
        if profile_obj.privacy == UserProfile.PRIVACY_PRIVATE:
            restricted = True
        elif profile_obj.privacy == UserProfile.PRIVACY_FRIENDS:
            # check if requester is a friend of view_user (either direction accepted)
            is_friend = Friend.objects.filter(user=view_user, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=view_user, status='accepted').exists()
            if not is_friend:
                restricted = True

    # Only load trips if the requester is allowed to view them
    if restricted:
        trips = TripLog.objects.none()
        days = []
    else:
        # Show trips where the profile owner is either the trip owner or recorded as a participant
        trips = TripLog.objects.filter(
            Q(user=view_user) | Q(on_trip_trip=view_user)
        ).distinct().order_by('-service_date', '-scheduled_departure', '-logged_at')

        # Group by date
        days = []
        from itertools import groupby
        for date, group in groupby(trips, key=lambda t: t.service_date):
            trip_list = list(group)
            days.append({'date': date, 'trips': trip_list})

    return render(request, 'profile.html', {
        'days': days,
        'total_trips': trips.count(),
        'total_days': len(days),
        'viewing_user': view_user,
        'restricted': restricted,
    })

@login_required
def log_trip(request):
    """
    GET  — show pre-filled form (query params come from the map's ts:log event)
    POST — save and redirect back to the map

    Query params the map injects (all optional):
        headcode, date, scheduled_time,
        origin, origin_crs, origin_tiploc,
        destination, destination_crs, destination_tiploc,
        stop, stop_crs, stop_atco,
        operator, transport_type,
        vehicle   (bus: "fleet - REG", populated from the vehicle field)
    """
    if request.method == 'POST':
        print("POST data:", dict(request.POST))
        form = TripLogForm(request.POST)
        if form.is_valid():
            trip = form.save(commit=False)
            trip.user = request.user
            trip.save()
            return redirect('home')
        else:
            print("Form errors:", form.errors) 

    else:
        p = request.GET

        # Try to parse a vehicle string like "21425 - BV24 LSJ"
        vehicle_raw  = p.get('vehicle', '')
        bus_fleet    = ''
        bus_reg      = ''
        if ' - ' in vehicle_raw:
            parts    = vehicle_raw.split(' - ', 1)
            bus_fleet = parts[0].strip()
            bus_reg   = parts[1].strip()

        initial = {
            'headcode':           p.get('headcode', ''),
            'operator':           p.get('operator', ''),
            'service_date':       p.get('date', '') or p.get('service_date', ''),
            'scheduled_departure': p.get('scheduled_time', '') or p.get('scheduled_departure', ''),
            'transport_type':     p.get('transport_type', 'rail'),

            'origin_name':        p.get('origin_name', '') or p.get('origin', ''),
            'origin_crs':         p.get('origin_crs', ''),
            'origin_tiploc':      p.get('origin_tiploc', ''),

            'destination_name':   p.get('destination_name', '') or p.get('destination', ''),
            'destination_crs':    p.get('destination_crs', ''),
            'destination_tiploc': p.get('destination_tiploc', ''),

            'boarded_stop_name':  p.get('boarded_stop_name', '') or p.get('stop', ''),
            'boarded_stop_crs':   p.get('boarded_stop_crs', '')  or p.get('stop_crs', ''),
            'boarded_stop_atco':  p.get('boarded_stop_atco', '') or p.get('stop_atco', ''),

            'bus_fleet_number':   bus_fleet,
            'bus_registration':   bus_reg,
        }
        form = TripLogForm(initial=initial)

    # Determine transport type so the template can show/hide vehicle sections
    transport_type = (
        request.POST.get('transport_type')
        or request.GET.get('transport_type', 'rail')
    )
    is_bus = transport_type in ('bus', 'tram', 'ferry')

    return render(request, 'log_trip.html', {
        'form':           form,
        'transport_type': transport_type,
        'is_bus':         is_bus,
        'is_rail':        not is_bus,
    })


@login_required
def edit_trip(request, pk):
    """Edit a previously logged trip. Only the user who logged the trip may edit it."""
    trip = get_object_or_404(TripLog, pk=pk)
    if request.user != trip.user:
        return render(request, '403.html', {'message': 'You are not permitted to edit this trip.'}, status=403)

    if request.method == 'POST':
        form = TripLogForm(request.POST, instance=trip)
        if form.is_valid():
            form.save()
            return redirect('trip_detail', pk=trip.pk)
    else:
        form = TripLogForm(instance=trip)

    return render(request, 'edit_trip.html', {
        'form': form,
        'trip': trip,
    })