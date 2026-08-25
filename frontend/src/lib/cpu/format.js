/**
 * Formatacao para os paineis do debugger.
 *
 * Tudo entra como BigInt e sai como string ja no tamanho da arquitetura —
 * enderecos de 32 bits com 8 digitos, de 64 bits com 16, como o x64dbg faz.
 */

/** Hexadecimal maiusculo, preenchido a esquerda. Ex.: hex(255n, 4) -> "00FF". */
export function hex(value, digits = 8) {
  const normalized = BigInt.asUintN(digits * 4, BigInt(value ?? 0));
  return normalized.toString(16).toUpperCase().padStart(digits, "0");
}

/** Digitos hexadecimais de um endereco na arquitetura dada. */
export function addressDigits(bits) {
  return bits === 64 ? 16 : 8;
}

export function formatAddress(value, bits) {
  return hex(value, addressDigits(bits));
}

/** Representacao ASCII de um byte para o dump; "." quando nao imprimivel. */
export function asciiByte(byte) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

/**
 * Interpreta um valor como decimal com sinal — util no painel de
 * registradores, onde 0xFFFFFFFF fica muito mais claro como -1.
 */
export function signedDecimal(value, bits) {
  return BigInt.asIntN(bits, BigInt(value ?? 0)).toString(10);
}

/** Aceita "0x1000", "4096" ou number e devolve BigInt; null se invalido. */
export function parseAddress(input) {
  if (input === null || input === undefined || input === "") return null;
  try {
    const text = String(input).trim();
    return BigInt(text.toLowerCase().startsWith("0x") ? text : text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dump ASCII
// ---------------------------------------------------------------------------

/**
 * Caractere de "nao conhecido" do dump.
 *
 * U+FFFD (REPLACEMENT CHARACTER) esta no subset da `MesloLGS NF` embarcada
 * (ver `src/assets/fonts/README.md`) — offline ele desenha, ao contrario dos
 * Control Pictures (U+2400+), que foram removidos do subset.
 */
export const ASCII_UNKNOWN = "�";

/**
 * Bytes de controle que TEM significado conhecido no dump.
 *
 * Um glifo por byte, e nao a escapatoria de duas letras (`\n`): o dump alinha
 * uma coluna por byte, e "\n" ocuparia duas. Todos os glifos abaixo estao nos
 * intervalos que o subset da fonte mantem (Latin-1 e U+2190-21FF).
 */
const ASCII_CONTROL = {
  0x00: { char: "·", kind: "null", label: "\\0" },   // ·  NUL
  0x09: { char: "⇥", kind: "control", label: "\\t" }, // ⇥  TAB
  0x0a: { char: "↵", kind: "control", label: "\\n" }, // ↵  LF
  0x0d: { char: "↩", kind: "control", label: "\\r" }, // ↩  CR
};

/**
 * Como desenhar um byte no dump ASCII.
 *
 * `kind` existe para o painel colorir: imprimivel em branco, controle conhecido
 * em azul, e o resto esmaecido — quem le distingue "aqui ha texto" de "aqui ha
 * binario" sem precisar decodificar o hexadecimal ao lado.
 */
export function asciiCell(byte) {
  const value = Number(byte) & 0xff;
  if (value >= 0x20 && value <= 0x7e) {
    return { char: String.fromCharCode(value), kind: "printable", label: String.fromCharCode(value) };
  }
  const known = ASCII_CONTROL[value];
  if (known) return known;
  return { char: ASCII_UNKNOWN, kind: "unknown", label: `0x${value.toString(16).toUpperCase().padStart(2, "0")}` };
}
