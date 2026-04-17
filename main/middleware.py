import re
from django.http import HttpResponseForbidden
from django.contrib.auth import get_user_model


class ViewAsMiddleware:
    """Middleware that allows superusers to view the site as another user.

    If the request path starts with /view/<user_id>/ then, when the current
    user is authenticated and is a superuser, the middleware will replace
    `request.user` with the target user for the lifetime of the request and
    strip the /view/<user_id> prefix from `request.path_info` so URL
    resolution continues normally.
    """

    pattern = re.compile(r"^/view/(?P<uid>\d+)(?P<rest>/.*|/|$)")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info or request.path
        m = self.pattern.match(path)
        if m:
            uid = m.group('uid')
            rest = m.group('rest') or '/'
            # Only allow when the current user is authenticated and superuser
            user = getattr(request, 'user', None)
            if not (user and user.is_authenticated and user.is_superuser):
                return HttpResponseForbidden('Not allowed')
            User = get_user_model()
            try:
                target = User.objects.get(pk=uid)
            except User.DoesNotExist:
                return HttpResponseForbidden('Target user does not exist')

            # Save original and override for this request
            request._original_user = request.user
            request.user = target

            # Strip the /view/<id> prefix so URL resolver sees the remainder
            # Ensure it starts with '/'
            request.path_info = rest if rest.startswith('/') else '/' + rest
            request.path = request.path_info

        response = self.get_response(request)

        # No persistence necessary; if we replaced the user, restore original
        if hasattr(request, '_original_user'):
            request.user = request._original_user
            del request._original_user

        return response
