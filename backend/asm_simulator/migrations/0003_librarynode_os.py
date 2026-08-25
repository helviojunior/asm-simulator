"""Sistema ALVO do programa.

Vazio nos arquivos ja existentes: eles foram salvos antes de o alvo existir, e
o frontend o resolve (detectando ou perguntando) na proxima montagem. Um
default 'linux' aqui marcaria como Linux material que pode nao ser.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('asm_simulator', '0002_library_metadata_and_source_files'),
    ]

    operations = [
        migrations.AddField(
            model_name='librarynode',
            name='os',
            field=models.CharField(blank=True, choices=[('linux', 'Linux'), ('windows', 'Windows'), ('macos', 'macOS')], default='', max_length=16),
        ),
    ]
