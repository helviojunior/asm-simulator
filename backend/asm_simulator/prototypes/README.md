# Protótipos de system call

Um arquivo YAML por função, agrupado por **alvo** — a combinação de sistema
operacional e arquitetura:

    prototypes/
      linux-x86/          int 0x80, números de 32 bits
      linux-x86_64/       syscall, números de 64 bits
      windows-x86_64/     syscall, SSN não fixo

A separação por alvo não é organizacional, é semântica: o mesmo `write` é a
syscall **4** no `int 0x80` do Linux e a **1** no `syscall` de 64 bits. São
funções diferentes, com o mesmo nome, em tabelas diferentes.

O **nome do arquivo é o nome da função** — é assim que o carregador o encontra,
sem precisar de um índice à parte que possa sair de sincronia.

## Layout

```yaml
function_name: write        # igual ao nome do arquivo
kind: syscall               # syscall (padrão) | function — ver abaixo
library: null               # obrigatório quando kind é function ("kernel32.dll")
ssn: 4                      # null no Windows: o número muda entre builds
summary: "..."              # uma linha sobre o que a função faz
input_args:
  arg0:
    type: "int"
    name: "fd"
    direction: "in"     # opcional: in | out | inout, com sufixo /opt
    description: "..."
  arg1: ...
output_data:
  type: "ssize_t"
  name: "written"
  description: "..."
```

`input_args` é um **mapa** `arg0`, `arg1`, … e não uma lista: a posição do
argumento é o que importa (é ela que decide o registrador em que ele viaja), e
como chave ela fica explícita em vez de implícita na ordem do arquivo.

Função sem argumentos usa `input_args: {}`.

## `direction`

Opcional, e presente nos protótipos do Windows. Diz o que o nome do parâmetro
sozinho não diz — `BaseAddress` no `NtAllocateVirtualMemory` **entra e sai**, e
`OldProtection` é só saída. O sufixo `/opt` marca o que aceita `NULL`.

Nos protótipos do Linux não aparece: a convenção de syscall do Linux não tem
parâmetro de saída por ponteiro no mesmo sentido, e o retorno já é um valor.

## De onde vêm as assinaturas do Windows

