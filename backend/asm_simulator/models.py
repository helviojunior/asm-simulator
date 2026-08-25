"""Modelos de dominio do ASMSimulator.

O projeto e 100% publico: nao ha User customizado, Company nem
permissionamento. O ``django.contrib.auth.User`` padrao existe apenas para
sustentar o Django admin (ver ``middleware.AdminAutoLoginMiddleware``).

Novos modelos herdam de ``dbmodels.base.Base``, que ja traz id UUID, created,
updated e enabled.
"""

__all__ = ['Base', 'LibraryNode']

from asm_simulator.dbmodels.base import Base  # noqa: F401
from asm_simulator.dbmodels.library_node import LibraryNode  # noqa: F401
