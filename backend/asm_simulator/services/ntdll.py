"""Extracao dos numeros de syscall de uma ``ntdll.dll``.

Por que isto existe
-------------------
O Windows nao tem numero de syscall estavel: o SSN de ``NtCreateFile`` muda
entre versoes e ate entre builds. Por isso o simulador se recusa a resolver
numero para nome no alvo Windows — dizer "isto e NtOpenFile" quando pode nao
ser ensinaria errado.

Mas o numero E determinado assim que se sabe DE QUAL build se fala. E quem sabe
disso e a ``ntdll.dll`` daquela maquina: cada stub exportado comeca com um
``mov eax, <SSN>``. Carregando a DLL do ambiente que o aluno esta estudando, a
resolucao deixa de ser chute e vira leitura.

Volatil de proposito
--------------------
A tabela extraida NAO e persistida. Ela vale para uma build especifica do
Windows, e um arquivo esquecido resolveria numeros para os nomes errados meses
depois, com toda a confianca. Se a tabela importa, reimportar custa um clique.

Duas travas garantem isso:

1. O arquivo vai para ``/dev/shm`` — tmpfs, memoria, fora do volume de dados.
2. Ele leva o CARIMBO DO BOOT do container. So `/dev/shm` nao bastaria: um
   ``docker restart`` **preserva** o conteudo dele (medido, nao suposto — o
   Docker so recria o tmpfs quando recria o container). Com o carimbo, uma
   tabela de antes do restart e vista como ausente e apagada.

E arquivo, e nao dicionario no processo, porque o uwsgi sobe varios workers:
em memoria de processo, importar num worker e consultar em outro daria "nao
carregada" de forma intermitente.

O parsing e feito a mao, com ``struct``. Um PE tem cabecalho fixo e tabela de
export bem definida; uma biblioteca a mais no requirements custaria mais que as
cem linhas abaixo.
"""

import json
import logging
import struct
import tempfile
import uuid
from pathlib import Path

log = logging.getLogger(__name__)

# Usado so quando nao ha /proc/1 (fora de container). Fica por processo.
_FALLBACK_BOOT = None

# Teto do upload. Uma ntdll.dll real tem ~2 MB.
MAX_DLL_BYTES = 8 * 1024 * 1024

# Bytes do stub que valem inspecao. O `mov eax, imm32` esta nos primeiros.
STUB_WINDOW = 24

# SSN plausivel. Sem o teto, um `mov eax, 0x0F1E2D3C` qualquer no meio de um
# stub atipico entraria na tabela como se fosse numero de chamada.
MAX_SSN = 0x2000

MACHINE_ARCH = {0x8664: 'x86_64', 0x014C: 'x86'}


class NtdllError(Exception):
    """Falha de leitura do PE. A mensagem e uma chave de traducao."""


# ---------------------------------------------------------------------------
# PE
# ---------------------------------------------------------------------------

def _u16(data, offset):
    return struct.unpack_from('<H', data, offset)[0]


def _u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]


def _sections(data, pe_offset, section_count, optional_size):
    """(rva, tamanho virtual, offset no arquivo) de cada secao."""
    table = pe_offset + 24 + optional_size
    out = []
    for index in range(section_count):
        entry = table + index * 40
        if entry + 40 > len(data):
            break
        out.append((
            _u32(data, entry + 12),  # VirtualAddress
            _u32(data, entry + 8),   # VirtualSize
            _u32(data, entry + 20),  # PointerToRawData
        ))
    return out


def _to_offset(rva, sections):
    """RVA -> posicao no arquivo. None quando o RVA nao cai em secao alguma."""
    for virtual, size, raw in sections:
        if virtual <= rva < virtual + max(size, 1):
            return raw + (rva - virtual)
    return None


def _cstring(data, offset, limit=256):
    end = data.find(b'\x00', offset, offset + limit)
    if end == -1:
        return ''
    return data[offset:end].decode('ascii', 'replace')


def _ssn_of(data, offset):
    """Le o SSN do stub: procura ``B8 xx xx xx xx`` (mov eax, imm32).

    Serve para as duas arquiteturas — em x64 o stub e ``mov r10, rcx`` seguido
    do ``mov eax``, em x86 o ``mov eax`` vem primeiro. Procurar o opcode em vez
    de assumir a posicao cobre os dois sem casos especiais.
    """
    window = data[offset:offset + STUB_WINDOW]
    for position in range(len(window) - 5):
        if window[position] != 0xB8:
            continue
        value = struct.unpack_from('<I', window, position + 1)[0]
        if value < MAX_SSN:
            return value
        return None
    return None


