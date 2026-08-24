# Handles
from django.http import JsonResponse

import sys
import traceback
import logging

from asm_simulator.tools import ban

# Handler e nivel vem do LOGGING das settings (console -> stdout). Nao montar
# handler aqui: o codigo antigo caia em SysLogHandler('/dev/log') sempre que
# stdin nao era um TTY — exatamente o caso do container, onde /dev/log nem
# existe e o import estourava dentro do proprio tratamento de erro.
logger = logging.getLogger('ASMSimulator')


def handler404(request, *args, **argv):
    return JsonResponse(
        {'error': 'Resource not found'},
        status=404
    )


def handler500(request, *args, **argv):
    exc_type, exc_value, exc_traceback = sys.exc_info()
    error = traceback.format_exception(exc_type, exc_value, exc_traceback)
    err_txt = '%s\n\n' % exc_value
    for e in error:
        err_txt += str(e.strip('\n'))

    logger.error(err_txt)

    if 'invalid http_host header' in err_txt.lower():
        ban(request)

    return JsonResponse(
        {'error': 'Internal server error'},
        status=500
    )