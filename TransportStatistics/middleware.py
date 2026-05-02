from django.db import connection, OperationalError
from django.shortcuts import render

class DatabaseColdStartMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            connection.ensure_connection()
        except OperationalError:
            return render(request, 'wait.html', status=503)
        
        return self.get_response(request)