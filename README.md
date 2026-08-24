# ASMSimulator

Simulador Assembly **full-stack** (Django REST + React) servido como aplicação
**100% pública**: sem login, sem conta de usuário, sem permissionamento. Traz
internacionalização (EN/PT-BR), identidade visual configurável e uma stack
Docker (backend + nginx) que sobe com um comando.

> As convenções obrigatórias do projeto estão em [`CLAUDE.md`](./CLAUDE.md).
> Toda variável, valor padrão e identificador de código é escrito em **inglês**.

## Stack

| Camada    | Tecnologia                                             |
|-----------|--------------------------------------------------------|
| Backend   | Django 5.2 + Django REST Framework, uWSGI              |
| Frontend  | React 19 (CRA/craco), TailwindCSS, react-router        |
| Banco     | SQLite (WAL), em volume gerenciado pelo Docker         |
| Proxy     | nginx (nginx-extras), **HTTP puro** — sem TLS          |
| Acesso    | Público — sem autenticação (ver abaixo)                |

Estrutura:

```
backend/    core/ (settings, wsgi/asgi) + asm_simulator/ (app: models, views, middleware)
frontend/   src/ (pages, components/ui, contexts, i18n, lib)
nginx/      Dockerfile + nginx.conf + entrypoint (rota do admin, real_ip)
docker-compose.yml       # produção (backend + nginx)
docker-compose.dev.yml   # desenvolvimento (backend + frontend hot-reload)
.env.example             # template do .env ÚNICO (nunca versione o .env real)
```

## Principais pontos

### 1. Acesso público — não existe autenticação
- Nenhuma tela, rota ou endpoint pede credencial: sem login, MFA, SSO, token ou
  sessão de usuário final.
- O DRF roda com `AllowAny` e sem authentication classes; o frontend não tem
  `AuthContext` nem armazenamento de token.

### 2. Django admin com login automático
- O `/admin/` é a única área com noção de usuário e entra **sempre autenticado**
  como `ADMIN_USERNAME` (padrão `admin`), criado sob demanda como superusuário
  **sem senha utilizável** — ver
  `asm_simulator/middleware.py:AdminAutoLoginMiddleware`.
- `/admin/login/` redireciona para o índice do admin: não há tela de credencial.
- **Atenção:** quem alcança a URL do admin tem acesso total ao banco. Para
  restringir, mude `ADMIN_URL` para um caminho não óbvio e limite o acesso no
  nginx.

### 3. Internacionalização (EN + PT-BR)
- **EN é o padrão e o fallback** de toda tradução.
- Frontend: `useI18n()` (`t`/`tf`) + catálogos em `src/i18n/locales.js`; o
  idioma inicial vem do navegador.
- Backend: `asm_simulator/i18n.py` (`translate`, `tr`); o idioma da resposta vem
  do `Accept-Language`.

### 4. Identidade visual
- Favicon e logo servidos de `media.sec4us.com.br`, com cache-busting
  `?ts=<BUILD_TS>` em todo objeto estático (a cada build).
- Marca configurável por env (`BRAND_*` / `REACT_APP_BRAND_*`).

### 5. UI/UX (convenções)
- Confirmações/alertas via **modais próprios** (nunca diálogos nativos do browser).
- Telas e formulários ocupam **100%** da largura.
- Detalhe de objeto abre em **janela/rota própria**, não em modal.

### 6. Infra / nginx — HTTP puro
- O nginx serve **somente HTTP** na porta 80 do container (publicável via
  `HTTP_PORT`). Não há `listen 443`, certificado nem HSTS.
- Precisando de HTTPS, coloque um proxy/CDN na frente terminando o TLS: o
  backend confia em `X-Forwarded-Proto`/`X-Forwarded-Host`, então os links
  absolutos saem como https mesmo recebendo HTTP neste hop.
- `USE_REAL_IP` + `real_ip` (`set_real_ip_from`, header `SC-Connecting-IP`).

### 7. Configuração
- **Um único `.env` na raiz**, consumido pelos compose e pelo backend. Nunca
  versione o `.env` — só o `.env.example`.
- `DEBUG=False` por padrão.

## Como rodar

Pré-requisitos: Docker + Docker Compose.

```bash
cp .env.example .env          # ajuste BRAND_*, ADMIN_URL, portas, etc.
docker compose build
docker compose up -d
```

- App: `http://localhost` (ou a `HTTP_PORT` configurada).
- Admin: `http://localhost/admin/` — abre já autenticado, sem pedir senha.
- O primeiro boot cria o `db.sqlite3` e a `SECRET_KEY` no volume de dados e roda
  as migrations.

Desenvolvimento (frontend com hot-reload em `:3000`, backend em `:8000`):

```bash
docker compose -f docker-compose.dev.yml up
```

## Banco e volumes

- **SQLite** em `<DATA_DIR>/db.sqlite3` (`/app/data/db.sqlite3` no container),
  com `journal_mode=WAL` e `timeout=20` para suportar os workers do uwsgi.
  `SQLITE_PATH` sobrescreve o caminho.
- Persistência em **volume gerenciado pelo Docker**, sem bind-mount:
  `asm_simulator_data` (banco + segredos). No compose de desenvolvimento,
  `asm_simulator_data_dev`.

```bash
docker volume ls | grep asm_simulator          # listar
docker compose down -v                          # apagar dados junto
```

- O app ainda não tem modelos próprios. Ao criá-los, gere e versione as
  migrations normalmente (`0001_initial.py`, `0002_...`); o entrypoint roda
  `makemigrations` + `migrate` no boot.

## Endpoints

A API pública ainda não expõe rotas de domínio — o backend serve hoje apenas o
`/admin/` e os redirects de favicon. Novas rotas entram em
`asm_simulator/urls.py`.
