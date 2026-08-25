"""Import da ``ntdll.dll`` para resolver numeros de syscall do Windows.

A tabela e VOLATIL: vive num diretorio em memoria e some quando o container
reinicia. Ver ``services/ntdll.py`` para o porque.
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from asm_simulator.i18n import tr
from asm_simulator.services import ntdll

log = logging.getLogger(__name__)

SUPPORTED_ARCHS = ('x86', 'x86_64')

ERROR_TEXTS = {
    'ntdll.notPe': 'This file is not a Windows DLL.',
    'ntdll.unsupportedMachine': 'This DLL is not x86 or x86-64.',
    'ntdll.noExports': 'This DLL has no export table.',
    'ntdll.noSyscalls': 'No syscall stubs found — is this really ntdll.dll?',
    'ntdll.noStorage': 'No writable memory storage available.',
    'ntdll.missing': 'Choose an ntdll.dll to import.',
    'ntdll.tooLarge': 'This file is too large.',
}


def _summary(table):
    """O que a interface precisa saber. A tabela inteira so na leitura."""
    if not table:
        return None
    return {
        'arch': table['arch'],
        'count': table['count'],
        'exports': table.get('exports'),
        'origin': table.get('origin'),
    }


class NtdllView(APIView):
    """GET status; POST importa; DELETE descarta."""

    def get(self, request):
        arch = request.query_params.get('arch')
        archs = [arch] if arch in SUPPORTED_ARCHS else SUPPORTED_ARCHS

        loaded = {}
        for item in archs:
            table = ntdll.load(item)
            if table:
                loaded[item] = _summary(table)

        # `syscalls` so vai quando se pede UMA arquitetura: e a tabela inteira,
        # e a interface a carrega uma vez para resolver sem ida e volta a cada
        # passo da execucao.
        body = {'loaded': loaded}
        if arch in SUPPORTED_ARCHS:
            table = ntdll.load(arch)
            body['syscalls'] = table['syscalls'] if table else {}
        return Response(body)

    def post(self, request):
        upload = request.FILES.get('file')
        if upload is None:
            return self._error(request, 'ntdll.missing')
        if upload.size > ntdll.MAX_DLL_BYTES:
            return self._error(request, 'ntdll.tooLarge')

        try:
            table = ntdll.parse(upload.read())
        except ntdll.NtdllError as exc:
            return self._error(request, str(exc))

        stored = ntdll.store(table, origin=upload.name)
        return Response(
            {**_summary(stored), 'syscalls': stored['syscalls']},
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        arch = request.query_params.get('arch')
        ntdll.clear(arch if arch in SUPPORTED_ARCHS else None)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _error(self, request, key):
        return Response(
            {'detail': tr(request, key, ERROR_TEXTS.get(key, 'Invalid file.'))},
            status=status.HTTP_400_BAD_REQUEST,
        )
