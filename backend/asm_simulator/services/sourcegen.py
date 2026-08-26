"""Reconstrucao de codigo-fonte NASM a partir de uma desmontagem.

Serve ao import de binario: o aluno traz bytes prontos (um shellcode extraido
de um exploit, por exemplo) e recebe de volta um `.asm` EDITAVEL, que pode
estudar, alterar e salvar na biblioteca — em vez de uma listagem morta.

O que sai daqui nao e o fonte ORIGINAL: esse nao existe mais. Comentario,
nome de variavel e escolha de macro se perderam na montagem e nao ha como
recupera-los. O que da para reconstruir e um fonte EQUIVALENTE, e e o que se
faz aqui — com os bytes originais em comentario, para nada se perder.
"""

import logging
import re

log = logging.getLogger(__name__)

# Capstone escreve na sintaxe da Intel/MASM; o NASM nao aceita o `ptr`.
_PTR = re.compile(r'\b(byte|word|dword|qword|xmmword|ymmword|tbyte)\s+ptr\b', re.IGNORECASE)

# Quantas rodadas de correcao tentar antes de desistir e deixar como bytes.
MAX_REPAIR_ROUNDS = 8

BITS_FOR_ARCH = {'x86': 32, 'x86_64': 64}

# Instrucoes cujo destino vale virar rotulo.
_BRANCH_GROUPS = ('jump', 'call')

# Coluna em que o comentario de bytes comeca. Alinhado, ele vira uma coluna
# que se ignora ao ler o codigo; desalinhado, vira ruido no meio da frase.
_COMMENT_COLUMN = 44


def _targets(instructions, by_address):
    """Enderecos de salto que caem no INICIO de uma instrucao.

    Um salto para o meio de outra instrucao existe (e ate e tecnica de
    ofuscacao), mas nao ha rotulo que o represente em NASM — esses ficam como
    endereco absoluto mesmo.
    """
    found = set()
    for item in instructions:
        if item['data'] or not any(g in _BRANCH_GROUPS for g in item['groups']):
            continue
        operands = item['operands']
        if len(operands) != 1 or operands[0]['type'] != 'imm':
            continue
        try:
            target = int(operands[0]['value'])
        except (TypeError, ValueError):
            continue
        if target in by_address:
            found.add(target)
    return found


def _label(address):
    return f'loc_{address:X}'


def _data_line(item):
    """`db 0x2F, 0x62, ...`, com o texto legivel em comentario quando houver."""
    raw = [int(b, 16) for b in item['bytes'].split()]
    values = ', '.join(f'0x{b:02X}' for b in raw)
    text = ''.join(chr(b) if 0x20 <= b <= 0x7E else '.' for b in raw)
    return f'db {values}', text


def to_source(instructions, arch='x86', base_address=0, origin=None, size=None,
              forced_data=None):
    """Monta o texto NASM equivalente a ``instructions``.

    Emite `bits` e `org` para que remontar reproduza os mesmos enderecos, e
    troca destino de salto por rotulo sempre que ele cai numa fronteira de
    instrucao — sem isso o fonte fica cheio de endereco absoluto e qualquer
    edicao no meio quebra todos os saltos de uma vez.

    ``forced_data`` sao enderecos a emitir como `db` mesmo tendo decodificado:
    e como `build_source` conserta o que o NASM nao aceita de volta.

    Devolve ``(texto, linhas)``, onde `linhas` mapeia numero da linha gerada ->
    endereco da instrucao. E o que permite localizar, num erro do NASM, QUAL
    instrucao precisa virar bytes.
    """
    forced_data = forced_data or set()
    by_address = {int(item['address']): item for item in instructions}
    targets = _targets(instructions, by_address)

    lines = [
        '; ' + '-' * 68,
        '; Codigo reconstruido a partir de um binario importado.',
        ';',
        '; Este NAO e o fonte original — comentarios, nomes e macros se perderam',
        '; na montagem. E um fonte equivalente: monta-lo produz o mesmo programa.',
        '; Os bytes originais de cada instrucao vao no comentario a direita.',
    ]
    if origin:
        lines.append(f'; Origem: {origin}' + (f' ({size} bytes)' if size else ''))
    lines += ['; ' + '-' * 68, '']

    bits = BITS_FOR_ARCH.get(arch)
    if bits:
        lines.append(f'bits {bits}')
    lines.append(f'org 0x{base_address:X}')
    lines.append('')

    line_of = {}
    prepared = [
        dict(item, data=True) if int(item['address']) in forced_data else item
        for item in instructions
    ]

    for item in _merge_data(prepared, targets):
        address = int(item['address'])
        if address in targets:
            lines.append('')
            lines.append(f'{_label(address)}:')

        if item['data']:
            body, readable = _data_line(item)
            comment = f'{address:08X}  {readable}'
            # O que virou bytes por nao ser aceito pelo NASM leva a leitura
            # original junto: a informacao nao se perde, so muda de coluna.
            if address in forced_data and item.get('text'):
                comment += f'  ({item["text"]})'
        else:
            body = _instruction(item, targets)
            comment = f'{address:08X}  {item["bytes"]}'

        text = f'    {body}'
        padding = max(1, _COMMENT_COLUMN - len(text))
        lines.append(f'{text}{" " * padding}; {comment}')
        line_of[len(lines)] = address

    lines.append('')
    return '\n'.join(lines), line_of


