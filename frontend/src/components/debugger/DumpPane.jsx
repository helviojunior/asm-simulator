import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, CornerDownLeft } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { asciiCell, hex, parseAddress } from "lib/cpu/format";
import { COPY_FORMATS, dumpWindow, formatBytes, selectionValue } from "lib/cpu/dump";
import { describeRegion } from "lib/cpu/inspect";
import { copyText } from "lib/clipboard";
import { ContextMenu, useContextMenu } from "components/ui/contextMenu";

// Altura de uma linha, em pixels. Fixa de proposito: e ela que converte
// posicao de rolagem em endereco, e uma altura medida do DOM tornaria essa
// conta dependente da fonte que carregou.
const ROW_HEIGHT = 18;

// Linhas desenhadas alem da area visivel, acima e abaixo. Evita a faixa em
// branco no instante entre rolar e renderizar.
const OVERSCAN = 4;

// Larguras oferecidas. 16 e o padrao de qualquer dump; 8 serve ao painel
// estreito e 32 a quem alargou a coluna.
const WIDTHS = [8, 16, 32];

// Cor de cada classe de byte, igual a da pilha: quem le distingue "aqui ha
// texto" de "aqui ha binario" sem decodificar o hexadecimal ao lado.
const ASCII_COLOR = {
  printable: "text-[#ce9178]",
  control: "text-[#569cd6]",
  null: "text-[#4a4a4a]",
  unknown: "text-[#6b6b6b]",
};

/**
 * Dump de memoria, no formato do x64dbg: endereco, bytes em hexadecimal e a
 * leitura ASCII dos mesmos bytes.
 *
 * Duas decisoes explicam o resto do arquivo:
 *
 * 1. **A faixa navegavel e limitada** (`dumpWindow`). Um espaco de 64 bits nao
 *    cabe numa barra de rolagem, e rolar por 16 exabytes de zeros nao mostra
 *    nada; o painel percorre a regiao em que o endereco atual esta — codigo,
 *    pilha, ou a vizinhanca do que se pediu para ver.
 * 2. **So as linhas visiveis sao desenhadas.** A pilha do simulador tem 16 KB,
 *    o que daria mil linhas de uma vez; a rolagem e traduzida em endereco e
 *    apenas a janela visivel vira DOM.
 *
 * A selecao e uma FAIXA CONTIGUA de enderecos (ancora + foco), como no
 * x64dbg — nao um conjunto de bytes soltos. E o que se copia.
 */
