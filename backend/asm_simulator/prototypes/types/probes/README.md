# Sondas de layout

Os `offset` e `size` dos tipos **não são documentação**: são o que lê a memória
no painel de estrutura. Um valor errado aqui não aparece como falha — aparece
como um campo mostrando o byte errado, com toda a aparência de estar certo.

Por isso cada layout é **medido pelo compilador**, e a medição fica aqui para
poder ser refeita.

## `win32.c` — tipos da API do Windows

Declarados pelos próprios headers do SDK, via mingw. São `_Static_assert`: um
valor errado **não compila**.

```bash
docker run --rm -v "$PWD":/w -w /w debian:bookworm-slim sh -c \
  "apt-get update -qq && apt-get install -y -qq gcc-mingw-w64-x86-64 && \
   x86_64-w64-mingw32-gcc -c win32.c -o /tmp/win32.o && echo LAYOUT_OK"
```

## `ntpebteb.c` — PEB, TEB e o carregador

O phnt não compila fora do SDK da Microsoft, então as structs são reescritas
aqui em C portável e **impressas** com `offsetof`. Rodam em Linux x86-64: as
regras de alinhamento do SysV e do MS x64 são as mesmas para estes campos —
nenhum deles é `long`, que é o único tipo cujo tamanho difere entre os dois.

```bash
docker run --rm -v "$PWD":/w -w /w debian:bookworm-slim sh -c \
  "apt-get update -qq && apt-get install -y -qq gcc && \
   gcc -O0 -o /tmp/probe ntpebteb.c && /tmp/probe"
```

A saída é `TIPO|campo|offset`, uma linha por campo — é dela que os YAML foram
gerados. Os tamanhos conhecidos servem de conferência: `NT_TIB` 56,
`PEB_LDR_DATA` 88, `LDR_MODULE` 136, `LDR_DATA_TABLE_ENTRY` 312,
`GDI_TEB_BATCH` 1256.
