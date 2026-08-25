import React, { useEffect } from "react";
import { useI18n } from "i18n";
import { CALL_CONVENTIONS, callInvocation } from "lib/cpu/inspect";
import { hex } from "lib/cpu/format";
import ArgumentRow from "components/debugger/ArgumentRow";
import PrototypeNameField from "components/debugger/PrototypeNameField";
import { setCallName } from "lib/cpu/callNames";
import { loadPrototype } from "lib/prototypes";

/**
 * Argumentos que a funcao prestes a ser chamada receberia.
 *
 * Equivalente ao painel de argumentos do x64dbg. So aparece quando a instrucao
 * atual e um `call` — nas demais nao ha chamada a inspecionar.
 *
 * Sem simbolos, a funcao no outro lado do `call` e um endereco: nao ha como
 * deduzir nem o nome nem quantos argumentos ela recebe. Por isso a quantidade
 * de posicoes vem da barra superior — ate o aluno DIZER que funcao e aquela.
 * Dito o nome, o prototipo do catalogo assume: a quantidade passa a ser a
 * dele, e cada linha ganha tipo e descricao. E o unico caminho para as Rtl* e
 * Ldr* da ntdll, que nunca aparecem num `syscall`.
 */
export default function CallPane({ machine, count, convention, onConventionChange, tick, onParse, onNameChange }) {
  const { t } = useI18n();

  // A maquina muda por mutacao; `tick` forca o recalculo a cada passo.
  void tick;

  const call = machine && !machine.halted
    ? callInvocation(machine, { count, convention })
    : null;

  // Busca o prototipo da funcao nomeada. Hook antes de qualquer `return`: a
  // regra dos hooks nao admite chamada condicional.
  const chosenName = call?.name || null;
  useEffect(() => {
    if (chosenName && machine) {
      loadPrototype(machine.osId, machine.archId, chosenName)
        .then((found) => { if (found) onNameChange?.(); });
    }
  }, [chosenName, machine, onNameChange]);

  // Com a execucao parada, o `call` sob o ponteiro nunca vai acontecer —
  // mostrar argumentos dele sugeriria uma chamada que nao existe.
  if (!call) return null;

  const digits = machine.arch.bits === 64 ? 16 : 8;
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
          value={call.convention.id}
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
        {/* Destino -> funcao. Espelha a linha "numero -> funcao" do painel de
            syscall: e o mesmo gesto para a outra forma de chamar. */}
        <div className="flex items-baseline gap-2 whitespace-pre border-b border-[#3c3c3c] px-2 pb-1">
          <span className="w-6 shrink-0 text-[#6b6b6b]">→</span>
          <span className="w-[14ch] shrink-0 text-[#d4d4d4]">
            {call.target !== null
              ? hex(call.target, digits)
              : t("sim.callIndirect", "indirect")}
          </span>
          <PrototypeNameField
            os={machine.osId}
            arch={machine.archId}
            // Sem filtro: num `call` tanto o stub `Nt*` quanto a funcao de
            // modo usuario sao alvos legitimos.
            name={call.name}
            origin={call.name ? "manual" : null}
            emptyLabel={t("sim.callNameUnknown", "unnamed")}
            editTitle={t("sim.callNameEdit", "Click to name this function")}
            onChange={(chosen) => {
              setCallName(machine.osId, machine.archId, call.key, chosen);
              onNameChange?.();
            }}
          />
        </div>

        {/* Dito ANTES de executar: quem so olhasse os registradores depois
            concluiria que a funcao rodou e devolveu o que ja estava la. */}
        {call.target !== null && !machine.hasCodeAt(call.target) && (
          <p className="mx-2 my-1 rounded border border-[#dcdcaa]/40 bg-[#dcdcaa]/5 px-2 py-1 text-[10px] text-[#dcdcaa]">
            {hex(call.target, digits)} — {t("sim.callNotLoaded", "target not loaded — the call will be skipped")}
          </p>
        )}

        {call.args.map((arg) => (
          <ArgumentRow key={arg.index} machine={machine} arg={arg} digits={digits}
                       type={arg.type} name={arg.name} description={arg.description}
                       onParse={onParse} />
        ))}

        {/* Sem nome, a quantidade de posicoes e escolha da barra superior — e
            nao a quantidade real de argumentos, que ninguem sabe. Dizer isso
            evita ler "1: RCX" como se fosse o primeiro parametro de uma funcao
            de um argumento. */}
        {!call.known && (
          <p className="px-2 pt-1 text-[10px] text-[#6b6b6b]">
            {t("sim.callNoPrototype",
               "Unknown argument count — showing the argument registers. Name the function to use its prototype.")}
          </p>
        )}
      </div>
    </section>
  );
}
