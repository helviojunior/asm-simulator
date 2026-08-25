"""Montagem de codigo-fonte NASM em bytes.

Este modulo **nao executa** codigo: chama o `nasm`, que le texto e escreve
bytes. A simulacao acontece no interpretador do frontend, instrucao por
instrucao — em nenhum ponto do sistema o codigo do aluno roda de verdade.
"""

import logging
import re
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

# Teto do fonte aceito. Um .asm de aula tem dezenas de linhas; o limite existe
# para o nasm nunca receber um arquivo absurdo.
MAX_SOURCE_BYTES = 256 * 1024

# O nasm de um fonte valido termina em milissegundos. Macros recursivas podem
# faze-lo girar por muito tempo — o timeout corta esse caso.
NASM_TIMEOUT_SECONDS = 10

# Tamanho maximo do binario gerado (o interpretador carrega tudo em memoria).
MAX_OUTPUT_BYTES = 1024 * 1024

# Linha do listing do nasm (-l): numero da linha, offset, bytes, fonte.
#
#     29 00000023 547265696E616D656E-         db "Treinamento Shellcoding", 0x0a, 0x01
#     29 0000002C 746F205368656C6C63-
#
# Linhas sem codigo gerado (rotulo, comentario, directive) nao trazem offset, e
# sequencias longas continuam em linhas seguintes repetindo o mesmo numero — as
# duas coisas o padrao abaixo acomoda.
_LISTING_LINE = re.compile(
    r'^\s*(?P<line>\d+)\s+(?P<offset>[0-9A-Fa-f]{8})\s+(?P<bytes>[0-9A-Fa-f]+)-?(?:\s|$)'
)

# "arquivo.asm:12: error: mensagem" / "... warning: ..."
_NASM_MESSAGE = re.compile(
    r'^(?P<file>[^:]+):(?P<line>\d+):\s*(?P<level>error|warning|fatal):\s*(?P<message>.*)$',
    re.IGNORECASE,
)

# Directives que o aluno pode ja ter escrito; nao sobrescrevemos as dele.
_HAS_BITS = re.compile(r'^\s*\[?\s*bits\s+(16|32|64)\b', re.IGNORECASE | re.MULTILINE)
_HAS_ORG = re.compile(r'^\s*\[?\s*org\s+', re.IGNORECASE | re.MULTILINE)

BITS_FOR_ARCH = {'x86': 32, 'x86_64': 64}


class AssemblyError(Exception):
    """Falha de montagem com as mensagens do proprio nasm, ja estruturadas."""

    def __init__(self, message, messages=None):
        super().__init__(message)
        self.message = message
        self.messages = messages or []


def _parse_nasm_output(output, source_name):
    """Converte o stderr do nasm em uma lista de dicionarios.

    Guardamos a linha para o editor poder marcar o erro no lugar certo.
    """
    parsed = []
    for raw in (output or '').splitlines():
        raw = raw.strip()
        if not raw:
            continue
        match = _NASM_MESSAGE.match(raw)
        if match:
            parsed.append({
                'line': int(match.group('line')),
                'level': match.group('level').lower(),
                'message': match.group('message').strip(),
            })
        else:
            # Mensagem sem posicao (ex.: "nasm: fatal: unable to open ...")
            parsed.append({
                'line': None,
                'level': 'error',
                'message': raw.replace(source_name, 'source'),
            })
    return parsed


def _parse_listing(text, line_offset):
    """Mapa ``offset do byte -> linha do fonte``, extraido do listing do nasm.

    E o proprio montador dizendo de que linha veio cada byte: nao ha
    heuristica de casamento de texto, e macros, ``times`` e ``db`` de multiplas
    linhas ficam corretos de graca.

    ``line_offset`` desconta as directives que injetamos antes do fonte, para
    o numero bater com o que o aluno ve no editor.
    """
    mapping = {}
    for raw in (text or '').splitlines():
        match = _LISTING_LINE.match(raw)
        if not match:
            continue
        line = int(match.group('line')) - line_offset
        if line < 1:
            # Byte gerado pelo preambulo, nao por codigo do aluno.
            continue
        offset = int(match.group('offset'), 16)
        # Nao sobrescrever: a primeira linha que gerou aquele offset e a certa.
        mapping.setdefault(offset, line)
    return mapping


