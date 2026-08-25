import React, { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Avisos NAO bloqueantes — o padrao do sistema para tudo que informa sem
 * exigir decisao.
 *
 * A divisao com o `DialogContext` e por consequencia, nao por gravidade: modal
 * quando o usuario precisa DECIDIR ou quando a execucao parou e ele tem de
 * saber antes de continuar; toast quando a execucao seguiu e o aviso e
 * contexto. Um `call` para fora do programa nao para nada — interromper o
 * passo a passo com um modal por causa dele custa mais do que informa.
 *
 * Uso:
 *   const { toast } = useToast();
 *   toast({ title: "...", description: <>...</>, variant: "warning", key: "..." });
 *
 * `key` opcional: com ela, um aviso repetido REINICIA o tempo do que ja esta na
 * tela em vez de empilhar outro igual — o caso de um `call` dentro de um laco.
 */
const ToastContext = createContext(null);

/** Quanto tempo um aviso fica no ar antes de sair sozinho. */
export const TOAST_TIMEOUT = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Espelho sincrono da lista. O `id` de um aviso precisa existir ANTES de
  // agendar a saida dele, e calcula-lo dentro do updater do `setState` daria
  // certo so por acidente: o React nao garante quando aquela funcao roda.
  const items = useRef([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const publish = useCallback((next) => {
    items.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id) => {
      const timer = timers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
      publish(items.current.filter((item) => item.id !== id));
    },
    [publish]
  );

  const toast = useCallback(
    ({ title, description, variant = "info", key, timeout = TOAST_TIMEOUT } = {}) => {
      // Mesma chave ja na tela: atualiza o conteudo e o relogio recomeca, em
      // vez de virar uma pilha de avisos identicos.
      const existing = key ? items.current.find((item) => item.key === key) : null;

      let id;
      if (existing) {
        id = existing.id;
        publish(items.current.map((item) =>
          item.id === id ? { ...item, title, description, variant } : item));
      } else {
        nextId.current += 1;
        id = nextId.current;
        publish([...items.current, { id, key, title, description, variant }]);
      }

      const previous = timers.current.get(id);
      if (previous) clearTimeout(previous);
      timers.current.set(id, setTimeout(() => dismiss(id), timeout));
      return id;
    },
    [dismiss, publish]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  return ctx;
}
