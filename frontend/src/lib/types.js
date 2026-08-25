/**
 * Prototipos de TIPO (structs e unions), servidos pelo backend.
 *
 * Guardados aqui depois de carregados: o painel consulta a cada passo da
 * execucao para redesenhar os campos, e ida ao servidor por passo seria
 * desperdicio.
 */

import api from "lib/api";

const NAMES = new Map();   // alvo -> Set de nomes disponiveis
const LAYOUTS = new Map(); // alvo:nome -> layout
const PENDING = new Map();

const keyOf = (os, arch) => `${os}:${arch}`;

/**
 * O tipo `name` pode ser lido neste alvo?
 *
 * Sincrono, para a linha de argumento decidir se mostra o botao sem esperar
 * requisicao. Antes de a lista chegar, responde false — o botao aparece no
 * render seguinte.
 */
export function isParseable(os, arch, name) {
  const known = NAMES.get(keyOf(os, arch));
  if (!known || !name) return false;

  const candidate = String(name)
    .replace(/[*]/g, "")
    .replace(/\b(const|CONST|struct)\b/g, "")
    .trim();
  // Convencao do Windows: `PFOO`, `PCFOO` e `LPFOO` sao ponteiro para o MESMO
  // `FOO`. E o backend que guarda o layout sob o nome sem prefixo — a lista
  // aqui precisa enxergar igual, senao o botao de estrutura some justo nos
  // tipos da API do Windows (LPSTARTUPINFOA, LPWSADATA).
  return known.has(candidate)
    || ["P", "PC", "LP", "LPC"].some(
      (prefix) => candidate.startsWith(prefix) && known.has(candidate.slice(prefix.length))
    );
}

/** Layout ja carregado, ou null. */
export function layoutOf(os, arch, name) {
  return LAYOUTS.get(`${keyOf(os, arch)}:${name}`) || null;
}

/** Carrega a lista de nomes disponiveis para o alvo. */
export async function loadTypeNames(os, arch) {
  if (!os || !arch) return new Set();
  const key = keyOf(os, arch);
  if (NAMES.has(key)) return NAMES.get(key);

  try {
    const { data } = await api.get("/api/types/", { params: { os, arch } });
    const set = new Set(data.types || []);
    NAMES.set(key, set);
    return set;
  } catch {
    NAMES.set(key, new Set());
    return NAMES.get(key);
  }
}

/** Carrega o layout de um tipo. */
export async function loadType(os, arch, name) {
  if (!os || !arch || !name) return null;
  const key = `${keyOf(os, arch)}:${name}`;
  if (LAYOUTS.has(key)) return LAYOUTS.get(key);
  if (PENDING.has(key)) return PENDING.get(key);

  const request = api
    .get("/api/types/", { params: { os, arch, name } })
    .then(({ data }) => {
      LAYOUTS.set(key, data.type || null);
      return data.type || null;
    })
    .catch(() => {
      LAYOUTS.set(key, null);
      return null;
    })
    .finally(() => PENDING.delete(key));

  PENDING.set(key, request);
  return request;
}
