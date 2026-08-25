/**
 * Sistema operacional ALVO do programa.
 *
 * Importa porque o numero de uma syscall nao e propriedade da arquitetura: e
 * do sistema. `write` e 4 no `int 0x80` do Linux, 1 no `syscall` do Linux de
 * 64 bits, e 0x2000004 no macOS — o mesmo `mov eax, 4` significa coisas
 * diferentes em cada um. Sem saber o alvo, o painel de syscall so poderia
 * chutar.
 */

/*
 * `icon` e o glifo da Nerd Font embarcada (Font Awesome, area privada):
 * U+F17C tux, U+F17A janela, U+F179 maca. Estao no subset — foram incluidos de
 * proposito ao regenera-lo, ver o README de src/assets/fonts. Sem isso o
 * navegador cairia para outra fonte e desenharia o retangulo de glifo ausente.
 */
export const OS = {
  linux: { id: "linux", label: "Linux", icon: "\uf17c" },
  windows: { id: "windows", label: "Windows", icon: "\uf17a" },
  macos: { id: "macos", label: "macOS", icon: "\uf179" },
};

/** Glifo do alvo, ou string vazia quando ele ainda nao foi definido. */
export function osIcon(id) {
  return OS[id]?.icon || "";
}

export const OS_OPTIONS = Object.values(OS);

/**
 * Duas leituras do fonte, porque as marcas vivem em lugares diferentes.
 *
 * `code` descarta comentarios E strings: e onde se procura sintaxe (`int
 * 0x80`, `.model`, `fs:[0x30]`), e um `; usa int 0x80` num comentario nao pode
 * votar. `text` descarta so os comentarios: os nomes que interessam —
 * "/bin/sh", "kernel32.dll" — sao DADOS, moram dentro de aspas, e descarta-los
 * jogaria fora o sinal mais forte que um shellcode tem.
 */
function readings(source) {
  const noComments = String(source || "")
    .split("\n")
    .map((line) => line.replace(/;.*$/, ""))
    .join("\n");
  const noStrings = noComments.replace(/(["'])(?:\\.|(?!\1).)*\1/g, " ");
  return { text: noComments, code: noStrings };
}

/**
 * Marcas que identificam o alvo.
 *
 * Cada regra vale um voto. Sao sinais que so aparecem em UM dos sistemas —
 * nada de "usa `mov`", que nao distingue nada.
 */
const RULES = [
  // --- Windows: tudo gira em torno do PEB e das DLLs ---------------------
  // Caminho classico do shellcode ate o PEB. As duas sintaxes do NASM
  // (`fs:[0x30]` e `[fs:0x30]`) aparecem por ai em igual medida.
  { os: "windows", key: "peb", scope: "code",
    test: /(\b(fs|gs)\s*:\s*\[\s*(0x)?(30|60)h?\s*\])|(\[\s*(fs|gs)\s*:\s*(0x)?(30|60)h?\s*\])/i },
  { os: "windows", key: "dll", scope: "text", test: /\b[\w-]+\.dll\b/i },
  { os: "windows", key: "winapi", scope: "text", test: /\b(kernel32|ntdll|user32|ws2_32|LoadLibrary[AW]?|GetProcAddress|WinExec|MessageBox[AW]?|VirtualAlloc|ExitProcess|CreateProcess[AW]?)\b/i },
  // Diretivas do MASM, que so existem no mundo Windows.
  { os: "windows", key: "masm", scope: "code", test: /^\s*\.(model|code|data|stack)\b/im },
  { os: "windows", key: "masmInvoke", scope: "code", test: /^\s*invoke\b/im },

  // --- macOS: syscall com a classe BSD somada ---------------------------
  // 0x2000000 e a classe UNIX do XNU. E o sinal mais forte que existe: nenhum
  // outro sistema poe esse bit no numero da chamada.
  { os: "macos", key: "bsdClass", scope: "code", test: /\b0x2[0-9a-f]{6}\b/i },
  { os: "macos", key: "machO", scope: "text", test: /\b(__TEXT|__DATA|__cstring)\b/ },

  // --- Linux: ELF e a interface de chamada do kernel --------------------
  { os: "linux", key: "int80", scope: "code", test: /\bint\s+0x80\b/i },
  { os: "linux", key: "start", scope: "code", test: /\b(global\s+_start|_start\s*:)/i },
  { os: "linux", key: "elfSection", scope: "code", test: /^\s*section\s+\.(text|data|bss|rodata)\b/im },
  { os: "linux", key: "path", scope: "text", test: /\/(bin\/(sh|bash)|etc\/passwd|proc\/self)\b/ },
];

// Uma diretiva do MASM ou a classe BSD nao convivem com o outro sistema: elas
// decidem sozinhas, sem depender de contagem.
const DECISIVE = new Set(["masm", "masmInvoke", "bsdClass", "peb"]);

/**
 * Tenta reconhecer o alvo pelo fonte.
 *
 * Devolve `{ os, confident, indicators }`. `os` e null quando nada aponta para
 * um sistema — e nesse caso quem decide e o usuario, nao um palpite: montar
 * com o alvo errado resolveria os numeros de syscall para as funcoes erradas,
 * e o painel mentiria com toda a confianca.
 */
export function detectOs(source) {
  const views = readings(source);
  const indicators = [];

  RULES.forEach((rule) => {
    const match = views[rule.scope].match(rule.test);
    if (match) indicators.push({ os: rule.os, key: rule.key, text: (match[0] || "").trim() });
  });

  const decisive = indicators.find((item) => DECISIVE.has(item.key));
  if (decisive) return { os: decisive.os, confident: true, indicators };

  const votes = {};
  indicators.forEach((item) => { votes[item.os] = (votes[item.os] || 0) + 1; });

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { os: null, confident: false, indicators };
  // Empate entre dois sistemas nao e deteccao, e duvida.
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return { os: null, confident: false, indicators };
  }
  return { os: ranked[0][0], confident: true, indicators };
}

/** Alvo mais provavel de uma arquitetura, quando nao ha nada melhor. */
export function defaultOs() {
  return OS.linux.id;
}
