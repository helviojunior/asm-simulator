/**
 * As flags, e o unico ponto do simulador em que o estado da CPU se muda a mao.
 *
 * O que se verifica: que a fileira mostra o valor de cada flag, que o menu de
 * contexto oferece o valor OPOSTO ao atual, que a escolha chega ao `onChange`,
 * que a maquina realmente muda — e que a marca vermelha continua sendo a do
 * ultimo passo, nao a da edicao.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import FlagsPane from "components/debugger/FlagsPane";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

let container;
let root;

function build() {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: [0x90],
    instructions: [
      { address: CODE_BASE.toString(), size: 1, text: "nop", mnemonic: "nop",
        groups: [], line: 1, operands: [] },
    ],
  });
  return machine;
}

async function mount(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><FlagsPane {...props} /></I18nProvider>);
  });
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

const chip = (flag) => container.querySelector(`[data-flag="${flag}"]`);

/** Abre o menu de contexto sobre uma flag e devolve os itens dele. */
const openMenu = async (flag) => {
  await act(async () => {
    chip(flag).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );
  });
  return [...document.querySelectorAll("[role=menuitem]")];
};

test("a fileira mostra as sete flags com o valor de cada uma", async () => {
  const machine = build();
  machine.cpu.setFlag("ZF", true);
  await mount({ machine });

  expect(chip("ZF").textContent).toBe("ZF 1");
  expect(chip("CF").textContent).toBe("CF 0");
});

test("o menu oferece o valor OPOSTO ao atual", async () => {
  const machine = build();
  machine.cpu.setFlag("ZF", true);
  await mount({ machine, onChange: () => {} });

  expect((await openMenu("CF"))[0].textContent).toContain("Set CF = 1");
  await act(async () => { document.querySelectorAll("[role=menuitem]")[0].click(); });
  expect((await openMenu("ZF"))[0].textContent).toContain("Set ZF = 0");
});

test("escolher o item pede a troca com o valor novo", async () => {
  const calls = [];
  await mount({ machine: build(), onChange: (flag, value) => calls.push([flag, value]) });

  const items = await openMenu("CF");
  await act(async () => { items[0].click(); });
  expect(calls).toEqual([["CF", true]]);
});

test("a maquina troca a flag pedida, e so ela", async () => {
  const machine = build();
  machine.setFlag("ZF", true);

  expect(machine.cpu.getFlag("ZF")).toBe(true);
  expect(machine.cpu.getFlag("CF")).toBe(false);

  machine.setFlag("ZF", false);
  expect(machine.cpu.getFlag("ZF")).toBe(false);
});

test("trocar a flag a mao nao entra no diario do passo", async () => {
  // O diario existe para o "voltar passo" desfazer o que uma INSTRUCAO fez.
  // Fora de um passo ele nem esta aberto, e uma edicao manual nao pode ser
  // confundida com efeito de instrucao.
  const machine = build();
  machine.setFlag("ZF", true);
  expect(machine.cpu.journal).toBeNull();
});

test("nome de flag desconhecido e recusado", async () => {
  expect(() => build().setFlag("XF", true)).toThrow();
});

test("sem quem atenda a troca, o menu nem abre", async () => {
  // O painel pode ser montado sem edicao; ali ele nao pode dar a impressao de
  // que o clique direito faz algo.
  await mount({ machine: build() });
  expect(await openMenu("CF")).toHaveLength(0);
});

test("a marca vermelha e a do ultimo passo", async () => {
  await mount({ machine: build(), changed: ["ZF"], onChange: () => {} });
  expect(container.querySelector('[data-flag="ZF"]').className).toContain("ring-[#ff6b6b]");
  expect(container.querySelector('[data-flag="CF"]').className).not.toContain("ring-[#ff6b6b]");
});
