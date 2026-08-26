import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { asciiCell, hex } from "lib/cpu/format";
import { codeReference, pointerString } from "lib/cpu/inspect";
import { useDumpMenu } from "components/debugger/useDumpMenu";
import { Switch } from "components/ui/switch";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

// Altura de uma linha, em pixels — a mesma do dump. Fixa de proposito: e ela
// que converte posicao de rolagem em endereco, e uma altura medida do DOM
// tornaria essa conta dependente da fonte que carregou.
const ROW_HEIGHT = 18;

// Linhas desenhadas alem da area visivel, acima e abaixo. Evita a faixa em
// branco no instante entre rolar e renderizar.
const OVERSCAN = 6;

// Onde a linha do ponteiro fica ao ser trazida a vista: algumas linhas abaixo
// do topo, para o que ja foi empilhado continuar visivel acima dela.
const POINTER_MARGIN = 4;

// Cor de cada classe de byte no dump: quem le distingue "aqui ha texto" de
// "aqui ha binario" sem decodificar o hexadecimal ao lado.
const ASCII_COLOR = {
  printable: "text-[#ce9178]",
  control: "text-[#569cd6]",
  null: "text-[#4a4a4a]",
  unknown: "text-[#6b6b6b]",
};

/**
 * Painel da pilha.
 *
 * A linha apontada por ESP/RSP fica marcada, e as celulas escritas no ultimo
 * passo vem destacadas — e a mesma leitura dos slides, em que a celula nova
 * aparece em branco sobre o fundo escuro.
 */
