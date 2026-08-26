"""Endpoints de preparacao de programa.

Recebem codigo-fonte NASM ou um binario bruto e devolvem a lista de
instrucoes decodificadas. Nada e executado aqui: a simulacao roda no
interpretador do frontend.
"""

import base64
import binascii
import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from asm_simulator.i18n import language_for_request, tr
from asm_simulator.services.assembler import (
    AssemblyError, MAX_OUTPUT_BYTES, assemble,
)
from asm_simulator.services.disassembler import DisassemblyError, analyze, disassemble
from asm_simulator.services.sourcegen import build_source

log = logging.getLogger(__name__)

SUPPORTED_ARCHS = ('x86', 'x86_64')

# Teto do binario importado. Nao e limitacao tecnica: e didatica. O simulador
# existe para ler um shellcode instrucao por instrucao, e um binario maior que
# isto nao se le assim — vira uma listagem que ninguem percorre.
MAX_IMPORT_BYTES = 4 * 1024

# Bases padrao das duas arquiteturas. Sao apenas defaults: o cliente manda a
# sua, e todo o layout de memoria e configuravel.
DEFAULT_BASE_ADDRESS = {
    'x86': 0x00401000,
    'x86_64': 0x0000000140001000,
}


def _parse_arch(payload):
    arch = (payload.get('arch') or 'x86').strip()
    if arch not in SUPPORTED_ARCHS:
        return None, f'Unsupported architecture: {arch!r}. Use one of {SUPPORTED_ARCHS}.'
    return arch, None


