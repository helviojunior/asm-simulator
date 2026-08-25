/**
 * Estado da CPU: registradores, flags e acesso a operandos.
 *
 * Todo valor e BigInt. Em 64 bits um endereco ou imediato passa de 2**53 e
 * Number perderia precisao em silencio — o tipo de bug que um simulador
 * didatico nao pode ter.
 *
 * Toda escrita passa por um DIARIO (journal): a cada passo registramos o que
 * mudou e qual era o valor anterior. Isso serve a duas coisas ao mesmo tempo:
 * destacar na tela o que a instrucao alterou, e desfazer o passo (algo que um
 * debugger real nao oferece, e que numa aula vale ouro).
 */

import { ARCH, CANONICAL_REGISTERS, resolveRegister } from "./registers";

export const FLAGS = ["CF", "PF", "AF", "ZF", "SF", "OF", "DF"];

const MASK = {
  1: 0xffn,
  2: 0xffffn,
  4: 0xffffffffn,
  8: 0xffffffffffffffffn,
};

const SIGN_BIT = {
  1: 0x80n,
  2: 0x8000n,
  4: 0x80000000n,
  8: 0x8000000000000000n,
};

/** Trunca para `size` bytes, sem sinal. */
export function truncate(value, size) {
  return BigInt.asUintN(size * 8, BigInt(value));
}

/** Reinterpreta `value` de `size` bytes como inteiro com sinal. */
export function toSigned(value, size) {
  return BigInt.asIntN(size * 8, BigInt(value));
}

export class Cpu {
  constructor(archId = "x86") {
    this.arch = ARCH[archId];
    if (!this.arch) throw new Error(`Unsupported architecture: ${archId}`);

    this.registers = new Map();
    CANONICAL_REGISTERS.forEach((name) => this.registers.set(name, 0n));

    this.flags = {};
    FLAGS.forEach((flag) => {
      this.flags[flag] = false;
    });

    this.journal = null;
  }

  // ------------------------------------------------------------------
  // Diario de alteracoes
  // ------------------------------------------------------------------

  beginStep() {
    this.journal = { registers: new Map(), flags: new Map(), memory: new Map() };
  }

  endStep() {
    const journal = this.journal;
    this.journal = null;
    return journal;
  }

  _recordRegister(canonical, previous) {
    if (this.journal && !this.journal.registers.has(canonical)) {
      this.journal.registers.set(canonical, previous);
    }
  }

  _recordFlag(flag, previous) {
    if (this.journal && !this.journal.flags.has(flag)) {
      this.journal.flags.set(flag, previous);
    }
  }

  // ------------------------------------------------------------------
  // Registradores
  // ------------------------------------------------------------------

  /** Le um registrador por qualquer um de seus nomes (rax, eax, ax, al, ah). */
  readRegister(name) {
    const view = resolveRegister(name);
    if (!view) throw new Error(`Unknown register: ${name}`);

    const full = this.registers.get(view.canonical) ?? 0n;
    if (view.high) return (full >> 8n) & 0xffn;
    return full & MASK[view.size];
  }

  /**
   * Escreve um registrador respeitando a largura do nome usado.
   *
   * A regra que mais surpreende: em x86-64, escrever um registrador de 32
   * bits ZERA a metade alta (`mov eax, 1` limpa os bits 32..63 de RAX),
   * enquanto escrever 8 ou 16 bits PRESERVA o resto. Nao e simetrico, e e
   * fonte classica de bug em shellcode.
   */
  writeRegister(name, value) {
    const view = resolveRegister(name);
    if (!view) throw new Error(`Unknown register: ${name}`);

    const previous = this.registers.get(view.canonical) ?? 0n;
    let next;

    if (view.high) {
      next = (previous & ~0xff00n) | ((BigInt(value) & 0xffn) << 8n);
    } else if (view.size === 4) {
      next = truncate(value, 4);
    } else if (view.size === 8) {
      next = truncate(value, 8);
    } else {
      const mask = MASK[view.size];
      next = (previous & ~mask) | (BigInt(value) & mask);
    }

    if (next !== previous) {
      this._recordRegister(view.canonical, previous);
      this.registers.set(view.canonical, next);
    }
    return next;
  }

  /** Valor canonico de 64 bits, para a UI ler sem se preocupar com views. */
  readCanonical(canonical) {
    return this.registers.get(canonical) ?? 0n;
  }

  setCanonical(canonical, value) {
    const previous = this.registers.get(canonical) ?? 0n;
    const next = truncate(value, 8);
    if (next !== previous) {
      this._recordRegister(canonical, previous);
      this.registers.set(canonical, next);
    }
  }

  // Atalhos para os tres registradores que a maquina manipula o tempo todo.
  get ip() {
    return this.readCanonical("rip");
  }

  set ip(value) {
    this.setCanonical("rip", value);
  }

  get sp() {
    return this.readRegister(this.arch.stackPointer);
  }

  set sp(value) {
    this.writeRegister(this.arch.stackPointer, value);
  }

  // ------------------------------------------------------------------
  // Flags
  // ------------------------------------------------------------------

  setFlag(flag, value) {
    const next = Boolean(value);
    if (this.flags[flag] !== next) {
      this._recordFlag(flag, this.flags[flag]);
      this.flags[flag] = next;
    }
  }

  getFlag(flag) {
    return Boolean(this.flags[flag]);
  }

  /**
   * ZF, SF e PF derivam so do resultado — CF e OF dependem da operacao e sao
   * responsabilidade de quem chamou.
   *
   * PF olha apenas o BYTE BAIXO do resultado, qualquer que seja o tamanho da
   * operacao: e herança do 8086 e costuma pegar quem estuda flags.
   */
  updateResultFlags(result, size) {
    const value = truncate(result, size);
    this.setFlag("ZF", value === 0n);
    this.setFlag("SF", (value & SIGN_BIT[size]) !== 0n);

    let parity = 0;
    let low = value & 0xffn;
    while (low) {
      parity ^= Number(low & 1n);
      low >>= 1n;
    }
    this.setFlag("PF", parity === 0);
  }

  static signBit(size) {
    return SIGN_BIT[size];
  }

  static mask(size) {
    return MASK[size];
  }
}
