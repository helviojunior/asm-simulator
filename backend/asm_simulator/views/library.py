"""Biblioteca de programas do aluno: pastas e arquivos .asm.

Arvore pequena e local (o ambiente roda offline, uma instancia por aluno),
entao a leitura devolve a arvore INTEIRA numa requisicao. Paginar ou carregar
por nivel so adicionaria idas e voltas sem ganho.

Cada arquivo carrega os PARAMETROS DE EXECUCAO com que foi montado
(arquitetura, base do codigo, topo da pilha, quantidade de argumentos). Eles
sao por arquivo e nao globais: um programa de 32 bits e um de 64 nao rodam com
o mesmo layout de memoria, e reabrir um exemplo com o layout do anterior
significaria montar errado sem aviso.

O CONTEUDO do .asm nao esta no banco — vive em ``<DATA_DIR>/library/<id>.asm``
(ver ``services/library_storage.py``).
"""

import logging

from django.db import transaction
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from asm_simulator.i18n import tr
from asm_simulator.models import LibraryNode
from asm_simulator.services import library_bundle, library_storage

log = logging.getLogger(__name__)

MAX_NAME_LENGTH = 255
MAX_SOURCE_BYTES = 256 * 1024
MAX_ADDRESS_LENGTH = 32
MAX_ARG_COUNT = 16
MAX_NAME_ATTEMPTS = 1000
# Nome sugerido no download e teto do upload.
BUNDLE_FILENAME = 'library.scasmlib'
MAX_BUNDLE_BYTES = 32 * 1024 * 1024


def _serialize(node):
    return {
        'id': str(node.id),
        'parent': str(node.parent_id) if node.parent_id else None,
        'kind': node.kind,
        'name': node.name,
        # O conteudo do arquivo so vai na leitura individual: mandar o fonte de
        # todos os arquivos junto com a arvore desperdicaria banda a toa.
        'updated': node.updated.isoformat(),
        'metadata': _serialize_metadata(node),
    }


def _serialize_metadata(node):
    """Parametros de execucao do arquivo. Pasta nao tem.

    Endereco vazio significa "use o padrao da arquitetura" — quem decide qual e
    esse padrao e o frontend, que ja o conhece para a tela inicial.
    """
    if node.is_folder:
        return None
    return {
        'arch': node.arch,
        'os': node.os,
        'code_base': node.code_base,
        'stack_top': node.stack_top,
        'arg_count': node.arg_count,
    }


def _clean_metadata(payload):
    """Valida o bloco de metadata. Devolve (dict de campos, erro).

    Chave ausente nao e alterada: o PATCH e parcial tambem aqui dentro.
    """
    raw = payload.get('metadata')
    if raw is None:
        return {}, None
    if not isinstance(raw, dict):
        return None, 'library.metadataInvalid'

    fields = {}

    if 'arch' in raw:
        arch = str(raw.get('arch') or '')
        if arch not in LibraryNode.Arch.values:
            return None, 'library.archInvalid'
        fields['arch'] = arch

    if 'os' in raw:
        # Vazio e legitimo: o arquivo pode ter sido salvo antes de o alvo ser
        # resolvido, e o frontend resolve na proxima montagem.
        target = str(raw.get('os') or '')
        if target and target not in LibraryNode.Os.values:
            return None, 'library.osInvalid'
        fields['os'] = target

    for key in ('code_base', 'stack_top'):
        if key in raw:
            value = str(raw.get(key) or '').strip()
            if len(value) > MAX_ADDRESS_LENGTH:
                return None, 'library.addressInvalid'
            # Vazio e legitimo: significa "padrao da arquitetura".
            if value and _parse_address(value) is None:
                return None, 'library.addressInvalid'
            fields[key] = value

    if 'arg_count' in raw:
        try:
            count = int(raw.get('arg_count'))
        except (TypeError, ValueError):
            return None, 'library.argCountInvalid'
        if not 0 <= count <= MAX_ARG_COUNT:
            return None, 'library.argCountInvalid'
        fields['arg_count'] = count

    return fields, None


