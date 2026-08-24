#!/usr/bin/env bash
set -e

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-core.settings}"

echo "==> Checking migrations..."
python manage.py makemigrations --noinput
python manage.py showmigrations --list 2>&1 | grep '\[ \]' && PENDING=1 || PENDING=0

if [ "$PENDING" = "1" ]; then
    echo "==> Applying pending migrations..."
    python manage.py migrate --noinput
else
    echo "==> All migrations are up to date."
fi

# Projeto 100% publico: nao ha usuario para criar aqui. O unico usuario do
# sistema e o do Django admin, criado sob demanda na primeira requisicao a
# /admin/ — ver asm_simulator/middleware.py:AdminAutoLoginMiddleware.

echo "==> Collecting static files..."
python manage.py collectstatic --noinput 2>/dev/null || true

echo "==> Starting application..."
exec "$@"
