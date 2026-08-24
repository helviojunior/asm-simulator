import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Trash2 } from "lucide-react";
import { Modal } from "components/ui/modal";
import { Button } from "components/ui/button";
import { useI18n } from "i18n";

/**
 * Substitui window.alert / window.confirm / window.prompt.
 *
 * Uso:
 *   const { confirm, alert } = useDialog();
 *   if (await confirm({ title: "Excluir?", variant: "danger" })) { ... }
 *   await alert({ title: "Salvo", variant: "success" });
 */
const DialogContext = createContext(null);

const variantIcons = {
  danger: {
    Icon: Trash2,
    wrapper: "bg-red-100 dark:bg-red-900/30",
    icon: "text-red-600 dark:text-red-400",
  },
  warning: {
    Icon: AlertTriangle,
    wrapper: "bg-amber-100 dark:bg-amber-900/30",
    icon: "text-amber-600 dark:text-amber-400",
  },
  success: {
    Icon: CheckCircle2,
    wrapper: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  info: {
    Icon: Info,
    wrapper: "bg-blue-100 dark:bg-blue-900/30",
    icon: "text-blue-600 dark:text-blue-400",
  },
};

function DialogIcon({ variant }) {
  const config = variantIcons[variant] || variantIcons.info;
  const { Icon } = config;
  return (
    <div
      className={`w-12 h-12 rounded-full flex items-center justify-center ${config.wrapper}`}
    >
      <Icon className={`h-5 w-5 ${config.icon}`} />
    </div>
  );
}

export function DialogProvider({ children }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    setDialog(null);
    setBusy(false);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const open = useCallback((config) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog(config);
    });
  }, []);

  const confirm = useCallback(
    (options = {}) =>
      open({
        type: "confirm",
        variant: "warning",
        confirmLabel: t("common.confirm"),
        cancelLabel: t("common.cancel"),
        ...options,
      }),
    [open, t]
  );

  const alert = useCallback(
    (options = {}) =>
      open({
        type: "alert",
        variant: "info",
        confirmLabel: "OK",
        ...options,
      }),
    [open]
  );

  const handleConfirm = async () => {
    // onConfirm opcional: mantem o modal aberto enquanto a acao executa.
    if (dialog?.onConfirm) {
      setBusy(true);
      try {
        await dialog.onConfirm();
      } catch (err) {
        setBusy(false);
        return;
      }
    }
    close(true);
  };

  const isConfirm = dialog?.type === "confirm";

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      <Modal
        open={!!dialog}
        onClose={busy ? undefined : () => close(false)}
        title={dialog?.title}
        description={dialog?.description}
        icon={<DialogIcon variant={dialog?.variant} />}
        size={dialog?.size || "sm"}
        footer={
          <>
            {isConfirm && (
              <Button
                variant="outline"
                onClick={() => close(false)}
                disabled={busy}
              >
                {dialog?.cancelLabel}
              </Button>
            )}
            <Button
              variant={dialog?.variant === "danger" ? "destructive" : "default"}
              onClick={handleConfirm}
              loading={busy}
              autoFocus
            >
              {dialog?.confirmLabel}
            </Button>
          </>
        }
      />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog deve ser usado dentro de <DialogProvider>");
  }
  return ctx;
}