def _merge_data(instructions, targets):
    """Junta bytes de dados vizinhos numa linha so.

    O Capstone entrega um `db` por byte indecifravel; oito linhas de `db 0x2F`
    dizem menos que uma com os oito juntos. A fusao para em qualquer byte que
    seja destino de salto — ali comeca outra coisa.
    """
    merged = []
    for item in instructions:
        previous = merged[-1] if merged else None
        contiguous = (
            previous is not None
            and previous['data'] and item['data']
            and int(item['address']) not in targets
            and int(previous['address']) + previous['size'] == int(item['address'])
        )
        if contiguous:
            previous['bytes'] += ' ' + item['bytes']
            previous['size'] += item['size']
            continue
        merged.append(dict(item))
    return merged


def _instruction(item, targets):
    """Texto de uma instrucao, com o destino trocado por rotulo quando cabe."""
    operands = item['operands']
    is_branch = any(g in _BRANCH_GROUPS for g in item['groups'])

    if is_branch and len(operands) == 1 and operands[0]['type'] == 'imm':
        try:
            target = int(operands[0]['value'])
        except (TypeError, ValueError):
            target = None
        # `short` preserva a codificacao curta: sem a dica, o NASM escolhe a
        # forma com deslocamento de 32 bits e um salto de 2 bytes vira 6.
        hint = 'short ' if item['size'] == 2 and item['mnemonic'] != 'call' else ''
        if target in targets:
            return f'{item["mnemonic"]} {hint}{_label(target)}'
        if target is not None:
            return f'{item["mnemonic"]} {hint}0x{target:X}'

    op_str = _PTR.sub(r'\1', item['op_str'])
    return f'{item["mnemonic"]} {op_str}'.strip()


def build_source(data, instructions, arch='x86', base_address=0, origin=None):
    """Fonte que REMONTA nos mesmos bytes, ou o mais perto disso que der.

    O texto do Capstone nem sempre e NASM valido: ele escreve `byte ptr [rsi]`
    (sintaxe da Intel) e imprime os operandos implicitos de instrucoes de
    string, que o NASM recusa. Entregar isso ao aluno seria entregar um arquivo
    que nao monta — e a primeira coisa que ele faria e apertar F9.

    Entao o fonte e VERIFICADO aqui: monta-se o que foi gerado e, a cada
    instrucao recusada, ela vira `db` com a leitura original em comentario.
    Repete-se ate montar limpo. O resultado e sempre montavel; no pior caso,
    com mais bytes crus e menos mnemonicos.
    """
    # Import tardio: o montador ja importa este modulo pelo caminho contrario
    # em nenhum ponto, mas manter aqui deixa a dependencia explicita e local.
    from asm_simulator.services.assembler import AssemblyError, assemble

    forced = set()
    text = ''
    for _round in range(MAX_REPAIR_ROUNDS):
        text, line_of = to_source(
            instructions, arch=arch, base_address=base_address,
            origin=origin, size=len(data), forced_data=forced,
        )
        try:
            rebuilt = assemble(text, arch=arch, base_address=base_address).data
        except AssemblyError as exc:
            broken = {
                line_of[m['line']]
                for m in exc.messages
                if m.get('line') in line_of
            }
            if not broken - forced:
                # Erro que nao aponta para nenhuma instrucao nossa: insistir so
                # repetiria a mesma rodada.
                log.warning('Import: source still fails to assemble (%s)', exc.messages[:2])
                break
            forced |= broken
            continue

        if rebuilt == data:
            return text

        # Montou, mas com bytes diferentes: em algum ponto o NASM escolheu
        # outra codificacao. Acha-se a PRIMEIRA divergencia, a instrucao que a
        # contem vira `db`, e tenta-se de novo. No limite tudo vira bytes — e
        # ai o fonte fica feio, mas continua sendo exatamente o binario original.
        culprit = _first_mismatch(data, rebuilt, instructions, base_address)
        if culprit is None or culprit in forced:
            log.info('Import: source assembles but differs from the original bytes.')
            return text
        forced.add(culprit)

    return text


def _first_mismatch(original, rebuilt, instructions, base_address):
    """Endereco da instrucao que contem o primeiro byte divergente."""
    limit = min(len(original), len(rebuilt))
    offset = next((i for i in range(limit) if original[i] != rebuilt[i]), limit)

    for item in instructions:
        start = int(item['address']) - base_address
        if start <= offset < start + item['size']:
            return int(item['address'])
    return None