export default function DumpPane({ machine, changed = [], target = null, tick = 0 }) {
  const { t } = useI18n();

  // `tick` sobe a cada passo. E dependencia das leituras de memoria mais
  // abaixo: a maquina muda por MUTACAO e nao troca de identidade, entao sem
  // ele o dump mostraria os bytes do primeiro render para sempre.
  const scrollRef = useRef(null);
  const [width, setWidth] = useState(16);
  // Endereco de referencia: define QUAL faixa o painel navega. Muda ao seguir
  // um ponteiro ou ao digitar um endereco, nao ao rolar.
  const [origin, setOrigin] = useState(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(240);
  // Faixa selecionada: `{ anchor, focus }` em BigInt, inclusiva nas duas
  // pontas. null quando nada esta selecionado.
  const [selection, setSelection] = useState(null);
  const [goto, setGoto] = useState("");
  // Confirmacao da copia. Local, e nao um toast: o aviso pertence ao botao que
  // foi apertado, e a area de avisos do sistema fica noutro painel.
  const [copied, setCopied] = useState(null);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const digits = machine?.arch.bits === 64 ? 16 : 8;
  const wordSize = machine?.arch.wordSize ?? 4;

  // Endereco de partida quando ninguem pediu nada: o inicio do codigo, que e
  // onde o programa carregado esta.
  const fallback = machine ? machine.codeBase : 0n;
  const at = origin ?? fallback;
  const window_ = useMemo(() => dumpWindow(machine, at), [machine, at]);

  const rowBytes = BigInt(width);
  const totalRows = Number((window_.end - window_.start) / rowBytes);

  const changedSet = useMemo(() => new Set(changed.map(String)), [changed]);

  // Programa novo: a faixa antiga (a pilha do programa anterior, por exemplo)
  // deixou de existir, e a selecao apontaria para bytes que ninguem escreveu.
  useEffect(() => {
    setOrigin(null);
    setSelection(null);
  }, [machine]);

  const addressAtRow = useCallback(
    (index) => window_.start + BigInt(index) * rowBytes,
    [window_.start, rowBytes]
  );

  /** Rola ate a linha que contem `address`, deixando-a no meio da area. */
  const revealAddress = useCallback(
    (address) => {
      const element = scrollRef.current;
      if (!element) return;
      const row = Number((BigInt(address) - window_.start) / rowBytes);
      const top = row * ROW_HEIGHT - element.clientHeight / 2 + ROW_HEIGHT;
      element.scrollTop = Math.max(0, Math.min(top, totalRows * ROW_HEIGHT - element.clientHeight));
    },
    [window_.start, rowBytes, totalRows]
  );

  /** Leva o painel a um endereco e o deixa selecionado. */
  const focusAddress = useCallback((address) => {
    const value = BigInt(address);
    setOrigin(value);
    setSelection({ anchor: value, focus: value });
  }, []);

  // Pedido vindo de outro painel ("ver no dump"). O `nonce` faz o mesmo
  // endereco poder ser pedido duas vezes seguidas e ainda assim rolar.
  const requested = target?.address ?? null;
  const nonce = target?.nonce ?? 0;
  useEffect(() => {
    if (requested === null || requested === undefined) return;
    focusAddress(requested);
  }, [requested, nonce, focusAddress]);

  // A rolagem ate o endereco pedido acontece DEPOIS do render: a faixa pode
  // ter mudado junto, e a altura total so existe com ela ja aplicada.
  useLayoutEffect(() => {
    if (origin === null) return;
    revealAddress(origin);
    // De proposito sem `revealAddress` nas dependencias: ela muda a cada troca
    // de faixa, e reexecutar aqui desfaria a rolagem manual do usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, window_.start, rowBytes]);

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

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.min(totalRows - first, Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2);

  const rows = useMemo(() => {
    if (!machine) return [];
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const address = addressAtRow(first + i);
      out.push({ address, bytes: machine.memory.readBytes(address, width) });
    }
    return out;
    // `tick` entra aqui: a memoria muda por mutacao e o array de bytes
    // precisa ser relido a cada passo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, first, count, width, addressAtRow, tick]);

  // ------------------------------------------------------------------
  // Selecao
  // ------------------------------------------------------------------

  // Faixa normalizada (menor -> maior): a ancora fica onde o botao desceu, e
  // arrastar para CIMA a deixa depois do foco. Num useMemo porque ela e
  // dependencia dos callbacks de copia — recria-la a cada render os recriaria
  // junto, sem nada ter mudado.
  const range = useMemo(() => {
    if (!selection) return null;
    return selection.anchor <= selection.focus
      ? { from: selection.anchor, to: selection.focus }
      : { from: selection.focus, to: selection.anchor };
  }, [selection]);

  const selectedBytes = useMemo(() => {
    if (!machine || !range) return new Uint8Array(0);
    const length = Number(range.to - range.from) + 1;
    return machine.memory.readBytes(range.from, length);
    // `tick` entra porque a memoria muda por mutacao: os mesmos enderecos
    // podem guardar outros bytes depois de um passo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, range, tick]);

  // Arrasto: a ancora fica onde o botao desceu e o foco acompanha o ponteiro.
  // Numa ref, e nao no estado: o movimento do mouse dispara dezenas de vezes
  // por segundo e nao precisa de render proprio.
  const dragging = useRef(false);
  const pointerY = useRef(0);

  const startSelection = useCallback((address, extend) => {
    setSelection((current) =>
      extend && current ? { ...current, focus: address } : { anchor: address, focus: address }
    );
  }, []);

  useEffect(() => {
    const stop = () => { dragging.current = false; };
    const track = (event) => { pointerY.current = event.clientY; };
    window.addEventListener("mouseup", stop);
    window.addEventListener("mousemove", track);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("mousemove", track);
    };
  }, []);

  // Arrastar para fora da area rola sozinho. Sem isto, selecionar mais bytes
  // do que cabem na tela exigiria soltar o botao no meio do caminho.
  useEffect(() => {
    const timer = setInterval(() => {
      const element = scrollRef.current;
      if (!dragging.current || !element) return;
      const box = element.getBoundingClientRect();
      if (pointerY.current < box.top) element.scrollTop -= ROW_HEIGHT;
      else if (pointerY.current > box.bottom) element.scrollTop += ROW_HEIGHT;
    }, 60);
    return () => clearInterval(timer);
  }, []);

  // ------------------------------------------------------------------
  // Copia
  // ------------------------------------------------------------------

  const announce = useCallback((label) => {
    setCopied(label);
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, []);

  const copySelection = useCallback(
    async (format) => {
      if (!range) return;
      const text =
        format === "address"
          ? hex(range.from, digits)
          : formatBytes(selectedBytes, format);
      const ok = await copyText(text);
      announce(ok ? t("dump.copied", "Copied") : t("dump.copyFailed", "Could not copy"));
    },
    [range, selectedBytes, digits, announce, t]
  );

  // ------------------------------------------------------------------
  // Teclado
  // ------------------------------------------------------------------

  const moveFocus = useCallback(
    (delta, extend) => {
      const from = selection ? selection.focus : at;
      let next = from + BigInt(delta);
      if (next < window_.start) next = window_.start;
      if (next >= window_.end) next = window_.end - 1n;

      setSelection(extend && selection ? { ...selection, focus: next } : { anchor: next, focus: next });
      revealSoon(scrollRef, window_.start, rowBytes, next);
    },
    [selection, at, window_.start, window_.end, rowBytes]
  );

  const handleKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection("hex");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      // A pagina visivel, e nao a faixa inteira: "tudo" numa pilha de 16 KB
      // seria uma selecao que ninguem consegue conferir.
      event.preventDefault();
      const top = addressAtRow(Math.floor(scrollTop / ROW_HEIGHT));
      const lines = Math.max(1, Math.floor(viewport / ROW_HEIGHT));
      setSelection({ anchor: top, focus: top + BigInt(lines * width) - 1n });
      return;
    }

    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -width,
      ArrowDown: width,
      PageUp: -width * Math.max(1, Math.floor(viewport / ROW_HEIGHT)),
      PageDown: width * Math.max(1, Math.floor(viewport / ROW_HEIGHT)),
    }[event.key];

    if (step !== undefined) {
      event.preventDefault();
      moveFocus(step, event.shiftKey);
      return;
    }
    if (event.key === "Escape") setSelection(null);
  };

  // ------------------------------------------------------------------
  // Navegacao
  // ------------------------------------------------------------------

  const submitGoto = (event) => {
    event.preventDefault();
    const parsed = parseAddress(goto.trim());
    if (parsed === null) return;
    focusAddress(parsed);
  };

  // Atalhos de navegacao. A cor liga cada botao ao que ele mostra: as mesmas
  // dos rotulos de regiao no rodape, para "fui parar na `.data`" ser a mesma
  // informacao nos dois lugares.
  const shortcuts = machine
    ? [
        {
          key: "ip",
          label: machine.arch.instructionPointer.toUpperCase(),
          address: machine.cpu.ip,
          color: "text-[#c586c0] hover:text-[#dda0dd]",
        },
        {
          key: "sp",
          label: machine.arch.stackPointer.toUpperCase(),
          address: machine.cpu.sp,
          color: "text-[#c586c0] hover:text-[#dda0dd]",
        },
        {
          key: "text",
          label: ".text",
          address: machine.textBase,
          color: "text-[#569cd6] hover:text-[#9cdcfe]",
        },
        {
          // Sempre oferecida, ainda que a `.data` esteja vazia: o atalho leva
          // ao ponto onde ela comecaria, que e a resposta certa para "onde
          // ficam os meus dados?" num programa que ainda nao declarou nenhum.
          key: "data",
          label: ".data",
          address: machine.dataBase,
          color: "text-[#4ec9b0] hover:text-[#7fdbca]",
          empty: machine.dataEnd === machine.dataBase,
        },
      ]
    : [];

  if (!machine) {
    return (
      <section className="flex h-full flex-col items-start bg-[#1e1e1e] p-3">
        <p className="text-[12px] text-[#6b6b6b]">
          {t("dump.idle", "Assemble a program to inspect memory.")}
        </p>
      </section>
    );
  }

  const menuItems = buildMenuItems(t, range, copySelection);

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Barra de navegacao: para onde ir, e como as linhas sao quebradas. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#3c3c3c] px-2 py-1">
        <form onSubmit={submitGoto} className="flex items-center gap-1">
          <label className="text-[10px] uppercase tracking-wider text-[#9a9a9a]" htmlFor="dump-goto">
            {t("dump.goto", "Go to")}
          </label>
          <input
            id="dump-goto"
            value={goto}
            onChange={(event) => setGoto(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="w-[16ch] rounded bg-[#3c3c3c] px-1.5 py-0.5 font-mono text-[11px] text-[#d4d4d4] outline-none placeholder:text-[#6b6b6b]"
          />
          <button
            type="submit"
            title={t("dump.goto", "Go to")}
            aria-label={t("dump.goto", "Go to")}
            className="rounded p-1 text-[#6b6b6b] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
          >
            <CornerDownLeft size={12} />
          </button>
        </form>

        {shortcuts.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => focusAddress(item.address)}
            // Sem `uppercase`: `.text` e `.data` sao nomes de secao, e `.DATA`
            // nao existe em fonte nenhum. Os registradores ja vem em maiuscula
            // do proprio rotulo.
            title={`${hex(item.address, digits)}${
              item.empty ? ` — ${t("dump.emptySection", "empty")}` : ""
            }`}
            className={cn(
              "rounded bg-[#3c3c3c] px-1.5 py-0.5 font-mono text-[10px] tracking-wider transition-colors hover:bg-[#4a4a4a]",
              item.color,
              // Secao vazia continua clicavel — leva ao ponto onde ela
              // comecaria —, mas dizer que nao ha nada la evita a leitura de
              // que o dump falhou ao abrir.
              item.empty && "opacity-50"
            )}
          >
            {item.label}
          </button>
        ))}

        <select
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
          aria-label={t("dump.bytesPerRow", "Bytes per row")}
          className="ml-auto rounded bg-[#3c3c3c] px-1 py-0.5 text-[10px] text-[#d4d4d4] outline-none"
        >
          {WIDTHS.map((value) => (
            <option key={value} value={value}>
              {value}/{t("dump.row", "row")}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => copySelection("hex")}
          disabled={!range}
          title={t("dump.copyHex", "Copy bytes as hex")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
            range
              ? "text-[#d4d4d4] hover:bg-[#3c3c3c] hover:text-[#9cdcfe]"
              : "cursor-not-allowed text-[#5a5a5a]"
          )}
        >
          <Copy size={11} />
          {t("common.copy", "Copy")}
        </button>
      </div>

      {/* Cabecalho das colunas, fora da area rolavel: rolar o dump nao pode
          levar embora o rotulo que diz o que cada coluna e. */}
      <div className="flex shrink-0 gap-3 whitespace-pre border-b border-[#3c3c3c] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#6b6b6b]">
        <span style={{ width: `${digits}ch` }} className="shrink-0">
          {t("dump.address", "Address")}
        </span>
        <span style={{ width: `${width * 3 - 1}ch` }} className="shrink-0">
          {t("dump.hex", "Hex")}
        </span>
        <span className="shrink-0">{t("dump.ascii", "ASCII")}</span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-label={t("dump.title", "Dump")}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[18px] outline-none focus:ring-1 focus:ring-inset focus:ring-[#0e639c]"
      >
        {/* Espacador da altura TOTAL da faixa: e ele que dimensiona a barra de
            rolagem, ainda que so a janela visivel exista no DOM. */}
        <div style={{ height: totalRows * ROW_HEIGHT }} className="relative w-max min-w-full">
          <div style={{ position: "absolute", top: first * ROW_HEIGHT, left: 0 }}>
            {rows.map((row) => (
              <Row
                key={row.address.toString()}
                row={row}
                width={width}
                digits={digits}
                machine={machine}
                range={range}
                changedSet={changedSet}
                onSelect={startSelection}
                onDragStart={() => { dragging.current = true; }}
                isDragging={dragging}
                onMenu={openMenu}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Rodape: o que esta selecionado, lido como numero. Inverter os bytes
          de cabeca e o erro mais comum de quem esta comecando a ler um dump. */}
      <footer className="flex shrink-0 items-center gap-3 overflow-hidden whitespace-pre border-t border-[#3c3c3c] px-2 py-1 font-mono text-[11px]">
        {range ? (
          <>
            <RegionLabel machine={machine} address={range.from} />
            <span className="shrink-0 text-[#858585]">
              {hex(range.from, digits)}
              {range.to !== range.from && `…${hex(range.to, digits)}`}
            </span>
            <span className="shrink-0 text-[#6a9955]">
              {Number(range.to - range.from) + 1} {t("dump.bytes", "bytes")}
            </span>
            <SelectionValue bytes={selectedBytes} wordSize={wordSize} t={t} />
          </>
        ) : (
          <span className="truncate text-[#6b6b6b]">
            {t("dump.selectHint", "Click or drag over the bytes to select; Ctrl+C copies.")}
          </span>
        )}
        {copied && <span className="ml-auto shrink-0 text-[#4ec9b0]">{copied}</span>}
      </footer>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </section>
  );
}

/**
 * Rola ate `address` no proximo quadro.
 *
 * Fora do componente porque e chamada de dentro do atualizador do `useState`,
 * que roda no meio do render — mexer no DOM ali seria efeito colateral em
 * fase errada.
 */
function revealSoon(scrollRef, start, rowBytes, address) {
  requestAnimationFrame(() => {
    const element = scrollRef.current;
    if (!element) return;
    const row = Number((address - start) / rowBytes);
    const top = row * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  });
}

function buildMenuItems(t, range, copySelection) {
  if (!range) {
    return [{ key: "empty", label: t("dump.noSelection", "Nothing selected"), disabled: true, onSelect: () => {} }];
  }

  const labels = {
    hex: t("dump.copyHex", "Copy bytes as hex"),
    hexRaw: t("dump.copyHexRaw", "Copy bytes as hex, no spaces"),
    escaped: t("dump.copyEscaped", "Copy bytes as \\x escapes"),
    db: t("dump.copyDb", "Copy bytes as db directives"),
    ascii: t("dump.copyAscii", "Copy bytes as ASCII"),
  };

  return [
    ...COPY_FORMATS.map((format) => ({
      key: format,
      label: labels[format],
      icon: Copy,
      onSelect: () => copySelection(format),
    })),
    { separator: true },
    {
      key: "address",
      label: t("dump.copyAddress", "Copy address"),
      icon: Copy,
      onSelect: () => copySelection("address"),
    },
  ];
}

/** Uma linha do dump: endereco, bytes e a leitura ASCII dos mesmos bytes. */
function Row({ row, width, digits, machine, range, changedSet, onSelect, onDragStart, isDragging, onMenu }) {
  const cells = Array.from(row.bytes, (byte, index) => {
    const address = row.address + BigInt(index);
    return {
      byte,
      address,
      key: address.toString(),
      selected: Boolean(range && address >= range.from && address <= range.to),
      changed: changedSet.has(address.toString()),
      // Byte que ninguem escreveu: a memoria e esparsa e le zero por padrao.
      // Esmaecer distingue "esta zerado" de "nunca foi tocado".
      defined: machine.memory.isDefined(address),
    };
  });

  const handlers = (address) => ({
    // O endereco no proprio elemento: e por ele que o teste encontra um byte,
    // e e o que responde "que endereco e este?" ao inspecionar a pagina.
    "data-address": address.toString(),
    onMouseDown: (event) => {
      if (event.button !== 0) return;
      // Sem isto o navegador comeca a selecionar o TEXTO da pagina, e o
      // arrasto pinta as linhas de azul por cima da selecao do painel.
      event.preventDefault();
      event.currentTarget.closest("[role=grid]")?.focus();
      onDragStart();
      onSelect(address, event.shiftKey);
    },
    // `onMouseOver`, e nao `onMouseEnter`: o de entrada nao borbulha, e o
    // React o sintetiza a partir deste. Para o arrasto os dois disparam no
    // mesmo instante — ao ponteiro alcancar a celula.
    onMouseOver: () => {
      if (isDragging.current) onSelect(address, true);
    },
    onContextMenu: (event) => {
      // Clique direito fora da selecao seleciona o byte de baixo primeiro —
      // senao o menu copiaria bytes que nao sao os que estao sob o cursor.
      const inside = range && address >= range.from && address <= range.to;
      if (!inside) onSelect(address, false);
      onMenu(event, address);
    },
  });

  return (
    <div className="flex gap-3 whitespace-pre px-2">
      <span style={{ width: `${digits}ch` }} className="shrink-0 select-none text-[#858585]">
        {hex(row.address, digits)}
      </span>

      <span style={{ width: `${width * 3 - 1}ch` }} className="shrink-0">
        {cells.map((cell, index) => (
          <React.Fragment key={cell.key}>
            {index > 0 && <span className="select-none text-[#3c3c3c]"> </span>}
            <span
              {...handlers(cell.address)}
              className={cn(
                "inline-block w-[2ch] cursor-text text-center tabular-nums",
                cell.selected
                  ? "bg-[#264f78] text-white"
                  : cell.changed
                  ? "bg-[#5a1d1d] font-bold text-[#ff6b6b]"
                  : cell.defined
                  ? "text-[#d4d4d4]"
                  : "text-[#4a4a4a]"
              )}
            >
              {hex(BigInt(cell.byte), 2)}
            </span>
          </React.Fragment>
        ))}
      </span>

      <span className="shrink-0 border-l border-[#3c3c3c] pl-3 font-dump">
        {cells.map((cell) => {
          const ascii = asciiCell(cell.byte);
          return (
            <span
              key={cell.key}
              {...handlers(cell.address)}
              title={ascii.label}
              // SEM overflow: um `inline-block` com overflow diferente de
              // `visible` passa a ter a baseline na borda inferior, e a linha
              // inteira desce. A largura fixa ja basta para alinhar.
              className={cn(
                "inline-block w-[1ch] cursor-text text-center",
                cell.selected ? "bg-[#264f78] text-white" : ASCII_COLOR[ascii.kind]
              )}
            >
              {ascii.char}
            </span>
          );
        })}
      </span>
    </div>
  );
}

/**
 * Em que regiao o byte selecionado esta.
 *
 * Endereco solto nao diz nada; `.data+0x0` diz que aquilo e a primeira
 * variavel declarada, e `stack` diz que e memoria que o programa empilhou.
 */
function RegionLabel({ machine, address }) {
  const { t } = useI18n();
  const { region, offset } = describeRegion(machine, address);
  if (!region) return null;

  // `.text` e `.data` sao nomes de secao — nao se traduzem. A pilha nao tem
  // nome de secao, e ai vale a palavra.
  const name =
    region === "code" ? ".text" : region === "data" ? ".data" : t("dump.regionStack", "stack");
  return (
    <span
      className={cn(
        "shrink-0",
        region === "data" ? "text-[#4ec9b0]" : region === "stack" ? "text-[#c586c0]" : "text-[#569cd6]"
      )}
    >
      {name}+0x{(offset < 0n ? -offset : offset).toString(16).toUpperCase()}
    </span>
  );
}

/** A selecao lida como inteiro little-endian, quando ela tem tamanho para isso. */
function SelectionValue({ bytes, wordSize, t }) {
  const read = selectionValue(bytes);
  if (!read) return null;
  return (
    <span className="shrink-0 text-[#d4d4d4]">
      <span className="text-[#6b6b6b]">
        {bytes.length === wordSize ? t("dump.word", "word") : `${t("dump.value", "value")} ${bytes.length}B`}{" "}
      </span>
      {hex(read.value, read.digits)}
    </span>
  );
}
