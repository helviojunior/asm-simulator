# Instruções do Projeto

**ASMSimulator** — Assembly simulador full-stack (Django REST + React), servido
como **aplicação 100% pública**: não há login, conta de usuário nem
permissionamento. As convenções abaixo são obrigatórias.

## Acesso e autenticação

### 1. O sistema é público — não existe autenticação
Nenhuma tela, rota ou endpoint exige credencial. Não há login, MFA, SSO/OIDC,
token, sessão de usuário final nem modelo de usuário da aplicação.

- **Proibido:** reintroduzir tela de login, `permission_classes` que exijam
  autenticação, middleware de sessão de usuário final, ou qualquer modelo de
  conta/tenant (Company, CompanyMember, roles, política de senha).
- **Como aplicar:** o DRF roda com `DEFAULT_AUTHENTICATION_CLASSES = []` e
  `DEFAULT_PERMISSION_CLASSES = ['rest_framework.permissions.AllowAny']`
  (`core/settings.py`). O frontend não tem `AuthContext`, token nem
  interceptor de 401 — `src/lib/api.js` é só um axios configurado.

### 1.1. Django admin entra com o usuário padrão, sem senha
O `/admin/` continua existindo como ferramenta de manutenção de dados e é a
**única** parte do sistema com noção de usuário.

- **Como aplicar:** `asm_simulator/middleware.py:AdminAutoLoginMiddleware`,
  registrado logo depois do `AuthenticationMiddleware`. Toda requisição ao
  prefixo `ADMIN_URL` entra autenticada como `ADMIN_USERNAME` (default
  `admin`), criado sob demanda como superusuário com
  `set_unusable_password()` — não existe senha para vazar. `/admin/login/`
  redireciona para o índice do admin.
- **Proibido:** `createsuperuser`, senha de admin em variável de ambiente, ou
  qualquer fluxo que peça credencial no admin.
- **Consequência de segurança, aceita conscientemente:** quem alcança a URL do
  admin tem acesso total de leitura e escrita ao banco. Em ambientes onde isso
  não for aceitável, troque `ADMIN_URL` por um caminho não óbvio e restrinja o
  acesso no nginx.

## UI / UX

### 2. Modais próprios — nunca os do navegador
Toda confirmação, alerta, aviso ou mensagem ao usuário deve usar os componentes
de modal do próprio sistema, consistentes com o design da aplicação.

- **Proibido:** `window.alert`, `window.confirm`, `window.prompt` ou qualquer
  API que renderize um popup nativo do navegador.
- **Como aplicar:** use a API do sistema, já disponível no frontend:
  - `src/components/ui/modal.jsx` — componente `Modal` base (portal, backdrop,
    ESC, botão de fechar).
  - `src/contexts/DialogContext.jsx` — `DialogProvider` (montado em `App.js`) e
    o hook `useDialog()`, que expõe `confirm()` e `alert()` retornando Promise:

    ```jsx
    const { confirm, alert } = useDialog();

    const ok = await confirm({
      title: "Excluir programa?",
      description: <>Excluir <strong>{program.name}</strong>?</>,
      variant: "danger",          // danger | warning | success | info
      confirmLabel: "Excluir",
      onConfirm: async () => api.delete(`/api/programs/${program.id}/`),
    });

    await alert({ title: "Erro ao salvar", variant: "danger" });
    ```
  - `onConfirm` mantém o modal aberto (com loading) enquanto a ação executa; se
    lançar erro, o modal permanece aberto para nova tentativa.

### 3. Telas e formulários ocupam 100% da área disponível
Toda tela e todo formulário devem preencher a largura total da região de
conteúdo em que estão inseridos.

- **Proibido:** "cards" estreitos e centralizados que deixam grandes margens
  laterais vazias; `max-width` fixo em containers de formulário.
- **Como aplicar:** o wrapper da página (`w-full`), o `Card`, o `<form>` e seus
  campos (`Input`, `select`, `textarea`) ocupam a largura disponível; para
  agrupar campos use grid responsivo (`grid gap-4 md:grid-cols-2`) em vez de
  limitar a largura do container.

