/**
 * O padrao de aviso NAO bloqueante: fica na tela ate ser dispensado — pelo OK,
 * ou pelo proximo comando (`dismissAll`).
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { ToastProvider, useToast } from "contexts/ToastContext";
import { ToastArea } from "components/ui/toast";

let container;
let root;
let api;

function Harness() {
  api = useToast();
  return <ToastArea />;
}

beforeEach(async () => {
  jest.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><ToastProvider><Harness /></ToastProvider></I18nProvider>);
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.useRealTimers();
});

const show = async (options) => { await act(async () => { api.toast(options); }); };
const advance = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const okButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "OK");

test("fica na tela: nao ha relogio que o tire", async () => {
  await show({ title: "call fora do programa" });

  // O aviso fala do passo que acabou de acontecer, e aquele passo continua
  // sendo o ultimo: sumir sozinho apagaria a explicacao do que esta na tela.
  await advance(60 * 1000);
  expect(container.textContent).toContain("call fora do programa");
});

test("o OK encerra", async () => {
  await show({ title: "syscall nao simulada" });
  await act(async () => { okButton().click(); });

  expect(container.textContent).not.toContain("syscall nao simulada");
});

test("o proximo comando limpa a tela de avisos", async () => {
  await show({ key: "a", title: "chamada externa" });
  await show({ key: "b", title: "syscall ignorada" });

  // E o que o Simulator chama ao dar outro passo: o aviso do passo anterior
  // deixa de descrever o que se ve.
  await act(async () => { api.dismissAll(); });

  expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
});

test("mesma chave nao empilha copias: atualiza a que esta na tela", async () => {
  // O caso de um `call` para fora dentro de um laco.
  await show({ key: "call:0x1000", title: "primeiro" });
  await show({ key: "call:0x1000", title: "segundo" });

  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("segundo");
  expect(container.textContent).not.toContain("primeiro");
});

test("chaves diferentes convivem", async () => {
  await show({ key: "a", title: "chamada externa" });
  await show({ key: "b", title: "syscall ignorada" });

  expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
});

test("nao bloqueia: nao ha backdrop nem portal", async () => {
  await show({ title: "aviso" });
  // O modal do sistema monta num portal com backdrop fixo; o toast vive no
  // fluxo da propria tela, e e essa a diferenca que importa.
  expect(document.body.querySelector(".fixed.inset-0")).toBeNull();
  expect(container.textContent).toContain("aviso");
});
