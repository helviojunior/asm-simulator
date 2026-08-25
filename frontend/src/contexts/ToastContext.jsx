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
 * `key` opcional: com ela, um aviso repetido ATUALIZA o que ja esta na tela em
 * vez de empilhar outro igual — o caso de um `call` dentro de um laco.
 *
 * NAO ha relogio. O aviso fica ate ser dispensado, por duas razoes:
 *
 * 1. Ele fala do passo que ACABOU de acontecer. Enquanto aquele passo e o
 *    ultimo, o aviso continua sendo a leitura correta da tela — sumir sozinho
 *    apagaria a explicacao do estado que ainda esta ali.
 * 2. Quem esta lendo registrador por registrador nao olha para o aviso nos
 *    primeiros segundos. Um tempo curto some antes de ser lido; um longo
 *    atrapalha o passo seguinte. Nao ha numero certo — entao quem decide e
 *    quem esta lendo, pelo OK, ou o proprio proximo comando (`dismissAll`).
 */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Espelho sincrono da lista: dois avisos publicados no mesmo passo (uma
  // chamada externa e uma syscall ignorada) precisam ver um ao outro, e o
  // estado do React so chega no render seguinte.
  const items = useRef([]);
  const nextId = useRef(0);

  const publish = useCallback((next) => {
    items.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id) => publish(items.current.filter((item) => item.id !== id)),
    [publish]
  );

  /**
   * Limpa a tela de avisos.
   *
   * E o que o proximo COMANDO chama: dado outro passo, o aviso do passo
   * anterior deixa de descrever o que esta na tela, e mante-lo seria pior que
   * nao te-lo mostrado.
   */
  const dismissAll = useCallback(() => {
    if (items.current.length) publish([]);
  }, [publish]);

  const toast = useCallback(
    ({ title, description, variant = "info", key } = {}) => {
      // Mesma chave ja na tela: atualiza o conteudo, em vez de virar uma pilha
      // de avisos identicos.
      const existing = key ? items.current.find((item) => item.key === key) : null;
      if (existing) {
        publish(items.current.map((item) =>
          item.id === existing.id ? { ...item, title, description, variant } : item));
        return existing.id;
      }

      nextId.current += 1;
      const id = nextId.current;
      publish([...items.current, { id, key, title, description, variant }]);
      return id;
    },
    [publish]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss, dismissAll, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  return ctx;
}
