# Stage 1: Build frontend
FROM node:20-alpine AS builder

WORKDIR /app

ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

# Marca (sobrescreve os defaults de frontend/.env)
ARG REACT_APP_BRAND_NAME=ASMSimulator
ARG REACT_APP_MEDIA_BASE=
ARG REACT_APP_BRAND_LOGO=
ARG REACT_APP_BRAND_CONTACT_EMAIL=contato@asmsimulator.com.br
ENV REACT_APP_BRAND_NAME=$REACT_APP_BRAND_NAME
ENV REACT_APP_MEDIA_BASE=$REACT_APP_MEDIA_BASE
ENV REACT_APP_BRAND_LOGO=$REACT_APP_BRAND_LOGO
ENV REACT_APP_BRAND_CONTACT_EMAIL=$REACT_APP_BRAND_CONTACT_EMAIL

COPY frontend/package.json frontend/yarn.loc[k] ./
RUN yarn install

COPY frontend/ .
# Carimba o timestamp do build: invalida o cache do favicon/logo remotos
# (media.sec4us.com.br) a cada nova imagem — padrao do ../sec_face.
RUN REACT_APP_BUILD_TS=$(date -u +%Y%m%d%H%M%S) yarn build

# Stage 2: Nginx with headers-more module
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx-extras && \
    rm -rf /var/lib/apt/lists/*

# Remove default config
RUN rm -f /etc/nginx/sites-enabled/default

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/app_locations.conf /etc/nginx/includes/app_locations.conf
COPY nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=builder /app/build /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
