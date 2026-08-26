import React from "react";
import { Repeat } from "lucide-react";
import { FLAGS } from "lib/cpu/cpu";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { ContextMenu, useContextMenu } from "components/ui/contextMenu";

/**
 * Flags do processador — e o unico lugar do simulador em que o estado da CPU
 * se muda a mao.
 *
 * Os slides de aula nao costumam mostrar flags, e e justamente por isso que
 * `cmp` seguido de `jne` parece magica para quem esta aprendendo. Aqui elas
 * ficam visiveis, piscam quando a instrucao as altera — e podem ser trocadas
 * pelo menu de contexto: ligar ZF e ver o `je` passar a saltar responde a
 * pergunta melhor do que qualquer explicacao, e sem isso alcancar o outro ramo
 * exigiria reescrever o `cmp` e montar de novo.
 *
 * A troca fica no MENU, e nao num controle na fileira: sete flags numa tira de
 * uma linha e a leitura que este painel existe para dar, e qualquer controle
 * ao lado de cada uma a desmancharia. Trocar uma flag e gesto raro; ler as
 * sete de relance e o tempo todo.
 */
export default function FlagsPane({ machine, changed = [], onChange }) {
  const { t } = useI18n();
  const { menu, openMenu, closeMenu } = useContextMenu();
  if (!machine) return null;

  const changedSet = new Set(changed);

  const openFlagMenu = (event, flag) => {
    if (!onChange) return;
    openMenu(event, flag);
  };

  const flag = menu?.payload;
  const active = flag ? machine.cpu.getFlag(flag) : false;
  const items = flag
    ? [
        {
          key: "toggle",
          icon: Repeat,
          // O rotulo diz o efeito, e nao so o nome da acao: "alternar ZF" nao
          // responde para onde, e a resposta e a metade que interessa.
          label: `${t("sim.flagSet", "Set")} ${flag} = ${active ? 0 : 1}`,
          onSelect: () => onChange(flag, !active),
        },
      ]
    : [];

  return (
    <section className="flex flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="shrink-0 border-b border-[#3c3c3c] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
        {t("sim.flags", "Flags")}
      </header>
      <div className="flex flex-wrap gap-1.5 p-2 font-mono text-[12px]">
        {FLAGS.map((name) => {
          const on = machine.cpu.getFlag(name);
          return (
            <span
              key={name}
              data-flag={name}
              title={
                onChange
                  ? `${t(`sim.flag.${name}`, name)} — ${t("sim.flagHint", "right-click to change")}`
                  : t(`sim.flag.${name}`, name)
              }
              onContextMenu={(event) => openFlagMenu(event, name)}
              className={cn(
                "rounded px-1.5 py-0.5 tabular-nums",
                on ? "bg-[#264f78] text-[#d4d4d4]" : "text-[#6b6b6b]",
                // Anel vermelho: mudou no ultimo PASSO. Uma troca a mao nao o
                // acende — quem a fez sabe o que mudou.
                changedSet.has(name) && "ring-1 ring-[#ff6b6b]",
                onChange && "cursor-context-menu"
              )}
            >
              {name} {on ? 1 : 0}
            </span>
          );
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
    </section>
  );
}
