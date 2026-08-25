"""Protótipos das system calls, lidos de ``asm_simulator/prototypes/``.

Um arquivo YAML por função, agrupado por alvo (sistema + arquitetura). O
diretorio e a fonte: nada aqui duplica a lista de funcoes, e acrescentar um
prototipo e criar um arquivo.

Por que a separacao por alvo importa: o mesmo `write` e a syscall 4 no
`int 0x80` do Linux e a 1 no `syscall` de 64 bits. Sao funcoes diferentes com o
mesmo nome, e um prototipo so serviria a uma delas.
"""

import logging
from pathlib import Path

import yaml

log = logging.getLogger(__name__)

PROTOTYPES_DIR = Path(__file__).resolve().parent.parent / 'prototypes'

# Alvos com prototipo. A chave e a mesma combinacao (sistema, arquitetura) que
# o simulador usa para escolher a tabela de syscalls.
TARGETS = {
    ('linux', 'x86'): 'linux-x86',
    ('linux', 'x86_64'): 'linux-x86_64',
    ('windows', 'x86_64'): 'windows-x86_64',
}

REQUIRED_FIELDS = ('function_name', 'input_args', 'output_data')
FIELD_FIELDS = ('type', 'name', 'description')

# O que a funcao E. Nem tudo que se chama numa DLL do sistema entra pelo
# kernel: `NtCreateFile` e um stub com `syscall` dentro, mas `RtlInitUnicodeString`
# roda inteiro em modo usuario e nunca tem SSN. Sao dois catalogos diferentes
# para dois paineis diferentes — o de `syscall` completa numeros, o de `call`
# completa nomes de export — e sem esta marca os dois se misturariam.
KINDS = ('syscall', 'function')
DEFAULT_KIND = 'syscall'

# Direcao do argumento, quando declarada. Vem das anotacoes SAL dos headers
# (`_In_`, `_Out_`, `_Inout_`, com `_opt_` para opcional) e diz o que o nome
# sozinho nao diz: `BaseAddress` no NtAllocateVirtualMemory entra E sai.
DIRECTIONS = ('in', 'out', 'inout', 'in/opt', 'out/opt', 'inout/opt')


class PrototypeError(Exception):
    """Arquivo de prototipo malformado. A mensagem aponta o arquivo."""


def target_dir(os_id, arch_id):
    """Diretorio do alvo, ou None quando nao ha prototipos para ele."""
    name = TARGETS.get((os_id, arch_id))
    return PROTOTYPES_DIR / name if name else None


def _check_field(where, data, allow_direction=False):
    if not isinstance(data, dict):
        raise PrototypeError(f'{where}: expected a mapping.')
    for field in FIELD_FIELDS:
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise PrototypeError(f'{where}: missing "{field}".')

    # Opcional, mas quando esta la tem de ser um dos valores conhecidos: um
    # "input" no lugar de "in" passaria despercebido e a interface leria errado.
    if allow_direction and 'direction' in data and data['direction'] not in DIRECTIONS:
        raise PrototypeError(
            f'{where}: direction is {data["direction"]!r}; use one of {DIRECTIONS}.')