def parse(data):
    """Extrai ``{'arch', 'syscalls': {ssn: nome}, ...}`` de uma ntdll.dll.

    So entram exports ``Nt*``; os ``Zw*`` sao apelidos do mesmo stub e apenas
    duplicariam a tabela.
    """
    if len(data) < 0x40 or data[:2] != b'MZ':
        raise NtdllError('ntdll.notPe')

    pe_offset = _u32(data, 0x3C)
    if pe_offset + 24 > len(data) or data[pe_offset:pe_offset + 4] != b'PE\x00\x00':
        raise NtdllError('ntdll.notPe')

    machine = _u16(data, pe_offset + 4)
    arch = MACHINE_ARCH.get(machine)
    if arch is None:
        raise NtdllError('ntdll.unsupportedMachine')

    section_count = _u16(data, pe_offset + 6)
    optional_size = _u16(data, pe_offset + 20)
    optional = pe_offset + 24
    magic = _u16(data, optional)
    # Onde comeca o DataDirectory, contado do inicio do cabecalho opcional.
    #
    # PE32+ (0x20B) tem quatro campos de 8 bytes onde o PE32 tem quatro de 4
    # (SizeOfStackReserve e companhia) e nao tem o BaseOfData: o cabecalho fixo
    # fica 16 bytes MAIOR. Dai 112 contra 96 — e nao o contrario, que foi o erro
    # que mandou o parser ler o diretorio errado numa ntdll de verdade.
    directories = optional + (112 if magic == 0x20B else 96)

    export_rva = _u32(data, directories)
    if not export_rva:
        raise NtdllError('ntdll.noExports')

    sections = _sections(data, pe_offset, section_count, optional_size)
    export = _to_offset(export_rva, sections)
    if export is None or export + 40 > len(data):
        raise NtdllError('ntdll.noExports')

    name_count = _u32(data, export + 24)
    functions_rva = _u32(data, export + 28)
    names_rva = _u32(data, export + 32)
    ordinals_rva = _u32(data, export + 36)

    functions = _to_offset(functions_rva, sections)
    names = _to_offset(names_rva, sections)
    ordinals = _to_offset(ordinals_rva, sections)
    if None in (functions, names, ordinals):
        raise NtdllError('ntdll.noExports')

    syscalls = {}
    for index in range(name_count):
        try:
            name_rva = _u32(data, names + index * 4)
            ordinal = _u16(data, ordinals + index * 2)
            function_rva = _u32(data, functions + ordinal * 4)
        except struct.error:
            break

        name_offset = _to_offset(name_rva, sections)
        if name_offset is None:
            continue
        name = _cstring(data, name_offset)
        if not name.startswith('Nt'):
            continue

        stub = _to_offset(function_rva, sections)
        if stub is None:
            continue
        ssn = _ssn_of(data, stub)
        if ssn is None:
            continue
        # Colisao acontece com stubs que nao sao syscall (`NtdllDialog...`):
        # o primeiro nome de cada numero e o que fica.
        syscalls.setdefault(ssn, name)

    if not syscalls:
        raise NtdllError('ntdll.noSyscalls')

    return {
        'arch': arch,
        'exports': name_count,
        'count': len(syscalls),
        'syscalls': {str(ssn): name for ssn, name in sorted(syscalls.items())},
    }


# ---------------------------------------------------------------------------
# Armazenamento volatil
# ---------------------------------------------------------------------------

def _boot_id():
    """Identidade desta execucao do container.

    Vem do instante de inicio do PID 1 (o entrypoint): e o MESMO valor para
    todos os workers do uwsgi, e muda a cada `docker restart` ou recriacao.
    Fora de um container — num teste local, por exemplo — cai num valor
    aleatorio por processo, que e volatil do mesmo jeito.
    """
    global _FALLBACK_BOOT
    try:
        # Campo 22 do /proc/1/stat e o starttime. O nome do processo vem entre
        # parenteses e pode conter espacos, entao a divisao e feita depois do
        # ultimo `)`.
        stat = Path('/proc/1/stat').read_text()
        return stat[stat.rindex(')') + 1:].split()[19]
    except (OSError, ValueError, IndexError):
        if _FALLBACK_BOOT is None:
            _FALLBACK_BOOT = uuid.uuid4().hex
        return _FALLBACK_BOOT


def _store_dir():
    """Diretorio em MEMORIA (`/dev/shm`), com fallback para o temporario."""
    for candidate in (Path('/dev/shm'), Path(tempfile.gettempdir())):
        try:
            path = candidate / 'asm-simulator'
            path.mkdir(parents=True, exist_ok=True)
            return path
        except OSError:
            continue
    raise NtdllError('ntdll.noStorage')


def _store_path(arch):
    return _store_dir() / f'ntdll-{arch}.json'


def store(table, origin=None):
    """Guarda a tabela para a arquitetura dela, carimbada com o boot atual."""
    payload = {**table, 'origin': origin, 'boot': _boot_id()}
    path = _store_path(table['arch'])
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(payload), encoding='utf-8')
    temporary.replace(path)
    log.info('ntdll loaded: %s syscalls (%s) from %s', table['count'], table['arch'], origin)
    return payload


def load(arch):
    """Tabela carregada para `arch`, ou None.

    Carimbo de outro boot conta como ausente, e o arquivo e removido na hora:
    deixa-lo la so adiaria o mesmo descarte para a proxima leitura.
    """
    path = None
    try:
        path = _store_path(arch)
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError, OSError, NtdllError):
        return None

    if payload.get('boot') != _boot_id():
        log.info('Discarding ntdll table from a previous container run.')
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None
    return payload


def clear(arch=None):
    """Descarta a tabela de `arch`, ou todas."""
    try:
        directory = _store_dir()
    except NtdllError:
        return
    targets = [_store_path(arch)] if arch else directory.glob('ntdll-*.json')
    for path in targets:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            log.exception('Could not clear %s', path)
