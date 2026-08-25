"""Protótipos de system call disponíveis, por alvo.

A interface usa isto para duas coisas: completar o nome quando o aluno resolve
uma chamada a mão, e mostrar o que cada argumento significa. Os arquivos vivem
em ``asm_simulator/prototypes/`` — ver o README de lá.
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from asm_simulator.services import prototypes

log = logging.getLogger(__name__)


class PrototypeListView(APIView):
    """GET /api/prototypes/?os=linux&arch=x86_64 — protótipos daquele alvo.

    Sem `os`/`arch`, devolve os alvos disponíveis.

    `name=NtCreateFile` traz um protótipo só, com os argumentos.

    `fields=names` traz só nome, número e resumo. É o que o auto-completar usa:
    o Windows tem 773 funções e a lista completa passa de 3 MB — peso sem uso
    para completar um nome enquanto se digita. A lista completa continua
    disponível para quando se quiser mostrar os argumentos.
    """

    def get(self, request):
        os_id = request.query_params.get('os')
        arch_id = request.query_params.get('arch')
        name = request.query_params.get('name')

        if os_id and arch_id and name:
            # Um prototipo so. E o que a interface pede ao resolver uma chamada:
            # a lista inteira do Windows passa de 3 MB, e o que interessa ali e
            # UMA funcao.
            prototype = prototypes.load(os_id, arch_id, name)
            if prototype is None:
                return Response({'prototype': None}, status=status.HTTP_404_NOT_FOUND)
            return Response({'prototype': prototype})

        if not os_id or not arch_id:
            return Response({
                'targets': [{'os': o, 'arch': a} for o, a in prototypes.TARGETS],
            })

        if request.query_params.get('fields') == 'names':
            return Response({
                'os': os_id,
                'arch': arch_id,
                'prototypes': prototypes.summaries(os_id, arch_id),
            })

        loaded = prototypes.load_target(os_id, arch_id)
        return Response({
            'os': os_id,
            'arch': arch_id,
            'prototypes': [loaded[name] for name in sorted(loaded)],
        })
