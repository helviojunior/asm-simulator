import React from "react";
import { hex, signedDecimal } from "lib/cpu/format";
import { pointerString } from "lib/cpu/inspect";
import { useDumpMenu } from "components/debugger/useDumpMenu";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

/**
 * Painel de registradores, no formato do x64dbg: nome, valor em hexadecimal
 * e — o que mais importa numa aula — o que mudou no ultimo passo destacado.
 */
export default function RegistersPane({ machine, changed = [], onViewInDump, onExplore }) {
  const { t } = useI18n();
  const { openDumpMenu, dumpMenu } = useDumpMenu(machine, onViewInDump, onExplore);
  if (!machine) return null;

  const { arch, cpu } = machine;
  const digits = arch.bits === 64 ? 16 : 8;
  const changedSet = new Set(changed.map(String));

  // "eax" e uma view de "rax": o diario registra o nome canonico.
  const toCanonical = (name) => (name.startsWith("e") ? `r${name.slice(1)}` : name);

  const rows = arch.gpRegisters.map((name) => {
    const value = cpu.readRegister(name);
    return {
      name,
      value,
      changed: changedSet.has(toCanonical(name)),
      // Quando o registrador aponta para texto, o decimal com sinal nao diz
      // nada — o que o aluno precisa ver e a string do outro lado.
      string: pointerString(machine, value),
    };
  });

  const pointer = {
    name: arch.instructionPointer,
    value: cpu.readRegister(arch.instructionPointer),
    changed: changedSet.has("rip"),
    string: null,
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#252526]">
      <header className="shrink-0 border-b border-[#3c3c3c] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
        {t("sim.registers", "Registers")}
      </header>
      <div className="flex-1 overflow-auto p-2 font-mono text-[12px] leading-[1.45]">
        {rows.map((row) => (
          <RegisterRow key={row.name} row={row} digits={digits} onMenu={openDumpMenu} />
        ))}
        <div className="my-1.5 border-t border-[#3c3c3c]" />
        <RegisterRow row={pointer} digits={digits} onMenu={openDumpMenu} />
      </div>
      {dumpMenu}
    </section>
  );
}

function RegisterRow({ row, digits, onMenu }) {
  return (
    <div
      className="flex items-baseline gap-2 px-1"
      onContextMenu={(event) =>
        onMenu?.(event, [
          // O mesmo registrador nas duas leituras: para onde o valor APONTA
          // (o dump) e o que o valor E (os bits). A segunda vale sempre.
          { label: row.name.toUpperCase(), address: row.value, explore: row.name },
        ])
      }
    >
      <span className="w-10 shrink-0 uppercase text-[#c586c0]">{row.name}</span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          // Vermelho para o que mudou: mesma convencao do x64dbg.
          row.changed
            ? "rounded-sm bg-[#5a1d1d] font-bold text-[#ff6b6b]"
            : "text-[#d4d4d4]"
        )}
      >
        {hex(row.value, digits)}
      </span>
      {row.string ? (
        <span
          className="ml-auto min-w-0 truncate pl-2 text-[11px] text-[#ce9178]"
          title={row.string}
        >
          <span className="text-[#6b6b6b]">{"\u2192 "}</span>
          {`"${row.string}"`}
        </span>
      ) : (
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-[#6a9955]">
          {signedDecimal(row.value, digits * 4)}
        </span>
      )}
    </div>
  );
}
