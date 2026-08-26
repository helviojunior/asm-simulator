"""Decodificacao de bytes em instrucoes, via Capstone.

Capstone **le** bytes e descreve o que eles significam; nao executa nada.

O formato devolvido aqui e o contrato consumido pelo interpretador do
frontend. Ele e deliberadamente independente do Capstone: trocar este modulo
por um decodificador WASM no navegador (para suportar codigo automodificavel
e salto para o meio de instrucao) nao deve exigir mudanca no interpretador.

Inteiros que podem ultrapassar 2**53 — enderecos e imediatos de 64 bits — sao
serializados como STRING DECIMAL. Em JSON eles virariam ``Number`` no
JavaScript e perderiam precisao silenciosamente; do outro lado eles entram
direto em ``BigInt()``.
"""

import logging

import capstone

log = logging.getLogger(__name__)

MODE_FOR_ARCH = {
    'x86': capstone.CS_MODE_32,
    'x86_64': capstone.CS_MODE_64,
}

# Sem teto, um binario cheio de bytes invalidos geraria uma lista gigante de
# instrucoes de 1 byte e travaria a UI.
MAX_INSTRUCTIONS = 20000

# Bytes por linha de dados na desmontagem. 16 e o que um dump classico mostra,
# e cabe na coluna sem truncar.
DATA_CHUNK = 16

# A partir de quantos bytes iguais seguidos uma faixa de dados vira UMA linha
# `times N db 0xVV` em vez de N/16 linhas de `db`.
#
# O vao entre `.text` e `.data` tem alguns milhares de bytes zerados; listado
# byte a byte, seriam centenas de linhas de `db 0x00` entre o codigo e os
# dados — a listagem inteira viraria rolagem. `times` e como o proprio NASM
# escreveria aquilo, entao a linha continua sendo fonte valido.
FILL_MIN = 32


class DisassemblyError(Exception):
    pass


def _operand(insn, op):
    """Traduz um operando do Capstone para o formato do interpretador."""
    if op.type == capstone.x86.X86_OP_REG:
        return {
            'type': 'reg',
            'reg': insn.reg_name(op.reg),
            'size': op.size,
        }

    if op.type == capstone.x86.X86_OP_IMM:
        return {
            'type': 'imm',
            'value': str(op.imm),
            'size': op.size,
        }

    if op.type == capstone.x86.X86_OP_MEM:
        mem = op.mem
        return {
            'type': 'mem',
            'size': op.size,
            'segment': insn.reg_name(mem.segment) if mem.segment else None,
            'base': insn.reg_name(mem.base) if mem.base else None,
            'index': insn.reg_name(mem.index) if mem.index else None,
            'scale': mem.scale,
            'disp': str(mem.disp),
        }

    return {'type': 'unknown'}


def _is_data(insn):
    """True quando o Capstone nao conseguiu decodificar estes bytes.

    Com ``skipdata`` ligado, bytes que nao formam instrucao viram uma
    pseudo-instrucao sintetica. Nela o Capstone **recusa** expor `operands` e
    `groups` — acessar qualquer um levanta CsError(CS_ERR_SKIPDATA). Por isso
    a checagem vem antes de tocar no detalhe.

    Nao e caso raro: e o que acontece com toda string embutida na secao de
    codigo, como no `db "..."` da tecnica JMP-CALL-POP.
    """
    return insn.id == 0


def _groups(insn):
    """Categorias da instrucao (jump/call/ret/...).

    O 'step over' do debugger precisa saber se a instrucao atual e um `call`
    para decidir se roda a sub-rotina inteira ou entra nela.
    """
    names = []
    for group in insn.groups:
        try:
            names.append(insn.group_name(group))
        except Exception:
            continue
    return names


def _segments(size, data_ranges):
    """Divide [0, size) em trechos ``(inicio, fim, e_dado)``, em ordem.

    E o que impede uma instrucao de atravessar a fronteira: o Capstone so ve um
    trecho de codigo por vez, e nunca os bytes de dados.
    """
    ranges = []
    for start, end in sorted(data_ranges or []):
        start, end = max(0, int(start)), min(size, int(end))
        if start < end:
            ranges.append((start, end))

    segments = []
    cursor = 0
    for start, end in ranges:
        if start > cursor:
            segments.append((cursor, start, False))
        segments.append((start, end, True))
        cursor = end
    if cursor < size:
        segments.append((cursor, size, False))
    return segments


def _fill_run(payload, start, end, line_map):
    """Ate onde vai a repeticao do byte em `start`, ou None se for curta.

    A corrida para no primeiro offset que tem linha PROPRIA no fonte: dois
    `db 0` em linhas diferentes sao duas declaracoes, e funde-las apagaria a
    ligacao de cada byte com a linha que o escreveu.
    """
    byte = payload[start]
    cursor = start + 1
    while cursor < end and payload[cursor] == byte and cursor not in line_map:
        cursor += 1
    return cursor if cursor - start >= FILL_MIN else None


