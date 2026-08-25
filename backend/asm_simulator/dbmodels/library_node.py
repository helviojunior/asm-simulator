from django.db import models, transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from asm_simulator.dbmodels.base import Base
from asm_simulator.services import library_storage


class LibraryNode(Base):
    """Pasta ou arquivo .asm da biblioteca do aluno.

    Pastas e arquivos moram na MESMA tabela, ligados por `parent`. Uma arvore
    de biblioteca e rasa e pequena (dezenas de itens), entao separar em duas
    tabelas so complicaria mover um item de lugar sem ganhar nada.

    `parent` nulo marca a raiz.

    O CONTEUDO do arquivo nao esta aqui: fica em ``<DATA_DIR>/library/<id>.asm``
    (ver ``services/library_storage.py``). O banco guarda o nome, a hierarquia e
    os parametros de execucao — que sao por arquivo, e nao globais, porque um
    programa de 32 bits e um de 64 nao rodam com o mesmo layout de memoria.
    """

    class Kind(models.TextChoices):
        FOLDER = 'folder', 'Folder'
        FILE = 'file', 'File'

    class Arch(models.TextChoices):
        X86 = 'x86', 'x86 (32-bit)'
        X86_64 = 'x86_64', 'x86-64 (64-bit)'

    class Os(models.TextChoices):
        LINUX = 'linux', 'Linux'
        WINDOWS = 'windows', 'Windows'
        MACOS = 'macos', 'macOS'

    parent = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='children',
    )
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.FILE)
    name = models.CharField(max_length=255)

    # --- Parametros de execucao (metadata do arquivo) ----------------------
    # Os enderecos ficam como TEXTO, na notacao que o aluno digitou
    # ("0x7F200100"). Um inteiro perderia a forma original e, em 64 bits,
    # esbarraria no limite do inteiro com sinal do SQLite.
    arch = models.CharField(max_length=16, choices=Arch.choices, default=Arch.X86)
    # Sistema ALVO. Vazio = ainda nao resolvido — o numero de uma syscall
    # pertence ao sistema, nao a arquitetura (`write` e 4 no int 0x80 do Linux
    # e 0x2000004 no macOS), entao sem isso nao da para ler o programa.
    os = models.CharField(max_length=16, choices=Os.choices, blank=True, default='')
    code_base = models.CharField(max_length=32, blank=True, default='')
    stack_top = models.CharField(max_length=32, blank=True, default='')
    # Quantas posicoes de argumento inspecionar num `call`.
    arg_count = models.PositiveSmallIntegerField(default=4)

    class Meta:
        verbose_name = 'Library node'
        verbose_name_plural = 'Library nodes'
        ordering = ['name']

    def __str__(self):
        return f'{self.name}{"/" if self.kind == self.Kind.FOLDER else ""}'

    @property
    def is_folder(self):
        return self.kind == self.Kind.FOLDER

    # --- Fonte em disco ----------------------------------------------------

    @property
    def source(self):
        """Conteudo do .asm. Pasta nao tem fonte."""
        return '' if self.is_folder else library_storage.read_source(self.pk)

    @source.setter
    def source(self, text):
        if self.is_folder:
            return
        library_storage.write_source(self.pk, text)

    @property
    def source_path(self):
        """Caminho do arquivo em disco — util no admin e no diagnostico."""
        return '' if self.is_folder else str(library_storage.source_path(self.pk))


@receiver(post_delete, sender=LibraryNode)
def _delete_source_file(sender, instance, **kwargs):
    """Apaga o .asm junto com o registro.

    Via sinal, e nao sobrescrevendo ``delete()``: apagar uma PASTA remove os
    filhos por CASCADE, que nao passa pelo ``delete()`` de cada objeto — mas
    emite ``post_delete`` para todos.

    So DEPOIS do commit: ``post_delete`` dispara dentro da transacao, e um
    rollback devolveria a linha ao banco com o arquivo ja apagado do disco.
    """
    if instance.is_folder:
        return
    # O id vai por valor: depois do delete o Django zera `instance.pk`, e um
    # lambda que so o lesse no commit receberia None.
    transaction.on_commit(lambda node_id=instance.pk: library_storage.delete_source(node_id))
