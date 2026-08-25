/**
 * Semantica das instrucoes suportadas.
 *
 * Cada funcao recebe (machine, insn) e aplica o EFEITO da instrucao sobre o
 * estado simulado. Nenhuma delas gera ou executa codigo de maquina.
 *
 * Convencao de retorno:
 *   undefined        -> instrucao normal; a maquina avanca o RIP sozinha
 *   { jumped: true } -> a instrucao ja escreveu o RIP (salto, call, ret)
 *   { halt: {...} }  -> parada anotada (syscall, divisao por zero, ...)
 */

import { Cpu, toSigned, truncate } from "./cpu";
import { HALT, MachineHalt } from "./halt";

// ---------------------------------------------------------------------------
// Flags aritmeticas
// ---------------------------------------------------------------------------

/**
 * AF (auxiliary carry) e o "vai um" do nibble baixo, usado pelas instrucoes
 * de BCD. A conta e a mesma para soma e subtracao.
 */
function auxiliaryCarry(a, b, result) {
  return ((a ^ b ^ result) & 0x10n) !== 0n;
}

function applyAdd(cpu, a, b, size, carryIn = 0n) {
  const mask = Cpu.mask(size);
  const sign = Cpu.signBit(size);
  const full = (a & mask) + (b & mask) + carryIn;
  const result = full & mask;

  cpu.setFlag("CF", full > mask);
  // Overflow com sinal: so acontece quando os operandos tem o MESMO sinal e o
  // resultado sai com sinal diferente. E o que distingue OF de CF.
  cpu.setFlag(
    "OF",
    ((a & sign) === (b & sign)) && ((result & sign) !== (a & sign))
  );
  cpu.setFlag("AF", auxiliaryCarry(a, b, result));
  cpu.updateResultFlags(result, size);
  return result;
}

function applySub(cpu, a, b, size, borrowIn = 0n) {
  const mask = Cpu.mask(size);
  const sign = Cpu.signBit(size);
  const result = (a - b - borrowIn) & mask;

  cpu.setFlag("CF", (a & mask) < (b & mask) + borrowIn);
  cpu.setFlag(
    "OF",
    ((a & sign) !== (b & sign)) && ((result & sign) !== (a & sign))
  );
  cpu.setFlag("AF", auxiliaryCarry(a, b, result));
  cpu.updateResultFlags(result, size);
  return result;
}

function applyLogic(cpu, result, size) {
  // Operacoes logicas zeram CF e OF por definicao; AF fica indefinida na
  // arquitetura e aqui a zeramos para o estado ser reproduzivel.
  cpu.setFlag("CF", false);
  cpu.setFlag("OF", false);
  cpu.setFlag("AF", false);
  cpu.updateResultFlags(result, size);
  return truncate(result, size);
}

// ---------------------------------------------------------------------------
// Condicoes (jcc / setcc / cmovcc)
// ---------------------------------------------------------------------------

const CONDITIONS = {
  o: (f) => f.OF,
  no: (f) => !f.OF,
  b: (f) => f.CF, c: (f) => f.CF, nae: (f) => f.CF,
  ae: (f) => !f.CF, nb: (f) => !f.CF, nc: (f) => !f.CF,
  e: (f) => f.ZF, z: (f) => f.ZF,
  ne: (f) => !f.ZF, nz: (f) => !f.ZF,
  be: (f) => f.CF || f.ZF, na: (f) => f.CF || f.ZF,
  a: (f) => !f.CF && !f.ZF, nbe: (f) => !f.CF && !f.ZF,
  s: (f) => f.SF,
  ns: (f) => !f.SF,
  p: (f) => f.PF, pe: (f) => f.PF,
  np: (f) => !f.PF, po: (f) => !f.PF,
  // Com sinal: compara SF com OF em vez de olhar CF.
  l: (f) => f.SF !== f.OF, nge: (f) => f.SF !== f.OF,
  ge: (f) => f.SF === f.OF, nl: (f) => f.SF === f.OF,
  le: (f) => f.ZF || f.SF !== f.OF, ng: (f) => f.ZF || f.SF !== f.OF,
  g: (f) => !f.ZF && f.SF === f.OF, nle: (f) => !f.ZF && f.SF === f.OF,
};

function testCondition(cpu, suffix) {
  const check = CONDITIONS[suffix];
  if (!check) throw new MachineHalt(HALT.UNSUPPORTED, `Unknown condition: ${suffix}`);
  return check(cpu.flags);
}

// ---------------------------------------------------------------------------
// Helpers de operando
// ---------------------------------------------------------------------------

const operandSize = (machine, operand) => operand.size || machine.arch.wordSize;

/**
 * Largura de um push/pop. O x86 nao empilha em 4 bytes no modo 64: mesmo
 * `push` de um imediato de 32 bits move o RSP em 8.
 */
function stackOperandSize(machine, operand) {
  if (operand && operand.type !== "imm" && operand.size === 2) return 2;
  return machine.arch.wordSize;
}

