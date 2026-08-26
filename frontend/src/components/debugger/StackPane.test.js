/**
 * O que a pilha diz sobre os valores que ela guarda.
 *
 * Um endereco de retorno e o valor mais importante da pilha e o mais mudo: sem
 * rotulo, e um numero igual a qualquer outro. Aqui se verifica que ele e
 * reconhecido — e que o menu de contexto leva ao dump so quando ha memoria de
 * verdade do outro lado.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import StackPane from "components/debugger/StackPane";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;
const TARGET = CODE_BASE + 0x10n;

let container;
let root;

/**
 * Maquina com um `call` de 5 bytes no inicio do codigo: o endereco de retorno
 * dele e, portanto, CODE_BASE+5.
 */
function build() {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: new Array(0x20).fill(0x90),
    instructions: [
      { address: CODE_BASE.toString(), size: 5, text: `call 0x${TARGET.toString(16)}`,
        mnemonic: "call", groups: ["call"], line: 7,
        operands: [{ type: "imm", value: TARGET.toString(), size: 4 }] },
      { address: (CODE_BASE + 5n).toString(), size: 1, text: "nop", mnemonic: "nop",
        groups: [], line: 8, operands: [] },
    ],
  });
  return machine;
}

async function mount(machine, props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <StackPane machine={machine} {...props} />
      </I18nProvider>
    );
  });
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

const rowFor = (address) =>
  [...container.querySelectorAll("div")].find((node) =>
    node.className.includes("items-baseline") &&
    node.textContent.includes(address.toString(16).toUpperCase().padStart(8, "0"))
  );

test("valor que aponta para depois de um call e lido como endereco de retorno", async () => {
  const machine = build();
  machine.memory.write(STACK_TOP, 4, CODE_BASE + 5n);
  await mount(machine);

  const text = container.textContent;
  expect(text).toContain("return to code+0x5");
  // De quem se volta fica como "???": e o que o aluno tem de deduzir, entao o
  // painel nao pode nomear a funcao nem mostrar o alvo do `call`.
  expect(text).toContain("???");
  expect(text).not.toContain("7F200110");
  // A linha do fonte fecha a leitura para quem esta olhando o codigo.
  expect(text).toContain("line 8");
});

test("valor no codigo que nao vem de um call e so um endereco de codigo", async () => {
  const machine = build();
  // CODE_BASE+2 esta no MEIO do `call`: nenhuma instrucao termina ali.
  machine.memory.write(STACK_TOP, 4, CODE_BASE + 2n);
  await mount(machine);

  expect(container.textContent).toContain("code+0x2");
  expect(container.textContent).not.toContain("return to");
});

test("valor que nao aponta para o codigo nao ganha rotulo nenhum", async () => {
  const machine = build();
  machine.memory.write(STACK_TOP, 4, 0x11223344n);
  await mount(machine);

  expect(container.textContent).not.toContain("code+");
  expect(container.textContent).not.toContain("return to");
});

test("o menu de contexto oferece o endereco da celula e o valor guardado nela", async () => {
  const machine = build();
  machine.memory.write(STACK_TOP, 4, CODE_BASE + 5n);
  const seen = [];
  await mount(machine, { onViewInDump: (address) => seen.push(address) });

  await act(async () => {
    rowFor(STACK_TOP).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );
  });

  const items = [...document.querySelectorAll("[role=menuitem]")];
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toContain("Follow in dump");

  await act(async () => { items[1].click(); });
  expect(seen).toEqual([CODE_BASE + 5n]);
});

test("celula com valor que nao e endereco so oferece o proprio endereco", async () => {
  const machine = build();
  machine.memory.write(STACK_TOP, 4, 0x11223344n);
  await mount(machine, { onViewInDump: () => {} });

  await act(async () => {
    rowFor(STACK_TOP).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );
  });

  // Um inteiro qualquer nao vira ponteiro: oferecer o salto ensinaria errado.
  expect([...document.querySelectorAll("[role=menuitem]")]).toHaveLength(1);
});