def _parse_address(text):
    """Aceita "0x401000" ou "4198400"; None quando nao e numero."""
    try:
        return int(text, 16) if text.lower().startswith('0x') else int(text, 10)
    except (TypeError, ValueError):
        return None


def _clean_name(raw):
    """Normaliza e valida o nome de uma pasta ou arquivo.

    `/` é barrado porque a hierarquia vem de `parent`, não do nome — permitir a
    barra criaria dois jeitos de expressar o mesmo caminho.
    """
    name = (raw or '').strip()
    if not name:
        return None, 'library.nameRequired'
    if len(name) > MAX_NAME_LENGTH:
        return None, 'library.nameTooLong'
    if '/' in name or '\\' in name:
        return None, 'library.nameInvalid'
    return name, None


def _resolve_parent(parent_id):
    """Pasta de destino. Devolve (parent, erro)."""
    if not parent_id:
        return None, None
    try:
        parent = LibraryNode.objects.get(pk=parent_id)
    except (LibraryNode.DoesNotExist, ValueError, TypeError):
        return None, 'library.parentNotFound'
    if not parent.is_folder:
        return None, 'library.parentNotFolder'
    return parent, None


def _name_taken(name, parent, exclude=None):
    query = LibraryNode.objects.filter(parent=parent, name__iexact=name)
    if exclude:
        query = query.exclude(pk=exclude)
    return query.exists()


def _error(request, key, fallback, code=status.HTTP_400_BAD_REQUEST):
    return Response({'detail': tr(request, key, fallback)}, status=code)


ERROR_TEXTS = {
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
    'library.addressInvalid': 'Address must be a number (e.g. 0x401000).',
    'library.argCountInvalid': f'Argument count must be between 0 and {MAX_ARG_COUNT}.',
    'library.importInvalid': 'This file is not a valid .scasmlib bundle.',
    'library.importMissing': 'Choose a .scasmlib file to import.',
    'library.importEmpty': 'This bundle has no files.',
    'library.importTooLarge': 'This bundle is too large.',
    'library.importVersion': 'This bundle was made by a newer version.',
}


