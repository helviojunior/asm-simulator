import React from "react";
import { FLAGS } from "lib/cpu/cpu";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

/**
 * Flags do processador.
 *
 * Os slides de aula nao costumam mostrar flags, e e justamente por isso que
 * `cmp` seguido de `jne` parece magica para quem esta aprendendo. Aqui elas
 * ficam visiveis, e piscam quando a instrucao as altera.
 */
export default function FlagsPane({ machine, changed = [] }) {
  const { t } = useI18n();
  if (!machine) return null;

  const changedSet = new Set(changed);

  return (
    <section className="flex flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="shrink-0 border-b border-[#3c3c3c] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
        {t("sim.flags", "Flags")}
      </header>
      <div className="flex flex-wrap gap-1.5 p-2 font-mono text-[12px]">
        {FLAGS.map((flag) => {
          const active = machine.cpu.getFlag(flag);
          return (
            <span
              key={flag}
              title={t(`sim.flag.${flag}`, flag)}
              className={cn(
                "rounded px-1.5 py-0.5 tabular-nums",
                active ? "bg-[#264f78] text-[#d4d4d4]" : "text-[#6b6b6b]",
                changedSet.has(flag) && "ring-1 ring-[#ff6b6b]"
              )}
            >
              {flag} {active ? 1 : 0}
            </span>
          );
        })}
      </div>
    </section>
  );
}