// ---------------------------------------------------------------------------
// Implementacoes
// ---------------------------------------------------------------------------

const HANDLERS = {
  nop: () => undefined,
  hlt: () => ({ halt: { reason: HALT.END_OF_PROGRAM, message: "hlt" } }),

  mov: (m, [dst, src]) => {
    m.writeOperand(dst, m.readOperand(src));
  },
  // O Capstone chama de `movabs` o mov com imediato de 64 bits (`48 B8 ...`).
  // Semanticamente e o mesmo mov — muda so o nome que o desmontador imprime.
  movabs: (m, [dst, src]) => {
    m.writeOperand(dst, m.readOperand(src));
  },

  // Zero-extend x sign-extend: a diferenca entre `movzx` e `movsx` e o que
  // acontece com um byte 0xFF virando dword — 0x000000FF ou 0xFFFFFFFF.
  movzx: (m, [dst, src]) => {
    m.writeOperand(dst, m.readOperand(src));
  },
  movsx: (m, [dst, src]) => {
    m.writeOperand(dst, toSigned(m.readOperand(src), src.size));
  },
  movsxd: (m, [dst, src]) => {
    m.writeOperand(dst, toSigned(m.readOperand(src), src.size));
  },

  // LEA nao acessa memoria: calcula o endereco e guarda o NUMERO. E a forma
  // idiomatica de fazer aritmetica com base+indice*escala em uma instrucao.
  lea: (m, [dst, src]) => {
    m.writeOperand(dst, m.effectiveAddress(src));
  },

  xchg: (m, [a, b]) => {
    const left = m.readOperand(a);
    const right = m.readOperand(b);
    m.writeOperand(a, right);
    m.writeOperand(b, left);
  },

  push: (m, [src]) => {
    const size = stackOperandSize(m, src);
    // Imediato de push e estendido com SINAL ate a largura da pilha.
    const value =
      src.type === "imm"
        ? truncate(toSigned(BigInt(src.value), src.size || 4), size)
        : m.readOperand(src);
    m.push(value, size);
  },

  pop: (m, [dst]) => {
    m.writeOperand(dst, m.pop(stackOperandSize(m, dst)));
  },

  add: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    m.writeOperand(dst, applyAdd(m.cpu, m.readOperand(dst), m.readOperand(src), size));
  },
  adc: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    const carry = m.cpu.getFlag("CF") ? 1n : 0n;
    m.writeOperand(dst, applyAdd(m.cpu, m.readOperand(dst), m.readOperand(src), size, carry));
  },
  sub: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    m.writeOperand(dst, applySub(m.cpu, m.readOperand(dst), m.readOperand(src), size));
  },
  sbb: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    const borrow = m.cpu.getFlag("CF") ? 1n : 0n;
    m.writeOperand(dst, applySub(m.cpu, m.readOperand(dst), m.readOperand(src), size, borrow));
  },

  // CMP e TEST sao a subtracao e o AND que jogam o resultado fora: existem
  // apenas pelas flags que deixam para o salto seguinte.
  cmp: (m, [a, b]) => {
    applySub(m.cpu, m.readOperand(a), m.readOperand(b), operandSize(m, a));
  },
  test: (m, [a, b]) => {
    applyLogic(m.cpu, m.readOperand(a) & m.readOperand(b), operandSize(m, a));
  },

  // INC e DEC preservam CF de proposito — e o que permite usa-los dentro de
  // um loop de soma com carry sem destruir o vai-um.
  inc: (m, [dst]) => {
    const size = operandSize(m, dst);
    const carry = m.cpu.getFlag("CF");
    m.writeOperand(dst, applyAdd(m.cpu, m.readOperand(dst), 1n, size));
    m.cpu.setFlag("CF", carry);
  },
  dec: (m, [dst]) => {
    const size = operandSize(m, dst);
    const carry = m.cpu.getFlag("CF");
    m.writeOperand(dst, applySub(m.cpu, m.readOperand(dst), 1n, size));
    m.cpu.setFlag("CF", carry);
  },

  neg: (m, [dst]) => {
    const size = operandSize(m, dst);
    const value = m.readOperand(dst);
    const result = applySub(m.cpu, 0n, value, size);
    m.cpu.setFlag("CF", value !== 0n);
    m.writeOperand(dst, result);
  },

  not: (m, [dst]) => {
    // NOT e a unica operacao logica que nao toca em flag nenhuma.
    const size = operandSize(m, dst);
    m.writeOperand(dst, truncate(~m.readOperand(dst), size));
  },

  and: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    m.writeOperand(dst, applyLogic(m.cpu, m.readOperand(dst) & m.readOperand(src), size));
  },
  or: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    m.writeOperand(dst, applyLogic(m.cpu, m.readOperand(dst) | m.readOperand(src), size));
  },
  xor: (m, [dst, src]) => {
    const size = operandSize(m, dst);
    m.writeOperand(dst, applyLogic(m.cpu, m.readOperand(dst) ^ m.readOperand(src), size));
  },

  shl: (m, ops) => shift(m, ops, "left"),
  sal: (m, ops) => shift(m, ops, "left"),
  shr: (m, ops) => shift(m, ops, "right"),
  sar: (m, ops) => shift(m, ops, "arithmetic"),

  jmp: (m, [target]) => {
    m.cpu.ip = m.readOperand(target);
    return { jumped: true };
  },

  call: (m, [target]) => {
    // O endereco de retorno vai para a pilha ANTES do desvio: e exatamente o
    // valor que um buffer overflow sobrescreve.
    m.push(m.cpu.ip + BigInt(m.currentInstruction.size));
    m.cpu.ip = m.readOperand(target);
    return { jumped: true };
  },

  ret: (m, ops) => {
    m.cpu.ip = m.pop();
    // `ret imm16` desempilha argumentos alem do endereco de retorno
    // (convencao stdcall).
    if (ops.length) m.cpu.sp = m.cpu.sp + m.readOperand(ops[0]);
    return { jumped: true };
  },

  // LEAVE desfaz o prologo em uma instrucao: mov esp, ebp / pop ebp.
  leave: (m) => {
    m.cpu.writeRegister(m.arch.stackPointer, m.cpu.readRegister(m.arch.basePointer));
    m.cpu.writeRegister(m.arch.basePointer, m.pop());
  },

  // As chamadas de sistema sao SIMULADAS (ver syscalls.js): `write` escreve no
  // console do simulador, `exit` encerra o programa. So param a execucao as
  // que nao tem efeito plausivel de reproduzir.
  int: (m, [vector]) => {
    const number = m.readOperand(vector);
    if (number !== 0x80n) {
      return {
        halt: { reason: HALT.SYSCALL, message: `int 0x${number.toString(16)}` },
      };
    }
    return m.syscall("int 0x80");
  },
  syscall: (m) => m.syscall("syscall"),
  sysenter: (m) => m.syscall("sysenter"),
};

