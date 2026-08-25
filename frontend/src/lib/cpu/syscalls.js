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
 * Convencao e numeros de cada arquitetura.
 *
 * Os numeros mudam entre 32 e 64 bits — `write` e 4 em `int 0x80` e 1 em
 * `syscall`. E uma das confusoes mais comuns de quem escreve shellcode.
 */
export const SYSCALL_ABI = {
  x86: {
    numberRegister: "eax",
    returnRegister: "eax",
    argumentRegisters: ["ebx", "ecx", "edx", "esi", "edi", "ebp"],
    // /usr/include/x86_64-linux-gnu/asm/unistd_32.h
    names: {
      1: "exit", 2: "fork", 3: "read", 4: "write", 5: "open", 6: "close",
      11: "execve", 20: "getpid", 37: "kill", 45: "brk", 91: "munmap",
      102: "socketcall", 122: "uname", 125: "mprotect", 192: "mmap2",
    },
  },
  x86_64: {
    numberRegister: "rax",
    returnRegister: "rax",
    argumentRegisters: ["rdi", "rsi", "rdx", "r10", "r8", "r9"],
    // /usr/include/x86_64-linux-gnu/asm/unistd_64.h
    names: {
      0: "read", 1: "write", 2: "open", 3: "close", 9: "mmap", 10: "mprotect",
      11: "munmap", 12: "brk", 39: "getpid", 41: "socket", 42: "connect",
      57: "fork", 59: "execve", 60: "exit", 62: "kill", 231: "exit_group",
    },
  },
};

/**
 * Executa a syscall indicada pelos registradores atuais.
 *
 * Devolve `{ halt }` quando o programa deve parar, ou undefined quando a
 * chamada foi atendida e a execucao segue.
 */
export function performSyscall(machine, { via }) {
  const abi = SYSCALL_ABI[machine.archId];
  const number = Number(machine.cpu.readRegister(abi.numberRegister));
  const name = abi.names[number];
  const args = abi.argumentRegisters.map((register) => machine.cpu.readRegister(register));

  // exit_group se comporta como exit para o que simulamos aqui.
  const handler = HANDLERS[name === "exit_group" ? "exit" : name];

  if (!handler) {
    return {
      halt: {
        reason: HALT.SYSCALL,
        message: `${via}: ${name || `syscall ${number}`}(${args
          .slice(0, 3)
          .map((value) => `0x${value.toString(16)}`)
          .join(", ")}) — ${name ? "not simulated" : "unknown"}`,
        syscall: name || String(number),
      },
    };
  }

  const result = handler(machine, args);
  if (result.halt) return { halt: result.halt };

  machine.cpu.writeRegister(abi.returnRegister, result.value);
  return undefined;
}
