/**
 * Simulacao das chamadas de sistema do Linux.
 *
 * Nao ha kernel aqui: cada syscall e reproduzida em JavaScript sobre o estado
 * simulado. `write` copia bytes da memoria para um console proprio, `exit`
 * encerra o programa, e assim por diante — o aluno ve o efeito do shellcode
 * sem que nada saia da aba do navegador.
 *
 * O que NAO tem efeito plausivel de simular (abrir arquivo real, criar socket,
 * trocar a imagem do processo) para com uma mensagem que mostra os argumentos
 * ja resolvidos. Fingir um retorno ali ensinaria algo falso.
 */

import { HALT } from "./halt";

/** Le uma string terminada em NUL a partir de `address`. */
function readCString(machine, address, limit = 4096) {
  let out = "";
  for (let i = 0; i < limit; i += 1) {
    const byte = machine.memory.readByte(BigInt(address) + BigInt(i));
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Le `count` bytes crus e devolve como texto (bytes altos viram escapes). */
function readBuffer(machine, address, count) {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const byte = machine.memory.readByte(BigInt(address) + BigInt(i));
    out += byte >= 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0d
      ? String.fromCharCode(byte)
      : `\\x${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** Le um vetor de ponteiros para string terminado em NULL (argv/envp). */
function readStringArray(machine, address, limit = 16) {
  if (BigInt(address) === 0n) return [];
  const size = machine.arch.wordSize;
  const items = [];
  for (let i = 0; i < limit; i += 1) {
    const pointer = machine.readMemory(BigInt(address) + BigInt(i * size), size);
    if (pointer === 0n) break;
    items.push(readCString(machine, pointer));
  }
  return items;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * write(fd, buf, count) — o efeito visivel da maioria dos exercicios.
 *
 * Copia exatamente `count` bytes: se o programa pedir um byte a mais que o
 * texto, o lixo aparece no console, que e justamente o que se quer enxergar.
 */
function sysWrite(machine, [fd, buf, count]) {
  const length = Number(count);
  const written = Math.max(0, Math.min(length, 65536));
  const text = readBuffer(machine, buf, written);
  // O texto exibido leva escapes (`\x01` sao 4 caracteres para UM byte), entao
  // a contagem de bytes vai a parte — senao o painel reportaria um tamanho
  // maior do que o programa realmente escreveu.
  machine.writeOutput(Number(fd), text, written);
  return { value: BigInt(length) };
}

/** read(fd, buf, count) — sem entrada ligada, devolve EOF. */
function sysRead() {
  return { value: 0n };
}

/** exit(code) / exit_group(code) — fim normal do programa. */
function sysExit(machine, [code]) {
  return {
    halt: {
      reason: HALT.EXITED,
      message: `exit(${BigInt.asIntN(32, BigInt(code))})`,
      exitCode: Number(BigInt.asIntN(32, BigInt(code))),
    },
  };
}

/**
 * execve(path, argv, envp) — o objetivo classico de um shellcode.
 *
 * Trocar a imagem do processo nao tem equivalente simulavel; o que importa
 * didaticamente e mostrar que o shellcode chegou aqui e COM QUE argumentos.
 */
function sysExecve(machine, [path, argv]) {
  const program = readCString(machine, path);
  const args = readStringArray(machine, argv);
  return {
    halt: {
      reason: HALT.EXECVE,
      message: `execve("${program}", [${args.map((a) => `"${a}"`).join(", ")}])`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tabelas por arquitetura
// ---------------------------------------------------------------------------

const HANDLERS = { write: sysWrite, read: sysRead, exit: sysExit, execve: sysExecve };

/**
 * Syscalls que este simulador REPRODUZ. As demais param a execucao.
 *
 * Derivado de HANDLERS para nao divergir dele: uma syscall nova ganha handler e
 * aparece aqui sozinha. `exit_group` entra a parte porque compartilha o handler
 * de `exit`.
 */
export const SIMULATED_SYSCALLS = new Set([...Object.keys(HANDLERS), 'exit_group']);

/**
 * Nome dos parametros de cada syscall.
 *
 * Um painel que dissesse "arg0 = 0x7F200123" nao ensina nada; "buf" diz que
 * aquele numero e um ponteiro e o que ha do outro lado importa. Sao os
 * prototipos do Linux, na ordem em que ocupam os registradores.
 */
/**
 * Numeros BSD, usados pelo macOS (derivados do 4.4BSD via XNU).
 *
 * Em 64 bits eles vao somados a classe UNIX (0x2000000); em 32 bits, crus.
 */
const BSD_NAMES = {
  1: 'exit', 2: 'fork', 3: 'read', 4: 'write', 5: 'open', 6: 'close',
  20: 'getpid', 33: 'access', 37: 'kill', 59: 'execve', 73: 'munmap',
  74: 'mprotect', 197: 'mmap',
};

/**
 * Windows nao tem numero de syscall ESTAVEL.
 *
 * O SSN de `NtCreateFile` muda entre versoes e ate entre builds do mesmo
 * Windows, e o caminho normal nem passa por `syscall` — passa pelas DLLs
 * (kernel32 -> ntdll). Resolver numero para nome aqui seria inventar: o painel
 * mostra o numero e diz por que nao ha nome, em vez de mentir com confianca.
 */
const WINDOWS_ABI = {
  resolvable: false,
  argumentsOn: 'registers',
  // Convencao do `syscall` do Windows x64; em 32 bits o caminho e outro, mas
  // os registradores servem de referencia ao aluno de qualquer forma.
  argumentRegisters: ['r10', 'rdx', 'r8', 'r9'],
  // Do quinto argumento em diante o Windows os passa pela PILHA, depois dos 32
  // bytes de shadow space que o chamador reserva. Sem isto o painel parava no
  // quarto, como se a chamada nao pudesse ter mais.
  stackOffset: 0x20,
  table: 'Windows (SSN varia por build)',
  names: {},
};

export const SYSCALL_SIGNATURES = {
  read: ["fd", "buf", "count"],
  write: ["fd", "buf", "count"],
  open: ["pathname", "flags", "mode"],
  close: ["fd"],
  execve: ["pathname", "argv", "envp"],
  exit: ["status"],
  exit_group: ["status"],
  fork: [],
  getpid: [],
  kill: ["pid", "sig"],
  brk: ["addr"],
  mmap: ["addr", "length", "prot", "flags", "fd", "offset"],
  mmap2: ["addr", "length", "prot", "flags", "fd", "pgoffset"],
  mprotect: ["addr", "len", "prot"],
  munmap: ["addr", "length"],
  socket: ["domain", "type", "protocol"],
  connect: ["sockfd", "addr", "addrlen"],
  socketcall: ["call", "args"],
  uname: ["buf"],
};

/**
 * Convencao e numeros de cada combinacao SISTEMA + arquitetura.
 *
 * O numero de uma syscall nao pertence a arquitetura, e ao sistema: `write` e
 * 4 no `int 0x80` do Linux, 1 no `syscall` do Linux de 64 bits e 0x2000004 no
 * macOS. E uma das confusoes mais comuns de quem escreve shellcode, e por isso
 * o alvo e uma informacao de primeira classe aqui.
 */
export const SYSCALL_ABI = {
  linux: {
    x86: {
      numberRegister: 'eax',
      returnRegister: 'eax',
      argumentsOn: 'registers',
      argumentRegisters: ['ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp'],
      table: 'Linux i386 (int 0x80)',
      // Punhado de numeros que resolve ANTES de a lista do servidor chegar. A
      // tabela completa (as 440 do unistd_32.h) vem do catalogo de prototipos,
      // por `syscallNameByNumber` — manter as 440 aqui seria uma segunda copia
      // para sair de sincronia com a primeira.
      names: {
        1: 'exit', 2: 'fork', 3: 'read', 4: 'write', 5: 'open', 6: 'close',
        11: 'execve', 20: 'getpid', 37: 'kill', 45: 'brk', 91: 'munmap',
        102: 'socketcall', 122: 'uname', 125: 'mprotect', 192: 'mmap2',
      },
    },
    x86_64: {
      numberRegister: 'rax',
      returnRegister: 'rax',
      argumentsOn: 'registers',
      argumentRegisters: ['rdi', 'rsi', 'rdx', 'r10', 'r8', 'r9'],
      table: 'Linux x86-64 (syscall)',
      // Idem: o resto das 362 do unistd_64.h vem do catalogo de prototipos.
      names: {
        0: 'read', 1: 'write', 2: 'open', 3: 'close', 9: 'mmap', 10: 'mprotect',
        11: 'munmap', 12: 'brk', 39: 'getpid', 41: 'socket', 42: 'connect',
        57: 'fork', 59: 'execve', 60: 'exit', 62: 'kill', 231: 'exit_group',
      },
    },
  },

  macos: {
    x86: {
      numberRegister: 'eax',
      returnRegister: 'eax',
      // BSD de 32 bits passa argumento na PILHA, nao em registrador — e a
      // convencao C de sempre, com o `int 0x80` no lugar do `call`.
      argumentsOn: 'stack',
      stackOffset: 4,
      argumentRegisters: [],
      table: 'macOS i386 (int 0x80, BSD)',
      names: BSD_NAMES,
    },
    x86_64: {
      numberRegister: 'rax',
      returnRegister: 'rax',
      argumentsOn: 'registers',
      argumentRegisters: ['rdi', 'rsi', 'rdx', 'r10', 'r8', 'r9'],
      // O XNU divide as chamadas em classes, e a UNIX e a 2: o numero vai com
      // 0x2000000 somado. `mov rax, 0x2000004` e write, nao a syscall 33554436.
      classMask: 0x2000000,
      table: 'macOS x86-64 (syscall, classe UNIX)',
      names: BSD_NAMES,
    },
  },

  windows: {
    x86: { ...WINDOWS_ABI, numberRegister: 'eax', returnRegister: 'eax' },
    x86_64: { ...WINDOWS_ABI, numberRegister: 'rax', returnRegister: 'rax' },
  },
};

/** ABI do alvo, com o Linux como ultimo recurso. */
export function syscallAbi(osId, archId) {
  const forOs = SYSCALL_ABI[osId] || SYSCALL_ABI.linux;
  return forOs[archId] || SYSCALL_ABI.linux[archId];
}

/**
 * Executa a syscall indicada pelos registradores atuais.
 *
 * Devolve `{ halt }` quando o programa deve parar, ou undefined quando a
 * chamada foi atendida e a execucao segue.
 */
export function performSyscall(machine, { via }) {
  const abi = syscallAbi(machine.osId, machine.archId);
  const raw = Number(machine.cpu.readRegister(abi.numberRegister));

  if (abi.resolvable === false) {
    return {
      unsimulated: {
        via,
        number: raw,
        name: null,
        reason: 'windows',
        text: `${via}: SSN 0x${raw.toString(16)}`,
      },
    };
  }

  const number = syscallNumber(abi, raw);
  const name = abi.names[number];
  const args = readArguments(machine, abi);

  // exit_group se comporta como exit para o que simulamos aqui.
  const handler = HANDLERS[name === "exit_group" ? "exit" : name];

  if (!handler) {
    // NAO e parada. Nao ter simulacao para `open` nao torna o resto do
    // programa inexecutavel — e quase sempre o que vem DEPOIS que interessa na
    // aula. A chamada passa direto e a interface avisa; o unico efeito que
    // deixa de acontecer e o retorno, que nao temos como inventar.
    return {
      unsimulated: {
        via,
        number,
        name: name || null,
        reason: name ? 'notSimulated' : 'unknown',
        text: `${via}: ${name || `syscall ${number}`}(${args
          .slice(0, 3)
          .map((value) => `0x${value.toString(16)}`)
          .join(", ")})`,
      },
    };
  }

  const result = handler(machine, args);
  // `exit` e `execve` acabam o programa: a parada ja fala por si, e um aviso
  // sobre "o retorno nao e real" nao faz sentido onde nao ha retorno.
  if (result.halt) return { halt: result.halt };

  machine.cpu.writeRegister(abi.returnRegister, result.value);

  // Reproduzida, sim — mas por um MODELO. O valor que ficou no registrador e
  // convencao nossa, e quem o le em seguida precisa saber disso: aqui todo
  // `write` "da certo" e todo `read` devolve fim de arquivo, o que num sistema
  // de verdade dependeria do descritor, da permissao e do que ha do outro lado.
  return {
    simulated: {
      via,
      number,
      name,
      returnRegister: abi.returnRegister,
      value: result.value,
      text: `${via}: ${name}(${args
        .slice(0, 3)
        .map((value) => `0x${value.toString(16)}`)
        .join(", ")})`,
    },
  };
}


/** Numero efetivo: no macOS de 64 bits a classe UNIX sai do valor. */
export function syscallNumber(abi, raw) {
  const value = Number(raw);
  return abi.classMask ? value & ~abi.classMask : value;
}

/**
 * De onde vem o argumento de indice `index`, e o que ha nele.
 *
 * Toda ABI aqui e hibrida: gasta os registradores de argumento e, do proximo em
 * diante, le da pilha. Tratar os dois casos num lugar so e o que impede o
 * painel de parar no ultimo registrador — que na tabela do Windows sao quatro.
 */
export function argumentSlot(machine, abi, index) {
  const size = machine.arch.wordSize;
  const registers = abi.argumentsOn === 'stack' ? [] : abi.argumentRegisters;

  if (index < registers.length) {
    const register = registers[index];
    return {
      source: register.toUpperCase(),
      register,
      value: machine.cpu.readRegister(register),
    };
  }

  const offset = (abi.stackOffset || 0) + (index - registers.length) * size;
  const address = machine.cpu.sp + BigInt(offset);
  const pointer = machine.arch.stackPointer.toUpperCase();
  return {
    source: `[${pointer}${offset ? `+0x${offset.toString(16).toUpperCase()}` : ''}]`,
    address,
    value: machine.readMemory(address, size),
  };
}

/** Valores dos `count` primeiros argumentos, na ordem. */
export function readArguments(machine, abi, count = 6) {
  return Array.from({ length: count }, (_, index) =>
    argumentSlot(machine, abi, index).value);
}
