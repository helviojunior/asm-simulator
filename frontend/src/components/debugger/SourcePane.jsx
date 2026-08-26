import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { TOKEN_COLOR, tokenizeLine } from "lib/asm/highlight";

// Metricas fixadas em pixel e aplicadas IDENTICAS as duas camadas. Qualquer
// divergencia entre elas desalinha o texto colorido do texto real.
const FONT_SIZE = 12;
const LINE_HEIGHT = 18;
const GUTTER_WIDTH = 52;
const PADDING_TOP = 8;
// Indentacao em espacos, como o Sublime com `translate_tabs_to_spaces`: a
// tecla Tab nunca insere `\t` no arquivo.
const TAB_SIZE = 4;
const INDENT = " ".repeat(TAB_SIZE);

/**
 * Editor de codigo-fonte NASM com coloracao e realce da linha em execucao.
 *
 * Um `<textarea>` nao colore o proprio texto. A solucao classica, usada aqui:
 * duas camadas sobrepostas — embaixo um `<pre>` com os tokens coloridos, em
 * cima o `<textarea>` real com o texto TRANSPARENTE (so o cursor aparece).
 * O que se ve e a camada de baixo; o que se digita e a de cima.
 *
 * Isso so alinha porque a fonte e monoespacada e as duas camadas usam a mesma
 * font-size, line-height e padding — dai as constantes acima.
 */