def _parse_ranges(value):
    """Faixas ``[[inicio, fim], ...]`` vindas do cliente. Ignora o que nao presta."""
    ranges = []
    for item in value or []:
        try:
            start, end = int(item[0]), int(item[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if 0 <= start < end:
            ranges.append((start, end))
    return ranges


# Largura do espaco de enderecamento de cada arquitetura.
ADDRESS_BITS = {'x86': 32, 'x86_64': 64}


def _parse_address(value, default, arch='x86_64'):
    """Aceita int, "0x7F200100" ou decimal em string, e COBRA a largura.

    Um programa de 32 bits nao pode morar acima de 0xFFFFFFFF, e aceitar isso
    nao daria erro visivel — daria pior. O Capstone guarda o endereco da
    instrucao em 64 bits mas calcula o alvo de um salto com a aritmetica de 32
    do modo: os dois deixam de casar, o interpretador escreve o IP com o alvo
    truncado, e a execucao para no primeiro `jmp` sem dizer por que.
    """
    if value is None or value == '':
        return default, None

    if isinstance(value, int):
        address = value
    else:
        try:
            address = int(str(value).strip(), 0)
        except (TypeError, ValueError):
            return None, f'Invalid address: {value!r}.'

    bits = ADDRESS_BITS.get(arch, 64)
    if not 0 <= address < (1 << bits):
        return None, (
            f'Address {address:#x} does not fit in {bits} bits '
            f'(architecture {arch}).'
        )
    return address, None


class AssembleView(APIView):
    """POST /api/program/assemble/ — codigo-fonte NASM -> instrucoes."""

    def post(self, request):
        payload = request.data or {}

        arch, error = _parse_arch(payload)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        base_address, error = _parse_address(
            payload.get('base_address'), DEFAULT_BASE_ADDRESS[arch], arch
        )
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        source = payload.get('source')
        if not isinstance(source, str) or not source.strip():
            return Response(
                {'detail': tr(request, 'program.emptySource', 'Source code is empty.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            built = assemble(source, arch=arch, base_address=base_address,
                             lang=language_for_request(request))
        except AssemblyError as exc:
            return Response(
                {'detail': exc.message, 'messages': exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            return Response(_payload(
                built.data, arch, base_address,
                warnings=built.warnings, line_map=built.line_map,
                data_ranges=built.data_ranges, sections=built.sections,
            ))
        except DisassemblyError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class DisassembleView(APIView):
    """POST /api/program/disassemble/ — binario bruto -> instrucoes.

    O binario chega em base64 porque o corpo da requisicao e JSON.
    """

    def post(self, request):
        payload = request.data or {}

        arch, error = _parse_arch(payload)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        base_address, error = _parse_address(
            payload.get('base_address'), DEFAULT_BASE_ADDRESS[arch], arch
        )
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        encoded = payload.get('data')
        if not isinstance(encoded, str) or not encoded.strip():
            return Response(
                {'detail': tr(request, 'program.emptyBinary', 'Binary is empty.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            return Response(
                {'detail': 'Field "data" must be valid base64.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(data) > MAX_OUTPUT_BYTES:
            return Response(
                {'detail': f'Binary is too large ({len(data)} bytes; limit is {MAX_OUTPUT_BYTES}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            return Response(_payload(
                data, arch, base_address,
                data_ranges=_parse_ranges(payload.get('data_ranges')),
                # A re-desmontagem de codigo automodificavel passa por aqui a
                # cada escrita na regiao de codigo; so o import de um binario
                # pede a analise.
                with_analysis=bool(payload.get('analyze')),
            ))
        except DisassemblyError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class ImportBinaryView(APIView):
    """POST /api/program/import/ — binario cru -> codigo-fonte NASM.

    Diferente de `/disassemble/`, que devolve instrucoes para o interpretador,
    aqui a saida e um `.asm` EDITAVEL: o aluno importa um shellcode, recebe
    fonte, estuda, altera e decide se guarda na biblioteca.

    Vem junto a analise de plausibilidade — qualquer sequencia de bytes
    decodifica em alguma coisa, entao "desmontou sem erro" nao quer dizer que
    aquilo seja codigo.
    """

    def post(self, request):
        payload = request.data or {}

        arch, error = _parse_arch(payload)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        base_address, error = _parse_address(
            payload.get('base_address'), DEFAULT_BASE_ADDRESS[arch], arch
        )
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        upload = request.FILES.get('file')
        if upload is None:
            return Response(
                {'detail': tr(request, 'program.noBinary', 'Choose a file to import.')},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size > MAX_IMPORT_BYTES:
            return Response(
                {
                    'detail': tr(
                        request, 'program.binaryTooLarge',
                        'The binary is too large.',
                    ),
                    'limit': MAX_IMPORT_BYTES,
                    'size': upload.size,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = upload.read()
        if not data:
            return Response(
                {'detail': tr(request, 'program.emptyBinary', 'Binary is empty.')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            instructions = disassemble(data, arch=arch, base_address=base_address)
        except DisassemblyError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        source = build_source(
            data, instructions, arch=arch, base_address=base_address, origin=upload.name)
        report = analyze(data, instructions)
        log.info('Binary import: %s (%s bytes) -> %s, verdict=%s',
                 upload.name, len(data), arch, report['verdict'])

        return Response({
            'source': source,
            'analysis': report,
            'arch': arch,
            'base_address': str(base_address),
            'size': len(data),
        })


def _default_sections(size):
    """Secoes de um binario que nao passou pelo nosso montador.

    Um shellcode importado nao tem secao nenhuma: e codigo do primeiro ao
    ultimo byte, e a `.data` existe vazia so para a regiao nunca faltar.
    """
    return [
        {'name': '.text', 'start': 0, 'end': size},
        {'name': '.data', 'start': size, 'end': size},
    ]


def _payload(data, arch, base_address, warnings=None, line_map=None,
             data_ranges=None, sections=None, with_analysis=False):
    """Corpo da resposta. Propaga DisassemblyError para a view tratar."""
    instructions = disassemble(
        data, arch=arch, base_address=base_address,
        line_map=line_map, data_ranges=data_ranges,
    )

    body = {
        'arch': arch,
        # offset -> linha do fonte. Vai separado (e nao so embutido em cada
        # instrucao) porque o frontend precisa reaplica-lo ao re-desmontar
        # codigo que se modificou em tempo de execucao.
        'line_map': {str(offset): line for offset, line in (line_map or {}).items()},
        # Faixas de bytes que sao DADOS. Mesmo motivo do line_map: a
        # re-desmontagem de codigo automodificavel precisa reaplica-las, senao
        # a string embutida volta a ser lida como instrucao.
        'data_ranges': [[start, end] for start, end in (data_ranges or [])],
        # Onde `.text` e `.data` cairam na imagem, em offsets. O simulador
        # sempre recebe uma `.data` — vazia, quando o fonte nao declara uma —
        # para nenhum painel precisar tratar a ausencia como caso a parte.
        'sections': sections if sections is not None else _default_sections(len(data)),
        # String decimal: um base_address de 64 bits nao cabe em Number no JS.
        'base_address': str(base_address),
        'size': len(data),
        'data': base64.b64encode(data).decode('ascii'),
        'instructions': instructions,
        'warnings': warnings or [],
    }

    # So faz sentido num binario vindo de fora. O que saiu do nosso montador e
    # codigo por construcao — analisa-lo seria teatro.
    if with_analysis:
        body['analysis'] = analyze(data, instructions)
    return body
