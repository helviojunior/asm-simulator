import React from "react";
import {
  StepForward, CornerDownRight, Undo2, RotateCcw, Hammer, SkipForward,
} from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

/**
 * Barra de comandos do debugger.
 *
 * Os atalhos de passo sao os mesmos do x64dbg (F7/F8) para quem ja usa a
 * ferramenta nao precisar reaprender. Ctrl+F7 e nosso: desfazer o passo, algo
 * que um debugger real nao consegue oferecer.
 *
 * F9 monta. No x64dbg ele e "executar tudo", que aqui nao existe — este e um
 * simulador didatico, e rodar o programa de uma vez esconderia justamente o
 * que ele existe para mostrar. A tecla fica livre, entao vai para o comando
 * que de fato inicia a sessao.
 */
export default function Toolbar({
  onAssemble, onStepInto, onStepOver, onSkip, onStepBack, onReset,
  canStep, canStepBack, canSkip, busy,
}) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#3c3c3c] bg-[#333333] px-2 py-1.5">
      <ToolbarButton
        icon={Hammer}
        label={t("sim.assemble", "Assemble")}
        shortcut="F9"
        onClick={onAssemble}
        disabled={busy}
        primary
      />
      <Separator />
      <ToolbarButton
        icon={CornerDownRight}
        label={t("sim.stepInto", "Step into")}
        shortcut="F7"
        onClick={onStepInto}
        disabled={!canStep}
      />
      <ToolbarButton
        icon={StepForward}
        label={t("sim.stepOver", "Step over")}
        shortcut="F8"
        onClick={onStepOver}
        disabled={!canStep}
      />
      {/* Pular NAO exige `canStep`: destravar uma parada e justamente o caso
          de uso — o simulador nao cobre aquela instrucao e o que interessa
          esta depois dela. */}
      <ToolbarButton
        icon={SkipForward}
        label={t("sim.skip", "Skip instruction")}
        shortcut="Ctrl+F8"
        onClick={onSkip}
        disabled={!canSkip}
      />
      <Separator />
      <ToolbarButton
        icon={Undo2}
        label={t("sim.stepBack", "Step back")}
        shortcut="Ctrl+F7"
        onClick={onStepBack}
        disabled={!canStepBack}
      />
      <ToolbarButton
        icon={RotateCcw}
        label={t("sim.reset", "Restart")}
        shortcut="Ctrl+F2"
        onClick={onReset}
      />
    </div>
  );
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-[#4a4a4a]" />;
}

function ToolbarButton({ icon: Icon, label, shortcut, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${shortcut})`}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors",
        disabled
          ? "cursor-not-allowed text-[#6b6b6b]"
          : primary
          ? "bg-[#0e639c] text-white hover:bg-[#1177bb]"
          : "text-[#d4d4d4] hover:bg-[#4a4a4a]"
      )}
    >
      <Icon size={14} />
      <span>{label}</span>
      <span className="text-[10px] text-[#9a9a9a]">{shortcut}</span>
    </button>
  );
}
