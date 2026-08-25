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

from asm_simulator.i18n import tr
from asm_simulator.services.assembler import (
    AssemblyError, MAX_OUTPUT_BYTES, assemble,
)
from asm_simulator.services.disassembler import DisassemblyError, disassemble

log = logging.getLogger(__name__)

SUPPORTED_ARCHS = ('x86', 'x86_64')

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


def _parse_address(value, default):
    """Aceita int, "0x7F200100" ou decimal em string."""
    if value is None or value == '':
        return default, None
    if isinstance(value, int):
        return value, None
    try:
        return int(str(value).strip(), 0), None
    except (TypeError, ValueError):
        return None, f'Invalid address: {value!r}.'


class AssembleView(APIView):
    """POST /api/program/assemble/ — codigo-fonte NASM -> instrucoes."""

    def post(self, request):
        payload = request.data or {}

        arch, error = _parse_arch(payload)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        base_address, error = _parse_address(
            payload.get('base_address'), DEFAULT_BASE_ADDRESS[arch]
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
            data, warnings, line_map = assemble(source, arch=arch, base_address=base_address)
        except AssemblyError as exc:
            return Response(
                {'detail': exc.message, 'messages': exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            return Response(
                _payload(data, arch, base_address, warnings=warnings, line_map=line_map)
            )
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
            payload.get('base_address'), DEFAULT_BASE_ADDRESS[arch]
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
            return Response(_payload(data, arch, base_address))
        except DisassemblyError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _payload(data, arch, base_address, warnings=None, line_map=None):
    """Corpo da resposta. Propaga DisassemblyError para a view tratar."""
    instructions = disassemble(
        data, arch=arch, base_address=base_address, line_map=line_map
    )

    return {
        'arch': arch,
        # offset -> linha do fonte. Vai separado (e nao so embutido em cada
        # instrucao) porque o frontend precisa reaplica-lo ao re-desmontar
        # codigo que se modificou em tempo de execucao.
        'line_map': {str(offset): line for offset, line in (line_map or {}).items()},
        # String decimal: um base_address de 64 bits nao cabe em Number no JS.
        'base_address': str(base_address),
        'size': len(data),
        'data': base64.b64encode(data).decode('ascii'),
        'instructions': instructions,
        'warnings': warnings or [],
    }
