"""
WSGI config for the project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application
from dj_static import Cling

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

# Cling serve o STATIC_ROOT (CSS/JS do Django admin) direto pelo WSGI. Com
# DEBUG=False o Django nao serve estatico sozinho, e o nginx so tem o build
# do React no disco — sem isto o admin sai sem estilo nenhum.
application = Cling(get_wsgi_application())
