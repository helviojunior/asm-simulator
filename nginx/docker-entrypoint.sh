#!/bin/sh
set -e

# Prefixo do Django admin. Espelha o ADMIN_URL das settings do backend: se
# um for trocado, o outro precisa acompanhar (mesma variavel no .env).
ADMIN_URL="$(echo "${ADMIN_URL:-admin}" | sed 's|^/*||; s|/*$||')"

# Real client IP behind trusted proxies. USE_REAL_IP toggles the whole feature;
# the values come with defaults so it works out of the box when enabled.
USE_REAL_IP="${USE_REAL_IP:-true}"
REAL_IP_FROM="${REAL_IP_FROM:-192.168.0.0/16,10.0.0.0/8,172.16.0.0/12}"
REAL_IP_HEADER="${REAL_IP_HEADER:-SC-Connecting-IP}"
REAL_IP_RECURSIVE="${REAL_IP_RECURSIVE:-on}"

INCLUDES_DIR="/etc/nginx/includes"

mkdir -p "$INCLUDES_DIR"

# Gera o real_ip.conf conforme USE_REAL_IP: uma linha set_real_ip_from por faixa
# do REAL_IP_FROM (virgula/espaco), o header e o modo recursivo. Desligado =
# arquivo vazio (nginx nao reescreve o IP de origem).
case "$(echo "$USE_REAL_IP" | tr '[:upper:]' '[:lower:]')" in
    true|1|yes|on)
        {
            echo "$REAL_IP_FROM" | tr ',' ' ' | tr -s ' ' '\n' | while read -r cidr; do
                [ -n "$cidr" ] && echo "set_real_ip_from ${cidr};"
            done
            echo "real_ip_header ${REAL_IP_HEADER};"
            echo "real_ip_recursive ${REAL_IP_RECURSIVE};"
        } > "${INCLUDES_DIR}/real_ip.conf"
        echo "[nginx-entrypoint] real_ip: on — header=${REAL_IP_HEADER}, from=[${REAL_IP_FROM}]"
        ;;
    *)
        : > "${INCLUDES_DIR}/real_ip.conf"
        echo "[nginx-entrypoint] real_ip: off (USE_REAL_IP=${USE_REAL_IP})"
        ;;
esac

# Rotas do Django admin: a unica area servida pelo backend hoje (o resto e
# SPA). O prefixo ^~ e obrigatorio nos estaticos — sem ele, o location regex
# de .css/.js/.png captura /static/admin/... antes e devolve 404 do disco do
# nginx, onde so existe o build do React.
cat > "${INCLUDES_DIR}/admin_location.conf" <<ADMINCONF
location ^~ /${ADMIN_URL}/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    # \$http_host (e nao \$host) preserva a PORTA do Host original. O admin
    # e a unica area com POST protegido por CSRF, e a checagem de Referer do
    # Django compara host:porta — servindo numa porta nao padrao, \$host
    # descarta a porta e todo POST responde 403.
    proxy_set_header Host \$http_host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$forwarded_proto;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_read_timeout 300s;
    client_max_body_size 100m;
}

location ^~ /static/admin/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Proto \$forwarded_proto;
    expires 1h;
}
ADMINCONF
echo "[nginx-entrypoint] Django admin publicado em /${ADMIN_URL}/"
echo "[nginx-entrypoint] Servindo HTTP puro na porta 80 (sem TLS neste container)."

exec nginx -g "daemon off;"