Tipos, nomes e direção foram conferidos contra os headers do projeto
[phnt](https://github.com/winsiderss/phnt) (MIT), do System Informer — a
referência prática para a API nativa, que a Microsoft não documenta por
completo. Cada arquivo aponta em comentário o header de onde veio.

O header dá o **fato**; a descrição de cada argumento é escrita aqui, porque é
justamente o que ele não tem e o que serve numa aula.

As 773 syscalls `NTSYSCALLAPI` do phnt estão aqui.

## `kind`: nem tudo na ntdll entra no kernel

`NtCreateFile` é um stub com `syscall` dentro; `RtlInitUnicodeString` roda
inteiro em modo usuário e **nunca** tem SSN. São duas coisas diferentes e o
campo `kind` as separa:

| `kind` | o que é | onde aparece na interface |
|---|---|---|
| `syscall` (padrão) | entra no kernel | painel de `syscall`, resolvido pelo número em RAX |
| `function` | modo usuário (`Rtl*`, `Ldr*`) | painel de `call`, nomeado pelo aluno |

O carregador **recusa** um `kind: function` com `ssn` preenchido: o número só
existe para quem cruza a fronteira do kernel, e exibi-lo convidaria a chamar um
`Rtl*` por `syscall`.

A API filtra com `?kind=syscall` (ou `function`); sem o parâmetro vêm os dois —
é o que o painel de `call` usa, onde tanto o stub `Nt*` quanto a função de modo
usuário são alvos legítimos.

### `library`: de qual DLL sai a função

Toda função `kind: function` **precisa** dizer o módulo que a exporta — o
carregador recusa uma que não diga. No Windows, achar a base do módulo e
resolver o export dele é o passo *anterior* à chamada; um nome solto não diz
onde procurar. É o que o auto-completar mostra ao lado do nome, no lugar do
número que a syscall tem.

As `Rtl*`/`Ldr*` (`ntdll.dll`) são as usadas pelos samples do livro *Windows
Native API* (zodiacon/winnativeapibooksamples): heap, zona de memória,
UNICODE_STRING, criação de processo e thread, privilégio, SID, security
descriptor, tempo e resolução de export. Assinaturas do `ntrtl.h` e do
`ntldr.h` do phnt.

Além delas, a **API do Windows** propriamente dita, com assinatura da
documentação da Microsoft:

| `library` | funções |
|---|---|
| `kernel32.dll` | `CreateProcessA`, `ExitProcess`, `LoadLibraryA`, `WaitForSingleObject`, `WinExec` |
| `ws2_32.dll` | `WSAStartup`, `WSASocketA`, `bind`, `WSAConnect` |

Ficam **fora** o que não é função exportada: `RtlProcessHeap` é macro para
`NtCurrentPeb()->ProcessHeap`, `RtlConvertUlongToLuid` é `FORCEINLINE` no
header, e `NtCurrentProcess`/`NtCurrentThread` e companhia são pseudo-handles.
Um protótipo para eles anunciaria uma chamada que não acontece.

## De onde vêm as assinaturas do Linux

O **número** vem de `/usr/include/x86_64-linux-gnu/asm/unistd_64.h` e
`unistd_32.h` — 362 e 440 chamadas. A **assinatura** vem do `man 2`, quando a
página existe: 250 e 261 delas. As demais têm só o número, e o arquivo diz isso
em comentário.

## Tipos (`types/`)

Structs e unions, um arquivo por tipo, no mesmo agrupamento por alvo:

    prototypes/types/
      linux-x86/
      linux-x86_64/
      windows-x86_64/

```yaml
type_name: OBJECT_ATTRIBUTES
kind: struct
size: 48                 # bytes
align: 8
fields:
  field0:
    type: "ULONG"
    name: "Length"
    offset: 0            # em bytes, a partir do início da struct
    size: 4
    description: "..."
  field1:
    type: "HANDLE"
    name: "RootDirectory"
    offset: 8            # 8, e não 4: o compilador insere preenchimento
    size: 8
```

Um campo pode ter `fields` próprios — é como um bloco anônimo (a union dentro
do `IO_STATUS_BLOCK`) aparece: mesmo endereço da struct, campos como filhos.

`kind` aceita `struct`, `union` e `enum`. O `enum` é um caso de borda honesto:
não tem campo nenhum, então entra como **um** campo de 4 bytes no offset 0,
cuja descrição lista os valores possíveis (ver `MEMORY_RESERVE_OBJECT_TYPE`).

### `variants`: tipo genérico que só se resolve lendo um campo

`sockaddr` não diz nada sozinho: os 14 bytes de `sa_data` só tomam forma depois
de ler a família. Ler o genérico esconderia justamente a porta e o IP. O bloco
`variants` diz qual campo decide e para que tipo cada valor leva:

```yaml
type_name: sockaddr
variants:
  field: sa_family
  cases:
    1: sockaddr_un
    2: sockaddr_in
    10: sockaddr_in6
```

O painel lê o campo na memória e abre o layout derivado, mostrando
`sockaddr → sockaddr_in` no cabeçalho — o desvio é dito, não silencioso. Valor
fora do mapa mantém o genérico, que diz menos mas não inventa.

Os números **mudam por sistema** — `AF_INET6` é 10 no Linux e 23 no Windows —,
e é por isso que o mapa vive no arquivo do alvo e não no código. O carregador
recusa um `field` que não exista na struct, e a suíte confere que todo tipo
citado em `cases` existe naquele alvo.

### Ponteiro para o tipo

`PFOO`, `PCFOO`, `LPFOO` e `const FOO*` são o **mesmo layout**: o carregador
tira o prefixo e acha `FOO`. Por isso um argumento declarado
`LPSTARTUPINFOA` abre o painel de estrutura com o `STARTUPINFOA` do catálogo.

### PEB e TEB são RECORTADOS

O `TEB` real passa de 6 KB e o `PEB` de 1900 bytes, e a maior parte desses
campos muda de posição a cada versão do Windows. O catálogo traz o **prefixo
estável** de cada um — `TEB` até `FpSoftwareStatusRegister` (0x10C) e `PEB` até
`NtGlobalFlag` (0xBC), que é onde estão os campos que uma aula usa
(`ProcessEnvironmentBlock`, `ClientId`, `Ldr`, `ProcessHeap`, `BeingDebugged`).
O corte está dito no `summary` de cada um, para ninguém ler o fim da struct
como se fosse o fim do objeto.

`offset` e `size` não são documentação, são o que **lê a memória**. Um erro aqui
não aparece como falha: aparece como um campo mostrando o byte errado, com toda
a aparência de estar certo. Por isso o carregador recusa um campo que termine
depois do fim do tipo, e a suíte confere os tamanhos contra valores conhecidos.

### De onde vêm os offsets

| alvo | como |
|---|---|
| Linux (32 e 64) | medidos pelo **compilador**, com `offsetof` e `-m32`/`-m64` |
| Win32 (`STARTUPINFOW`, `WSADATA`…) | medidos pelo **mingw**, mesma técnica |
| Native API (phnt) | **calculados** pelas regras de alinhamento do x86-64 |

Os do phnt são calculados porque ele não compila fora do SDK da Microsoft (usa
sufixos literais do MSVC). O cálculo é conferido contra tamanhos conhecidos —
`OBJECT_ATTRIBUTES` 48, `UNICODE_STRING` 16, `IO_STATUS_BLOCK` 16 — e a suíte
falha se uma regra de alinhamento sair errada.

Os tipos do **PEB/TEB e do carregador** não são calculados: são medidos. As
structs foram reescritas em C portável e impressas com `offsetof` — ver
`types/probes/`, que traz as duas sondas (mingw para os tipos do SDK, gcc para
os do phnt) e o comando para rodar cada uma.

O mesmo tipo pode ter layouts diferentes por arquitetura: `iovec` tem 16 bytes
em 64 bits e 8 em 32. Por isso o agrupamento por alvo vale aqui também.

## `TODO:` no cabeçalho

Marca o que ainda não passou por revisão humana: o resumo está vazio e as
descrições foram derivadas do tipo e do nome do parâmetro — exatas, mas
genéricas. É o que permite achar depois o que falta escrever:

```bash
grep -rl 'TODO:' prototypes/ | wc -l
```

Um arquivo revisado perde a marca ao ganhar `summary`. Os geradores preservam
todo texto escrito à mão, então regenerar a partir de uma versão nova dos
headers não desfaz revisão nenhuma.

## Por que `ssn: null` no Windows

O Windows não tem número de syscall estável: o SSN de `NtCreateFile` muda entre
versões e até entre builds. Fixar um aqui ensinaria errado. O número vem da
`ntdll.dll` da máquina que se está estudando, importada em tempo de execução
(ver `services/ntdll.py`) — o protótipo contribui com o resto: nomes, tipos e o
que cada argumento significa.

## Ao adicionar um protótipo

O carregador valida a forma de todo arquivo do diretório, e há teste que
percorre os três alvos. Um `arg2` sem `arg1`, um nome que não bate com o
arquivo ou um campo faltando falham a suíte — não passam despercebidos.
