/**
 * Nomes de syscall escolhidos A MAO pelo aluno.
 *
 * A resolucao automatica cobre o que da: a tabela fixa no Linux, a ntdll
 * importada no Windows. Fora disso — um numero que nao esta na tabela, um
 * Windows sem ntdll, um kernel com numeracao propria — nao ha o que deduzir, e
 * quem sabe do que se trata e quem esta lendo o codigo.
 *
 * A escolha vale por (alvo, arquitetura, numero): e uma afirmacao sobre AQUELE
 * numero naquele sistema, e nao sobre a instrucao onde foi feita — o mesmo
 * numero em outro ponto do programa e a mesma chamada.
 */

const OVERRIDES = new Map();

const keyOf = (os, arch, number) => `${os}:${arch}:${number}`;

export function setSyscallName(os, arch, number, name) {
  const key = keyOf(os, arch, number);
  if (name) OVERRIDES.set(key, name);
  else OVERRIDES.delete(key);
}

export function syscallNameOverride(os, arch, number) {
  return OVERRIDES.get(keyOf(os, arch, number)) || null;
}

/** Descarta as escolhas. Chamado quando o programa carregado e trocado. */
export function clearSyscallNames() {
  OVERRIDES.clear();
}
