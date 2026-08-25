import React from "react";
import { useI18n } from "i18n";
import { CALL_CONVENTIONS, callArguments } from "lib/cpu/inspect";
import { hex } from "lib/cpu/format";
import ArgumentRow from "components/debugger/ArgumentRow";

/**
 * Argumentos que a funcao prestes a ser chamada receberia.
 *
 * Equivalente ao painel de argumentos do x64dbg. So aparece quando a instrucao
 * atual e um `call` — nas demais nao ha chamada a inspecionar.
 *
 * A aridade real da funcao e desconhecida (nao ha simbolos nem prototipo), por
 * isso a quantidade de posicoes vem da barra superior: o aluno escolhe quantas
 * quer ver.
 */
export default function CallPane({ machine, count, convention, onConventionChange, tick, onParse }) {
  const { t } = useI18n();

  // A maquina muda por mutacao; `tick` forca o recalculo a cada passo.
  void tick;

  const insn = machine?.currentInstruction;
  const isCall = Boolean(insn && !insn.data && insn.groups?.includes("call"));
  // Com a execucao parada, o `call` sob o ponteiro nunca vai acontecer —
  // mostrar argumentos dele sugeriria uma chamada que nao existe.
  if (!machine || machine.halted || !isCall) return null;

  const { convention: spec, args } = callArguments(machine, { count, convention });
  const digits = machine.arch.bits === 64 ? 16 : 8;

  // Destino, quando e um imediato. Chamada indireta (`call rbx`, `call [rax]`)
  // so se resolve na hora de executar, entao nao ha o que antecipar.
  const immediate = (insn.operands || []).find((operand) => operand.type === "imm");
  const target = immediate ? BigInt(immediate.value) : null;
  const options = Object.values(CALL_CONVENTIONS).filter((item) =>
    item.archs.includes(machine.archId)
  );

  return (
    <section className="flex h-full flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.callArgs", "Call arguments")}
        </span>
        {/* A convencao muda ONDE os argumentos estao. Deixar implicito
            ensinaria a convencao errada em metade dos casos. */}
        <select
          value={spec.id}
          onChange={(event) => onConventionChange(event.target.value)}
          aria-label={t("sim.callConvention", "Calling convention")}
          className="ml-auto rounded bg-[#3c3c3c] px-1.5 py-0.5 text-[10px] text-[#d4d4d4] outline-none"
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-auto py-1 text-[12px] leading-[1.6]">
        {/* Dito ANTES de executar: quem so olhasse os registradores depois
            concluiria que a funcao rodou e devolveu o que ja estava la. */}
        {target !== null && !machine.hasCodeAt(target) && (
          <p className="mx-2 mb-1 rounded border border-[#dcdcaa]/40 bg-[#dcdcaa]/5 px-2 py-1 text-[10px] text-[#dcdcaa]">
            {hex(target, digits)} — {t("sim.callNotLoaded", "target not loaded — the call will be skipped")}
          </p>
        )}

        {args.map((arg) => (
          <ArgumentRow key={arg.index} machine={machine} arg={arg} digits={digits}
                       type={arg.type} name={arg.name} description={arg.description}
                       onParse={onParse} />
        ))}
      </div>
    </section>
  );
}