### 3.1. Booleano é sempre o Switch estilo iPhone
Todo campo booleano da interface usa o *Switch* iOS de
`src/components/ui/switch.jsx` — é o controle padrão de todo o sistema.

- **Proibido:** `<input type="checkbox">` nativo e toggles reimplementados
  dentro de cada tela (geram cores, tamanhos e acessibilidade divergentes).
- **Como aplicar:** `import { Switch } from "components/ui/switch";` —
  `onChange` recebe **o novo booleano**, não o evento
  (`onChange={(v) => setCampo(v)}`). Três layouts:
  1. Solto — `<div className="flex items-center gap-3 text-sm"><Switch …/><span>…</span></div>`
  2. Em caixa — `flex items-center gap-3 rounded-lg border border-border p-3`,
     com o texto clicável alternando o valor.
  3. Com rótulo e descrição — use o `SwitchField` exportado pelo mesmo módulo.

### 4. Detalhe de objeto abre em nova janela
Toda visualização de detalhe de um objeto/entidade deve ser uma nova janela
(rota/página própria), nunca apenas um modal sobreposto.

- **Como aplicar:** detalhe de registro = rota dedicada (ex.: `/entidade/:id`),
  navegável, com URL própria e possibilidade de abrir em nova aba. Modais ficam
  reservados para confirmações e mensagens curtas — não para exibir detalhes.

## Internacionalização (i18n)

### 5. Todo o sistema é multi-language
Nenhum texto visível ao usuário pode ser hard-coded. Idiomas suportados hoje:
**EN** e **PT-BR** (a lista deve ser extensível sem alterar componentes).

- **EN é o idioma padrão de todo o sistema** e **o fallback é sempre o inglês**:
  chave sem tradução no idioma ativo cai para EN, nunca para outro idioma nem
  para a chave crua. O texto do fallback nas chamadas (`t("chave", "fallback")`)
  é escrito em inglês.
- **Escopo:** frontend (telas, modais, validações) e backend (mensagens de erro
  da API).
- **Como aplicar (frontend):** `src/i18n/` — `I18nProvider` (montado em
  `App.js`) e o hook `useI18n()` com `t("chave", "fallback")` e
  `tf("chave", { param })`; catálogos em `src/i18n/locales.js`.
- **Como aplicar (backend):** `asm_simulator/i18n.py` — `translate(key, lang)` e
  `tr(request, key)`; catálogos EN/PT-BR no mesmo arquivo.

### 6. Sem usuários, o idioma vem do cliente
Não há Company nem preferência de conta para consultar.

- **Frontend:** o idioma inicial é detectado do navegador
  (`detectBrowserLanguage`); o seletor no cabeçalho troca o idioma da sessão.
- **Backend:** `language_for_request()` lê o `Accept-Language` da requisição.
- **Idioma ausente ou não suportado → EN.** Nenhum ponto do sistema pode cair
  em outro idioma por default.

## Comunicação e identidade visual

### 7. Todo asset é local — o ambiente roda offline
O simulador é executado pelo próprio aluno, via Docker, **sem internet**.
Nenhum recurso pode depender de rede em tempo de execução.

- **Proibido:** logo, favicon, webfont (Google Fonts), CDN de biblioteca ou
  qualquer `src`/`href` para host externo. Offline, isso não carrega — e a
  falha é silenciosa, então passa despercebida em quem desenvolve com rede.
- **Como aplicar:** a arte vive em `frontend/public/` (`favicon.ico`,
  `favicon.png`, `assets/`), e `src/lib/brand.js` usa esses caminhos como
  padrão. As variáveis `REACT_APP_BRAND_LOGO`, `_LOGO_DARK`, `_FAVICON` e
  `REACT_APP_MEDIA_BASE` continuam existindo para sobrescrever com URL
  externa em quem tiver rede — mas o **default é local**.
- **Tipografia:** `MesloLGS NF` (Nerd Font do powerlevel10k), embarcada em
  `src/assets/fonts/` como `.woff2` **subsetado** — ver o README daquele
  diretório. O `@font-face` em `src/index.css` declara `local()` antes do
  `url()`: quem tem a fonte instalada usa a do sistema, com todos os ícones.
  Toda a interface é monoespacada, como um debugger.
