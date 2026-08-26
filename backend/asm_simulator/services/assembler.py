"""Montagem de codigo-fonte NASM em bytes.

Este modulo **nao executa** codigo: chama o `nasm`, que le texto e escreve
bytes. A simulacao acontece no interpretador do frontend, instrucao por
instrucao — em nenhum ponto do sistema o codigo do aluno roda de verdade.
"""

import logging
import re
import subprocess
import tempfile
from collections import namedtuple
from pathlib import Path

from asm_simulator.i18n import translate

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
# O sufixo cobre as tres continuacoes que o nasm escreve:
#
#   `-`            a sequencia segue na proxima linha
#   `<rep 4h>`     os bytes vem de um `times` (com espaco dentro, dai o `[^>]*`)
#   `(00000000)`   deslocamento resolvido depois, como no `lea rcx, [rel msg]`
#
# Sem aceitar cada uma delas, a linha inteira era descartada — e com ela o mapa
# de linhas e a marcacao de dados daquele trecho. A terceira forma e o caso de
# TODO acesso RIP-relativo a `.data`: sem ela, justamente a instrucao que le a
# variavel ficava sem linha no editor.
_LISTING_LINE = re.compile(
    r'^\s*(?P<line>\d+)\s+(?P<offset>[0-9A-Fa-f]{8})\s+'
    r'(?P<bytes>[0-9A-Fa-f]+)(?:-|<[^>]*>|\([0-9A-Fa-f]*\))*(?:\s|$)'
)

