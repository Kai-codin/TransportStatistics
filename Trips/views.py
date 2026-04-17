import datetime
import json
import logging
import os
import threading
from itertools import groupby

from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
from django.conf import settings
from django.db.models import Q
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.utils.dateparse import parse_time, parse_date

from Social.forms import ProfileForm
from Social.models import UserProfile, Friend

from . import tasks
from .forms import TripLogForm, UploadServicesForm
from .models import TripLog, ImportJob

logger = logging.getLogger(__name__)


def trip_detail(request, pk):
    trip = get_object_or_404(TripLog, pk=pk)
    owner = trip.user

    if request.user.is_authenticated and request.user == trip.user:
        trip_owner = True
    else:
        trip_owner = False

    if request.user == trip.user:
        return render(request, 'trip_detail.html', {'trip_owner': trip_owner, 'trip': trip})

    try:
        profile = owner.profile
    except Exception:
        from Social.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=owner)

    if profile.privacy == profile.PRIVACY_PUBLIC:
        return render(request, 'trip_detail.html', {'trip_owner': trip_owner, 'trip': trip})

    if profile.privacy == profile.PRIVACY_FRIENDS:
        if not request.user.is_authenticated:
            return render(request, '403.html', {'message': 'This trip is friends-only. Please log in to request access.'}, status=403)
        is_friend = Friend.objects.filter(user=owner, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=owner, status='accepted').exists()
        if is_friend:
            return render(request, 'trip_detail.html', {'trip_owner': trip_owner, 'trip': trip})
        return render(request, '403.html', {'message': 'This trip is friends-only. You are not permitted to view this trip.'}, status=403)

    return render(request, '403.html', {'message': 'This trip is private.'}, status=403)


@login_required
def join_trip(request, pk):
    """Toggle that the requesting user was present on another user's trip.

    Only allowed when the requester is permitted to view the trip (public or friends),
    or when the requester is the trip owner.
    """
    trip = get_object_or_404(TripLog, pk=pk)
    owner = trip.user

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

    return render(request, 'trip_confirm_join.html', {'trip': trip})


def trip_date_map(request, date):
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
        if request.user.is_authenticated:
            target_user = request.user
        else:
            return render(request, 'trips_map.html', {'error': 'Please log in or specify a user.'}, status=403)

    if request.user != target_user:
        try:
            profile = target_user.profile
        except Exception:
            from Social.models import UserProfile
            profile, _ = UserProfile.objects.get_or_create(user=target_user)

        if profile.privacy == profile.PRIVACY_PUBLIC:
            pass
        elif profile.privacy == profile.PRIVACY_FRIENDS:
            if not request.user.is_authenticated:
                return render(request, '403.html', {'message': 'This user\'s trips are friends-only. Please log in to request access.'}, status=403)
            is_friend = Friend.objects.filter(user=target_user, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=target_user, status='accepted').exists()
            if not is_friend:
                return render(request, '403.html', {'message': 'This user\'s trips are friends-only. You are not permitted to view this map.'}, status=403)
        else:
            return render(request, '403.html', {'message': 'This user\'s trips are private.'}, status=403)

    if date == 'all':
        if request.user.is_authenticated and request.user == target_user:
            trips = TripLog.objects.filter(Q(user=target_user) | Q(on_trip_trip=target_user))
        else:
            trips = TripLog.objects.filter(user=target_user)
        service_date = None
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
            'route_geometry': t.route_geometry,
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
    trips = TripLog.objects.filter(
        Q(user=request.user) | Q(on_trip_trip=request.user)
    ).distinct().order_by('-service_date', '-scheduled_departure', '-logged_at')

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
    pf = ProfileForm(instance=profile_obj)
    upload_form = UploadServicesForm()
    jobs = ImportJob.objects.filter(user=request.user).order_by('-created_at')[:20]

    if request.method == 'POST':

        if 'privacy' in request.POST or 'display_name' in request.POST:
            pf = ProfileForm(request.POST, instance=profile_obj)
            if pf.is_valid():
                pf.save()
                return redirect('profile')

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

                with open(dest_path, 'wb') as out_f:
                    for chunk in services_file.chunks():
                        out_f.write(chunk)

                job = ImportJob.objects.create(
                    user=request.user,
                    filepath=dest_path,
                    status=ImportJob.STATUS_UPLOADED,
                    dupe_policy=dupe_policy,
                )

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
                    logger.exception("Quick scan failed for import job %s: %s", job.pk, e)
                    job.status = ImportJob.STATUS_FAILED
                    job.result_log = {'error': f'Quick scan failed: {str(e)}'}
                    job.save()
                else:
                    job.total = total
                    job.duplicates = duplicates
                    job.result_log = {'preview': preview[:20]}
                    job.save()

                jobs = ImportJob.objects.filter(user=request.user).order_by('-created_at')[:20]

        if request.POST.get('start_import'):
            job_id = request.POST.get('job_id')
            policy = request.POST.get('policy') or 'skip'
            job = get_object_or_404(ImportJob, pk=job_id, user=request.user)
            job.dupe_policy = policy
            job.status = ImportJob.STATUS_QUEUED
            job.save()

            t = threading.Thread(target=tasks.run_import_job, args=(job.pk,), kwargs={'policy': policy}, daemon=True)
            t.start()

            return redirect('profile_settings')

    return render(request, 'profile_settings.html', {
        'profile_form': pf,
        'upload_form': upload_form,
        'import_jobs': jobs,
    })


