import React from "react";
import { AlertTriangle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "i18n";
import { useToast } from "contexts/ToastContext";
import { cn } from "lib/utils";

/**
 * A cor e o aviso.
 *
 * O fundo INTEIRO carrega a gravidade — azul informa, verde confirma, ambar
 * chama atencao, vermelho e erro. Antes so uma borda de 2px dizia isso, e um
 * aviso que aparece por cima de um painel denso de hexadecimal se perdia no
 * cinza do resto: era preciso LER para saber se era grave.
 *
 * Os tons sao escuros de proposito. O simulador inteiro e escuro, e um verde
 * de notificacao de site claro ofuscaria a listagem atras; estes ficam com o
 * texto branco acima de 4.5:1, que e o minimo legivel.
 */
const VARIANTS = {
  info: {
    Icon: Info,
    surface: "bg-[#0e5a86] border-[#1177bb]",
    button: "bg-white/15 text-white hover:bg-white/25",
  },
  success: {
    Icon: CheckCircle2,
    surface: "bg-[#1e6b3a] border-[#2f8a4f]",
    button: "bg-white/15 text-white hover:bg-white/25",
  },
  warning: {
    Icon: AlertTriangle,
    surface: "bg-[#8a6d1f] border-[#b08c2a]",
    button: "bg-black/25 text-white hover:bg-black/35",
  },
  danger: {
    Icon: TriangleAlert,
    surface: "bg-[#8b2635] border-[#b03546]",
    button: "bg-white/15 text-white hover:bg-white/25",
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
        // Respiro curto: o painel de operandos tem 128px por padrao, e cada
        // 4px de folga aqui e uma linha a menos de texto visivel.
        "bg-[#1e1e1e]/95 p-2 backdrop-blur-[1px] animate-fade-in",
        className
      )}
    >
      {toasts.map((item) => {
        const variant = VARIANTS[item.variant] || VARIANTS.info;
        return (
          <div
            key={item.id}
            role="status"
            // Uma LINHA so: icone, texto, botao. O painel de operandos pode ter
            // 60px de altura, e uma caixa em coluna com o botao no rodape nao
            // cabe ali — o botao era empurrado para fora e atravessava a borda.
            // Em linha, a altura da caixa e a do texto, e o aviso cabe onde for.
            className={cn(
              "flex shrink-0 items-start gap-2 rounded border px-3 py-2",
              variant.surface
            )}
          >
            <variant.Icon size={15} className="mt-px shrink-0 text-white/90" />
            <div className="min-w-0 flex-1">
              {item.title && (
                <p className="text-[12px] font-semibold text-white">{item.title}</p>
              )}
              {/* Um pouco menos que branco: separa o detalhe do titulo sem
                  precisar de outra cor sobre um fundo que ja e colorido. */}
              {item.description && (
                <div className="mt-1 text-[11px] leading-[1.6] text-white/85">
                  {item.description}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismiss(item.id)}
              autoFocus
              className={cn(
                "shrink-0 rounded px-4 py-1 text-[11px] font-semibold",
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