function shift(machine, [dst, countOperand], mode) {
  const cpu = machine.cpu;
  const size = operandSize(machine, dst);
  // O x86 mascara a contagem em 5 bits (6 em operandos de 64): `shl eax, 33`
  // desloca 1, nao 33.
  const maskBits = size === 8 ? 0x3fn : 0x1fn;
  const count = (countOperand ? machine.readOperand(countOperand) : 1n) & maskBits;
  if (count === 0n) return;

  const value = machine.readOperand(dst);
  const bits = BigInt(size * 8);
  let result;
  let carry;

  if (mode === "left") {
    carry = ((value >> (bits - count)) & 1n) === 1n;
    result = truncate(value << count, size);
  } else if (mode === "right") {
    carry = ((value >> (count - 1n)) & 1n) === 1n;
    result = truncate(value >> count, size);
  } else {
    const signed = toSigned(value, size);
    carry = ((signed >> (count - 1n)) & 1n) === 1n;
    result = truncate(signed >> count, size);
  }

  cpu.setFlag("CF", carry);
  cpu.updateResultFlags(result, size);
  machine.writeOperand(dst, result);
}

/** Retorna o handler de um mnemonico, incluindo as familias condicionais. */
function resolveHandler(mnemonic) {
  if (HANDLERS[mnemonic]) return HANDLERS[mnemonic];

  if (mnemonic.startsWith("j") && CONDITIONS[mnemonic.slice(1)]) {
    const suffix = mnemonic.slice(1);
    return (m, [target]) => {
      if (!testCondition(m.cpu, suffix)) return undefined;
      m.cpu.ip = m.readOperand(target);
      return { jumped: true };
    };
  }

  if (mnemonic.startsWith("set") && CONDITIONS[mnemonic.slice(3)]) {
    const suffix = mnemonic.slice(3);
    return (m, [dst]) => {
      m.writeOperand(dst, testCondition(m.cpu, suffix) ? 1n : 0n);
    };
  }

  if (mnemonic.startsWith("cmov") && CONDITIONS[mnemonic.slice(4)]) {
    const suffix = mnemonic.slice(4);
    return (m, [dst, src]) => {
      if (testCondition(m.cpu, suffix)) m.writeOperand(dst, m.readOperand(src));
    };
  }

  return null;
}

/** Conjunto suportado, para a UI avisar antes de o aluno rodar. */
export function isSupported(mnemonic) {
  return resolveHandler(String(mnemonic).toLowerCase()) !== null;
}

export function execute(machine, insn) {
  const mnemonic = String(insn.mnemonic).toLowerCase();
  const handler = resolveHandler(mnemonic);

  if (!handler) {
    return {
      halt: {
        reason: HALT.UNSUPPORTED,
        message: insn.text,
      },
    };
  }

  return handler(machine, insn.operands || []);
}
