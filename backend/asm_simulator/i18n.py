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

        'program.emptySource': 'Source code is empty.',
        'program.emptyBinary': 'Binary is empty.',
        'program.sectionNotAllowed': (
            'Section "{name}" is not supported. This simulator only has '
            '{allowed}: there is no loader here, so any other section would '
            'just be appended to the end of the image.'
        ),

        'library.nameRequired': 'Name is required.',
        'library.nameTooLong': 'Name is too long.',
        'library.nameInvalid': 'Name cannot contain slashes.',
        'library.nameTaken': 'There is already an item with this name here.',
        'library.parentNotFound': 'Folder not found.',
        'library.parentNotFolder': 'The destination is not a folder.',
        'library.notFound': 'Item not found.',
        'library.sourceTooLarge': 'File is too large.',
        'library.cyclicMove': 'A folder cannot be moved into itself.',
        'library.metadataInvalid': 'Invalid execution parameters.',
        'library.archInvalid': 'Unsupported architecture.',
        'library.osInvalid': 'Unsupported target system.',
        'program.noBinary': 'Choose a file to import.',
        'program.binaryTooLarge': 'The binary is too large.',
        'ntdll.notPe': 'This file is not a Windows DLL.',
        'ntdll.unsupportedMachine': 'This DLL is not x86 or x86-64.',
        'ntdll.noExports': 'This DLL has no export table.',
        'ntdll.noSyscalls': 'No syscall stubs found — is this really ntdll.dll?',
        'ntdll.noStorage': 'No writable memory storage available.',
        'ntdll.missing': 'Choose an ntdll.dll to import.',
        'ntdll.tooLarge': 'This file is too large.',
        'library.addressInvalid': 'Address must be a number (e.g. 0x401000).',
        'library.argCountInvalid': 'Argument count must be between 0 and 16.',
        'library.importInvalid': 'This file is not a valid .scasmlib bundle.',
        'library.importMissing': 'Choose a .scasmlib file to import.',
        'library.importEmpty': 'This bundle has no files.',
        'library.importTooLarge': 'This bundle is too large.',
        'library.importVersion': 'This bundle was made by a newer version.',
    },
    'pt-br': {
        'error.notFound': 'Não encontrado.',
        'error.invalidRequest': 'Requisição inválida.',
        'error.internal': 'Erro interno do servidor.',

        'program.emptySource': 'O código-fonte está vazio.',
        'program.emptyBinary': 'O binário está vazio.',
        'program.sectionNotAllowed': (
            'A seção "{name}" não é suportada. Este simulador só tem '
            '{allowed}: não há carregador aqui, então qualquer outra seção '
            'seria apenas concatenada no fim da imagem.'
        ),

        'library.nameRequired': 'O nome é obrigatório.',
        'library.nameTooLong': 'O nome é longo demais.',
        'library.nameInvalid': 'O nome não pode conter barras.',
        'library.nameTaken': 'Já existe um item com este nome aqui.',
        'library.parentNotFound': 'Pasta não encontrada.',
        'library.parentNotFolder': 'O destino não é uma pasta.',
        'library.notFound': 'Item não encontrado.',
        'library.sourceTooLarge': 'O arquivo é grande demais.',
        'library.cyclicMove': 'Uma pasta não pode ser movida para dentro de si mesma.',
        'library.metadataInvalid': 'Parâmetros de execução inválidos.',
        'library.archInvalid': 'Arquitetura não suportada.',
        'library.osInvalid': 'Sistema alvo não suportado.',
        'program.noBinary': 'Escolha um arquivo para importar.',
        'program.binaryTooLarge': 'O binário é grande demais.',
        'ntdll.notPe': 'Este arquivo não é uma DLL do Windows.',
        'ntdll.unsupportedMachine': 'Esta DLL não é x86 nem x86-64.',
        'ntdll.noExports': 'Esta DLL não tem tabela de exports.',
        'ntdll.noSyscalls': 'Nenhum stub de syscall encontrado — isto é mesmo a ntdll.dll?',
        'ntdll.noStorage': 'Não há armazenamento em memória disponível.',
        'ntdll.missing': 'Escolha uma ntdll.dll para importar.',
        'ntdll.tooLarge': 'Este arquivo é grande demais.',
        'library.addressInvalid': 'O endereço deve ser um número (ex.: 0x401000).',
        'library.argCountInvalid': 'A quantidade de argumentos deve estar entre 0 e 16.',
        'library.importInvalid': 'Este arquivo não é um bundle .scasmlib válido.',
        'library.importMissing': 'Escolha um arquivo .scasmlib para importar.',
        'library.importEmpty': 'Este bundle não tem arquivos.',
        'library.importTooLarge': 'Este bundle é grande demais.',
        'library.importVersion': 'Este bundle foi gerado por uma versão mais nova.',
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