class LibraryListView(APIView):
    """GET lista a arvore inteira; POST cria pasta ou arquivo."""

    def get(self, request):
        nodes = LibraryNode.objects.all().order_by('kind', 'name')
        return Response({'nodes': [_serialize(node) for node in nodes]})

    def post(self, request):
        payload = request.data or {}

        kind = payload.get('kind')
        if kind not in (LibraryNode.Kind.FOLDER, LibraryNode.Kind.FILE):
            return Response(
                {'detail': f'kind must be one of folder/file (got {kind!r}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name, error = _clean_name(payload.get('name'))
        if error:
            return _error(request, error, ERROR_TEXTS[error])

        parent, error = _resolve_parent(payload.get('parent'))
        if error:
            return _error(request, error, ERROR_TEXTS[error])

        if _name_taken(name, parent):
            return _error(request, 'library.nameTaken', ERROR_TEXTS['library.nameTaken'])

        source = payload.get('source') or ''
        if len(source.encode('utf-8')) > MAX_SOURCE_BYTES:
            return _error(request, 'library.sourceTooLarge', ERROR_TEXTS['library.sourceTooLarge'])

        metadata, error = _clean_metadata(payload)
        if error:
            return _error(request, error, ERROR_TEXTS[error])
        if kind == LibraryNode.Kind.FOLDER:
            metadata = {}

        node = LibraryNode.objects.create(parent=parent, kind=kind, name=name, **metadata)
        # O fonte so pode ser gravado DEPOIS do create: o nome do arquivo em
        # disco e o id, que so existe quando a linha existe.
        if kind == LibraryNode.Kind.FILE:
            node.source = source
        return Response(_serialize(node), status=status.HTTP_201_CREATED)


class LibraryDetailView(APIView):
    """GET devolve o conteudo; PATCH renomeia/move/salva; DELETE remove."""

    def _get(self, pk):
        try:
            return LibraryNode.objects.get(pk=pk)
        except (LibraryNode.DoesNotExist, ValueError, TypeError):
            return None

    def get(self, request, pk):
        node = self._get(pk)
        if node is None:
            return _error(request, 'library.notFound', ERROR_TEXTS['library.notFound'],
                          status.HTTP_404_NOT_FOUND)
        return Response({**_serialize(node), 'source': node.source})

    def patch(self, request, pk):
        node = self._get(pk)
        if node is None:
            return _error(request, 'library.notFound', ERROR_TEXTS['library.notFound'],
                          status.HTTP_404_NOT_FOUND)

        payload = request.data or {}
        fields = []

        if 'name' in payload:
            name, error = _clean_name(payload.get('name'))
            if error:
                return _error(request, error, ERROR_TEXTS[error])
            if _name_taken(name, node.parent, exclude=node.pk):
                return _error(request, 'library.nameTaken', ERROR_TEXTS['library.nameTaken'])
            node.name = name
            fields.append('name')

        if 'parent' in payload:
            parent, error = _resolve_parent(payload.get('parent'))
            if error:
                return _error(request, error, ERROR_TEXTS[error])
            # Mover uma pasta para dentro de si mesma (ou de um descendente)
            # desconectaria o ramo inteiro da raiz.
            if parent and node.is_folder and _is_descendant(parent, node):
                return _error(request, 'library.cyclicMove', ERROR_TEXTS['library.cyclicMove'])
            if _name_taken(node.name, parent, exclude=node.pk):
                return _error(request, 'library.nameTaken', ERROR_TEXTS['library.nameTaken'])
            node.parent = parent
            fields.append('parent')

        metadata, error = _clean_metadata(payload)
        if error:
            return _error(request, error, ERROR_TEXTS[error])
        if metadata and not node.is_folder:
            for key, value in metadata.items():
                setattr(node, key, value)
            fields.extend(metadata.keys())

        # O fonte fica FORA do banco: nao entra em `update_fields`, e a escrita
        # acontece so depois de a validacao toda passar — um nome invalido no
        # mesmo PATCH nao pode deixar o arquivo em disco ja alterado.
        source = None
        if 'source' in payload and not node.is_folder:
            source = payload.get('source') or ''
            if len(source.encode('utf-8')) > MAX_SOURCE_BYTES:
                return _error(request, 'library.sourceTooLarge',
                              ERROR_TEXTS['library.sourceTooLarge'])

        if fields:
            node.save(update_fields=[*fields, 'updated'])
        if source is not None:
            node.source = source
            # `updated` precisa refletir a gravacao do fonte: e o que a arvore
            # mostra como "modificado em".
            node.save(update_fields=['updated'])
        return Response({**_serialize(node), 'source': node.source})

    def delete(self, request, pk):
        node = self._get(pk)
        if node is None:
            return _error(request, 'library.notFound', ERROR_TEXTS['library.notFound'],
                          status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            # on_delete=CASCADE cuida dos descendentes.
            node.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class LibraryExportView(APIView):
    """Baixa a biblioteca inteira como um ``.scasmlib``.

    O par export/import existe porque o ambiente e local e descartavel: o aluno
    roda o container na propria maquina, e sem isso o material dele morreria
    junto com o volume.
    """

    def get(self, request):
        nodes = list(LibraryNode.objects.all().order_by('kind', 'name'))
        payload = library_bundle.export_bundle(
            nodes,
            lambda node: node.source,
            # A MESMA funcao que serve a API: um campo novo em metadata entra
            # nos dois caminhos de uma vez.
            _serialize_metadata,
        )

        response = HttpResponse(payload, content_type='application/gzip')
        response['Content-Disposition'] = f'attachment; filename="{BUNDLE_FILENAME}"'
        response['Content-Length'] = str(len(payload))
        log.info('Library export: %s node(s), %s bytes', len(nodes), len(payload))
        return response


class LibraryImportView(APIView):
    """Importa um ``.scasmlib`` dentro da pasta indicada em `parent`.

    Nada e apagado: o import ACRESCENTA. Nome que ja existe no destino ganha um
    sufixo — cancelar a operacao inteira por causa de uma colisao obrigaria o
    aluno a limpar a biblioteca antes de recuperar o material.
    """

    def post(self, request):
        parent, error = _resolve_parent(request.data.get('parent'))
        if error:
            return _error(request, error, ERROR_TEXTS[error])

        upload = request.FILES.get('file')
        if upload is None:
            return _error(request, 'library.importMissing', ERROR_TEXTS['library.importMissing'])
        if upload.size > MAX_BUNDLE_BYTES:
            return _error(request, 'library.importTooLarge', ERROR_TEXTS['library.importTooLarge'])

        try:
            entries = library_bundle.read_bundle(upload.read())
        except library_bundle.BundleError as exc:
            key = str(exc)
            return _error(request, key, ERROR_TEXTS.get(key, 'Invalid bundle.'))

        try:
            with transaction.atomic():
                created = _create_from_bundle(entries, parent)
        except ValueError as exc:
            key = str(exc)
            return _error(request, key, ERROR_TEXTS.get(key, 'Invalid bundle.'))

        log.info('Library import: %s node(s) under %s', created, parent.pk if parent else 'root')
        return Response({'imported': created}, status=status.HTTP_201_CREATED)


def _create_from_bundle(entries, parent):
    """Cria os nos do bundle, com ids NOVOS e os pais remapeados.

    Os UUIDs de dentro do pacote nao viram os do banco: o bundle pode voltar
    para a instancia de onde saiu, e reusar os ids colidiria com o material que
    ja esta la. Dentro do arquivo eles so ligam filho a pai — e e essa ligacao
    que `mapping` preserva.

    A gravacao do fonte fica para DEPOIS do commit: escrever durante a
    transacao deixaria `.asm` orfaos em disco se um no mais adiante no bundle
    invalidasse a operacao inteira — o banco volta atras, o disco nao.
    """
    mapping = {}
    created = 0

    for entry in entries:
        destination = mapping.get(entry['parent'], parent) if entry['parent'] else parent

        name, error = _clean_name(entry['name'])
        if error:
            raise ValueError('library.importInvalid')
        name = _unique_name(name, destination)

        fields = {}
        if entry['kind'] == LibraryNode.Kind.FILE:
            metadata, error = _clean_metadata({'metadata': entry.get('metadata')})
            if error:
                raise ValueError(error)
            fields = metadata

        node = LibraryNode.objects.create(
            id=library_bundle.new_id(),
            parent=destination,
            kind=entry['kind'],
            name=name,
            **fields,
        )
        mapping[entry['id']] = node
        created += 1

        if entry['kind'] == LibraryNode.Kind.FILE:
            transaction.on_commit(
                lambda node_id=node.pk, text=entry.get('source', ''):
                    library_storage.write_source(node_id, text)
            )

    return created


def _unique_name(name, parent):
    """`nome.asm` -> `nome (2).asm` enquanto houver colisao no destino."""
    if not _name_taken(name, parent):
        return name

    stem, dot, extension = name.rpartition('.')
    if not dot:
        stem, extension = name, ''
    for index in range(2, MAX_NAME_ATTEMPTS):
        candidate = f'{stem} ({index}){dot}{extension}'
        if len(candidate) <= MAX_NAME_LENGTH and not _name_taken(candidate, parent):
            return candidate
    raise ValueError('library.nameTaken')


def _is_descendant(candidate, ancestor):
    """True se `candidate` esta dentro de `ancestor` (ou e o proprio)."""
    node = candidate
    seen = 0
    while node is not None and seen < 128:
        if node.pk == ancestor.pk:
            return True
        node = node.parent
        seen += 1
    return False
