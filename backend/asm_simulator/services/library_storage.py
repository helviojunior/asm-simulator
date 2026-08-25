"""Armazenamento do fonte dos arquivos da biblioteca.

O conteudo do .asm NAO fica no banco: cada arquivo vira ``<uuid>.asm`` dentro
do volume de dados, e o banco guarda apenas o nome, a hierarquia e os
parametros de execucao. Duas razoes:

1. O fonte e o unico campo que cresce sem teto. Mantido no SQLite, cada leitura
   da arvore arrastaria junto o texto de todos os arquivos.
2. Em disco o material do aluno e recuperavel com um ``cat`` — nao depende de
   abrir o banco.

O nome do arquivo em disco e o UUID, e nao o nome escolhido pelo aluno: nomes
mudam, repetem entre pastas e aceitam caracteres que o sistema de arquivos nao
aceita. O UUID nao tem nenhum desses problemas, e o nome de exibicao continua
no banco.
"""

import logging
import uuid
from pathlib import Path

from django.conf import settings

log = logging.getLogger(__name__)

SOURCE_SUFFIX = '.asm'


def library_dir():
    """Diretorio dos fontes, criado sob demanda."""
    path = Path(settings.DATA_DIR) / 'library'
    path.mkdir(parents=True, exist_ok=True)
    return path


def source_path(node_id):
    """Caminho de ``<uuid>.asm``.

    O id passa por ``uuid.UUID`` antes de virar nome de arquivo: sem isso, um
    id vindo da URL poderia carregar ``../`` e escrever fora do diretorio.
    """
    return library_dir() / f'{uuid.UUID(str(node_id))}{SOURCE_SUFFIX}'


def read_source(node_id):
    """Conteudo do arquivo; string vazia se ele ainda nao existe."""
    try:
        return source_path(node_id).read_text(encoding='utf-8')
    except FileNotFoundError:
        return ''
    except (OSError, ValueError):
        log.exception('Could not read library source %s', node_id)
        return ''


def write_source(node_id, text):
    """Grava o fonte de forma atomica.

    A escrita vai para um temporario no MESMO diretorio e so entao e renomeada:
    um crash no meio deixaria o arquivo do aluno truncado, e ``rename`` dentro
    do mesmo sistema de arquivos e atomico.
    """
    path = source_path(node_id)
    temporary = path.with_suffix(f'{SOURCE_SUFFIX}.tmp')
    temporary.write_text(text or '', encoding='utf-8')
    temporary.replace(path)


def delete_source(node_id):
    """Remove o fonte. Silencioso se ja nao existe."""
    try:
        source_path(node_id).unlink(missing_ok=True)
    except (OSError, ValueError):
        log.exception('Could not delete library source %s', node_id)
