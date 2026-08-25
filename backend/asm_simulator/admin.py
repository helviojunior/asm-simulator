"""Registros do Django admin.

O admin e a ferramenta de manutencao de dados do projeto e entra sempre
autenticado como o usuario padrao (ver ``middleware.AdminAutoLoginMiddleware``).
"""

from django.contrib import admin

from asm_simulator.models import LibraryNode


@admin.register(LibraryNode)
class LibraryNodeAdmin(admin.ModelAdmin):
    list_display = ('name', 'kind', 'parent', 'arch', 'updated')
    list_filter = ('kind', 'arch')
    # `source` fica de fora da busca: nao e mais coluna do banco — o conteudo
    # esta em <DATA_DIR>/library/<id>.asm.
    search_fields = ('name',)
    autocomplete_fields = ('parent',)
    ordering = ('kind', 'name')
    readonly_fields = ('source_path',)
    fieldsets = (
        (None, {'fields': ('parent', 'kind', 'name', 'enabled')}),
        ('Execution parameters', {'fields': ('arch', 'code_base', 'stack_top', 'arg_count')}),
        ('Source file', {'fields': ('source_path',)}),
    )
