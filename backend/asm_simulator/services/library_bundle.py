"""Empacotamento da biblioteca no formato ``.scasmlib``.

Um ``.scasmlib`` e um **tar.gz** que reproduz a arvore da biblioteca usando o
UUID de cada no como nome no sistema de arquivos:

    scasmlib.yaml                 # cabecalho do bundle (formato, data)
    <uuid-pasta>.yaml             # metadados da pasta
    <uuid-pasta>/
        <uuid-arquivo>.yaml       # metadados do arquivo
        <uuid-arquivo>.asm        # o fonte
    <uuid-arquivo>.yaml           # arquivo na raiz
    <uuid-arquivo>.asm

Por que UUID e nao o nome escolhido pelo aluno: nome repete entre pastas, muda,
e aceita caracteres que o tar (ou o sistema de arquivos de quem extrair) nao
aceita. O nome de exibicao vive no YAML, onde e apenas texto.

Cada no tem EXATAMENTE um ``.yaml``, no mesmo diretorio do seu conteudo — e a
correspondencia 1:1 que permite conferir o pacote a olho nu.

Na importacao os ids sao TROCADOS por novos. O bundle pode voltar para a mesma
instancia de onde saiu, e reaproveitar os UUIDs colidiria com o material que ja
esta la; dentro do arquivo eles servem so para ligar filho a pai.
"""

import io
import logging
import tarfile
import time
import uuid

import yaml

log = logging.getLogger(__name__)

FORMAT_VERSION = 1
HEADER_NAME = 'scasmlib.yaml'
SOURCE_SUFFIX = '.asm'
METADATA_SUFFIX = '.yaml'

# Limites de leitura. Um bundle vem de fora, e um tar.gz pequeno pode se
# expandir em gigabytes ("zip bomb") — o teto e por membro e no total.
MAX_MEMBERS = 10000
MAX_MEMBER_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024


class BundleError(Exception):
    """Bundle malformado. A mensagem e uma chave de traducao."""


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_bundle(nodes, read_source, read_metadata):
    """Monta o ``.scasmlib`` e devolve os bytes.

    `nodes` e a lista PLANA de nos; `read_source(node)` entrega o fonte de um
    arquivo e `read_metadata(node)` os parametros de execucao. As tres
    dependencias entram por parametro para o servico nao precisar conhecer o
    ORM nem o armazenamento em disco — e, no caso da metadata, para que a lista
    de campos exista num lugar SO. Duplicada aqui, ela ja engoliu um campo novo
    em silencio: o bundle exportava sem ele e ninguem percebia ate reimportar.
    """
    paths = _paths_by_id(nodes)
    buffer = io.BytesIO()

    # mtime fixo e sem gzip filename: o mesmo conteudo produz sempre o mesmo
    # arquivo, o que torna dois exports comparaveis com um diff.
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        _add(tar, HEADER_NAME, yaml.safe_dump({
            'format': FORMAT_VERSION,
            'exported': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }, sort_keys=False, allow_unicode=True))

        for node in nodes:
            path = paths[str(node.id)]
            _add(tar, f'{path}{METADATA_SUFFIX}', yaml.safe_dump(
                _node_metadata(node, read_metadata), sort_keys=False, allow_unicode=True))
            if node.kind == 'folder':
                _add_dir(tar, path)
            else:
                _add(tar, f'{path}{SOURCE_SUFFIX}', read_source(node))

    return buffer.getvalue()


def _paths_by_id(nodes):
    """Caminho de cada no dentro do tar, SEM sufixo: 'pai/filho'."""
    by_id = {str(node.id): node for node in nodes}
    cache = {}

    def resolve(node_id):
        if node_id in cache:
            return cache[node_id]
        node = by_id[node_id]
        parent = str(node.parent_id) if node.parent_id else None
        # Pai fora da lista (nao deveria acontecer) cai na raiz em vez de
        # derrubar o export inteiro.
        prefix = f'{resolve(parent)}/' if parent and parent in by_id else ''
        cache[node_id] = f'{prefix}{node_id}'
        return cache[node_id]

    for node in nodes:
        resolve(str(node.id))
    return cache


def _node_metadata(node, read_metadata):
    data = {
        'id': str(node.id),
        'kind': node.kind,
        'name': node.name,
        'parent': str(node.parent_id) if node.parent_id else None,
    }
    if node.kind != 'folder':
        data['metadata'] = read_metadata(node)
    return data


def _add(tar, name, text):
    payload = text.encode('utf-8')
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mtime = 0
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(payload))