describe("a pilha inteira, e nao uma janela ao redor do ponteiro", () => {
  // A regiao vai do limite ao teto: numa pilha de 16 KB com palavras de 4
  // bytes sao mais de quatro mil linhas. Ve-las todas de uma vez travaria o
  // painel a cada passo, entao so as visiveis viram DOM — e a barra de
  // rolagem alcanca o resto.
  const ROW_HEIGHT = 18;

  const scroller = () => container.querySelector(".overflow-auto");
  const spacer = () => scroller().firstChild;
  const rendered = () =>
    [...container.querySelectorAll("div")].filter((node) =>
      node.className.includes("items-baseline")
    );

  // Altura visivel do painel, mutavel: e arrastando a divisoria que ela muda.
  let panelHeight;

  beforeEach(() => {
    panelHeight = 180;
    // jsdom nao calcula layout: sem isto toda altura e 0 e nao ha o que rolar.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return String(this.className || "").includes("overflow-auto") ? panelHeight : 0;
      },
    });
  });

  /** Novo render no mesmo root — o que o arrasto da divisoria provoca. */
  const rerender = async (machine) => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <StackPane machine={machine} />
        </I18nProvider>
      );
    });
  };

  /** O bloco absoluto que carrega as linhas desenhadas. */
  const block = () => scroller().firstChild.firstChild;

  const scrollTo = async (top) => {
    await act(async () => {
      scroller().scrollTop = top;
      scroller().dispatchEvent(new Event("scroll", { bubbles: false }));
    });
  };

  const total = (machine) =>
    Number((machine.stackCeiling - machine.stackLimit) / BigInt(machine.arch.wordSize)) + 1;

  test("a barra de rolagem cobre do limite ao teto da pilha", async () => {
    const machine = build();
    await mount(machine);
    expect(spacer().style.height).toBe(`${total(machine) * ROW_HEIGHT}px`);
    expect(total(machine)).toBeGreaterThan(4000);
  });

  test("mas so as linhas visiveis existem no DOM", async () => {
    const machine = build();
    await mount(machine);
    expect(rendered().length).toBeLessThan(60);
  });

  test("rolando ate o fim chega-se ao limite da pilha", async () => {
    // O endereco mais baixo da regiao — onde um estouro de buffer terminaria.
    const machine = build();
    await mount(machine);
    await scrollTo(0);
    expect(rowFor(machine.stackLimit)).toBeTruthy();
  });

  test("rolando ate o topo chega-se ao teto da pilha", async () => {
    const machine = build();
    await mount(machine);
    await scrollTo(total(machine) * ROW_HEIGHT);
    expect(rowFor(machine.stackCeiling)).toBeTruthy();
  });

  test("redimensionar o painel nao deixa faixa em branco", async () => {
    // Ao crescer a area, o navegador corta a rolagem sem passar por evento
    // nenhum. Com o estado desatualizado, o bloco de linhas ficava fora do
    // lugar e sobrava uma faixa vazia onde deveria haver pilha.
    const machine = build();
    await mount(machine);

    const top = 1000 * ROW_HEIGHT;
    scroller().scrollTop = top;
    panelHeight = 400;
    await rerender(machine);

    const drawn = Number(block().style.top.replace("px", ""));
    expect(drawn).toBeLessThanOrEqual(top);
    // E as linhas desenhadas passam do fim da area visivel.
    expect(drawn + rendered().length * ROW_HEIGHT).toBeGreaterThanOrEqual(top + panelHeight);
  });

  test("redimensionar nao desfaz a rolagem feita a mao", async () => {
    // Mostrar a regiao inteira so serve se der para ficar olhando um endereco
    // distante; puxar de volta ao ponteiro a cada arrasto tiraria isso.
    const machine = build();
    await mount(machine);
    await scrollTo(0);

    panelHeight = 400;
    await rerender(machine);
    expect(scroller().scrollTop).toBe(0);
  });

  test("o ponteiro e trazido a vista quando muda", async () => {
    // Rolar a mao e uma leitura legitima e nao pode ser desfeita a cada
    // render; um passo que mexe no ponteiro, sim, traz a vista de volta.
    const machine = build();
    await mount(machine);
    await scrollTo(0);
    expect(rowFor(machine.cpu.sp)).toBeFalsy();

    await act(async () => { machine.push(0x41424344n); });
    await mount(machine);
    expect(rowFor(machine.cpu.sp)).toBeTruthy();
  });
});
