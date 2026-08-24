from django.urls import re_path
from django.views.generic import RedirectView

app_name = 'asm_simulator'

favicon_view = RedirectView.as_view(url='/static/favicon.png', permanent=True)

urlpatterns = [
    re_path(r'^favicon\.ico', favicon_view),
    re_path(r'^favicon\.png', favicon_view),
]
