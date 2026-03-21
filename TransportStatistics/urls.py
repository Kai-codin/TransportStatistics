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
from Trips.views import log_trip, profile, trip_detail

urlpatterns = [
    path('', TemplateView.as_view(template_name='home.html'), name='home'),
    path('legal/', TemplateView.as_view(template_name='legal.html'), name='legal'),
    path('profile/', profile, name='profile'),
    path('trips/<int:pk>/', trip_detail, name='trip_detail'),
    path('manage/', TemplateView.as_view(template_name='manage.html'), name='manage'),
    path('accounts/login/', auth_views.LoginView.as_view(template_name='registration/login.html'), name='login'),
    path('accounts/register/', views_auth.register, name='register'),
    path('accounts/logout/', TemplateView.as_view(template_name='logged_out.html'), name='logout'),
    path('admin/', admin.site.urls),
    path('api/', include('API.urls')),
    path('log-trip/', log_trip, name='log_trip'),
    path('demo-map/', TemplateView.as_view(template_name='demo_map.html'), name='demo-map'),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)