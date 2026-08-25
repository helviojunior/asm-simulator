import React from "react";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "i18n";
import { useToast } from "contexts/ToastContext";
import { cn } from "lib/utils";

const VARIANTS = {
  info: { Icon: Info, border: "border-[#0e639c]", accent: "text-[#4fc1ff]" },
  warning: { Icon: AlertTriangle, border: "border-[#dcdcaa]/50", accent: "text-[#dcdcaa]" },
  danger: { Icon: TriangleAlert, border: "border-[#f14c4c]/50", accent: "text-[#f14c4c]" },
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
    <div className={cn("flex flex-col gap-1 px-2 pb-1", className)}>
      {toasts.map((item) => {
        const variant = VARIANTS[item.variant] || VARIANTS.info;
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              "flex items-start gap-2 rounded border bg-[#2d2d2d] px-2 py-1.5 text-[11px] animate-fade-in",
              variant.border
            )}
          >
            <variant.Icon size={13} className={cn("mt-px shrink-0", variant.accent)} />
            <div className="min-w-0 flex-1">
              {item.title && (
                <p className={cn("font-semibold", variant.accent)}>{item.title}</p>
              )}
              {item.description && (
                <div className="text-[#d4d4d4]">{item.description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold text-[#9a9a9a] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
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