def _add_dir(tar, name):
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mtime = 0
    info.mode = 0o755
    tar.addfile(info)


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def read_bundle(data):
    """Le um ``.scasmlib`` e devolve os nos em ordem de criacao (pai antes).

    Cada item: ``{'id', 'kind', 'name', 'parent', 'metadata', 'source'}``, com
    `id`/`parent` ainda nos UUIDs DO BUNDLE — a troca por ids novos e de quem
    grava, que e o unico que sabe o que ja existe no banco.
    """
    try:
        tar = tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise BundleError('library.importInvalid') from exc

    with tar:
        entries, sources = _read_members(tar)

    if not entries:
        raise BundleError('library.importEmpty')
    return _ordered(entries, sources)


def _read_members(tar):
    """Separa metadados de fontes, validando cada membro."""
    entries = {}
    sources = {}
    total = 0

    for index, member in enumerate(tar):
        if index >= MAX_MEMBERS:
            raise BundleError('library.importTooLarge')
        if member.isdir():
            continue
        if not member.isfile():
            # Link simbolico ou dispositivo nao tem o que fazer aqui, e um
            # link e justamente o vetor classico de escrita fora do destino.
            continue

        name = member.name
        # `..` e caminho absoluto sao recusados mesmo sem extrairmos nada em
        # disco: um caminho desses so existe para escapar do diretorio.
        if name.startswith('/') or '..' in name.split('/'):
            raise BundleError('library.importInvalid')
        if member.size > MAX_MEMBER_BYTES:
            raise BundleError('library.importTooLarge')

        total += member.size
        if total > MAX_TOTAL_BYTES:
            raise BundleError('library.importTooLarge')

        if name == HEADER_NAME:
            _check_header(tar.extractfile(member).read())
            continue

        stem = name.rsplit('/', 1)[-1]
        if stem.endswith(METADATA_SUFFIX):
            node = _parse_metadata(tar.extractfile(member).read())
            entries[node['id']] = node
        elif stem.endswith(SOURCE_SUFFIX):
            key = stem[: -len(SOURCE_SUFFIX)]
            sources[key] = tar.extractfile(member).read().decode('utf-8', 'replace')
        # Qualquer outro arquivo e ignorado: um bundle com um README dentro
        # continua valido.

    return entries, sources


def _check_header(payload):
    header = _safe_load(payload)
    if not isinstance(header, dict):
        raise BundleError('library.importInvalid')
    version = header.get('format')
    # Formato mais NOVO que o suportado: recusar e melhor que importar pela
    # metade e deixar o aluno achar que deu certo.
    if isinstance(version, int) and version > FORMAT_VERSION:
        raise BundleError('library.importVersion')


def _parse_metadata(payload):
    data = _safe_load(payload)
    if not isinstance(data, dict):
        raise BundleError('library.importInvalid')

    node_id = str(data.get('id') or '')
    kind = data.get('kind')
    name = data.get('name')
    if not node_id or kind not in ('folder', 'file') or not isinstance(name, str) or not name.strip():
        raise BundleError('library.importInvalid')

    parent = data.get('parent')
    metadata = data.get('metadata')
    return {
        'id': node_id,
        'kind': kind,
        'name': name.strip(),
        'parent': str(parent) if parent else None,
        'metadata': metadata if isinstance(metadata, dict) else {},
    }


def _safe_load(payload):
    """YAML do bundle e DADO, nunca objeto Python: `safe_load` sempre."""
    try:
        return yaml.safe_load(payload.decode('utf-8'))
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise BundleError('library.importInvalid') from exc


def _ordered(entries, sources):
    """Ordena pai antes de filho e anexa o fonte de cada arquivo.

    Um `parent` que nao esta no bundle vira raiz — um pacote truncado importa o
    que da em vez de falhar inteiro. Um ciclo (so possivel num arquivo forjado)
    e cortado pelo mesmo caminho.
    """
    ordered = []
    placed = set()

    def place(node_id, guard):
        if node_id in placed or node_id in guard:
            return
        node = entries[node_id]
        parent = node['parent']
        if parent and parent in entries:
            place(parent, guard | {node_id})
        if node_id in placed:
            return
        placed.add(node_id)
        if node['kind'] == 'file':
            node['source'] = sources.get(node_id, '')
        ordered.append(node)

    for node_id in entries:
        place(node_id, frozenset())
    return ordered


def new_id():
    """Id novo para um no importado."""
    return uuid.uuid4()
