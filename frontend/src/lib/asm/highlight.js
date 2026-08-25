/**
 * Tokenizador de Assembly (sintaxe NASM) para colorir o editor.
 *
 * Nao e um parser: o objetivo e classificar cada trecho de texto para pintar,
 * nao validar o programa — quem valida e o nasm, e os erros dele ja aparecem
 * no painel de mensagens.
 *
 * A classificacao e por LINHA, e a ordem importa: comentario e string vem
 * antes de tudo, porque um `;` dentro de uma string nao inicia comentario e um
 * `;` fora dela engole o resto da linha.
 */

const DIRECTIVES = new Set([
  "bits", "use16", "use32", "use64", "org", "section", "segment", "absolute",
  "global", "extern", "common", "static", "cpu", "default",
  "db", "dw", "dd", "dq", "dt", "do", "dy", "dz",
  "resb", "resw", "resd", "resq", "rest", "reso", "resy", "resz",
  "equ", "times", "align", "alignb", "incbin", "struc", "endstruc", "istruc",
  "at", "iend", "byte", "word", "dword", "qword", "tword", "oword",
  "ptr", "near", "far", "short", "strict", "nosplit", "rel", "abs",
]);

const REGISTERS = new Set([
  // 64 bits
  "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp",
  "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
  // 32 bits
  "eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp",
  "r8d", "r9d", "r10d", "r11d", "r12d", "r13d", "r14d", "r15d",
  // 16 bits
  "ax", "bx", "cx", "dx", "si", "di", "bp", "sp",
  "r8w", "r9w", "r10w", "r11w", "r12w", "r13w", "r14w", "r15w",
  // 8 bits
  "al", "bl", "cl", "dl", "ah", "bh", "ch", "dh",
  "sil", "dil", "bpl", "spl",
  "r8b", "r9b", "r10b", "r11b", "r12b", "r13b", "r14b", "r15b",
  // Segmento e ponteiro de instrucao
  "cs", "ds", "es", "fs", "gs", "ss", "rip", "eip", "ip",
]);

// Tokens do trecho de codigo (ja sem comentario).
const TOKEN = new RegExp(
  [
    '"(?:[^"\\\\]|\\\\.)*"',       // string com aspas duplas
    "'(?:[^'\\\\]|\\\\.)*'",       // string com aspas simples
    "0[xX][0-9a-fA-F_]+",          // 0x1F
    "0[bB][01_]+",                 // 0b1010
    "\\$[0-9a-fA-F]+",             // $1F
    "\\d[0-9a-fA-F_]*[hHbBoOqQdD]\\b", // 1Fh, 1010b
    "\\d[\\d_]*",                  // decimal
    "[A-Za-z_.?$@][\\w.?$@]*",     // identificador (rotulo, mnemonico, registrador)
    "\\s+",                        // espacos preservados
    "[^\\s]",                      // qualquer outro caractere isolado
  ].join("|"),
  "g"
);

const IS_NUMBER = /^(?:0[xX]|0[bB]|\$|\d)/;

/**
 * Divide a linha em (codigo, comentario), respeitando strings.
 *
 * Percorre caractere a caractere porque um `;` so inicia comentario quando
 * esta fora de aspas — `db "a;b"` continua sendo uma string inteira.
 */
function splitComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ";") {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ""];
}

/**
 * Classifica uma linha em tokens `{ text, kind }`.
 *
 * kind: comment | string | number | directive | mnemonic | register | label |
 *       reference | plain
 */
export function tokenizeLine(line) {
  const tokens = [];
  const [code, comment] = splitComment(line);

  // O primeiro identificador da linha e o mnemonico (ou a directive); os
  // seguintes sao operandos. Um rotulo `nome:` nao consome essa posicao.
  let expectingMnemonic = true;

  const matches = code.match(TOKEN) || [];
  matches.forEach((text, index) => {
    if (/^\s+$/.test(text)) {
      tokens.push({ text, kind: "plain" });
      return;
    }
    if (/^["']/.test(text)) {
      tokens.push({ text, kind: "string" });
      return;
    }
    if (IS_NUMBER.test(text)) {
      tokens.push({ text, kind: "number" });
      return;
    }
    if (!/^[A-Za-z_.?$@]/.test(text)) {
      tokens.push({ text, kind: "plain" });
      return;
    }

    const lower = text.toLowerCase();
    // Rotulo: identificador seguido imediatamente de ':'.
    const next = matches.slice(index + 1).find((t) => !/^\s+$/.test(t));
    if (expectingMnemonic && next === ":") {
      tokens.push({ text, kind: "label" });
      return;
    }
    if (DIRECTIVES.has(lower)) {
      tokens.push({ text, kind: "directive" });
      expectingMnemonic = false;
      return;
    }
    if (REGISTERS.has(lower)) {
      tokens.push({ text, kind: "register" });
      expectingMnemonic = false;
      return;
    }
    if (expectingMnemonic) {
      tokens.push({ text, kind: "mnemonic" });
      expectingMnemonic = false;
      return;
    }
    tokens.push({ text, kind: "reference" });
  });

  if (comment) tokens.push({ text: comment, kind: "comment" });
  return tokens;
}

/** Cor de cada categoria — mesma paleta dos paineis de desmontagem. */
export const TOKEN_COLOR = {
  comment: "text-[#6a9955]",
  string: "text-[#ce9178]",
  number: "text-[#b5cea8]",
  directive: "text-[#c586c0]",
  mnemonic: "text-[#569cd6]",
  register: "text-[#9cdcfe]",
  label: "text-[#dcdcaa]",
  reference: "text-[#dcdcaa]",
  plain: "text-[#d4d4d4]",
};
