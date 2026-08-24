import os
import sys
import logging
import secrets
import signal
import string
from pathlib import Path
from django.conf import settings

log = logging.getLogger(__name__)

# Alfabeto dos segredos gerados no primeiro boot. Sem pontuacao "viva": o valor
# vai para um arquivo .env lido por dotenv, onde aspas, crase, '#', '$' e chaves
# quebram o parse. Letras/digitos + simbolos sempre inertes ja dao entropia de
# sobra nos comprimentos usados aqui.
_SECRET_ALPHABET = string.ascii_letters + string.digits + "-_.~"


def _generate_secret(min_len, max_len):
    """Segredo aleatorio com CSPRNG — nunca ``random``, que e previsivel.

    Usado para a SECRET_KEY do Django, que assina a sessao do admin.
    """
    length = secrets.randbelow(max_len - min_len + 1) + min_len
    return ''.join(secrets.choice(_SECRET_ALPHABET) for _ in range(length))

# Flag de módulo para evitar execuções repetidas no mesmo processo
_ALREADY_RAN = False

# Comandos do manage.py que NÃO devem disparar o startup
_SKIP_COMMANDS = {
    "collectstatic", "migrate", "makemigrations", "showmigrations",
    "check", "shell", "dbshell", "inspectdb", "flush",
    "createsuperuser", "changepassword", "compilemessages",
    "makemessages", "squashmigrations", "test", "sendtestemail",
}


def _should_run_now() -> bool:
    """
    Garante que on_startup só execute quando o app está servindo via
    WSGI/ASGI (gunicorn, uwsgi, daphne, runserver), e não durante
    comandos de build/manage (collectstatic, migrate, etc.).
    """
    # Gunicorn, uwsgi, daphne etc. não passam por manage.py —
    # sys.argv[0] não será manage.py, então permitimos a execução.
    if len(sys.argv) > 0 and os.path.basename(sys.argv[0]) in ("manage.py", "django-admin"):
        command = sys.argv[1] if len(sys.argv) > 1 else ""
        if command in _SKIP_COMMANDS:
            return False
        # runserver em DEV: só roda no processo filho (evita execução dupla do autoreloader)
        if command == "runserver" and settings.DEBUG:
            return os.environ.get("RUN_MAIN") == "true" or os.environ.get("WERKZEUG_RUN_MAIN") == "true"

    return True


def on_startup():
    global _ALREADY_RAN
    if _ALREADY_RAN:
        return
    if not _should_run_now():
        return
    _ALREADY_RAN = True

    # 👇 Coloque aqui o que precisa rodar no startup
    try:
        log.info("Running startup tasks...")
        # exemplos:
        # - registrar schedulers
        # - pré-carregar caches
        # - validar variáveis de ambiente
        # - checar conexões externas

        env_path = Path(settings.DATA_DIR) / ".env"
        if not env_path.exists():
            # warning, nao exception: nao ha excecao em curso aqui e o
            # log.exception imprimia um "NoneType: None" logo abaixo da mensagem.
            log.warning("Environment file '.env' not found, creating a default one!")
            create_default_dot_env()
            os.kill(os.getpid(), signal.SIGTERM)

        from django.core.cache import cache
        cache.set("app:healthy", True, timeout=60)

        log.info("Startup ok.")
    except Exception:
        log.exception("Fail running startup tasks.")


def create_default_dot_env():
    """Gera os segredos do proprio processo no volume de dados.

    Hoje isso e a SECRET_KEY do Django (assina a sessao do admin). O par RSA
    saiu junto com os tokens JWE do login, que nao existem mais.
    """
    dotenv_path = Path(settings.DATA_DIR) / ".env"

    data = {
        "SECRET_KEY": _generate_secret(60, 80)
    }

    default_config = "\n".join(
        f"{k}={v}"
        for k, v in data.items()
    )
    with open(dotenv_path, 'w', encoding="UTF-8") as f:
        f.write(default_config)
        f.write("\n")

    try:
        # Em sistemas POSIX, restringe a leitura ao usuario do processo
        dotenv_path.chmod(0o600)
    except Exception:
        pass  # Ignora em sistemas que nao suportam chmod
