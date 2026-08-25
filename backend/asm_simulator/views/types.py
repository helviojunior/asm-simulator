"""Protótipos de TIPO (structs e unions), por alvo.

A interface usa isto no "Parse as type": tendo o layout, um ponteiro deixa de
ser um número e vira os campos que estão naquele endereço.
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from asm_simulator.services import prototypes

log = logging.getLogger(__name__)


class TypeListView(APIView):
    """GET /api/types/?os=&arch=[&name=]

    Sem `name`, devolve os nomes disponíveis — é o que a interface precisa para
    saber se um argumento pode ser expandido. Com `name`, devolve o layout.
    """

    def get(self, request):
        os_id = request.query_params.get('os')
        arch_id = request.query_params.get('arch')
        if not os_id or not arch_id:
            return Response({'detail': 'os and arch are required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        name = request.query_params.get('name')
        if name:
            found = prototypes.load_type(os_id, arch_id, name)
            if found is None:
                return Response({'type': None}, status=status.HTTP_404_NOT_FOUND)
            return Response({'type': found})

        return Response({
            'os': os_id,
            'arch': arch_id,
            'types': sorted(prototypes.load_types(os_id, arch_id)),
        })
