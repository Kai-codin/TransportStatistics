"""
URL configuration for TransportStatistics project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.contrib.auth import views as auth_views
from django.conf import settings
from django.conf.urls.static import static
from main import views_auth
from Trips.views import log_trip, profile, trip_detail, trip_date_map, view_profile, edit_trip, profile_settings, delete_trip, join_trip
from Social import views

urlpatterns = [
    path('', TemplateView.as_view(template_name='home.html'), name='home'),
    path("friends/", views.friends_page, name="friends"),
    path("friends/add/<int:user_id>/", views.add_friend, name="add_friend"),
    path("friends/accept/<int:user_id>/", views.accept_friend, name="accept_friend"),
    path("friends/decline/<int:user_id>/", views.decline_friend, name="decline_friend"),
    path("completion/", views.completion_home, name='completion'),
    path("completion/liveries/", views.completion_liveries, name='completion_liveries'),
    path("completion/liveries/trips/", views.completion_livery_trips, name='completion_livery_trips'),
    path("completion/update/", views.completion_update, name='completion_update'),
    path("completion/update/search/", views.completion_update_search, name='completion_update_search'),
    path("completion/<str:operator_name>/fleet/", views.completion_fleet, name='fleet_completion'),
    path("completion/<str:operator_name>/route/", views.completion_route, name='route_completion'),
    path("completion/<str:operator_name>/", views.completion_details, name='operator_details'),
    path('profile/<int:user_id>/', view_profile, name='view_profile'),
    path('legal/', TemplateView.as_view(template_name='legal.html'), name='legal'),
    path('profile/', profile, name='profile'),
    path('trips/map/<str:date>/', trip_date_map, name='trips_map'),
    path('trips/<int:pk>/', trip_detail, name='trip_detail'),
    path('trips/<int:pk>/delete/', delete_trip, name='delete_trip'),
    path('trips/<int:pk>/join/', join_trip, name='join_trip'),
    path('trips/<int:pk>/edit/', edit_trip, name='edit_trip'),
    path('profile/settings/', profile_settings, name='profile_settings'),
    path('manage/', TemplateView.as_view(template_name='manage.html'), name='manage'),
    path('accounts/login/', auth_views.LoginView.as_view(template_name='registration/login.html'), name='login'),
    path('accounts/register/', views_auth.register, name='register'),
    path('accounts/logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('admin/', admin.site.urls),
    path('api/', include('API.urls')),
    path('log-trip/', log_trip, name='log_trip'),
    path('demo-map/', TemplateView.as_view(template_name='demo_map.html'), name='demo-map'),
    path('onboarding/import/', views_auth.onboarding_import, name='onboarding_import'),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
