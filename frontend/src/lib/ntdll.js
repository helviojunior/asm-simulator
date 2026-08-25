/**
 * Cliente da ntdll.dll importada.
 *
 * A tabela e VOLATIL no servidor (vive em memoria, some quando o container
 * reinicia), e aqui ela e mantida num registro de modulo — carregada uma vez e
 * consultada a cada passo da execucao, sem ida e volta ao backend.
 */

import api from "lib/api";

/** SSN -> nome, por arquitetura. Vazio ate alguem importar. */
const TABLES = { x86: null, x86_64: null };

/** Status por arquitetura: `{ count, origin }`. */
const SUMMARIES = { x86: null, x86_64: null };

export function ntdllTable(arch) {
  return TABLES[arch] || null;
}

export function ntdllSummary(arch) {
  return SUMMARIES[arch] || null;
}

/** Nome da funcao para um SSN, ou null se nao houver tabela. */
export function resolveSyscall(arch, ssn) {
  const table = TABLES[arch];
  if (!table) return null;
  return table[String(ssn)] || null;
}

function adopt(arch, summary, syscalls) {
  TABLES[arch] = syscalls || null;
  SUMMARIES[arch] = summary || null;
}

/** Consulta o servidor e adota o que ja estiver carregado. */
export async function refreshNtdll(arch) {
  const { data } = await api.get("/api/ntdll/", { params: { arch } });
  const summary = data.loaded?.[arch] || null;
  adopt(arch, summary, summary ? data.syscalls : null);
  return summary;
}

/** Envia a DLL; o servidor extrai os SSN e devolve a tabela. */
export async function importNtdll(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/api/ntdll/", form);
  adopt(data.arch, { count: data.count, origin: data.origin, exports: data.exports },
        data.syscalls);
  return data;
}

/** Descarta a tabela, no servidor e aqui. */
export async function clearNtdll(arch) {
  await api.delete("/api/ntdll/", { params: arch ? { arch } : undefined });
  if (arch) adopt(arch, null, null);
  else {
    adopt("x86", null, null);
    adopt("x86_64", null, null);
  }
}