export default function StackPane({ machine, changed = [], onViewInDump }) {
  const { t } = useI18n();
  const { openDumpMenu, dumpMenu } = useDumpMenu(machine, onViewInDump);
  // Ligado por padrao: numa aula de shellcode a pilha quase sempre carrega
  // texto, e o dump e o que revela isso sem precisar abrir outro painel.
  const [showAscii, setShowAscii] = useState(true);

  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(240);

  const arch = machine?.arch;
  const wordSize = BigInt(arch?.wordSize || 4);
  // A regiao inteira, do limite ao teto — e nao uma janela de N linhas ao
  // redor do ponteiro. Quem estuda estouro de buffer precisa ver ATE ONDE a
  // escrita foi, e um recorte fixo esconde justamente o alcance dela.
  const limit = machine ? machine.stackLimit : 0n;
  const total = machine
    ? Number((machine.stackCeiling - limit) / wordSize) + 1
    : 0;
  const sp = machine ? machine.cpu.sp : 0n;

  const rowOf = useCallback(
    (address) => Number((BigInt(address) - limit) / wordSize),
    [limit, wordSize]
  );

  // Ultimo ponteiro ja trazido a vista. Numa ref, e nao no estado: mudar de
  // valor aqui nao pode, sozinho, pedir outro render.
  const revealed = useRef(null);
  const spKey = sp.toString();

  /**
   * Depois de CADA render: a altura e a rolagem do elemento sao a verdade.
   *
   * Duas coisas acontecem aqui, e as duas precisam do DOM ja montado:
   *
   * 1. O ponteiro mudou (ou o painel acabou de montar) → a linha dele vem a
   *    vista. So nesse caso: rolar a pilha a mao para olhar um endereco
   *    distante e uma leitura legitima — e o motivo de o painel mostrar a
   *    regiao inteira —, e devolve-lo ao ponteiro a cada render a desfaria.
   * 2. Altura e rolagem do elemento sao copiadas para o estado. Redimensionar
   *    o painel muda as duas SEM passar por evento nenhum: o navegador corta
   *    a rolagem quando a area cresce, e o `onScroll` pode nem disparar. Com o
   *    estado desatualizado, a janela desenhada fica fora do lugar e sobra uma
   *    faixa em branco onde deveria haver linhas.
   *
   * Sem lista de dependencias de proposito, e por isso a regra fica desligada
   * aqui: o que muda e a ALTURA DO PAI, que nao e prop nem estado deste
   * componente — nenhuma dependencia mudaria quando a divisoria e arrastada, e
   * com lista o efeito simplesmente nao rodaria. Nao ha risco de laco: os dois
   * `set` so disparam quando o valor difere do que ja esta no estado.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    if (spKey !== revealed.current) {
      const top = Math.max(0, (rowOf(sp) - POINTER_MARGIN) * ROW_HEIGHT);
      const highest = Math.max(0, total * ROW_HEIGHT - element.clientHeight);
      element.scrollTop = Math.min(top, highest);
      // So dado por feito com a altura ja medida: antes dela o navegador
      // limita a rolagem a zero, e a linha nunca teria chegado ao lugar.
      if (element.clientHeight > 0) revealed.current = spKey;
    }

    // Altura zero e o painel ainda sem layout (ou um ambiente sem ele): manter
    // a estimativa desenha algumas linhas, e zero nao desenharia nenhuma.
    if (element.clientHeight && element.clientHeight !== viewport) {
      setViewport(element.clientHeight);
    }
    if (element.scrollTop !== scrollTop) setScrollTop(element.scrollTop);
  });

  // Altura visivel: quantas linhas desenhar. Um ResizeObserver, e nao a altura
  // do primeiro render — a divisoria do painel e arrastavel.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  if (!machine) return null;

  const { cpu, memory } = machine;
  const digits = arch.bits === 64 ? 16 : 8;

  // Enderecos alterados no passo (byte a byte) reduzidos a palavra da pilha.
  const changedWords = new Set(
    changed.map((address) => {
      const value = BigInt(address);
      return (value - (value % wordSize)).toString();
    })
  );

  // So as linhas visiveis viram DOM: a pilha tem milhares de palavras (e pode
  // crescer ate 1 MB), e desenha-las todas travaria o painel a cada passo.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.max(
    0,
    Math.min(total - first, Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2)
  );

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const address = limit + BigInt(first + i) * wordSize;
    const value = memory.read(address, arch.wordSize);
    rows.push({
      address,
      value,
      isPointer: address === sp,
      isBase: address === cpu.readRegister(arch.basePointer),
      changed: changedWords.has(address.toString()),
      // Ordem de memoria (byte baixo primeiro): e assim que uma string na
      // pilha se le da esquerda para a direita, ao contrario do hexadecimal
      // little-endian ao lado.
      bytes: memory.readBytes(address, arch.wordSize),
      string: pointerString(machine, value),
      // Valor que aponta para dentro do codigo carregado. E quase sempre um
      // endereco de retorno, e dize-lo e o que transforma um numero solto na
      // pilha no caminho de volta da chamada.
      code: codeReference(machine, value),
    });
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.stack", "Stack")}
        </span>
        {/* Div, e nao <label>: o Switch e um <button>, e um label associado
            reenviaria o clique para ele — o texto alternaria duas vezes. */}
        <div className="ml-auto flex select-none items-center gap-2 text-[10px] uppercase tracking-wider text-[#9a9a9a]">
          <span className="cursor-pointer" onClick={() => setShowAscii(!showAscii)}>
            {t("sim.viewAscii", "View ASCII")}
          </span>
          {/* O Switch padrao tem 24px de altura e engordaria o cabecalho em
              relacao aos demais paineis; a escala mantem o mesmo componente. */}
          <span className="flex origin-right scale-75 items-center">
            <Switch
              checked={showAscii}
              onChange={setShowAscii}
              ariaLabel={t("sim.viewAscii", "View ASCII")}
            />
          </span>
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="flex-1 overflow-auto font-mono text-[12px] leading-[18px]"
      >
        {/* Espacador da altura TOTAL da regiao: e ele que dimensiona a barra
            de rolagem, ainda que so a janela visivel exista no DOM. */}
        <div style={{ height: total * ROW_HEIGHT }} className="relative">
        <div style={{ position: "absolute", top: first * ROW_HEIGHT, left: 0, right: 0 }}>
        {rows.map((row) => (
          <div
            key={row.address.toString()}
            // Dois destinos possiveis por linha: o endereco da propria celula
            // e o valor guardado nela, quando ele aponta para algum lugar.
            onContextMenu={(event) =>
              openDumpMenu(event, [
                { label: t("dump.thisAddress", "this address"), address: row.address },
                { label: t("dump.thisValue", "this value"), address: row.value },
              ])
            }
            // Altura fixa, e nao a natural: a conta que converte rolagem em
            // endereco depende dela, e o rotulo em 11px ao lado do valor em
            // 12px faria a linha crescer uma fracao de pixel — o bastante
            // para as linhas sairem do lugar depois de algumas centenas.
            style={{ height: ROW_HEIGHT }}
            className={cn(
              "flex items-baseline gap-3 whitespace-pre px-2",
              row.isPointer && "bg-[#094771]"
            )}
          >
            <span className="w-[5ch] shrink-0 text-[#c586c0]">
              {row.isPointer
                ? arch.stackPointer.toUpperCase()
                : row.isBase
                ? arch.basePointer.toUpperCase()
                : " "}
            </span>
            <span className={cn("shrink-0", row.isPointer ? "text-white" : "text-[#858585]")}>
              {hex(row.address, digits)}
            </span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                row.changed
                  ? "rounded-sm bg-[#5a1d1d] font-bold text-[#ff6b6b]"
                  : "text-[#d4d4d4]"
              )}
            >
              {hex(row.value, digits)}
            </span>
            {showAscii && <AsciiDump bytes={row.bytes} />}
            {row.code ? (
              <CodeLabel reference={row.code} />
            ) : (
              row.string && (
                <span className="min-w-0 truncate text-[11px] text-[#ce9178]" title={row.string}>
                  <span className="text-[#6b6b6b]">{"→ "}</span>
                  {`"${row.string}"`}
                </span>
              )
            )}
          </div>
        ))}
        </div>
        </div>
      </div>
      {dumpMenu}
    </section>
  );
}

