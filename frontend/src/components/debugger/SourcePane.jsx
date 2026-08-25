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

  const metrics = {
    fontSize: `${FONT_SIZE}px`,
    lineHeight: `${LINE_HEIGHT}px`,
    paddingTop: `${PADDING_TOP}px`,
    paddingBottom: `${PADDING_TOP}px`,
    tabSize: 4,
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