@login_required
def export_user_data(request):
    """Export the requesting user's data (profile, friends, trips) as a JSON file."""
    User = get_user_model()
    user = request.user

    profile_obj, _ = UserProfile.objects.get_or_create(user=user)

    friends_qs = Friend.objects.filter(user=user)
    friends = [
        {'username': f.friend.username, 'status': f.status}
        for f in friends_qs
    ]

    trips_qs = TripLog.objects.filter(user=user).order_by('logged_at')
    trips = []
    for t in trips_qs:
        trips.append({
            'headcode': t.headcode,
            'operator': t.operator,
            'service_date': str(t.service_date) if t.service_date else None,
            'transport_type': t.transport_type,
            'origin_name': t.origin_name,
            'origin_crs': t.origin_crs,
            'origin_tiploc': t.origin_tiploc,
            'destination_name': t.destination_name,
            'destination_crs': t.destination_crs,
            'destination_tiploc': t.destination_tiploc,
            'scheduled_departure': str(t.scheduled_departure) if t.scheduled_departure else None,
            'scheduled_arrival': str(t.scheduled_arrival) if t.scheduled_arrival else None,
            'boarded_stop_name': t.boarded_stop_name,
            'boarded_stop_crs': t.boarded_stop_crs,
            'boarded_stop_atco': t.boarded_stop_atco,
            'route_geometry': t.route_geometry,
            'full_route_geometry': t.full_route_geometry,
            'full_locations': t.full_locations,
            'train_fleet_number': t.train_fleet_number,
            'train_type': t.train_type,
            'bus_fleet_number': t.bus_fleet_number,
            'bus_registration': t.bus_registration,
            'bus_type': t.bus_type,
            'bus_livery': t.bus_livery,
            'bus_livery_name': t.bus_livery_name,
            'notes': t.notes,
            'on_trip_usernames': [u.username for u in t.on_trip_trip.all()],
        })

    # Export only the trips as a JSON array (no user, friends or profile data)
    content = json.dumps(trips, ensure_ascii=False, indent=2)
    filename = f"{user.username}-transport-data.json"
    resp = HttpResponse(content, content_type='application/json; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


@login_required
def import_user_data(request):
    """Import a previously-exported user data JSON file.

    The uploaded file must belong to the requesting user's username. Trips will be created
    and profile/friends updated. Duplicate trips are skipped.
    """
    message = None
    if request.method == 'POST' and 'user_data_file' in request.FILES:
        fh = request.FILES['user_data_file']
        try:
            data = json.load(fh)
        except Exception as e:
            message = f'Failed to parse JSON: {e}'
            return render(request, 'profile_settings.html', {'import_error': message})

        # Accept either a raw list of trips, or an object containing a 'trips' key.
        if isinstance(data, list):
            trips_list = data
        elif isinstance(data, dict) and 'trips' in data:
            trips_list = data.get('trips') or []
        else:
            message = 'Uploaded file does not contain trips in a supported format.'
            return render(request, 'profile_settings.html', {'import_error': message})

        # Trips: create TripLog entries (skip duplicates)
        created = 0
        skipped = 0
        for t in trips_list:
            service_date = None
            scheduled_departure = None
            try:
                if t.get('service_date'):
                    service_date = parse_date(t.get('service_date'))
                if t.get('scheduled_departure'):
                    scheduled_departure = parse_time(t.get('scheduled_departure'))
            except Exception:
                service_date = None
                scheduled_departure = None

            dup_q = TripLog.objects.filter(
                user=request.user,
                origin_name=t.get('origin_name') or '',
                destination_name=t.get('destination_name') or '',
                service_date=service_date,
                scheduled_departure=scheduled_departure,
            )
            if dup_q.exists():
                skipped += 1
                continue

            trip = TripLog.objects.create(
                user=request.user,
                headcode=t.get('headcode') or '',
                operator=t.get('operator') or '',
                service_date=service_date,
                transport_type=t.get('transport_type') or '',
                origin_name=t.get('origin_name') or '',
                origin_crs=t.get('origin_crs') or '',
                origin_tiploc=t.get('origin_tiploc') or '',
                destination_name=t.get('destination_name') or '',
                destination_crs=t.get('destination_crs') or '',
                destination_tiploc=t.get('destination_tiploc') or '',
                scheduled_departure=scheduled_departure,
                scheduled_arrival=t.get('scheduled_arrival') or None,
                boarded_stop_name=t.get('boarded_stop_name') or '',
                boarded_stop_crs=t.get('boarded_stop_crs') or '',
                boarded_stop_atco=t.get('boarded_stop_atco') or '',
                route_geometry=t.get('route_geometry'),
                full_route_geometry=t.get('full_route_geometry'),
                full_locations=t.get('full_locations'),
                train_fleet_number=t.get('train_fleet_number') or '',
                train_type=t.get('train_type') or '',
                bus_fleet_number=t.get('bus_fleet_number') or '',
                bus_registration=t.get('bus_registration') or '',
                bus_type=t.get('bus_type') or '',
                bus_livery=t.get('bus_livery') or '',
                bus_livery_name=t.get('bus_livery_name') or '',
                notes=t.get('notes') or '',
            )

            # attach on_trip users where possible
            for uname in t.get('on_trip_usernames', []):
                try:
                    other = get_user_model().objects.get(username=uname)
                except get_user_model().DoesNotExist:
                    continue
                trip.on_trip_trip.add(other)

            created += 1

        message = f'Import completed — created {created} trips, skipped {skipped} duplicates.'

    # build the same context as profile_settings so template has required forms
    profile_obj, _ = UserProfile.objects.get_or_create(user=request.user)
    from Social.forms import ProfileForm
    from .forms import UploadServicesForm
    pf = ProfileForm(instance=profile_obj)
    upload_form = UploadServicesForm()
    jobs = ImportJob.objects.filter(user=request.user).order_by('-created_at')[:20]

    ctx = {
        'profile_form': pf,
        'upload_form': upload_form,
        'import_jobs': jobs,
        'import_message': message,
    }
    return render(request, 'profile_settings.html', ctx)



@login_required
def delete_trip(request, pk):
    """Allow a trip owner to delete their trip via POST."""
    trip = get_object_or_404(TripLog, pk=pk)
    if request.user != trip.user and not request.user.is_staff:
        return render(request, '403.html', {'message': 'You are not permitted to delete this trip.'}, status=403)

    if request.method == 'POST':
        trip.delete()
        return redirect('profile')

    return render(request, 'trip_confirm_delete.html', {'trip': trip})
    

def view_profile(request, user_id):
    User = get_user_model()
    view_user = get_object_or_404(User, id=user_id)
    profile_obj, _ = UserProfile.objects.get_or_create(user=view_user)

    restricted = False
    if request.user != view_user:
        if profile_obj.privacy == UserProfile.PRIVACY_PRIVATE:
            restricted = True
        elif profile_obj.privacy == UserProfile.PRIVACY_FRIENDS:
            is_friend = Friend.objects.filter(user=view_user, friend=request.user, status='accepted').exists() or Friend.objects.filter(user=request.user, friend=view_user, status='accepted').exists()
            if not is_friend:
                restricted = True

    if restricted:
        trips = TripLog.objects.none()
        days = []
    else:
        trips = TripLog.objects.filter(
            Q(user=view_user) | Q(on_trip_trip=view_user)
        ).distinct().order_by('-service_date', '-scheduled_departure', '-logged_at')

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
        stop, stop_crs, stop_atco, 'bustimes_service_slug', 'bustimes_service_id',
        operator, transport_type,
        vehicle   (bus: "fleet - REG", populated from the vehicle field)
    """
    if request.method == 'POST':
        logger.debug("log_trip POST fields: %s", dict(request.POST))
        post_data = request.POST.copy()
        route_number = (post_data.get('route_number') or '').strip()
        if route_number and not (post_data.get('headcode') or '').strip():
            post_data['headcode'] = route_number
        form = TripLogForm(post_data)
        print(post_data)
        if form.is_valid():
            trip = form.save(commit=False)
            trip.user = request.user
            if not (trip.headcode or '').strip():
                trip.headcode = route_number
            trip.save()
            return redirect('home')
        else:
            logger.warning("log_trip form errors for user %s: %s", request.user.pk, form.errors)

    else:
        p = request.GET

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
            
            'bustimes_service_slug': p.get('bustimes_service_slug', ''),
            'bustimes_service_id': p.get('bustimes_service_id', ''),

            'bus_fleet_number':   bus_fleet,
            'bus_registration':   bus_reg,
        }
        form = TripLogForm(initial=initial)

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
