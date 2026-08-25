/**
 * Cliente da biblioteca de programas (pastas e arquivos .asm).
 *
 * A arvore inteira vem numa requisicao so: e um conjunto pequeno e local, e
 * carregar por nivel so adicionaria idas e voltas.
 */

import api from "lib/api";

export const KIND = { FOLDER: "folder", FILE: "file" };

export async function listNodes() {
  const response = await api.get("/api/library/");
  return response.data.nodes || [];
}

/** Le um arquivo COM o conteudo (a listagem nao traz o fonte). */
export async function readNode(id) {
  const response = await api.get(`/api/library/${id}/`);
  return response.data;
}

export async function createNode({ kind, name, parent = null, source = "", metadata }) {
  const payload = { kind, name, parent, source };
  if (metadata) payload.metadata = metadata;
  const response = await api.post("/api/library/", payload);
  return response.data;
}

export async function updateNode(id, patch) {
  const response = await api.patch(`/api/library/${id}/`, patch);
  return response.data;
}

export async function deleteNode(id) {
  await api.delete(`/api/library/${id}/`);
}

/** Extensao do bundle da biblioteca — um tar.gz com a arvore inteira. */
export const BUNDLE_EXTENSION = ".scasmlib";

/**
 * Baixa a biblioteca como `.scasmlib`.
 *
 * `blob`, e nao JSON: o corpo e um tar.gz. Deixado como texto, o axios tentaria
 * decodificar bytes binarios como UTF-8 e corromperia o arquivo.
 */
export async function exportLibrary() {
  const response = await api.get("/api/library/export/", { responseType: "blob" });
  return response.data;
}

/** Envia um `.scasmlib` para dentro de `parent` (null = raiz). */
export async function importLibrary(file, parent = null) {
  const form = new FormData();
  form.append("file", file);
  // FormData nao tem null: a ausencia da chave e o que significa "na raiz".
  if (parent) form.append("parent", parent);
  const response = await api.post("/api/library/import/", form);
  return response.data;
}

/**
 * Parametros de execucao de um arquivo.
 *
 * A API fala snake_case (e a convencao do Django); a interface, camelCase. A
 * conversao mora AQUI, num lugar so — espalhada pelos componentes, cada tela
 * inventaria a sua e a divergencia apareceria como campo que nao salva.
 *
 * Endereco vazio significa "use o padrao da arquitetura": quem abre o arquivo
 * decide qual e esse padrao.
 */
export function toParams(metadata) {
  if (!metadata) return null;
  return {
    arch: metadata.arch || null,
    os: metadata.os || null,
    codeBase: metadata.code_base || "",
    stackTop: metadata.stack_top || "",
    argCount: Number.isInteger(metadata.arg_count) ? metadata.arg_count : 4,
  };
}

export function fromParams(params) {
  if (!params) return undefined;
  return {
    arch: params.arch,
    // Vazio e legitimo: arquivo salvo antes de o alvo ser resolvido.
    os: params.os || "",
    code_base: params.codeBase,
    stack_top: params.stackTop,
    arg_count: params.argCount,
  };
}

/**
 * Monta a arvore a partir da lista plana.
 *
 * Ordena pastas antes de arquivos e, dentro de cada grupo, alfabeticamente —
 * a mesma convencao de qualquer gerenciador de arquivos.
 */
export function buildTree(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, { ...node, children: [] }]));
  const roots = [];

  byId.forEach((node) => {
    const parent = node.parent ? byId.get(node.parent) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sort = (list) => {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === KIND.FOLDER ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    list.forEach((node) => sort(node.children));
  };
  sort(roots);

  return roots;
}