def parse(path):
    """Le e VALIDA um arquivo de prototipo.

    A validacao e estrita de proposito. Estes arquivos sao escritos a mao, e um
    `arg2` sem `arg1` ou um nome que nao bate com o arquivo produziria um painel
    silenciosamente errado — que e pior do que um painel vazio.
    """
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as exc:
        raise PrototypeError(f'{path.name}: {exc}') from exc

    if not isinstance(data, dict):
        raise PrototypeError(f'{path.name}: expected a mapping at the top level.')
    for field in REQUIRED_FIELDS:
        if field not in data:
            raise PrototypeError(f'{path.name}: missing "{field}".')

    name = data['function_name']
    if name != path.stem:
        raise PrototypeError(
            f'{path.name}: function_name is {name!r}; it must match the file name.')

    kind = data.get('kind', DEFAULT_KIND)
    if kind not in KINDS:
        raise PrototypeError(f'{path.name}: kind is {kind!r}; use one of {KINDS}.')
    # Funcao de modo usuario com SSN seria uma contradicao: o numero so existe
    # para quem cruza a fronteira do kernel, e exibi-lo convidaria o aluno a
    # chamar um `RtlInitUnicodeString` por `syscall`.
    if kind == 'function' and data.get('ssn') is not None:
        raise PrototypeError(f'{path.name}: a user-mode function has no syscall number.')

    args = data['input_args'] or {}
    if not isinstance(args, dict):
        raise PrototypeError(f'{path.name}: input_args must be a mapping (arg0, arg1, ...).')

    ordered = []
    for index in range(len(args)):
        key = f'arg{index}'
        if key not in args:
            # Buraco na sequencia: com `arg0` e `arg2`, qual e o segundo
            # argumento? Nao ha resposta, entao o arquivo esta errado.
            raise PrototypeError(f'{path.name}: input_args is missing "{key}".')
        _check_field(f'{path.name}:{key}', args[key], allow_direction=True)
        ordered.append({'index': index, **args[key]})

    _check_field(f'{path.name}:output_data', data['output_data'])

    return {
        'function_name': name,
        'kind': kind,
        'ssn': data.get('ssn'),
        'summary': data.get('summary', ''),
        'input_args': ordered,
        'output_data': data['output_data'],
    }


# Os arquivos nao mudam em execucao: le-los a cada requisicao seria abrir 773
# arquivos para responder a uma tecla digitada no auto-completar.
_CACHE = {}


def load_target(os_id, arch_id):
    """Todos os prototipos de um alvo, indexados pelo nome da funcao."""
    cached = _CACHE.get((os_id, arch_id))
    if cached is not None:
        return cached

    directory = target_dir(os_id, arch_id)
    if directory is None or not directory.is_dir():
        return {}

    found = {}
    for path in sorted(directory.glob('*.yaml')):
        try:
            prototype = parse(path)
        except PrototypeError:
            # Um arquivo quebrado nao pode derrubar os outros: o painel perde
            # uma funcao, e o log diz qual.
            log.exception('Skipping malformed prototype %s', path)
            continue
        found[prototype['function_name']] = prototype

    _CACHE[(os_id, arch_id)] = found
    return found


def summaries(os_id, arch_id, kind=None):
    """Só o que o auto-completar precisa: nome, número e resumo.

    A lista inteira de um alvo passa de 3 MB com os argumentos; para completar
    um nome enquanto se digita, isso e peso sem uso.

    `kind` filtra por natureza da funcao. O painel de `syscall` pede
    `kind='syscall'`: oferecer `RtlInitUnicodeString` para um numero em RAX
    sugeriria que aquilo se chama por `syscall`, e nao se chama.
    """
    return [
        {
            'function_name': item['function_name'],
            'kind': item['kind'],
            'ssn': item['ssn'],
            'summary': item['summary'],
            'args': len(item['input_args']),
        }
        for name, item in sorted(load_target(os_id, arch_id).items())
        if kind is None or item['kind'] == kind
    ]


def load(os_id, arch_id, function_name):
    """Um prototipo, ou None."""
    directory = target_dir(os_id, arch_id)
    if directory is None:
        return None
    path = directory / f'{function_name}.yaml'
    if not path.is_file():
        return None
    try:
        return parse(path)
    except PrototypeError:
        log.exception('Malformed prototype %s', path)
        return None


# ---------------------------------------------------------------------------
# Tipos (structs e unions)
# ---------------------------------------------------------------------------

TYPE_REQUIRED = ('type_name', 'size', 'fields')
_TYPE_CACHE = {}


def types_dir(os_id, arch_id):
    """Diretorio dos tipos do alvo, ou None."""
    name = TARGETS.get((os_id, arch_id))
    return PROTOTYPES_DIR / 'types' / name if name else None


