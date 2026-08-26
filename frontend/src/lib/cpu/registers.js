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

/**
 * Numero de cada registrador na CODIFICACAO das instrucoes.
 *
 * E de onde vem o "RAX ou R0": os oito classicos nao estao em ordem
 * alfabetica nem na ordem em que o x64dbg os mostra — o campo de 3 bits do
 * ModR/M numera AX, CX, DX, BX, SP, BP, SI, DI nessa ordem, herdada do 8086.
 * O x86-64 apenas continuou a contagem em R8..R15, e por isso RAX e R0.
 */
const REGISTER_NUMBER = {
  rax: 0, rcx: 1, rdx: 2, rbx: 3, rsp: 4, rbp: 5, rsi: 6, rdi: 7,
};
for (let i = 8; i <= 15; i += 1) REGISTER_NUMBER[`r${i}`] = i;

// Sufixo do nome numerado por largura: r0, r0d, r0w, r0b.
const NUMBERED_SUFFIX = { 8: "", 4: "d", 2: "w", 1: "b" };

/**
 * Nome numerado de uma view: `("rax", 4)` -> `"r0d"`.
 *
 * null para quem nao tem numero — `rip` nao entra na contagem do ModR/M.
 */
export function numberedName(canonical, size) {
  const number = REGISTER_NUMBER[canonical];
  if (number === undefined) return null;
  const suffix = NUMBERED_SUFFIX[size];
  return suffix === undefined ? null : `r${number}${suffix}`;
}

/**
 * As views de um registrador canonico, da mais larga para a mais estreita:
 * `[{ size, name, numbered }]`.
 *
 * `bits` corta o que a arquitetura ativa nao expoe: num programa de 32 bits o
 * registrador se chama EAX e nao ha RAX para mostrar — e `numbered` vem nulo,
 * porque a numeracao r0..r15 nasceu COM o x86-64. Num programa de 32 bits nao
 * existe "r1d": mostrar esse nome ensinaria uma equivalencia que so vale na
 * outra arquitetura.
 *
 * Os nomes de byte ALTO (ah, bh...) ficam de fora: eles nao sao um degrau da
 * mesma escada — AL e os bits 0..7 e AH os bits 8..15, entao empilha-los na
 * cascata sugeriria um encaixe que nao existe.
 */
export function registerViews(canonical, bits = 64) {
  const maxSize = bits === 64 ? 8 : 4;
  const bySize = new Map();
  Object.entries(REGISTER_VIEWS).forEach(([name, view]) => {
    if (view.canonical !== canonical || view.high || view.size > maxSize) return;
    if (!bySize.has(view.size)) bySize.set(view.size, name);
  });
  return [...bySize.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, name]) => ({
      size,
      name,
      numbered: bits === 64 ? numberedName(canonical, size) : null,
    }));
}

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
