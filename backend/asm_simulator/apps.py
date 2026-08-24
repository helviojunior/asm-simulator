from django.apps import AppConfig


class AsmSimulatorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'asm_simulator'
    app_name = 'asm_simulator'
    verbose_name = "ASMSimulator"

    def ready(self):
        # Import tardio para evitar import circular
        from .startup import on_startup
        on_startup()


def after_migrate(**kwargs):
    # Aqui o BD já está migrado
    # e você pode criar dados iniciais de forma idempotente
    from django.contrib.auth.models import Group
    Group.objects.get_or_create(name="Padrão")
