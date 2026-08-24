"""Traducao de textos voltados ao usuario (API e e-mails).

Regras do projeto:

* **EN e o idioma padrao e o fallback**: chave sem traducao no idioma ativo cai
  para EN — nunca para outro idioma nem para a chave crua (se a chave tambem
  nao existir em EN, devolve o ``default`` recebido, e so entao a chave).
* O projeto e publico e nao tem usuarios: o idioma da resposta vem do
  ``Accept-Language`` da requisicao e, na duvida, e EN.

Catalogos sao dicionarios planos com chaves em ``dominio.item``. Toda chave
adicionada em PT-BR precisa existir em EN.
"""

DEFAULT_LANGUAGE = 'en'
SUPPORTED_LANGUAGES = ('en', 'pt-br')

CATALOGS = {
    'en': {
        'error.notFound': 'Not found.',
        'error.invalidRequest': 'Invalid request.',
        'error.internal': 'Internal server error.',
    },
    'pt-br': {
        'error.notFound': 'Não encontrado.',
        'error.invalidRequest': 'Requisição inválida.',
        'error.internal': 'Erro interno do servidor.',
    },
}


def normalize_language(value):
    """Normaliza um codigo de idioma para um dos suportados; senao, EN."""
    lang = (value or '').strip().lower().replace('_', '-')
    if lang in SUPPORTED_LANGUAGES:
        return lang
    # 'pt', 'pt-PT', 'pt-br-x' -> pt-br; qualquer outro -> EN
    if lang.split('-')[0] == 'pt':
        return 'pt-br'
    if lang.split('-')[0] == 'en':
        return 'en'
    return DEFAULT_LANGUAGE


def translate(key, language=None, default=None, **params):
    """Traduz ``key`` no idioma dado, com fallback obrigatorio para EN."""
    lang = normalize_language(language)
    text = CATALOGS.get(lang, {}).get(key)
    if text is None:
        text = CATALOGS[DEFAULT_LANGUAGE].get(key)
    if text is None:
        text = default if default is not None else key
    if params:
        try:
            return text.format(**params)
        except (KeyError, IndexError):
            return text
    return text


# Alias curto, no mesmo espirito do t() do frontend.
t = translate


def language_for_request(request):
    """Idioma da requisicao: Accept-Language -> EN."""
    header = (request.META.get('HTTP_ACCEPT_LANGUAGE') or '').split(',')[0]
    return normalize_language(header)


def tr(request, key, default=None, **params):
    """Traduz no idioma da requisicao — atalho para uso dentro das views."""
    return translate(key, language_for_request(request), default=default, **params)
