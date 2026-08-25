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

/**
 * Prototipos COMPLETOS (com argumentos), carregados um a um.
 *
 * Separados da lista de nomes de proposito: o auto-completar precisa de 773
 * nomes, e o painel precisa dos argumentos de UM. Carregar tudo para atender os
 * dois seria trazer 3 MB para usar 2 KB.
 */
const FULL = new Map();
const FULL_PENDING = new Map();

/** Prototipo completo JA carregado, ou null. Sincrono, para o painel ler. */
export function prototypeByName(os, arch, name) {
  if (!os || !arch || !name) return null;
  return FULL.get(`${os}:${arch}:${name}`) || null;
}

/** Busca o prototipo completo de uma funcao e o guarda. */
export async function loadPrototype(os, arch, name) {
  if (!os || !arch || !name) return null;

  const key = `${os}:${arch}:${name}`;
  if (FULL.has(key)) return FULL.get(key);
  if (FULL_PENDING.has(key)) return FULL_PENDING.get(key);

  const request = api
    .get("/api/prototypes/", { params: { os, arch, name } })
    .then(({ data }) => {
      const prototype = data.prototype || null;
      FULL.set(key, prototype);
      return prototype;
    })
    .catch(() => {
      // Nome sem prototipo — um que o aluno digitou, ou uma funcao que ainda
      // nao esta no catalogo. Guardar o null evita repetir a busca a cada passo.
      FULL.set(key, null);
      return null;
    })
    .finally(() => FULL_PENDING.delete(key));

  FULL_PENDING.set(key, request);
  return request;
}
