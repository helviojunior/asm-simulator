/**
 * O padrao de aviso NAO bloqueante: some sozinho, e o OK encerra antes.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { ToastProvider, TOAST_TIMEOUT, useToast } from "contexts/ToastContext";
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

test("aparece e some sozinho depois do tempo", async () => {
  await show({ title: "call fora do programa" });
  expect(container.textContent).toContain("call fora do programa");

  await advance(TOAST_TIMEOUT - 100);
  expect(container.textContent).toContain("call fora do programa");

  await advance(200);
  expect(container.textContent).not.toContain("call fora do programa");
});

test("o OK encerra antes do tempo", async () => {
  await show({ title: "syscall nao simulada" });
  await act(async () => { okButton().click(); });

  expect(container.textContent).not.toContain("syscall nao simulada");
});

test("mesma chave nao empilha copias: reinicia o relogio", async () => {
  // O caso de um `call` para fora dentro de um laco.
  await show({ key: "call:0x1000", title: "primeiro" });
  await advance(TOAST_TIMEOUT - 500);

  await show({ key: "call:0x1000", title: "segundo" });
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("segundo");

  // O relogio recomecou: o que faltava do primeiro nao derruba o segundo.
  await advance(1000);
  expect(container.textContent).toContain("segundo");

  await advance(TOAST_TIMEOUT);
  expect(container.textContent).not.toContain("segundo");
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
