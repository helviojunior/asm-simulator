import React, { useEffect, useRef } from "react";
import { hex } from "lib/cpu/format";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

// Mnemonicos agrupados por familia, para colorir como o x64dbg faz.
const CONTROL_FLOW = /^(jmp|call|ret|j[a-z]{1,3}|loop|loope|loopne)$/;
const STACK_OPS = /^(push|pop|pusha[d]?|popa[d]?|pushf[dq]?|popf[dq]?|enter|leave)$/;

function mnemonicColor(mnemonic) {
  if (CONTROL_FLOW.test(mnemonic)) return "text-[#dcdcaa]";
  if (STACK_OPS.test(mnemonic)) return "text-[#4ec9b0]";
  if (mnemonic === "nop") return "text-[#6b6b6b]";
  return "text-[#569cd6]";
}

/** Texto legivel de uma linha de dados: "Treinamento Shellcoding\n\x01". */
function dataPreview(bytes) {
  return bytes
    .split(" ")
    .map((pair) => {
      const byte = parseInt(pair, 16);
      if (byte >= 0x20 && byte <= 0x7e) return String.fromCharCode(byte);
      if (byte === 0x0a) return "\\n";
      if (byte === 0x0d) return "\\r";
      if (byte === 0x00) return "\\0";
      return `\\x${pair.toLowerCase()}`;
    })
    .join("");
}

/**
 * Painel de desmontagem.
 *
 * Colunas na ordem do x64dbg: margem de breakpoint, endereco, bytes do
 * encoding e texto da instrucao. A coluna de bytes nao e enfeite — e o que
 * explica por que a instrucao seguinte esta 5 bytes adiante.
 */
export default function DisassemblyPane({
  machine,
  instructions,
  currentAddress,
  breakpoints,
  onToggleBreakpoint,
  // Motivo da parada, ou null. Enquanto existir, a listagem inteira aparece
  // esmaecida: nenhuma daquelas instrucoes vai executar.
  halted = null,
}) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const currentRef = useRef(null);

  // Mantem a instrucao atual sempre visivel, como um debugger de verdade.
  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [currentAddress]);

  const digits = machine?.arch.bits === 64 ? 16 : 8;

  // Onde cada secao comeca, para a listagem dizer quando uma acaba e a outra
  // comeca. Sem a marca, a passagem de `.text` para `.data` e so mais uma
  // linha de `db` no meio de outras — some justamente a fronteira que a aula
  // esta ensinando.
  const sectionAt = new Map(
    (machine?.sections || []).map((item) => [item.start.toString(), item.name])
  );

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.disassembly", "CPU")}
        </span>
        {/* Sem este rotulo, a listagem apagada pareceria falha de renderizacao
            em vez de "o programa acabou". */}
        {halted && (
          <span className="ml-auto shrink-0 rounded bg-[#5a1d1d] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#ff6b6b]">
            {t("sim.executionEnded", "Execution ended")}
          </span>
        )}
      </header>
      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-auto font-mono text-[12px] leading-[1.5] transition-all duration-200",
          // Esmaecido E dessaturado: a cor por familia de mnemonico some junto,
          // entao nem a linha atual continua chamando atencao — ela nao vai
          // mais executar. "Voltar passo" e "reiniciar" limpam `halted` na
          // maquina, e a listagem volta ao normal sozinha.
          halted && "opacity-50 grayscale"
        )}
      >
        {instructions.length === 0 && (
          <p className="p-4 text-[#6b6b6b]">
            {t("sim.noProgram", "Assemble a program to see the instructions.")}
          </p>
        )}
        {instructions.map((insn) => {
          const address = BigInt(insn.address);
          const isCurrent = currentAddress !== null && address === currentAddress;
          const hasBreakpoint = breakpoints.has(address.toString());
          const section = sectionAt.get(address.toString());

          return (
            <React.Fragment key={insn.address}>
            {section && <SectionRule name={section} />}
            <div
              ref={isCurrent ? currentRef : null}
              className={cn(
                "flex items-baseline gap-3 whitespace-pre px-1",
                isCurrent && "bg-[#094771]"
              )}
            >
              <button
                type="button"
                onClick={() => onToggleBreakpoint(address)}
                aria-label={t("sim.toggleBreakpoint", "Toggle breakpoint")}
                className="w-4 shrink-0 text-center text-[#f14c4c] hover:bg-[#3c3c3c]"
              >
                {hasBreakpoint ? "●" : " "}
              </button>
              <span className={cn("shrink-0", isCurrent ? "text-[#ffffff]" : "text-[#858585]")}>
                {hex(address, digits)}
              </span>
              {/* Largura para 10 bytes: cobre desde `50` (push eax) ate um
                  movabs de imediato de 64 bits. E a coluna que explica por que
                  a proxima instrucao esta N enderecos adiante — truncar aqui
                  esconderia exatamente o que se quer ensinar. */}
              <span className="w-[30ch] shrink-0 truncate text-[#6a9955]" title={insn.bytes}>
                {insn.bytes}
              </span>
              <span
                className={cn(
                  "shrink-0 w-[7ch]",
                  // Enchimento nao e dado declarado nem instrucao: e o vao
                  // entre as secoes, e le-lo apagado é a leitura certa.
                  insn.fill ? "text-[#5a5a5a]" : insn.data ? "text-[#ce9178]" : mnemonicColor(insn.mnemonic)
                )}
              >
                {insn.mnemonic}
              </span>
              {/* Dados embutidos no codigo (o `db "..."` do JMP-CALL-POP)
                  aparecem como texto legivel, nao como bytes soltos. Ler o
                  enchimento como texto daria uma linha de `\x00` repetido: o
                  que se quer saber dele e QUANTOS bytes sao. */}
              <span
                className={
                  insn.fill ? "text-[#5a5a5a]" : insn.data ? "text-[#ce9178]" : "text-[#d4d4d4]"
                }
              >
                {insn.fill
                  ? insn.op_str
                  : insn.data
                  ? `"${dataPreview(insn.bytes)}"`
                  : insn.op_str}
              </span>
            </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Divisoria de secao: uma linha suave com o nome ao lado.
 *
 * Discreta de proposito — ela separa, nao compete com o codigo. A cor e a
 * mesma que o dump usa para cada regiao, entao `.data` e verde-agua nos dois
 * lugares e a associacao se faz sozinha.
 */
function SectionRule({ name }) {
  return (
    <div className="flex select-none items-center gap-2 px-1 pb-0.5 pt-2">
      <span
        className={cn(
          "shrink-0 text-[10px] uppercase tracking-wider",
          name === ".data" ? "text-[#4ec9b0]" : "text-[#569cd6]"
        )}
      >
        {name}
      </span>
      {/* Bem apagada: ela separa, e nao compete com o codigo. Na mesma cor
          das bordas do sistema, mas a 45% — cheia, virava mais uma regua
          horizontal disputando a atencao com a linha em execucao. */}
      <span className="h-px flex-1 bg-[#3c3c3c]/45" />
    </div>
  );
}
