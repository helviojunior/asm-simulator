"""Metadata de execucao por arquivo + fonte fora do banco.

O conteudo do .asm sai da coluna ``source`` e passa a viver em
``<DATA_DIR>/library/<uuid>.asm`` (ver ``services/library_storage.py``). A
migracao de dados no meio copia o que ja existe ANTES de a coluna ser removida
— sem ela, o material dos alunos ja salvo se perderia.
"""

from django.db import migrations, models


def source_to_disk(apps, schema_editor):
    from asm_simulator.services import library_storage

    LibraryNode = apps.get_model('asm_simulator', 'LibraryNode')
    for node in LibraryNode.objects.exclude(kind='folder').iterator():
        if node.source:
            library_storage.write_source(node.id, node.source)


def source_to_database(apps, schema_editor):
    """Volta o fonte para a coluna, para o caso de reverter a migracao."""
    from asm_simulator.services import library_storage

    LibraryNode = apps.get_model('asm_simulator', 'LibraryNode')
    for node in LibraryNode.objects.exclude(kind='folder').iterator():
        text = library_storage.read_source(node.id)
        if text:
            node.source = text
            node.save(update_fields=['source'])


class Migration(migrations.Migration):

    dependencies = [
        ('asm_simulator', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='librarynode',
            name='arch',
            field=models.CharField(
                choices=[('x86', 'x86 (32-bit)'), ('x86_64', 'x86-64 (64-bit)')],
                default='x86',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='librarynode',
            name='code_base',
            field=models.CharField(blank=True, default='', max_length=32),
        ),
        migrations.AddField(
            model_name='librarynode',
            name='stack_top',
            field=models.CharField(blank=True, default='', max_length=32),
        ),
        migrations.AddField(
            model_name='librarynode',
            name='arg_count',
            field=models.PositiveSmallIntegerField(default=4),
        ),
        migrations.RunPython(source_to_disk, source_to_database),
        migrations.RemoveField(
            model_name='librarynode',
            name='source',
        ),
    ]