def _emit_data(instructions, payload, start, end, line_map, base_address):
    """Linhas de dados de uma faixa: `times` para o enchimento, `db` para o resto."""
    offset = start
    while offset < end:
        if len(instructions) >= MAX_INSTRUCTIONS:
            return

        run_end = _fill_run(payload, offset, end, line_map)
        if run_end:
            instructions.append(_fill_entry(
                len(instructions), payload[offset], run_end - offset,
                base_address + offset, line_map, base_address))
            offset = run_end
            continue

        # Uma linha por bloco de DATA_CHUNK bytes: `db "/bin/sh", 0x01` cabe
        # numa linha so, e um buffer grande nao vira centenas delas. O bloco
        # para antes da proxima corrida longa, senao ela comecaria no meio.
        limit = min(offset + DATA_CHUNK, end)
        chunk = payload[offset:limit]
        instructions.append(_data_entry(
            len(instructions), chunk, base_address + offset, line_map, base_address))
        offset = limit


def _fill_entry(index, byte, count, address, line_map, base_address):
    """Uma corrida de bytes iguais, escrita como o NASM a escreveria."""
    op_str = f'{count} db 0x{byte:02X}'
    return {
        'index': index,
        'address': str(address),
        'size': count,
        # O byte repetido, e nao os `count` bytes: a coluna de bytes da
        # listagem tem largura de uma instrucao, e `count` pode ser milhares.
        'bytes': f'{byte:02X}',
        'mnemonic': 'times',
        'op_str': op_str,
        'text': f'times {op_str}',
        'data': True,
        # Distingue "enchimento" de "dado declarado": a interface mostra a
        # contagem em vez de tentar ler aquilo como texto.
        'fill': True,
        'line': line_map.get(address - base_address),
        'operands': [],
        'groups': [],
    }


def _data_entry(index, chunk, address, line_map, base_address):
    """Uma linha de dados: os bytes crus, sem tentativa de decodificacao."""
    op_str = ', '.join(f'0x{b:02X}' for b in chunk)
    return {
        'index': index,
        'address': str(address),
        'size': len(chunk),
        'bytes': ' '.join(f'{b:02X}' for b in chunk),
        'mnemonic': 'db',
        'op_str': op_str,
        'text': f'db {op_str}',
        'data': True,
        'fill': False,
        'line': line_map.get(address - base_address),
        'operands': [],
        'groups': [],
    }


def disassemble(data, arch='x86', base_address=0, line_map=None, data_ranges=None):
    """Decodifica ``data`` e devolve a lista de instrucoes.

    ``line_map`` (offset -> linha do fonte, produzido pelo montador) anota cada
    instrucao com a linha que a originou. So existe quando o programa veio de
    codigo-fonte; num binario bruto nao ha fonte a que corresponder.

    ``data_ranges`` (offsets ``[inicio, fim)`` vindos do montador) marca o que
    saiu de `db`/`resb`/`incbin`. Sem isso o Capstone leria os bytes de
    ``db "/bin/sh"`` como instrucoes — e leria mesmo, porque eles FORMAM
    instrucoes validas (`6E` e `outsb`, `73 68` e `jae`). O `skipdata` nao
    resolve: ele so age quando os bytes NAO decodificam.

    Faz uma varredura LINEAR: decodifica do inicio ao fim, em sequencia. Isso
    cobre o codigo de aula, mas nao um salto para o meio de uma instrucao nem
    codigo que reescreve a si mesmo — casos que exigiriam decodificar sob
    demanda no endereco do RIP.
    """
    if arch not in MODE_FOR_ARCH:
        raise DisassemblyError(f'Unsupported architecture: {arch!r}')

    md = capstone.Cs(capstone.CS_ARCH_X86, MODE_FOR_ARCH[arch])
    # detail=True e o que traz os operandos estruturados; sem isso so viria o
    # texto do mnemonico, inutil para o interpretador.
    md.detail = True
    # Bytes que nao formam instrucao viram uma linha de dados em vez de
    # interromper a varredura: o aluno precisa VER a string embutida no codigo,
    # nao um disassembly truncado.
    md.skipdata = True
    # Mnemonico "db", como o NASM escreve — e nao o ".byte" padrao do Capstone.
    md.skipdata_setup = ("db", None, None)

    line_map = line_map or {}
    payload = bytes(data)
    instructions = []

    for start, end, is_data_segment in _segments(len(payload), data_ranges):
        if len(instructions) >= MAX_INSTRUCTIONS:
            break

        if is_data_segment:
            _emit_data(instructions, payload, start, end, line_map, base_address)
            continue

        instructions.extend(_decode(
            md, payload[start:end], base_address + start, line_map, base_address,
            len(instructions)))

    return instructions


