from django.urls import path, re_path
from django.views.generic import RedirectView

from asm_simulator.views.library import (
    LibraryDetailView, LibraryExportView, LibraryImportView, LibraryListView,
)
from asm_simulator.views.ntdll import NtdllView
from asm_simulator.views.prototypes import PrototypeListView
from asm_simulator.views.types import TypeListView
from asm_simulator.views.program import AssembleView, DisassembleView, ImportBinaryView

app_name = 'asm_simulator'

favicon_view = RedirectView.as_view(url='/static/favicon.png', permanent=True)

urlpatterns = [
    re_path(r'^favicon\.ico', favicon_view),
    re_path(r'^favicon\.png', favicon_view),

    # Preparacao de programa: fonte NASM ou binario bruto -> instrucoes
    # decodificadas. A execucao acontece no interpretador do frontend.
    path('api/program/assemble/', AssembleView.as_view(), name='program-assemble'),
    path('api/program/disassemble/', DisassembleView.as_view(), name='program-disassemble'),
    # Binario cru -> codigo-fonte editavel (o import do wizard).
    path('api/program/import/', ImportBinaryView.as_view(), name='program-import'),

    # Prototipos de TIPO: layout de struct/union, para ler um ponteiro.
    path('api/types/', TypeListView.as_view(), name='types'),

    # Prototipos das syscalls: nomes, tipos e o que cada argumento significa.
    path('api/prototypes/', PrototypeListView.as_view(), name='prototypes'),

    # ntdll.dll importada: resolve SSN -> nome no alvo Windows. VOLATIL.
    path('api/ntdll/', NtdllView.as_view(), name='ntdll'),

    # Biblioteca: pastas e arquivos .asm do aluno.
    path('api/library/', LibraryListView.as_view(), name='library-list'),
    # Antes da rota com <uuid:pk> nao e necessario (os caminhos nao colidem),
    # mas mantem as rotas de colecao juntas.
    path('api/library/export/', LibraryExportView.as_view(), name='library-export'),
    path('api/library/import/', LibraryImportView.as_view(), name='library-import'),
    path('api/library/<uuid:pk>/', LibraryDetailView.as_view(), name='library-detail'),
]
