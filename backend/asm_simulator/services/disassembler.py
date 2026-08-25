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


def disassemble(data, arch='x86', base_address=0, line_map=None):
    """Decodifica ``data`` e devolve a lista de instrucoes.

    ``line_map`` (offset -> linha do fonte, produzido pelo montador) anota cada
    instrucao com a linha que a originou. So existe quando o programa veio de
    codigo-fonte; num binario bruto nao ha fonte a que corresponder.

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
    instructions = []
    for insn in md.disasm(bytes(data), base_address):
        if len(instructions) >= MAX_INSTRUCTIONS:
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
            'index': len(instructions),
            'address': str(insn.address),
            'size': insn.size,
            'bytes': ' '.join(f'{b:02X}' for b in insn.bytes),
            'mnemonic': 'db' if is_data else insn.mnemonic,
            'op_str': op_str,
            'text': text,
            # A UI pinta a linha de outro jeito e o interpretador se recusa a
            # "executar" dados, com uma mensagem que explica o que houve.
            'data': is_data,
            # Linha do fonte que gerou estes bytes; None quando nao ha
            # correspondencia exata (binario bruto, ou byte de preambulo).
            'line': line_map.get(insn.address - base_address),
            'operands': operands,
            'groups': groups,
        })

    return instructions