- Fontes ficam em `src/` (não em `public/`) para o webpack empacotá-las com
  hash de conteúdo no nome — o equivalente do `?ts=` da regra 7.1 para assets
  que passam pelo bundler.

### 7.1. Cache-busting `?ts=` em todo objeto estático
Todo asset estático carrega o carimbo do build: `?ts=<REACT_APP_BUILD_TS>`.

- `frontend/craco.config.js` fixa `REACT_APP_BUILD_TS` uma vez por build (mesmo
  valor em `start` e `build`) e interpola `%REACT_APP_BUILD_TS%` nos estáticos
  emitidos (`manifest.json`, `asset-manifest.json`).
- `src/lib/asset.js` expõe `BUILD_TS`, `withTs(url)` e `asset(path)` — use-os
  para **qualquer** URL de asset (imagens, sons, PDFs), local ou remota.
- Os Dockerfiles carimbam `REACT_APP_BUILD_TS=$(date -u +%Y%m%d%H%M%S)` no
  build; a CI pode sobrescrever exportando a variável.

## Configuração e banco

### 8. `.env` único
Existe **um único `.env` na raiz** do repositório, consumido pelos
`docker-compose*.yml` (`env_file` + interpolação) e pelo backend Django
(`core/settings.py` carrega a raiz; `backend/.env` só como fallback legado).
As variáveis de build do frontend (`REACT_APP_*`) saem desse mesmo arquivo e
chegam ao React como build args.

- **Proibido:** `.env` separado por serviço (não existe `frontend/.env`),
  valores duplicados entre compose e backend, ou segredo direto no compose.
- **Única exceção:** `<DATA_DIR>/.env`, gerado no primeiro boot com a
  `SECRET_KEY` do próprio processo — é estado, não configuração, e também é
  carregado pelas settings.
- **Nunca versionar o `.env`.** Só o `.env.example` — template sem valores
  sensíveis — vai para o git. Manter `.env` no `.gitignore` (já está); nunca
  `git add .env` nem `git add -A` sem confirmar que o `.env` continua ignorado.

### 9. Banco: SQLite, `DEBUG=False` por padrão
- O banco é **SQLite**, num arquivo dentro do volume de dados
  (`<DATA_DIR>/db.sqlite3`, sobrescrevível por `SQLITE_PATH`). O diretório é
  criado pelas settings no import, então o primeiro boot não falha.
- A conexão usa `PRAGMA journal_mode=WAL` e `timeout=20`: o uwsgi serve vários
  workers sobre o mesmo arquivo e, no modo padrão, um write concorrente
  devolveria "database is locked".
- `DEBUG` tem default `False`; ligar exige `DEBUG=True` explícito no ambiente.
- **Proibido:** reintroduzir PostgreSQL, `psycopg2` ou `dj-database-url` sem
  decisão explícita — o compose não sobe serviço de banco.

### 9.1. Volumes são gerenciados pelo Docker
Dados persistentes ficam em **volumes nomeados**, nunca em bind-mount do host.

- **Como aplicar:** `docker-compose.yml` declara `asm_simulator_data`
  (SQLite + segredos); `docker-compose.dev.yml` declara
  `asm_simulator_data_dev`.
- **Única exceção:** os bind-mounts de **código-fonte** no compose de
  desenvolvimento (`./backend:/app`, `./frontend/src:/app/src`,
  `./frontend/public:/app/public`), que existem para o hot reload.

### 9.2. Log do backend sai no stdout do container
Todo log do backend vai para o **stdout do processo** — é lá que o Docker
coleta (`docker compose logs -f backend`). Log que não aparece no `docker logs`
não existe.

- **Proibido:** `SysLogHandler`, arquivo de log dentro do container, ou handler
  montado à mão no módulo (`if os.isatty(0): ... else: ...`). Dentro do
  container não há TTY nem `/dev/log`, e o syslog engole a mensagem.
  Também proibido `print()` para diagnóstico — use `logging`.
- **Como aplicar:** a configuração é única, em `core/settings.py` (`LOGGING`,
  dictConfig) com um handler `console` para `sys.stdout` **sem** o filtro
  `require_debug_true` — o padrão do Django silencia tudo com `DEBUG=False`,
  que é o modo normal deste projeto. Nos módulos, apenas
  `log = logging.getLogger(__name__)`; nada de `addHandler`/`basicConfig`.
