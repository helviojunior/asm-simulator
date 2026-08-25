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

## De onde vêm as assinaturas do Linux

O **número** vem de `/usr/include/x86_64-linux-gnu/asm/unistd_64.h` e
`unistd_32.h` — 362 e 440 chamadas. A **assinatura** vem do `man 2`, quando a
página existe: 250 e 261 delas. As demais têm só o número, e o arquivo diz isso
em comentário.

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
