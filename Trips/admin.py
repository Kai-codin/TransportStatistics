from django.contrib import admin, messages
from django.db import transaction
from .models import TripLog
from .models import ImportJob
 
@admin.register(TripLog)
class TripLogAdmin(admin.ModelAdmin):
    list_display  = ['user', 'headcode', 'operator', 'transport_type', 'origin_name',
                     'destination_name', 'service_date',]
    list_filter   = ['transport_type', 'service_date', 'user']
    search_fields = ['headcode', 'origin_name', 'destination_name', 'operator', 'bus_registration', 'bus_fleet_number', 'train_fleet_number']
    readonly_fields = ['logged_at']
    autocomplete_fields = ['user']
    actions = ['flip_lat_lon']

    def _swap_pair(self, pair):
        try:
            if isinstance(pair, (list, tuple)) and len(pair) >= 2:
                a = pair[0]
                b = pair[1]
                return [b, a]
        except Exception:
            pass
        return pair

    def _swap_coords_list(self, coords):
        if not isinstance(coords, list):
            return coords
        out = []
        for item in coords:
            if isinstance(item, list) and len(item) >= 2 and (isinstance(item[0], (int, float)) or isinstance(item[1], (int, float))):
                out.append(self._swap_pair(item))
            else:
                out.append(item)
        return out

    def flip_lat_lon(self, request, queryset):
        """Admin action: swap lat/lon for selected TripLog objects.

        This swaps coordinate pairs in `route_geometry`, `full_route_geometry`,
        and each entry's `coordinates` inside `full_locations`.
        """
        updated = 0
        with transaction.atomic():
            for trip in queryset.select_for_update():
                changed = False

                if trip.route_geometry:
                    new_rg = self._swap_coords_list(trip.route_geometry)
                    if new_rg != trip.route_geometry:
                        trip.route_geometry = new_rg
                        changed = True

                if trip.full_route_geometry:
                    new_fr = self._swap_coords_list(trip.full_route_geometry)
                    if new_fr != trip.full_route_geometry:
                        trip.full_route_geometry = new_fr
                        changed = True

                if trip.full_locations and isinstance(trip.full_locations, list):
                    new_locs = []
                    for loc in trip.full_locations:
                        if isinstance(loc, dict):
                            coords = loc.get('coordinates')
                            if coords and isinstance(coords, list) and len(coords) >= 2:
                                loc = dict(loc)
                                loc['coordinates'] = self._swap_pair(coords)
                                changed = True
                        new_locs.append(loc)
                    if changed:
                        trip.full_locations = new_locs

                if changed:
                    trip.save(update_fields=['route_geometry', 'full_route_geometry', 'full_locations'])
                    updated += 1

        if updated:
            messages.success(request, f"Flipped lat/lon for {updated} trip(s).")
        else:
            messages.info(request, "No coordinates were changed.")

    flip_lat_lon.short_description = 'Flip lat/lon for selected trips'


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'status', 'created_at', 'started_at', 'completed_at', 'total', 'inserted', 'duplicates']
    readonly_fields = ['created_at', 'started_at', 'completed_at']
    search_fields = ['user__username', 'filepath']
    autocomplete_fields = ['user']