- **Níveis por ambiente:** `LOG_LEVEL` (aplicação + root, default `INFO`),
  `DJANGO_LOG_LEVEL` (loggers do Django) e `SQL_LOG_LEVEL`
  (`django.db.backends`, default `WARNING`).
- **Sem buffer:** o `backend/Dockerfile` define `PYTHONUNBUFFERED=1`; sob uwsgi
  o stdout fica em buffer de bloco e o log atrasa ou se perde no crash.

### 10. Migrations
O app `asm_simulator` ainda não tem modelos próprios. Ao criar os modelos de
domínio, gere e **versione** as migrations normalmente (`0001_initial.py`,
`0002_...`). O entrypoint roda `makemigrations` + `migrate` no boot.

- Novos modelos herdam de `asm_simulator/dbmodels/base.py:Base`, que já traz
  `id` (UUID), `created`, `updated` e `enabled`.

### 9.3. O nginx serve HTTP puro — TLS não é dele
O container do nginx escuta **somente na porta 80**. Não há `listen 443`,
certificado self-signed, redirect HTTP→HTTPS nem HSTS.

- **Proibido:** reintroduzir `ssl_certificate`, geração de certificado no
  entrypoint, `SECURE_SSL_REDIRECT` ou `SECURE_HSTS_SECONDS` — num deploy HTTP
  qualquer um dos dois derruba o próprio acesso. Também proibido marcar os
  cookies como `Secure`: o navegador não os devolveria por HTTP e o admin
  nunca autenticaria.
- **Como aplicar:** precisando de HTTPS, o TLS é terminado por um proxy/CDN na
  frente do container. O backend mantém
  `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` e
  `USE_X_FORWARDED_HOST = True`, e o nginx repassa `X-Forwarded-Proto` pelo map
  `$forwarded_proto` — assim os links absolutos saem como https mesmo com este
  hop em HTTP.
- Quando a app for alcançada por um domínio/porta diferente do que o Django vê
  no `Host`, defina `CSRF_TRUSTED_ORIGINS` no `.env`.

## Convenções de código e versionamento

### 11. Identificadores de código sempre em inglês
**Todo nome de variável, valor padrão, chave de configuração, env var, função e
campo de modelo é em inglês.** Comentários e textos de UI podem seguir o idioma
local; identificadores de código, não.

- **Proibido:** misturar português em nomes de símbolos ou em valores padrão de
  config.
- **Como aplicar:** use nomes em inglês (`ADMIN_URL`, `REAL_IP_FROM`,
  `USE_REAL_IP`, `language`…).

### 11.1. Ferramenta não instalada na máquina? Use Docker
A máquina do desenvolvedor não tem todos os runtimes instalados (Node/npm, por
exemplo). Sempre que for preciso conferir um comando, uma sintaxe, uma versão de
lib ou rodar um lint/build de um runtime ausente, **execute via Docker** em vez
de instalar a ferramenta no host ou desistir da verificação.

- **Como aplicar:** rode um container descartável montando o diretório do
  projeto, na mesma imagem usada pelo build (`node:20-alpine` para o frontend,
  conforme `frontend/Dockerfile`):

  ```bash
  docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine node -e '...'
  docker run --rm -v "$PWD/frontend":/app -w /app node:20-alpine npx eslint src
  ```

  O mesmo vale para qualquer outro runtime (Python, etc.): imagem oficial,
  `--rm`, volume no projeto. Com os serviços de pé, `docker compose exec` também
  serve para checar algo dentro do container.

### 12. Commits vão direto na `main`
O fluxo é trunk-based: o histórico é linear na `main`.

- **Proibido:** criar branch de feature ou abrir merge request para publicar uma
  alteração.
- **Como aplicar:** quando o usuário pedir para commitar/publicar, `git add` +
  `git commit` + `git push origin main`, sem `git checkout -b`. Commitar apenas
  quando o usuário pedir, usar a identidade configurada no git (sem `--author`)
  e manter as mensagens em português.