def _preamble(arch, base_address, source):
    """Directives injetadas quando o fonte nao as traz.

    `bits` define o modo de montagem e `org` a base — sem `org`, o nasm monta
    como se o codigo comecasse em 0 e todo endereco absoluto sai errado em
    relacao ao endereco em que o simulador carrega o binario.
    """
    lines = []
    if not _HAS_BITS.search(source):
        lines.append(f'bits {BITS_FOR_ARCH[arch]}')
    if not _HAS_ORG.search(source):
        lines.append(f'org 0x{base_address:X}')
    return lines


def assemble(source, arch='x86', base_address=0):
    """Monta ``source`` (sintaxe NASM).

    Devolve ``(bytes, warnings, line_map)``, onde ``line_map`` associa o offset
    de cada byte gerado a linha do fonte que o originou — e o que permite a
    interface destacar, a cada passo, a linha correspondente no editor.

    Levanta ``AssemblyError`` quando o nasm recusa o fonte.
    """
    if arch not in BITS_FOR_ARCH:
        raise AssemblyError(f'Unsupported architecture: {arch!r}')

    encoded = (source or '').encode('utf-8')
    if len(encoded) > MAX_SOURCE_BYTES:
        raise AssemblyError(
            f'Source is too large ({len(encoded)} bytes; limit is {MAX_SOURCE_BYTES}).'
        )

    preamble = _preamble(arch, base_address, source or '')
    # As directives entram ANTES do fonte, entao a numeracao de linha do nasm
    # fica deslocada; descontamos o offset para o erro apontar a linha que o
    # aluno realmente escreveu.
    line_offset = len(preamble)
    full_source = '\n'.join(preamble + [source or '', ''])

    with tempfile.TemporaryDirectory(prefix='asmsim-') as tmp:
        tmp_path = Path(tmp)
        src_file = tmp_path / 'source.asm'
        out_file = tmp_path / 'source.bin'
        lst_file = tmp_path / 'source.lst'
        src_file.write_text(full_source, encoding='utf-8')

        try:
            completed = subprocess.run(
                [
                    'nasm',
                    '-f', 'bin',
                    # Includes limitados ao diretorio temporario.
                    '-i', f'{tmp}/',
                    # Listing: a fonte do mapa offset -> linha do fonte.
                    '-l', str(lst_file),
                    '-o', str(out_file),
                    str(src_file),
                ],
                capture_output=True,
                text=True,
                timeout=NASM_TIMEOUT_SECONDS,
                cwd=tmp,
                check=False,
            )
        except FileNotFoundError:
            log.exception('nasm is not installed in this image.')
            raise AssemblyError('The assembler (nasm) is not available on the server.')
        except subprocess.TimeoutExpired:
            raise AssemblyError(
                f'Assembling timed out after {NASM_TIMEOUT_SECONDS}s.'
            )

        messages = _parse_nasm_output(completed.stderr, str(src_file))
        for item in messages:
            if item['line'] is not None:
                item['line'] = max(1, item['line'] - line_offset)

        errors = [m for m in messages if m['level'] in ('error', 'fatal')]
        warnings = [m for m in messages if m['level'] == 'warning']

        if completed.returncode != 0 or errors:
            raise AssemblyError('Assembly failed.', messages=errors or messages)

        if not out_file.exists():
            raise AssemblyError('Assembly produced no output.', messages=messages)

        data = out_file.read_bytes()
        listing = lst_file.read_text(encoding='utf-8', errors='replace') if lst_file.exists() else ''
        line_map = _parse_listing(listing, line_offset)

    if len(data) > MAX_OUTPUT_BYTES:
        raise AssemblyError(
            f'Assembled binary is too large ({len(data)} bytes; limit is {MAX_OUTPUT_BYTES}).'
        )

    return data, warnings, line_map
