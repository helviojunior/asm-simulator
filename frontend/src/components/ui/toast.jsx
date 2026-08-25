import React from "react";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "i18n";
import { useToast } from "contexts/ToastContext";
import { cn } from "lib/utils";

// Mesma paleta dos demais avisos do simulador: azul informa, ambar chama
// atencao, vermelho e erro.
const VARIANTS = {
  info: {
    Icon: Info,
    border: "border-[#0e639c]",
    accent: "text-[#4fc1ff]",
    button: "bg-[#0e639c] text-white hover:bg-[#1177bb]",
  },
  warning: {
    Icon: AlertTriangle,
    border: "border-[#dcdcaa]",
    accent: "text-[#dcdcaa]",
    button: "bg-[#5a4d1d] text-[#dcdcaa] hover:bg-[#6b5c22]",
  },
  danger: {
    Icon: TriangleAlert,
    border: "border-[#f14c4c]",
    accent: "text-[#f14c4c]",
    button: "bg-[#5a1d1d] text-[#ff6b6b] hover:bg-[#6b2222]",
  },
};

/**
 * Onde os avisos nao bloqueantes aparecem.
 *
 * E um componente de POSICAO, separado do provider: quem decide onde o aviso
 * cabe e a tela, nao o contexto. Aqui ele mora no painel de operandos — junto
 * do que se le a cada passo, e sem cobrir a desmontagem nem a pilha.
 */
export function ToastArea({ className }) {
  const { toasts, dismiss } = useToast();
  const { t } = useI18n();

  if (toasts.length === 0) return null;

  return (
    // Overlay: cobre o container inteiro em vez de empurrar o conteudo. O
    // painel de operandos e denso, e uma faixa inserida no topo reorganizaria
    // tudo que esta abaixo a cada aviso — e de novo ao sumir.
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col gap-2 overflow-auto",
        "bg-[#1e1e1e]/95 p-3 backdrop-blur-[1px] animate-fade-in",
        className
      )}
    >
      {toasts.map((item) => {
        const variant = VARIANTS[item.variant] || VARIANTS.info;
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              "flex min-h-0 flex-1 flex-col rounded border-l-2 bg-[#252526] p-3",
              variant.border
            )}
          >
            <div className="flex items-start gap-2">
              <variant.Icon size={15} className={cn("mt-px shrink-0", variant.accent)} />
              <div className="min-w-0 flex-1">
                {item.title && (
                  <p className={cn("text-[12px] font-semibold", variant.accent)}>
                    {item.title}
                  </p>
                )}
                {item.description && (
                  <div className="mt-1 text-[11px] leading-[1.6] text-[#d4d4d4]">
                    {item.description}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => dismiss(item.id)}
              autoFocus
              className={cn(
                "mt-auto self-end rounded px-4 py-1 text-[11px] font-semibold",
                "transition-colors",
                variant.button
              )}
            >
              {t("common.ok", "OK")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastArea;
