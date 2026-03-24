from django.contrib import admin
from .models import Friend
from .models import UserProfile


@admin.action(description='Mark selected requests as accepted')
def make_accepted(modeladmin, request, queryset):
	queryset.update(status='accepted')


@admin.action(description='Mark selected requests as rejected')
def make_rejected(modeladmin, request, queryset):
	queryset.update(status='rejected')


class FriendAdmin(admin.ModelAdmin):
	list_display = ('id', 'user', 'friend', 'status', 'created_at')
	list_filter = ('status', 'created_at')
	search_fields = ('user__username', 'friend__username')
	actions = (make_accepted, make_rejected)


admin.site.register(Friend, FriendAdmin)
admin.site.register(UserProfile)
