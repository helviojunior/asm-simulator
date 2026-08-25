import React from "react";
import { Terminal } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { hex } from "lib/cpu/format";
import { syscallInvocation } from "lib/cpu/inspect";
import ArgumentRow from "components/debugger/ArgumentRow";

/**
 * A chamada de sistema prestes a acontecer.
 *
 * Irmao do painel de `call`, para a outra forma de chamar codigo alheio. A
 * diferenca esta no que da para afirmar: num `call` a aridade e desconhecida,
 * mas aqui o numero em EAX/RAX identifica a funcao — entao o painel mostra o
 * NOME dela e o nome de cada parametro.
 *
 * O numero e o ponto que mais confunde quem escreve shellcode: `write` e 4 em
 * `int 0x80` e 1 em `syscall`. Por isso a resolucao numero -> nome fica na
 * primeira linha, e nao escondida num tooltip.
 */
export default function SyscallPane({ machine, count, tick }) {
  const { t } = useI18n();

  // A maquina muda por mutacao; `tick` forca o recalculo a cada passo.
  void tick;

  // Parado, a instrucao sob o ponteiro nunca vai executar: anunciar a chamada
  // sugeriria que ela ainda vai acontecer.
  if (!machine || machine.halted) return null;

  const call = syscallInvocation(machine, { count });
  if (!call) return null;

  const digits = machine.arch.bits === 64 ? 16 : 8;
  const numberDigits = machine.arch.bits === 64 ? 16 : 8;

  return (
    <section className="flex max-h-56 flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <Terminal size={12} className="shrink-0 text-[#9cdcfe]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.syscall", "System call")}
        </span>
        {/* Por qual porta se entra no kernel: `int 0x80` e `syscall` usam
            tabelas de numeros DIFERENTES. */}
        <span className="ml-auto rounded bg-[#3c3c3c] px-1.5 py-0.5 font-mono text-[10px] text-[#d4d4d4]">
          {call.via}
        </span>
      </header>

      <div className="flex-1 overflow-auto py-1 text-[12px] leading-[1.6]">
        {/* Numero -> funcao. */}
        <div className="flex items-baseline gap-2 whitespace-pre border-b border-[#3c3c3c] px-2 pb-1">
          <span className="w-6 shrink-0 text-[#6b6b6b]">#</span>
          <span className="w-[14ch] shrink-0 uppercase text-[#c586c0]">
            {call.numberRegister}
          </span>
          <span className="shrink-0 text-[#d4d4d4]">{hex(call.number, numberDigits)}</span>
          <span className="shrink-0 text-[#6b6b6b]">→</span>
          {call.name ? (
            <span className="shrink-0 font-bold text-[#dcdcaa]">{call.name}</span>
          ) : (
            <span className="shrink-0 text-[#f14c4c]">
              {t("sim.syscallUnknown", "unknown number")}
            </span>
          )}
          <span
            className={cn(
              "ml-auto shrink-0 text-[10px]",
              call.simulated ? "text-[#6a9955]" : "text-[#dcdcaa]"
            )}
          >
            {call.simulated
              ? t("sim.syscallSimulated", "simulated")
              : t("sim.syscallNotSimulated", "stops execution")}
          </span>
        </div>

        {call.args.map((arg) => (
          <ArgumentRow
            key={arg.index}
            machine={machine}
            // O painel compartilhado espera `source`: aqui a origem e sempre um
            // registrador, entao o nome dele e a origem.
            arg={{ ...arg, source: arg.register.toUpperCase() }}
            digits={digits}
            name={call.known ? arg.name : null}
          />
        ))}

        {!call.known && call.name && (
          <p className="px-2 pt-1 text-[10px] text-[#6b6b6b]">
            {t("sim.syscallNoPrototype", "No known prototype — showing the argument registers.")}
          </p>
        )}
      </div>
    </section>
  );
}
