import logging

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.shortcuts import redirect

log = logging.getLogger(__name__)

# Backend explicito: sem senha nao ha `authenticate()`, e o `login()` exige
# saber por qual backend a sessao foi estabelecida.
_AUTH_BACKEND = 'django.contrib.auth.backends.ModelBackend'


class AdminAutoLoginMiddleware:
    """Autentica automaticamente o usuario padrao no Django admin.

    O projeto e 100% publico: nao ha login, nem sessao de usuario final. O
    ``/admin/`` continua existindo como ferramenta de manutencao de dados e,
    para nao exigir credenciais que ninguem tem, toda requisicao a ele entra
    ja autenticada como ``ADMIN_USERNAME`` (superusuario criado na primeira
    passagem).

    Roda depois do ``AuthenticationMiddleware`` — e ele quem monta o
    ``request.user`` que este middleware substitui.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.prefix = f"/{settings.ADMIN_URL.strip('/')}/"

    def __call__(self, request):
        if request.path.startswith(self.prefix):
            # A tela de login nao tem funcao aqui: quem chega nela ja esta
            # autenticado, entao volta para o index do admin.
            if request.path.startswith(f'{self.prefix}login/'):
                return redirect(self.prefix)

            if not request.user.is_authenticated:
                user = self._default_admin()
                if user is not None:
                    login(request, user, backend=_AUTH_BACKEND)

        return self.get_response(request)

    @staticmethod
    def _default_admin():
        """Usuario padrao do admin, criado sob demanda.

        Sem senha utilizavel (``set_unusable_password``): a unica porta de
        entrada e este middleware, entao nao existe segredo para vazar.
        """
        User = get_user_model()
        try:
            user, created = User.objects.get_or_create(
                username=settings.ADMIN_USERNAME,
                defaults={'is_staff': True, 'is_superuser': True},
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=['password'])
                log.info("Default admin user '%s' created.", settings.ADMIN_USERNAME)
            elif not (user.is_staff and user.is_superuser and user.is_active):
                user.is_staff = True
                user.is_superuser = True
                user.is_active = True
                user.save(update_fields=['is_staff', 'is_superuser', 'is_active'])
            return user
        except Exception:
            # Banco ainda sem as tabelas de auth (boot antes do migrate), por
            # exemplo. Nao derruba a requisicao: o admin responde deslogado.
            log.exception("Could not resolve the default admin user.")
            return None