# Directives que RESERVAM OU EMITEM DADOS, e nao instrucoes.
#
# Existe para o desmontador nao tentar ler texto como codigo. Capstone decodifica
# o que puder, e os bytes de "/bin/sh" formam instrucoes validas — `6E` e `outsb`,
# `73 68` e `jae`. Sem esta marcacao, um `db "/bin/sh"` aparece como um punhado
# de instrucoes sem sentido, que e exatamente o que o aluno NAO deve ver.
#
# O rotulo opcional a frente cobre `command: db "notepad.exe", 0`; o `times`
# cobre `times 16 db 0x90`.
_DATA_DIRECTIVE = re.compile(
    r'^\s*(?:[\w.$#@~?]+\s*:\s*)?'
    r'(?:times\s+\S+\s+)?'
    r'(?:d[bwdqto]|res[bwdqt]|incbin)\b',
    re.IGNORECASE,
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

# As UNICAS secoes aceitas.
#
# O simulador nao tem carregador: o `nasm -f bin` produz UMA imagem contigua,
# que e escrita inteira em `codeBase`, e ao lado dela existe so a pilha. Uma
# `section .bss` nao seria reservada nem zerada em tempo de carga, e uma
# `.rodata` nao teria protecao de escrita — os bytes apenas seriam concatenados
# no fim da imagem. Aceitar essas secoes ensinaria uma semantica que o
# simulador nao tem; recusa-las e a leitura honesta.
ALLOWED_SECTIONS = ('.text', '.data')

# Secao vigente antes de qualquer directive: e o que o proprio nasm assume no
# formato `bin`.
DEFAULT_SECTION = '.text'

# Onde a `.data` mora.
#
# Num programa de verdade ela fica noutra PAGINA — outro mapeamento, outra
# permissao —, e o endereco dela termina em tres zeros. Colada ao fim do
# codigo, como o `nasm -f bin` a deixaria (alinhada em 4 bytes), a fronteira
# entre codigo e dado vira um detalhe invisivel: o aluno olha o dump e nao tem
# como dizer onde uma acaba e a outra comeca.
#
# A folga minima existe pelo mesmo motivo. Sem ela, um `.text` que termina em
# 0x…FF0 poria a `.data` 16 bytes adiante, na pagina seguinte mas colada — o
# endereco seria redondo e a separacao continuaria imperceptivel.
DATA_ALIGN = 0x1000
DATA_MIN_GAP = 500

# `section .data`, `[section .text]`, `segment .text align=16`.
_SECTION_DIRECTIVE = re.compile(
    r'^\s*\[?\s*(?:section|segment)\s+(?P<name>[^\s\],;]+)',
    re.IGNORECASE,
)

# Linha da tabela-resumo do map do nasm:
#
#     Vstart            Start             Stop              Length    Class     Name
#         7FF700001000      7FF700001000      7FF700001024  00000024  progbits  .text
#
# A largura das colunas de endereco acompanha o `org` (8 digitos num programa
# de 32 bits, 16 num de 64), entao o padrao nao pode fixa-la.
_MAP_SECTION_ROW = re.compile(
    r'^\s*(?P<vstart>[0-9A-Fa-f]+)\s+(?P<start>[0-9A-Fa-f]+)\s+(?P<stop>[0-9A-Fa-f]+)\s+'
    r'(?P<length>[0-9A-Fa-f]+)\s+\S+\s+(?P<name>\.\S+)\s*$'
)

_MAP_ORIGIN_HEADER = re.compile(r'^--+\s*Program origin\b', re.IGNORECASE)
_MAP_SUMMARY_HEADER = re.compile(r'^--+\s*Sections \(summary\)', re.IGNORECASE)
_MAP_ANY_HEADER = re.compile(r'^--+\s*\S')


# O que `assemble()` devolve. Um namedtuple, e nao uma tupla solta: sao cinco
# campos, e `data, _w, _lm, _r, _s = assemble(...)` diz menos a cada um que se
# acrescenta.
AssemblyResult = namedtuple(
    'AssemblyResult', 'data warnings line_map data_ranges sections'
)


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


def _data_lines(source):
    """Numeros das linhas do fonte que sao directive de dados."""
    lines = set()
    for index, raw in enumerate((source or '').splitlines(), start=1):
        # Comentario fora antes de olhar: `; db "x"` nao emite byte nenhum.
        code = raw.split(';', 1)[0]
        if _DATA_DIRECTIVE.match(code):
            lines.add(index)
    return lines


def _sections_by_line(source):
    """Em que secao cada linha do fonte esta, e as secoes recusadas.

    Devolve ``(mapa linha -> secao, [(linha, nome)] recusadas)``. Antes da
    primeira directive vale ``.text``, como o proprio nasm assume no formato
    `bin`. Uma secao recusada NAO troca a secao vigente: o fonte vai ser
    rejeitado de qualquer forma, e mudar para ela so bagunçaria o mapa.
    """
    mapping = {}
    rejected = []
    current = DEFAULT_SECTION

    for index, raw in enumerate((source or '').splitlines(), start=1):
        code = raw.split(';', 1)[0]
        match = _SECTION_DIRECTIVE.match(code)
        if match:
            name = match.group('name').lower()
            if name in ALLOWED_SECTIONS:
                current = name
            else:
                rejected.append((index, match.group('name')))
        mapping[index] = current

    return mapping, rejected


def _check_sections(source, lang=None):
    """Recusa o fonte que declare uma secao fora de ``ALLOWED_SECTIONS``.

    A checagem acontece ANTES de chamar o nasm: ele montaria `.bss` e
    `.rodata` sem reclamar, e o aluno so descobriria a diferenca ao ver os
    bytes num lugar que nao esperava.
    """
    mapping, rejected = _sections_by_line(source)
    if rejected:
        allowed = ', '.join(ALLOWED_SECTIONS)
        raise AssemblyError(
            translate('program.sectionNotAllowed', lang,
                      default='Only the {allowed} sections are supported.',
                      name=rejected[0][1], allowed=allowed),
            messages=[{
                'line': line,
                'level': 'error',
                'message': translate(
                    'program.sectionNotAllowed', lang,
                    default='Only the {allowed} sections are supported.',
                    name=name, allowed=allowed),
            } for line, name in rejected],
        )
    return mapping


def _align_up(value, alignment):
    return -(-value // alignment) * alignment


def _data_address(origin, text_end):
    """Endereco em que a `.data` comeca: fronteira de pagina apos a folga."""
    return _align_up(origin + text_end + DATA_MIN_GAP, DATA_ALIGN)


def _parse_map(text):
    """Base e tamanho de cada secao, lidos do map do nasm.

    E o montador dizendo onde cada secao caiu na imagem — informacao que o
    listing NAO tem, porque ali os offsets sao relativos a cada secao e
    recomecam do zero. Sem isto, o primeiro byte de `.text` e o primeiro de
    `.data` sao ambos "offset 0" e um sobrescreve o outro no mapa de linhas.

    Devolve ``(origem, {nome: (offset na imagem, tamanho)})``; ``(None, {})``
    se o map nao veio.
    """
    origin = None
    sections = {}
    block = None

    for raw in (text or '').splitlines():
        if _MAP_ORIGIN_HEADER.match(raw):
            block = 'origin'
            continue
        if _MAP_SUMMARY_HEADER.match(raw):
            block = 'summary'
            continue
        if _MAP_ANY_HEADER.match(raw):
            block = None
            continue

        stripped = raw.strip()
        if not stripped:
            continue

        if block == 'origin' and origin is None:
            try:
                origin = int(stripped, 16)
            except ValueError:
                return None, {}
            continue

        if block == 'summary':
            match = _MAP_SECTION_ROW.match(raw)
            if match:
                sections[match.group('name').lower()] = (
                    int(match.group('start'), 16), int(match.group('length'), 16)
                )

    if origin is None:
        return None, {}
    # O offset na imagem e o que interessa: o simulador carrega o binario em
    # `codeBase`, que pode nem ser o `org` (o aluno pode ter escrito o dele).
    return origin, {
        name: (start - origin, length) for name, (start, length) in sections.items()
    }


def _section_layout(bases, size, origin=None):
    """Secoes da imagem, em offsets, com a `.data` sempre presente.

    A pseudo-secao existe porque o simulador SEMPRE tem uma regiao de dados,
    ainda que vazia: assim nenhum painel precisa tratar "programa sem `.data`"
    como um caso a parte, e o aluno ve onde ela comecaria — na MESMA fronteira
    de pagina em que ela cairia se existisse, e nao colada ao fim do codigo.
    """
    layout = []
    for name in ALLOWED_SECTIONS:
        if name in bases:
            start, length = bases[name]
            layout.append({'name': name, 'start': start, 'end': start + length})

    if not any(item['name'] == '.text' for item in layout):
        layout.insert(0, {'name': '.text', 'start': 0, 'end': size})

    if not any(item['name'] == '.data' for item in layout):
        text_end = next(item['end'] for item in layout if item['name'] == '.text')
        # Sem origem (map ilegivel) nao ha fronteira a calcular: fica logo
        # depois da imagem, que e o comportamento de sempre.
        start = size if origin is None else _data_address(origin, text_end) - origin
        layout.append({'name': '.data', 'start': start, 'end': start})

    return layout


def _parse_listing(text, line_offset, base_for_line=None):
    """Linhas do listing como ``[(offset, linha do fonte)]``, em ordem.

    E o proprio montador dizendo de onde veio cada byte: nao ha heuristica de
    casamento de texto, e macros, ``times`` e ``db`` de multiplas linhas ficam
    corretos de graca.

    ``line_offset`` desconta as directives que injetamos antes do fonte, para
    o numero bater com o que o aluno ve no editor. ``base_for_line`` traduz o
    offset relativo a secao para o offset na imagem.
    """
    rows = {}
    for raw in (text or '').splitlines():
        match = _LISTING_LINE.match(raw)
        if not match:
            continue
        line = int(match.group('line')) - line_offset
        if line < 1:
            # Byte gerado pelo preambulo, nao por codigo do aluno.
            continue
        # O listing conta o offset a partir do inicio da SECAO; a base leva
        # ao offset na imagem, que e como o resto do sistema indexa.
        offset = int(match.group('offset'), 16)
        if base_for_line:
            offset += base_for_line(line)
        # Nao sobrescrever: a primeira linha que gerou aquele offset e a certa.
        rows.setdefault(offset, line)
    return sorted(rows.items())


def _data_ranges(rows, data_lines, size):
    """Faixas ``[inicio, fim)`` de bytes que sairam de directive de dados.

    O tamanho de cada trecho vem do PROXIMO offset do listing, e nao da
    contagem de bytes da propria linha: com `times`, o nasm escreve `90<rept>`
    e nao lista os bytes repetidos, entao contar o que esta escrito daria 1
    onde ha 4.
    """
    spans = []
    for index, (offset, line) in enumerate(rows):
        if line not in data_lines:
            continue
        end = rows[index + 1][0] if index + 1 < len(rows) else size
        if offset < end:
            spans.append((offset, end))
    return _merge(spans)


def _data_layout(spans, sections):
    """Faixas de dados finais, ja com a `.data` e o enchimento entre secoes.

    Tres coisas entram aqui, e cada uma vira uma faixa SEPARADA:

    1. O que a deteccao por directive achou dentro do `.text` — o `db` embutido
       no meio do codigo, do idioma JMP-CALL-POP.
    2. O enchimento de alinhamento entre as secoes. O nasm alinha `.data` em 4
       bytes, e esses bytes nao sao instrucao: desmontados, virariam um
       `add [rax], al` que o aluno procuraria no fonte sem achar.
    3. A `.data` inteira, comece ela por `db` ou nao.

    Separadas de proposito: a desmontagem quebra os dados em linhas de 16 bytes
    a partir do inicio de CADA faixa. Fundidas, a primeira linha da `.data`
    comecaria nos bytes de enchimento e a primeira variavel apareceria
    deslocada — que e exatamente o que ninguem consegue conferir num dump.
    """
    data = next((item for item in sections if item['name'] == '.data'), None)
    if not data or data['end'] <= data['start']:
        return spans

    text_end = next((item['end'] for item in sections if item['name'] == '.text'), 0)
    if text_end <= 0 or text_end > data['start']:
        text_end = data['start']

    # O que veio de directive fica confinado ao `.text`: o que esta na `.data`
    # entra pela faixa da propria secao, e sobrepor as duas faria a desmontagem
    # emitir os mesmos bytes duas vezes.
    ranges = [(start, min(end, text_end)) for start, end in spans if start < text_end]
    ranges = [(start, end) for start, end in ranges if start < end]

    if text_end < data['start']:
        ranges.append((text_end, data['start']))
    ranges.append((data['start'], data['end']))
    return sorted(ranges)


def _merge(spans):
    """Funde intervalos que se tocam, para o desmontador ver um bloco so.

    Um `db "/bin/sh", 0x01` sai do listing em varias linhas; sem fundir, viraria
    varias linhas de `db` na desmontagem em vez da string inteira.
    """
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [tuple(span) for span in merged]


def _preamble(arch, base_address, source, map_file, data_at=None):
    """Directives injetadas quando o fonte nao as traz.

    `bits` define o modo de montagem e `org` a base — sem `org`, o nasm monta
    como se o codigo comecasse em 0 e todo endereco absoluto sai errado em
    relacao ao endereco em que o simulador carrega o binario.

    O `map` e sempre nosso: e a unica forma de saber onde cada secao caiu na
    imagem final (ver `_parse_map`).

    `data_at` posiciona a `.data`. Quem faz a conta e o proprio nasm, e nao o
    simulador: e ele que resolve `lea rcx, [rel msg]`, e mover a secao depois
    de montada deixaria o deslocamento apontando para o lugar antigo. Declarar
    o atributo aqui e voltar para `.text` na linha seguinte: sem isso, o codigo
    escrito antes da primeira directive do aluno cairia dentro da `.data`.
    """
    lines = []
    if not _HAS_BITS.search(source):
        lines.append(f'bits {BITS_FOR_ARCH[arch]}')
    if not _HAS_ORG.search(source):
        lines.append(f'org 0x{base_address:X}')
    lines.append(f'[map sections {map_file}]')
    if data_at is not None:
        lines.append(f'section .data start=0x{data_at:X}')
        lines.append('section .text')
    return lines


# Uma passada do montador, ja com o stderr interpretado.
NasmOutcome = namedtuple('NasmOutcome', 'data listing mapping warnings')


def _run_nasm(tmp, src_file, out_file, lst_file, map_file, line_offset):
    """Chama o nasm uma vez e devolve o que ele produziu.

    `line_offset` desconta as directives que injetamos antes do fonte, para o
    erro apontar a linha que o aluno realmente escreveu.

    Levanta ``AssemblyError`` com as mensagens do proprio nasm quando ele
    recusa o fonte.
    """
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
        raise AssemblyError(f'Assembling timed out after {NASM_TIMEOUT_SECONDS}s.')

    messages = _parse_nasm_output(completed.stderr, str(src_file))
    for item in messages:
        if item['line'] is not None:
            item['line'] = max(1, item['line'] - line_offset)

    errors = [m for m in messages if m['level'] in ('error', 'fatal')]
    if completed.returncode != 0 or errors:
        raise AssemblyError('Assembly failed.', messages=errors or messages)

    if not out_file.exists():
        raise AssemblyError('Assembly produced no output.', messages=messages)

    read = lambda path: path.read_text(encoding='utf-8', errors='replace') if path.exists() else ''
    return NasmOutcome(
        out_file.read_bytes(),
        read(lst_file),
        read(map_file),
        [m for m in messages if m['level'] == 'warning'],
    )


def assemble(source, arch='x86', base_address=0, lang=None):
    """Monta ``source`` (sintaxe NASM).

    Devolve um ``AssemblyResult``. ``line_map`` associa o offset de cada byte
    gerado a linha do fonte que o originou — e o que permite a interface
    destacar, a cada passo, a linha correspondente no editor. ``data_ranges``
    marca o que veio de `db`/`resb`/`incbin` e o conteudo de `.data`, para o
    desmontador nao tentar ler texto como instrucao. ``sections`` diz onde
    `.text` e `.data` cairam na imagem.

    Levanta ``AssemblyError`` quando o nasm recusa o fonte — ou quando ele
    declara uma secao que o simulador nao tem como representar.
    """
    if arch not in BITS_FOR_ARCH:
        raise AssemblyError(f'Unsupported architecture: {arch!r}')

    encoded = (source or '').encode('utf-8')
    if len(encoded) > MAX_SOURCE_BYTES:
        raise AssemblyError(
            f'Source is too large ({len(encoded)} bytes; limit is {MAX_SOURCE_BYTES}).'
        )

    # Antes do nasm: ele montaria `.bss` sem reclamar, e o aluno so notaria a
    # diferenca ao procurar os bytes num lugar que nao os tem.
    section_of_line = _check_sections(source, lang)

    map_name = 'source.map'

    with tempfile.TemporaryDirectory(prefix='asmsim-') as tmp:
        tmp_path = Path(tmp)
        src_file = tmp_path / 'source.asm'
        out_file = tmp_path / 'source.bin'
        lst_file = tmp_path / 'source.lst'
        map_file = tmp_path / map_name

        def run(data_at):
            """Uma passada do nasm. Devolve `(bytes, listing, map, avisos)`."""
            preamble = _preamble(arch, base_address, source or '', map_name, data_at)
            # As directives entram ANTES do fonte, entao a numeracao de linha
            # do nasm fica deslocada; descontamos o offset para o erro apontar
            # a linha que o aluno realmente escreveu.
            offset = len(preamble)
            src_file.write_text('\n'.join(preamble + [source or '', '']), encoding='utf-8')
            return _run_nasm(tmp, src_file, out_file, lst_file, map_file, offset), offset

        # Primeira passada: descobrir o tamanho do `.text`. So com ele em maos
        # se sabe em que pagina a `.data` cabe.
        #
        # Ate tres passadas porque a segunda pode mudar o tamanho do `.text`
        # (um endereco maior nao cabe mais num imediato curto) e ai a fronteira
        # muda de lugar junto. Converge na segunda em qualquer programa real; o
        # teto existe para o caso patologico nao virar laco infinito.
        placement = None
        for attempt in range(3):
            outcome, line_offset = run(placement)
            origin, bases = _parse_map(outcome.mapping)
            text, data_section = bases.get('.text'), bases.get('.data')
            if origin is None or not text or not data_section:
                break
            wanted = _data_address(origin, text[0] + text[1])
            if origin + data_section[0] == wanted:
                break
            placement = wanted
        else:
            log.warning('Section .data placement did not settle after %d passes.', attempt + 1)

        data = outcome.data
        listing = outcome.listing
        mapping = outcome.mapping
        warnings = outcome.warnings

        # Sem map legivel, a leitura antiga (uma secao so) continua valendo —
        # e exatamente o que um fonte sem `section` produz.
        origin, bases = _parse_map(mapping)
        sections = _section_layout(bases, len(data), origin)

        def base_for_line(line):
            name = section_of_line.get(line, DEFAULT_SECTION)
            return bases.get(name, (0, 0))[0]

        rows = _parse_listing(listing, line_offset, base_for_line)
        line_map = dict(rows)

        data_ranges = _data_layout(
            _merge(_data_ranges(rows, _data_lines(source), len(data))), sections
        )

    if len(data) > MAX_OUTPUT_BYTES:
        raise AssemblyError(
            f'Assembled binary is too large ({len(data)} bytes; limit is {MAX_OUTPUT_BYTES}).'
        )

    return AssemblyResult(data, warnings, line_map, data_ranges, sections)