def _decode(md, payload, address, line_map, base_address, index):
    """Decodifica um trecho de CODIGO."""
    instructions = []
    for insn in md.disasm(payload, address):
        if index + len(instructions) >= MAX_INSTRUCTIONS:
            log.warning('Disassembly truncated at %d instructions.', MAX_INSTRUCTIONS)
            break

        is_data = _is_data(insn)

        if is_data:
            # Pseudo-instrucao: sem operandos e sem grupos, por definicao.
            operands, groups = [], []
            op_str = ', '.join(f'0x{b:02X}' for b in insn.bytes)
            text = f'db {op_str}'
        else:
            operands = [_operand(insn, op) for op in insn.operands]
            groups = _groups(insn)
            op_str = insn.op_str
            text = f'{insn.mnemonic} {insn.op_str}'.strip()

        instructions.append({
            'index': index + len(instructions),
            'address': str(insn.address),
            'size': insn.size,
            'bytes': ' '.join(f'{b:02X}' for b in insn.bytes),
            'mnemonic': 'db' if is_data else insn.mnemonic,
            'op_str': op_str,
            'text': text,
            # A UI pinta a linha de outro jeito e o interpretador se recusa a
            # "executar" dados, com uma mensagem que explica o que houve.
            'data': is_data,
            # Byte que o Capstone nao decodificou nunca e enchimento: veio de
            # dentro do codigo, e nao do vao entre as secoes.
            'fill': False,
            # Linha do fonte que gerou estes bytes; None quando nao ha
            # correspondencia exata (binario bruto, ou byte de preambulo).
            'line': line_map.get(insn.address - base_address),
            'operands': operands,
            'groups': groups,
        })

    return instructions


# ---------------------------------------------------------------------------
# Analise: isto parece codigo de maquina?
# ---------------------------------------------------------------------------

# Assinaturas de CONTAINER. Um .exe ou .elf nao e codigo cru: comeca com um
# cabecalho que o Capstone vai decodificar como instrucoes sem sentido. Avisar
# "isto e um PE" e mais util que apontar 40% de bytes invalidos.
_CONTAINERS = (
    (b'MZ', 'pe'),
    (b'\x7fELF', 'elf'),
    (b'\xca\xfe\xba\xbe', 'macho'),
    (b'\xcf\xfa\xed\xfe', 'macho'),
    (b'\xce\xfa\xed\xfe', 'macho'),
    (b'PK\x03\x04', 'zip'),
    (b'%PDF', 'pdf'),
    (b'\x89PNG', 'image'),
    (b'GIF8', 'image'),
    (b'\xff\xd8\xff', 'image'),
)

# Acima disto, bytes que nao decodificam deixam de ser excecao e viram a regra.
UNDECODABLE_LIMIT = 0.25
# Um arquivo quase todo imprimivel e texto, nao codigo.
PRINTABLE_LIMIT = 0.85


def _container_of(data):
    for signature, name in _CONTAINERS:
        if data.startswith(signature):
            return name
    return None


def analyze(data, instructions):
    """Avalia se ``data`` faz sentido como codigo de maquina.

    Nao ha resposta exata: qualquer sequencia de bytes decodifica em ALGUMA
    coisa, e por isso o Capstone nunca "falha" de um jeito obvio. O que da para
    medir sao indicios, e e isso que volta aqui — com os numeros que os
    sustentam, para o aviso poder mostrar em que se baseia em vez de so dizer
    "arquivo suspeito".

    ``reasons`` traz chaves de traducao; quem escreve o texto e a interface.
    """
    size = len(data)
    if size == 0:
        return {'verdict': 'empty', 'reasons': ['analysis.empty'], 'size': 0}

    undecodable = sum(item['size'] for item in instructions if item['data'])
    printable = sum(1 for b in data if 0x20 <= b <= 0x7E or b in (0x09, 0x0A, 0x0D))

    undecodable_ratio = undecodable / size
    printable_ratio = printable / size
    container = _container_of(data)

    reasons = []
    if container:
        reasons.append(f'analysis.container.{container}')
    if undecodable_ratio > UNDECODABLE_LIMIT:
        reasons.append('analysis.undecodable')
    if printable_ratio > PRINTABLE_LIMIT:
        reasons.append('analysis.text')

    return {
        'verdict': 'suspect' if reasons else 'ok',
        'reasons': reasons,
        'size': size,
        'container': container,
        'instructions': sum(1 for item in instructions if not item['data']),
        'undecodable_bytes': undecodable,
        # Arredondado: o aviso mostra porcentagem, nao precisa da cauda binaria.
        'undecodable_ratio': round(undecodable_ratio, 4),
        'printable_ratio': round(printable_ratio, 4),
    }
