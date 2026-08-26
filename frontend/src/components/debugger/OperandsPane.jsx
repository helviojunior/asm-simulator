import React from "react";
import { ArrowRight } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { hex } from "lib/cpu/format";
import { annotateValue, inspectOperands } from "lib/cpu/inspect";
import { displayName } from "lib/cpu/registers";
import { ToastArea } from "components/ui/toast";
import { useDumpMenu } from "components/debugger/useDumpMenu";

/**
 * Painel de informacao da instrucao atual — o equivalente da barra abaixo da
 * desmontagem no x64dbg.
 *
 * Mostra, ANTES de executar: cada operando resolvido (endereco efetivo
 * calculado e valor que esta lá agora) e, em seguida, o que a instrucao vai
 * escrever. Para `mov byte ptr [ecx+0x19], al` isso da exatamente tres linhas:
 * o destino em memoria, o registrador de origem, e o valor novo.
 */
export default function OperandsPane({ machine, tick, onViewInDump }) {
  const { t } = useI18n();
  const { openDumpMenu, dumpMenu } = useDumpMenu(machine, onViewInDump);

  // `tick` nao e usado no corpo: existe para o React recalcular quando a
  // maquina muda por mutacao (a identidade do objeto nao muda a cada passo).
  void tick;

  if (!machine) {
    return (
      <Shell title={t("sim.operands", "Operands")}>
        <p className="px-2 text-[#6b6b6b]">
          {t("sim.operandsIdle", "Assemble a program to inspect operands.")}
        </p>
      </Shell>
    );
  }

  const insn = machine.currentInstruction;
  const halted = Boolean(machine.halted);
  // Parado: a instrucao sob o ponteiro nao sera executada, entao inspecionar
  // seus operandos daria a impressao de que algo ainda vai acontecer.
  const operands = halted ? [] : inspectOperands(machine);
  const preview = machine.preview();

  return (
    <Shell
      title={t("sim.operands", "Operands")}
      subtitle={!halted && insn && !insn.data ? insn.text : null}
    >
      {(halted || !insn || insn.data) && (
        <p className="px-2 text-[#6b6b6b]">
          {!halted && insn?.data
            ? t("sim.operandsData", "These bytes are data — nothing to execute.")
            : t("sim.operandsHalted", "Execution stopped.")}
        </p>
      )}

      {/* Leitura: o que a instrucao consulta */}
      {operands.map((operand, index) => (
        <Row
          key={`op-${index}`}
          arrow={false}
          label={operand.label}
          detail={operand.expression}
          value={operand.value}
          notes={operand.notes}
          onMenu={openDumpMenu}
          entries={[
            operand.address ? { label: t("dump.thisAddress", "this address"), address: operand.address } : null,
            operand.raw !== undefined ? { label: t("dump.thisValue", "this value"), address: operand.raw } : null,
          ]}
        />
      ))}

      {/* Escrita: o que a instrucao vai mudar (execucao especulativa).
          O avanco do RIP fica de fora: toda instrucao o altera, e repetir isso
          em cada linha so afogaria o que interessa. */}
      {groupWrites(preview?.writes, machine).map((write, index) => (
        <Row
          key={`wr-${index}`}
          arrow
          label={write.label}
          value={hex(write.next, write.size * 2)}
          previous={hex(write.previous, write.size * 2)}
          notes={annotateValue(machine, write.next, { asPointer: write.size >= 4 })}
          onMenu={openDumpMenu}
          entries={[
            write.address ? { label: t("dump.thisAddress", "this address"), address: write.address } : null,
            { label: t("dump.thisValue", "this value"), address: write.next },
          ]}
        />
      ))}

      {/* Flags que a instrucao vai alterar. Em `cmp`/`test` elas sao o UNICO
          efeito — sem esta linha o painel pareceria dizer que nada acontece. */}
      <FlagRow writes={preview?.writes} />
      {dumpMenu}
    </Shell>
  );
}

