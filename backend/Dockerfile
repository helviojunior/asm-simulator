FROM python:3.11-slim

WORKDIR /app

# Log em container so serve se sair na hora: sem PYTHONUNBUFFERED o stdout do
# Python fica em buffer de bloco sob uwsgi e o `docker logs` atrasa (ou perde,
# se o processo morre) o que foi escrito.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Instalar dependências do sistema
# nasm e um MONTADOR: transforma texto em bytes e nao executa nada. E o
# unico caminho de .asm -> binario; a simulacao acontece no interpretador
# proprio do frontend.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    curl \
    jq \
    nasm \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir wheel uWSGI && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Tornar entrypoint executável
RUN chmod +x entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]

CMD ["uwsgi", "--buffer-size=32768", "--http", "0.0.0.0:8001", "--http-buffer-size=32768", "--module", "core.wsgi", "--env", "DJANGO_SETTINGS_MODULE=core.settings", "--reload-mercy=1", "--worker-reload-mercy=1", "--req-logger", "file:/dev/null", "--touch-reload", "./core/settings.py"]
