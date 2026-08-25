/**
 * Nomes de funcao dados A MAO ao alvo de um `call`.
 *
 * Diferente da syscall, aqui nao ha numero para resolver: um `call` para
 * 0x7FFE1234 e um endereco, e so quem esta lendo o codigo sabe que ali mora o
 * `RtlInitUnicodeString`. Dito o nome, o prototipo do catalogo entra e o
 * painel passa a mostrar tipo e significado de cada argumento em vez de
 * "1: RCX".
 *
 * A CHAVE e o que identifica a chamada:
 *
 * - `target:<endereco>` quando o destino e conhecido (`call 0x401000`). E uma
 *   afirmacao sobre a FUNCAO, entao vale para todos os `call` que forem para
 *   la — nomear uma vez basta.
 * - `site:<endereco do call>` quando o destino so se resolve em execucao
 *   (`call rax`, `call [rbx+8]`). Ali nao ha funcao a nomear ainda, e o que
 *   se pode afirmar e sobre AQUELE ponto do programa.
 */

const OVERRIDES = new Map();

const keyOf = (os, arch, key) => `${os}:${arch}:${key}`;

/** Chave de uma chamada: pelo destino quando ele e conhecido, senao pelo site. */
export function callKey(target, site) {
  if (target !== null && target !== undefined) return `target:${BigInt(target)}`;
  return `site:${BigInt(site)}`;
}

export function setCallName(os, arch, key, name) {
  const full = keyOf(os, arch, key);
  if (name) OVERRIDES.set(full, name);
  else OVERRIDES.delete(full);
}

export function callNameOverride(os, arch, key) {
  return OVERRIDES.get(keyOf(os, arch, key)) || null;
}

/** Descarta as escolhas. Chamado quando o programa carregado e trocado. */
export function clearCallNames() {
  OVERRIDES.clear();
}
