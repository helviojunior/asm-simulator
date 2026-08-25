/**
 * Deteccao de arquitetura DIVERGENTE entre o fonte e a selecao do usuario.
 *
 * O nasm monta `mov rax, 1` em modo 32 bits com um erro pouco util, e alguns
 * casos nem falham — `int 0x80` monta em 64 bits e simplesmente nao faz o que o
 * aluno espera. O objetivo aqui e apontar a divergencia ANTES de montar, com a
 * evidencia na mao: qual linha, qual trecho.
 *
 * O criterio e sintatico de proposito. Nao ha analise semantica: o que se
 * procura sao marcas que so aparecem num dos dois modos.
 */

/** Remove comentarios (`;`) e o conteudo de strings, que nao sao codigo. */
function stripNoise(line) {
  return line
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, " ")
    .replace(/;.*$/, "");
}

// Registradores de 64 bits: rax..rsp, r8..r15 e as views r8d/r8w/r8b.
// `rip` entra junto (enderecamento relativo so existe em 64 bits).
const REG64 = /\b(r(?:ax|bx|cx|dx|si|di|bp|sp|ip)|r(?:8|9|1[0-5])[dwb]?)\b/i;

/**
 * Marcas que so fazem sentido em cada modo.
 *
 * `int 0x80` e a chamada de sistema do Linux de 32 bits; `syscall` e a de 64.
 * Nenhuma das duas e erro de montagem no modo errado — por isso estao aqui, e
 * nao deixadas para o montador.
 */
const RULES = [
  { arch: "x86_64", key: "bits64", test: /^\s*\[?\s*bits\s+64\s*\]?\s*$/i },
  { arch: "x86", key: "bits32", test: /^\s*\[?\s*bits\s+32\s*\]?\s*$/i },
  { arch: "x86_64", key: "reg64", test: REG64 },
  { arch: "x86_64", key: "syscall", test: /\bsyscall\b/i },
  { arch: "x86_64", key: "relative", test: /\bdefault\s+rel\b/i },
  { arch: "x86", key: "int80", test: /\bint\s+0x80\b/i },
  // `pusha`/`popa` e a familia BCD nao existem em modo 64 bits.
  { arch: "x86", key: "only32", test: /\b(pusha[d]?|popa[d]?|aaa|aad|aam|aas|daa|das|into)\b/i },
];

// A diretiva `bits` e declaracao explicita: ela sozinha decide o alvo, mesmo
// que o resto do arquivo aponte para o outro lado.
const EXPLICIT = new Set(["bits64", "bits32"]);

/**
 * Varre o fonte e devolve o que ele aparenta ser.
 *
 * `{ target, indicators }` — `target` e null quando nada indica um modo ou
 * quando os indicadores se contradizem sem uma diretiva `bits` para desempatar.
 * `indicators` traz linha, trecho e a chave de traducao do motivo.
 */
export function detectArch(source) {
  const indicators = [];
  const lines = String(source || "").split("\n");

  lines.forEach((raw, index) => {
    const line = stripNoise(raw);
    if (!line.trim()) return;
    RULES.forEach((rule) => {
      const match = line.match(rule.test);
      if (!match) return;
      indicators.push({
        arch: rule.arch,
        key: rule.key,
        line: index + 1,
        text: (match[0] || "").trim() || line.trim(),
      });
    });
  });

  const explicit = indicators.find((item) => EXPLICIT.has(item.key));
  if (explicit) return { target: explicit.arch, indicators };

  const votes = { x86: 0, x86_64: 0 };
  indicators.forEach((item) => { votes[item.arch] += 1; });
  if (votes.x86_64 === votes.x86) return { target: null, indicators };

  return { target: votes.x86_64 > votes.x86 ? "x86_64" : "x86", indicators };
}

/**
 * Compara o fonte com a arquitetura selecionada.
 *
 * Devolve null quando nao ha conflito. Havendo, so vem junto a evidencia DO
 * LADO divergente: listar tambem o que confirma a selecao atual so tiraria a
 * atencao do que precisa ser decidido.
 */
export function findArchMismatch(source, arch) {
  const { target, indicators } = detectArch(source);
  if (!target || target === arch) return null;
  return {
    target,
    indicators: indicators.filter((item) => item.arch === target),
  };
}