function FlagRow({ writes }) {
  const { t } = useI18n();
  const flags = (writes || []).filter((write) => write.kind === "flag");
  if (flags.length === 0) return null;

  return (
    <div className="flex items-baseline gap-2 whitespace-pre px-2 hover:bg-[#2d2d2d]">
      <span className="w-4 shrink-0 text-center text-[#569cd6]">
        <ArrowRight size={11} className="inline" />
      </span>
      <span className="shrink-0 text-[#ff6b6b]">{t("sim.flags", "Flags")}</span>
      <span className="shrink-0 text-[#6b6b6b]">=</span>
      {flags.map((flag) => (
        <span key={flag.name} className="shrink-0">
          <span className="text-[#c586c0]">{flag.name}</span>
          <span className="text-[#6b6b6b]">{flag.previous ? 1 : 0}→</span>
          <span className="font-bold text-[#ff6b6b]">{flag.next ? 1 : 0}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Prepara as escritas para exibicao.
 *
 * Duas coisas acontecem aqui:
 *
 * 1. O avanco do RIP sai da lista — toda instrucao o altera, e repetir isso em
 *    cada linha afogaria o que interessa.
 * 2. Bytes de memoria CONTIGUOS viram uma linha so. O diario registra byte a
 *    byte (e o que permite desfazer com precisao), mas um `push` de 4 bytes
 *    lido como quatro linhas de 1 byte esconde justamente o valor empilhado.
 */
function groupWrites(writes, machine) {
  if (!writes) return [];
  const digits = machine.arch.bits === 64 ? 16 : 8;

  const registers = writes
    .filter((write) => write.kind === "register" && write.name !== "rip")
    .map((write) => ({
      label: displayName(write.name, machine.arch.bits).toUpperCase(),
      size: machine.arch.wordSize,
      previous: write.previous,
      next: write.next,
    }));

  const bytes = writes
    .filter((write) => write.kind === "memory")
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  const memory = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    memory.push({
      label: `[${hex(run.address, digits)}]`,
      address: run.address,
      size: run.previous.length,
      // Little-endian: o primeiro byte do bloco e o menos significativo.
      previous: run.previous.reduceRight((acc, b) => (acc << 8n) | b, 0n),
      next: run.next.reduceRight((acc, b) => (acc << 8n) | b, 0n),
    });
    run = null;
  };

  bytes.forEach((write) => {
    if (run && write.address === run.address + BigInt(run.previous.length)) {
      run.previous.push(write.previous);
      run.next.push(write.next);
      return;
    }
    flush();
    run = { address: write.address, previous: [write.previous], next: [write.next] };
  });
  flush();

  return [...registers, ...memory];
}

function Shell({ title, subtitle, children }) {
  return (
    <section className="flex h-full flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="flex shrink-0 items-baseline gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {title}
        </span>
        {subtitle && <span className="text-[11px] text-[#d4d4d4]">{subtitle}</span>}
      </header>
      {/* `relative`: e o referencial do overlay de avisos. */}
      <div className="relative flex-1 overflow-auto py-1 text-[12px] leading-[1.6]">
        {children}
        {/* Avisos nao bloqueantes cobrem o painel enquanto duram — e o que
            mudou agora, e some sozinho em seguida. */}
        <ToastArea />
      </div>
    </section>
  );
}

/**
 * Uma linha do painel.
 *
 * `arrow` distingue leitura de escrita: a seta marca o valor que AINDA nao
 * existe — e o resultado previsto, nao o estado atual.
 */
function Row({ arrow, label, detail, value, previous, notes, onMenu, entries }) {
  // O tamanho da movimentacao continua visivel pela LARGURA do valor: um byte
  // sai com 2 digitos hexadecimais, uma dword com 8.
  return (
    <div
      className="flex items-baseline gap-2 whitespace-pre px-2 hover:bg-[#2d2d2d]"
      onContextMenu={entries ? (event) => onMenu?.(event, entries) : undefined}
    >
      <span className="w-4 shrink-0 text-center text-[#569cd6]">
        {arrow ? <ArrowRight size={11} className="inline" /> : " "}
      </span>
      <span className={cn("shrink-0", arrow ? "text-[#ff6b6b]" : "text-[#c586c0]")}>
        {label}
      </span>
      {detail && <span className="shrink-0 text-[#6a9955]">({detail})</span>}
      <span className="shrink-0 text-[#6b6b6b]">=</span>
      {previous !== undefined && (
        <>
          <span className="shrink-0 text-[#6b6b6b] line-through">{previous}</span>
          <span className="shrink-0 text-[#6b6b6b]">→</span>
        </>
      )}
      <span className={cn("shrink-0 font-bold", arrow ? "text-[#ff6b6b]" : "text-[#d4d4d4]")}>
        {value}
      </span>
      {notes.length > 0 && (
        <span className="truncate text-[#ce9178]">{notes.join("  ")}</span>
      )}
    </div>
  );
}