def _parse_fields(where, raw, depth=0):
    """Campos de um tipo: `field0`, `field1`, ... sem buracos na sequencia.

    Recursivo: um campo pode ser um bloco anonimo com campos proprios — e o
    caso da union dentro do IO_STATUS_BLOCK.
    """
    if depth > 8:
        raise PrototypeError(f'{where}: nested too deeply.')
    if not isinstance(raw, dict):
        raise PrototypeError(f'{where}: fields must be a mapping (field0, field1, ...).')

    out = []
    for index in range(len(raw)):
        key = f'field{index}'
        if key not in raw:
            raise PrototypeError(f'{where}: fields is missing "{key}".')
        field = raw[key]
        if not isinstance(field, dict):
            raise PrototypeError(f'{where}:{key}: expected a mapping.')
        for required in ('name', 'offset', 'size'):
            if required not in field:
                raise PrototypeError(f'{where}:{key}: missing "{required}".')
        if not isinstance(field['offset'], int) or not isinstance(field['size'], int):
            raise PrototypeError(f'{where}:{key}: offset and size must be integers.')

        item = {
            'index': index,
            'name': field['name'],
            'type': field.get('type', ''),
            'offset': field['offset'],
            'size': field['size'],
            'description': field.get('description', ''),
        }
        if field.get('array'):
            item['array'] = field['array']
        if field.get('fields'):
            item['fields'] = _parse_fields(f'{where}:{key}', field['fields'], depth + 1)
        out.append(item)
    return out


def parse_type(path):
    """Le e VALIDA um arquivo de tipo.

    Offset e tamanho sao o que permite LER a memoria: um erro aqui nao aparece
    como falha, aparece como um campo mostrando o byte errado com toda a
    aparencia de estar certo. Dai a validacao ser estrita.
    """
    try:
        data = yaml.safe_load(path.read_text(encoding='utf-8'))
    except (OSError, yaml.YAMLError) as exc:
        raise PrototypeError(f'{path.name}: {exc}') from exc

    if not isinstance(data, dict):
        raise PrototypeError(f'{path.name}: expected a mapping at the top level.')
    for field in TYPE_REQUIRED:
        if field not in data:
            raise PrototypeError(f'{path.name}: missing "{field}".')
    if data['type_name'] != path.stem:
        raise PrototypeError(
            f'{path.name}: type_name is {data["type_name"]!r}; '
            'it must match the file name.')
    if not isinstance(data['size'], int) or data['size'] <= 0:
        raise PrototypeError(f'{path.name}: size must be a positive integer.')

    fields = _parse_fields(path.name, data['fields'])

    # Campo que termina depois do fim da struct significa layout errado, e
    # levaria o painel a ler memoria de fora do objeto.
    for field in fields:
        if field['offset'] + field['size'] > data['size']:
            raise PrototypeError(
                f'{path.name}:{field["name"]}: ends at '
                f'{field["offset"] + field["size"]}, past the {data["size"]}-byte type.')

    return {
        'type_name': data['type_name'],
        'kind': data.get('kind', 'struct'),
        'size': data['size'],
        'align': data.get('align'),
        'summary': data.get('summary', ''),
        'fields': fields,
    }


def load_types(os_id, arch_id):
    """Todos os tipos de um alvo, indexados pelo nome."""
    cached = _TYPE_CACHE.get((os_id, arch_id))
    if cached is not None:
        return cached

    directory = types_dir(os_id, arch_id)
    if directory is None or not directory.is_dir():
        return {}

    found = {}
    for path in sorted(directory.glob('*.yaml')):
        try:
            found[parse_type(path)['type_name']] = parse_type(path)
        except PrototypeError:
            log.exception('Skipping malformed type %s', path)

    _TYPE_CACHE[(os_id, arch_id)] = found
    return found


def load_type(os_id, arch_id, type_name):
    """Um tipo, ou None. Aceita a convencao `PFOO`/`PCFOO` do Windows."""
    if not type_name:
        return None
    known = load_types(os_id, arch_id)

    candidate = type_name.replace('*', '').strip()
    for name in (candidate,
                 candidate[1:] if candidate.startswith('P') else None,
                 candidate[2:] if candidate.startswith('PC') else None):
        if name and name in known:
            return known[name]
    return None
