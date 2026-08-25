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


def summaries(os_id, arch_id):
    """Só o que o auto-completar precisa: nome, número e resumo.

    A lista inteira de um alvo passa de 3 MB com os argumentos; para completar
    um nome enquanto se digita, isso e peso sem uso.
    """
    return [
        {
            'function_name': item['function_name'],
            'ssn': item['ssn'],
            'summary': item['summary'],
            'args': len(item['input_args']),
        }
        for name, item in sorted(load_target(os_id, arch_id).items())
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
