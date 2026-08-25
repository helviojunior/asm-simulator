from django.urls import path, re_path
from django.views.generic import RedirectView

from asm_simulator.views.library import (
    LibraryDetailView, LibraryExportView, LibraryImportView, LibraryListView,
)
from asm_simulator.views.program import AssembleView, DisassembleView

app_name = 'asm_simulator'

favicon_view = RedirectView.as_view(url='/static/favicon.png', permanent=True)

urlpatterns = [
    re_path(r'^favicon\.ico', favicon_view),
    re_path(r'^favicon\.png', favicon_view),

    # Preparacao de programa: fonte NASM ou binario bruto -> instrucoes
    # decodificadas. A execucao acontece no interpretador do frontend.
    path('api/program/assemble/', AssembleView.as_view(), name='program-assemble'),
    path('api/program/disassemble/', DisassembleView.as_view(), name='program-disassemble'),

    # Biblioteca: pastas e arquivos .asm do aluno.
    path('api/library/', LibraryListView.as_view(), name='library-list'),
    # Antes da rota com <uuid:pk> nao e necessario (os caminhos nao colidem),
    # mas mantem as rotas de colecao juntas.
    path('api/library/export/', LibraryExportView.as_view(), name='library-export'),
    path('api/library/import/', LibraryImportView.as_view(), name='library-import'),
    path('api/library/<uuid:pk>/', LibraryDetailView.as_view(), name='library-detail'),
]