/**
 * O que uma celula da pilha que aponta para o CODIGO esta guardando.
 *
 * Um endereco de retorno e o valor mais importante da pilha e o mais mudo: um
 * numero como qualquer outro. O rotulo diz para onde ele leva, como o
 * "return to …" do x64dbg — que e a leitura que faz o estouro de buffer
 * deixar de ser abstrato. Quem chamou fica como "???": e o que o aluno tem
 * de deduzir.
 */
function CodeLabel({ reference }) {
  const { t } = useI18n();
  const where = `code+0x${reference.offset.toString(16).toUpperCase()}`;
  const line = reference.instruction?.line;

  if (!reference.isReturn) {
    return (
      <span className="min-w-0 truncate text-[11px] text-[#4ec9b0]">
        <span className="text-[#6b6b6b]">{"→ "}</span>
        {where}
        {line ? ` (${t("sim.line", "line")} ${line})` : ""}
      </span>
    );
  }

  // De QUEM se volta fica em branco de proposito: descobrir a origem do
  // endereco de retorno e o exercicio: o "???" marca o lugar da resposta em
  // vez de entrega-la.
  return (
    <span className="min-w-0 truncate text-[11px] text-[#d16969]">
      {t("sim.returnTo", "return to")} {where}
      {line ? ` (${t("sim.line", "line")} ${line})` : ""} ???
    </span>
  );
}

/**
 * Dump ASCII de uma palavra da pilha.
 *
 * Uma coluna de largura fixa por byte (`w-[1ch]`): assim o dump continua
 * alinhado entre linhas mesmo quando um byte cai num glifo de controle ou no
 * caractere de "nao conhecido", que nao tem a mesma largura da fonte.
 */
function AsciiDump({ bytes }) {
  return (
    <span className="shrink-0 border-l border-[#3c3c3c] pl-3 font-dump">
      {Array.from(bytes, (byte, index) => {
        const cell = asciiCell(byte);
        return (
          <span
            key={index}
            title={cell.label}
            // SEM overflow-hidden: por especificacao, um `inline-block` com
            // overflow diferente de `visible` passa a ter a baseline na borda
            // INFERIOR, e o `items-baseline` da linha entao empurra tudo para
            // baixo — a faixa azul crescia e o texto ficava colado no topo.
            // A largura fixa ja basta: a face `font-dump` e a embarcada, cuja
            // cobertura de glifos e verificada (ver o README da fonte).
            className={cn("inline-block w-[1ch] text-center", ASCII_COLOR[cell.kind])}
          >
            {cell.char}
          </span>
        );
      })}
    </span>
  );
}
