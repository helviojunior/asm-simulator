/**
 * Modelo de registradores x86 / x86-64.
 *
 * O estado guarda SEMPRE o valor de 64 bits, indexado pelo nome canonico
 * ("rax"). Os nomes menores — eax, ax, al, ah — sao views sobre esse valor.
 * Em modo 32 bits a mesma estrutura serve: apenas expomos "eax" e ignoramos
 * a metade alta.
 */

// Registradores de proposito geral, na ordem em que o x64dbg os exibe.
export const GP_REGISTERS_64 = [
  "rax", "rbx", "rcx", "rdx", "rbp", "rsp", "rsi", "rdi",
  "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
];

export const GP_REGISTERS_32 = [
  "eax", "ebx", "ecx", "edx", "ebp", "esp", "esi", "edi",
];

export const ARCH = {
  x86: {
    id: "x86",
    label: "x86 (32 bits)",
    bits: 32,
    wordSize: 4,
    gpRegisters: GP_REGISTERS_32,
    instructionPointer: "eip",
    stackPointer: "esp",
    basePointer: "ebp",
  },
  x86_64: {
    id: "x86_64",
    label: "x86-64 (64 bits)",
    bits: 64,
    wordSize: 8,
    gpRegisters: GP_REGISTERS_64,
    instructionPointer: "rip",
    stackPointer: "rsp",
    basePointer: "rbp",
  },
};

/**
 * Mapa nome -> { canonical, size, high }.
 *
 * `high` marca os registradores de byte alto (ah, bh, ch, dh), que escrevem
 * nos bits 8..15 em vez dos bits 0..7.
 */
const REGISTER_VIEWS = {};

function defineRegister(canonical, { qword, dword, word, low, high }) {
  if (qword) REGISTER_VIEWS[qword] = { canonical, size: 8, high: false };
  if (dword) REGISTER_VIEWS[dword] = { canonical, size: 4, high: false };
  if (word) REGISTER_VIEWS[word] = { canonical, size: 2, high: false };
  if (low) REGISTER_VIEWS[low] = { canonical, size: 1, high: false };
  if (high) REGISTER_VIEWS[high] = { canonical, size: 1, high: true };
}

// Os oito registradores classicos, com os nomes de byte alto herdados do 8086.
[
  ["rax", "eax", "ax", "al", "ah"],
  ["rbx", "ebx", "bx", "bl", "bh"],
  ["rcx", "ecx", "cx", "cl", "ch"],
  ["rdx", "edx", "dx", "dl", "dh"],
].forEach(([qword, dword, word, low, high]) =>
  defineRegister(qword, { qword, dword, word, low, high })
);

// Indices e ponteiros: o byte baixo so ganhou nome no x86-64 (spl, bpl, ...).
[
  ["rsi", "esi", "si", "sil"],
  ["rdi", "edi", "di", "dil"],
  ["rsp", "esp", "sp", "spl"],
  ["rbp", "ebp", "bp", "bpl"],
].forEach(([qword, dword, word, low]) =>
  defineRegister(qword, { qword, dword, word, low })
);

// R8..R15 usam sufixo em vez de nome proprio.
for (let i = 8; i <= 15; i += 1) {
  const canonical = `r${i}`;
  defineRegister(canonical, {
    qword: canonical,
    dword: `${canonical}d`,
    word: `${canonical}w`,
    low: `${canonical}b`,
  });
}

// Ponteiro de instrucao: eip e a metade baixa de rip.
defineRegister("rip", { qword: "rip", dword: "eip" });

/** Descreve um nome de registrador, ou null se nao for reconhecido. */
export function resolveRegister(name) {
  if (!name) return null;
  return REGISTER_VIEWS[String(name).toLowerCase()] || null;
}

/** Nome canonico (64 bits) de um registrador qualquer: "eax" -> "rax". */
export function canonicalName(name) {
  const view = resolveRegister(name);
  return view ? view.canonical : null;
}

/** Todos os nomes canonicos que compoem o estado da CPU. */
export const CANONICAL_REGISTERS = [
  "rax", "rbx", "rcx", "rdx", "rbp", "rsp", "rsi", "rdi",
  "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
  "rip",
];

/**
 * Nome de exibicao de um registrador canonico na arquitetura ativa.
 *
 * O estado guarda tudo com o nome de 64 bits ("rsp"), mas mostrar "RSP" num
 * programa de 32 bits estaria errado — ali o registrador se chama ESP.
 */
export function displayName(canonical, bits) {
  if (bits === 64) return canonical;
  if (canonical === "rip") return "eip";
  if (/^r([a-z]{2})$/.test(canonical)) return canonical.replace(/^r/, "e");
  if (/^r\d+$/.test(canonical)) return `${canonical}d`;
  return canonical;
}
