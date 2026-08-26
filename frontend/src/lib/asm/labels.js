/**
 * Rotulos do fonte NASM, e o endereco de cada um.
 *
 * O montador nao devolve tabela de simbolos: o `nasm -f bin` produz bytes
 * crus, e o desmontador ve um `call 0x7FF70000101E` sem saber que aquilo se
 * chama `Function1`. Mas o nome esta no fonte, que continua aberto no editor —
 * e o `line_map` diz que byte veio de que linha. Cruzando os dois, cada rotulo
 * volta a ter endereco.
 *
 * E o que faz o painel de chamada dizer "Function1" em vez de "sem nome", sem
 * o aluno precisar batizar a mao uma funcao que ele mesmo acabou de escrever.
 */

// `nome:` — a forma comum, com ou sem instrucao na mesma linha.
const WITH_COLON = /^\s*([A-Za-z_.?$][\w.?$@~#]*)\s*:/;

// `msg db "Hello"` — sem dois-pontos, que e como quase todo `.data` se
// escreve. O recuo nao importa (o NASM nao o cobra), mas o que vem DEPOIS do
// nome sim: so uma directive de dados. Sem essa exigencia, `mov rax, 1` teria
// `mov` como rotulo.
const WITHOUT_COLON =
  /^\s*([A-Za-z_.?$][\w.?$@~#]*)\s+(?:times\s+\S+\s+)?(?:d[bwdqto]|res[bwdqt]|incbin)\b/i;

// Troca de secao. Um rotulo nao atravessa uma: o ultimo rotulo de uma `.text`
// seguida de `section .data` aponta para o FIM do codigo, e nao para o
// primeiro byte de dados que por acaso vem a seguir no fonte.
const SECTION = /^\s*\[?\s*(?:section|segment)\s+\S/i;

/**
 * Rotulos declarados no fonte, com a linha e a secao de cada um.
 *
 * `section` e um contador, nao um nome: serve so para dizer se dois pontos do
 * fonte estao na mesma secao.
 */
export function parseLabels(source) {
  const labels = [];
  let section = 0;

  (source || "").split("\n").forEach((raw, index) => {
    // Comentario fora antes de olhar: `; fim:` nao declara rotulo nenhum.
    const code = raw.split(";", 1)[0];
    if (SECTION.test(code)) {
      section += 1;
      return;
    }
    const match = WITH_COLON.exec(code) || WITHOUT_COLON.exec(code);
    if (match) labels.push({ name: match[1], line: index + 1, section });
  });

  return labels;
}

/**
 * Mapa `endereco (decimal, string) -> nome do rotulo`.
 *
 * O endereco de um rotulo e o do PRIMEIRO byte emitido dele em diante — o
 * rotulo em si nao gera byte nenhum. Dai a busca pela primeira linha, a partir
 * dele, que aparece no `line_map`.
 *
 * `lineMap` e o mapa `offset -> linha` do montador, como ele chega da API
 * (chaves em string). `base` e o endereco em que a imagem foi carregada.
 */
export function labelMap(source, lineMap, base) {
  const labels = parseLabels(source);
  if (labels.length === 0) return new Map();

  // Linha -> menor offset emitido nela. Uma linha pode gerar varios (um `db`
  // longo sai do listing em pedacos); o rotulo aponta para o comeco.
  const firstOffset = new Map();
  Object.entries(lineMap || {}).forEach(([offset, line]) => {
    const value = Number(offset);
    const key = Number(line);
    const current = firstOffset.get(key);
    if (current === undefined || value < current) firstOffset.set(key, value);
  });

  const emitted = [...firstOffset.keys()].sort((a, b) => a - b);
  // Secao de cada linha do fonte, para o rotulo nao atravessar uma troca.
  const sectionOfLine = sectionsByLine(source);

  const out = new Map();
  labels.forEach(({ name, line, section }) => {
    const at = emitted.find((candidate) => candidate >= line);
    if (at === undefined || sectionOfLine[at] !== section) return;

    const address = (BigInt(base) + BigInt(firstOffset.get(at))).toString();
    // O primeiro rotulo de um endereco e o que vale: dois rotulos seguidos
    // apontam para o mesmo byte, e o de cima e o que nomeia o bloco.
    if (!out.has(address)) out.set(address, name);
  });

  return out;
}

/** Contador de secao de cada linha do fonte, indexado por numero de linha. */
function sectionsByLine(source) {
  const out = [];
  let section = 0;
  (source || "").split("\n").forEach((raw, index) => {
    if (SECTION.test(raw.split(";", 1)[0])) section += 1;
    out[index + 1] = section;
  });
  return out;
}
