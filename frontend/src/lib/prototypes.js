/**
 * Prototipos das syscalls, servidos pelo backend a partir de
 * `asm_simulator/prototypes/`.
 *
 * Carregados uma vez por alvo e mantidos aqui: sao algumas dezenas de itens, e
 * o auto-completar consulta a cada tecla — ida e volta ao servidor por tecla
 * seria desperdicio.
 */

import api from "lib/api";

const CACHE = new Map();
const PENDING = new Map();

const keyOf = (os, arch) => `${os}:${arch}`;

/** Prototipos ja carregados para o alvo, ou lista vazia. */
export function prototypesFor(os, arch) {
  return CACHE.get(keyOf(os, arch)) || [];
}

/**
 * Garante que o alvo esta carregado.
 *
 * Chamadas concorrentes compartilham a MESMA requisicao: o painel pode pedir
 * enquanto o menu tambem pede, e duas idas ao servidor para a mesma lista nao
 * ajudariam ninguem.
 */
export async function loadPrototypes(os, arch) {
  if (!os || !arch) return [];

  const key = keyOf(os, arch);
  if (CACHE.has(key)) return CACHE.get(key);
  if (PENDING.has(key)) return PENDING.get(key);

  const request = api
    // `fields=names` traz so nome, numero e resumo: a lista completa do
    // Windows sao 773 funcoes com argumentos e passa de 3 MB — peso sem uso
    // para completar um nome enquanto se digita.
    .get("/api/prototypes/", { params: { os, arch, fields: "names" } })
    .then(({ data }) => {
      const list = data.prototypes || [];
      CACHE.set(key, list);
      return list;
    })
    .catch(() => {
      // Sem prototipos a interface segue: o auto-completar fica vazio e o
      // aluno digita o nome inteiro.
      CACHE.set(key, []);
      return [];
    })
    .finally(() => PENDING.delete(key));

  PENDING.set(key, request);
  return request;
}

/** Um prototipo pelo nome, se ja carregado. */
export function prototypeByName(os, arch, name) {
  return prototypesFor(os, arch).find((item) => item.function_name === name) || null;
}