export default function SourcePane({
  source,
  onChange,
  messages = [],
  disabled,
  currentLine = null,
  // Dentro do EditorPane a barra de abas ja identifica o painel; um segundo
  // cabecalho logo abaixo seria ruido.
  hideHeader = false,
}) {
  const { t } = useI18n();
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const gutterRef = useRef(null);

  // Selecao a restaurar quando a edicao NAO passa pelo `execCommand` (jsdom,
  // navegador antigo): ali o valor volta pelo React, e mexer no cursor antes
  // do re-render seria desfeito por ele.
  const pendingSelection = useRef(null);

  const lines = useMemo(() => source.split("\n"), [source]);
  const tokenized = useMemo(() => lines.map(tokenizeLine), [lines]);

  // A camada de baixo nao tem barra de rolagem propria: ela e arrastada para
  // acompanhar a de cima.
  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    // O gutter acompanha so a vertical: numero de linha nao rola para o lado.
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }, []);

  // Mantem a linha em execucao visivel, como a desmontagem faz com o RIP.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !currentLine) return;

    const top = (currentLine - 1) * LINE_HEIGHT;
    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight - LINE_HEIGHT * 2;
    if (top < viewTop || top > viewBottom) {
      textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 2);
      syncScroll();
    }
  }, [currentLine, syncScroll]);

  useEffect(() => {
    const selection = pendingSelection.current;
    if (!selection || !textareaRef.current) return;
    pendingSelection.current = null;
    textareaRef.current.setSelectionRange(selection[0], selection[1]);
  }, [source]);

  /**
   * Substitui o trecho `[start, end)` preservando o historico de undo.
   *
   * `execCommand("insertText")` e a unica forma de escrever num textarea sem
   * zerar a pilha de Ctrl+Z do navegador — e, por disparar um evento `input`,
   * o React continua recebendo o `onChange`. Onde ele nao existe, cai no
   * caminho controlado e o cursor e reposicionado depois do re-render.
   */
  const replaceRange = useCallback(
    (start, end, text, selectionStart, selectionEnd) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(start, end);

      let inserted = false;
      if (typeof document.execCommand === "function") {
        try {
          inserted = document.execCommand("insertText", false, text);
        } catch (error) {
          inserted = false;
        }
      }

      if (inserted) {
        textarea.setSelectionRange(selectionStart, selectionEnd);
        return;
      }

      const value = textarea.value;
      pendingSelection.current = [selectionStart, selectionEnd];
      onChange(value.slice(0, start) + text + value.slice(end));
    },
    [onChange]
  );

  /**
   * Tab indenta, Shift+Tab desindenta — o comportamento do Sublime.
   *
   * Sem isso o Tab tira o foco do editor, que e o default do navegador. Com
   * cursor solto, completa ate a proxima parada de 4 colunas (2 espacos de
   * recuo viram 4, nao 6). Com varias linhas selecionadas, desloca o bloco
   * inteiro e mantem a selecao sobre ele.
   */
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      event.preventDefault();

      const value = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const multiline = value.slice(start, end).includes("\n");

      // Caso simples: nada selecionado (ou selecao numa linha so) e Tab —
      // vira espacos ate a proxima parada.
      if (!event.shiftKey && !multiline) {
        const column = start - (value.lastIndexOf("\n", start - 1) + 1);
        const spaces = " ".repeat(TAB_SIZE - (column % TAB_SIZE));
        replaceRange(start, end, spaces, start + spaces.length, start + spaces.length);
        return;
      }

      // Bloco: da primeira a ultima linha tocada pela selecao. Uma selecao que
      // termina exatamente no inicio de uma linha nao inclui essa linha.
      const blockStart = value.lastIndexOf("\n", start - 1) + 1;
      const lastLineProbe = end > start && value[end - 1] === "\n" ? end - 1 : end;
      const newline = value.indexOf("\n", lastLineProbe);
      const blockEnd = newline === -1 ? value.length : newline;

      let firstDelta = 0;
      let totalDelta = 0;
      const block = value
        .slice(blockStart, blockEnd)
        .split("\n")
        .map((line, index) => {
          let result = line;
          let delta = 0;
          if (event.shiftKey) {
            // Um `\t` herdado de arquivo antigo tambem sai, inteiro.
            const leading = /^(\t| {1,4})/.exec(line);
            if (leading) {
              result = line.slice(leading[0].length);
              delta = -leading[0].length;
            }
          } else if (line.trim() !== "") {
            // Linha em branco nao ganha recuo — viraria espaco solto.
            result = INDENT + line;
            delta = INDENT.length;
          }
          if (index === 0) firstDelta = delta;
          totalDelta += delta;
          return result;
        })
        .join("\n");

      if (totalDelta === 0) return;

      replaceRange(
        blockStart,
        blockEnd,
        block,
        Math.max(blockStart, start + firstDelta),
        Math.max(blockStart, end + totalDelta)
      );
    },
    [replaceRange]
  );

  const metrics = {
    fontSize: `${FONT_SIZE}px`,
    lineHeight: `${LINE_HEIGHT}px`,
    paddingTop: `${PADDING_TOP}px`,
    paddingBottom: `${PADDING_TOP}px`,
    tabSize: TAB_SIZE,
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      {!hideHeader && (
        <header className="flex shrink-0 items-baseline gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
            {t("sim.source", "Source (NASM)")}
          </span>
          {currentLine && (
            <span className="text-[10px] text-[#6a9955]">
              {t("sim.line", "line")} {currentLine}
            </span>
          )}
        </header>
      )}

      <div className="relative min-h-0 flex-1">
        {/* Numeros de linha — fora das camadas de texto para nao rolarem na
            horizontal junto com o codigo. */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 top-0 z-20 select-none overflow-hidden border-r border-[#2d2d2d] bg-[#1e1e1e] text-right"
          style={{ width: `${GUTTER_WIDTH}px`, ...metrics }}
        >
          {lines.map((_, index) => (
            <div
              key={index}
              className={cn(
                "pr-2",
                index + 1 === currentLine ? "bg-[#094771] text-white" : "text-[#5a5a5a]"
              )}
              style={{ height: `${LINE_HEIGHT}px` }}
            >
              {index + 1}
            </div>
          ))}
        </div>

        {/* Camada visivel: tokens coloridos + faixa da linha atual. */}
        <div
          ref={highlightRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre"
          style={{ ...metrics, paddingLeft: `${GUTTER_WIDTH + 8}px` }}
        >
          {tokenized.map((tokens, index) => (
            <div
              key={index}
              style={{ height: `${LINE_HEIGHT}px` }}
              className={cn(
                "-mx-[9999px] px-[9999px]",
                index + 1 === currentLine && "bg-[#094771]"
              )}
            >
              {tokens.length === 0 ? (
                <span> </span>
              ) : (
                tokens.map((token, position) => (
                  <span key={position} className={TOKEN_COLOR[token.kind]}>
                    {token.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </div>

        {/* Editor vazio: o `placeholder` nativo do textarea nao serve — o
            texto dele e transparente para deixar ver a camada colorida, e o
            placeholder herdaria essa cor. */}
        {source === "" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 select-none whitespace-pre text-[#5a5a5a]"
            style={{ ...metrics, paddingLeft: `${GUTTER_WIDTH + 8}px` }}
          >
            {t("sim.sourceEmpty", "Write your program here, or open one from the library.")}
          </div>
        )}

        {/* Camada real: recebe a digitacao, mas o texto e transparente — so o
            cursor e a selecao aparecem. */}
        <textarea
          ref={textareaRef}
          value={source}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          disabled={disabled}
          spellCheck={false}
          wrap="off"
          aria-label={t("sim.source", "Source (NASM)")}
          className="absolute inset-0 z-10 w-full resize-none overflow-auto bg-transparent text-transparent caret-[#ffffff] outline-none"
          style={{ ...metrics, paddingLeft: `${GUTTER_WIDTH + 8}px` }}
        />
      </div>

      {messages.length > 0 && (
        <ul className="max-h-32 shrink-0 overflow-auto border-t border-[#3c3c3c] bg-[#2d1e1e] p-2 text-[11px]">
          {messages.map((message, index) => (
            <li
              key={`${message.line}-${index}`}
              className={cn(
                message.level === "warning" ? "text-[#dcdcaa]" : "text-[#f14c4c]"
              )}
            >
              {message.line ? `${t("sim.line", "line")} ${message.line}: ` : ""}
              {message.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
