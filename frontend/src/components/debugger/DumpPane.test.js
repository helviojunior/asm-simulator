/**
 * O painel de dump: selecionar bytes (inclusive atravessando linhas) e
 * copia-los.
 *
 * A copia real passa por `document.execCommand("copy")` — o simulador e
 * servido em HTTP puro e `navigator.clipboard` nao existe ali. Aqui o
 * `execCommand` e espionado: o que se verifica e QUE TEXTO teria ido para a
 * area de transferencia.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import DumpPane from "components/debugger/DumpPane";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

// "Hello" seguido de bytes nao imprimiveis, para exercitar as duas colunas.
const BYTES = [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x90, 0xff];

let container;
let root;
let copied;

function build(sections) {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: BYTES,
    sections,
    instructions: [
      { address: CODE_BASE.toString(), size: 8, text: "nop", mnemonic: "nop",
        bytes: "90", groups: [], operands: [] },
    ],
  });
  return machine;
}

async function mount({ sections, ...props } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <DumpPane machine={build(sections)} {...props} />
      </I18nProvider>
    );
  });
}

beforeEach(() => {
  copied = null;
  // jsdom nao implementa nem `execCommand` nem o ResizeObserver que mede a
  // altura visivel do painel.
  // O texto copiado e lido do textarea temporario que `lib/clipboard` cria e
  // seleciona: em jsdom, `select()` nao move o foco, entao o elemento ativo
  // nao serve de pista.
  document.execCommand = jest.fn(() => {
    const field = [...document.querySelectorAll('textarea[aria-hidden="true"]')].pop();
    copied = field ? field.value : null;
    return true;
  });
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // jsdom nao calcula layout: sem isto toda altura e 0 e nao ha o que rolar.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() { return this.getAttribute("role") === "grid" ? 180 : 0; },
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

/**
 * A celula hexadecimal de um endereco.
 *
 * Por endereco, e nao por posicao: a faixa navegavel comeca ANTES do codigo
 * (a folga que deixa ver o que ha antes do programa), entao a primeira celula
 * da tela nao e o primeiro byte carregado.
 */
const cell = (address) =>
  [...container.querySelectorAll(`[data-address="${BigInt(address).toString()}"]`)][0];

const grid = () => container.querySelector("[role=grid]");
const footer = () => container.querySelector("footer").textContent;

const fire = async (node, type, init = {}) => {
  await act(async () => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
};

const press = async (key, init = {}) => {
  await act(async () => {
    grid().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
};

test("desenha endereco, hexadecimal e ASCII dos bytes carregados", async () => {
  await mount();
  const text = container.textContent;
  expect(text).toContain("7F200100");
  expect(text).toContain("48");
  // A coluna ASCII usa os mesmos glifos da pilha: "Hello" aparece legivel.
  expect(text).toContain("Hello");
});

test("clique seleciona um byte e o rodape diz qual", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });

  expect(footer()).toContain("7F200100");
  expect(footer()).toContain("1 bytes");
});

test("arrastar seleciona uma faixa contigua, atravessando linhas", async () => {
  await mount();
  // Do primeiro byte do programa ate um que ja esta na linha seguinte: com 16
  // bytes por linha e a faixa alinhada, 0x7F200114 esta na de baixo.
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(cell(CODE_BASE + 20n), "mouseover");
  await fire(window, "mouseup");

  expect(footer()).toContain("21 bytes");
  expect(footer()).toContain("7F200114");
});

test("shift+clique estende a selecao a partir da ancora", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(cell(CODE_BASE + 3n), "mousedown", { button: 0, shiftKey: true });

  expect(footer()).toContain("4 bytes");
});

test("soltar o botao encerra o arrasto — passar o mouse depois nao seleciona", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(window, "mouseup");
  await fire(cell(CODE_BASE + 5n), "mouseover");

  expect(footer()).toContain("1 bytes");
});

test("Ctrl+C copia os bytes selecionados em hexadecimal", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(cell(CODE_BASE + 4n), "mouseover");
  await fire(window, "mouseup");
  await press("c", { ctrlKey: true });

  expect(copied).toBe("48 65 6C 6C 6F");
});

test("o menu de contexto copia nos formatos de shellcode", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(cell(CODE_BASE + 2n), "mouseover");
  await fire(window, "mouseup");
  await fire(cell(CODE_BASE), "contextmenu", { button: 2 });

  const item = [...document.querySelectorAll("[role=menuitem]")]
    .find((node) => node.textContent.includes("\\x"));
  expect(item).toBeTruthy();
  await act(async () => { item.click(); });

  expect(copied).toBe("\\x48\\x65\\x6c");
});

test("clique direito fora da selecao passa a selecionar o byte de baixo", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(window, "mouseup");
  await fire(cell(CODE_BASE + 6n), "contextmenu", { button: 2 });

  expect(footer()).toContain("7F200106");
  expect(footer()).toContain("1 bytes");
});

test("as setas movem o byte selecionado; shift estende", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await press("ArrowRight");
  expect(footer()).toContain("7F200101");
  expect(footer()).toContain("1 bytes");

  await press("ArrowRight", { shiftKey: true });
  expect(footer()).toContain("2 bytes");
});

test("Escape limpa a selecao", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await press("Escape");
  expect(footer()).not.toContain("1 bytes");
});

test("a selecao de 4 bytes e lida como um numero little-endian", async () => {
  await mount();
  await fire(cell(CODE_BASE), "mousedown", { button: 0 });
  await fire(cell(CODE_BASE + 3n), "mouseover");
  await fire(window, "mouseup");

  // 48 65 6C 6C na memoria e 0x6C6C6548 como dword.
  expect(footer()).toContain("6C6C6548");
});

test('"ver no dump" leva o painel ao endereco pedido e o seleciona', async () => {
  const at = STACK_TOP - 0x20n;
  await mount({ target: { address: at, nonce: 1 } });
  expect(footer()).toContain("00803FE0");
  expect(container.textContent).toContain("00803FE0");
});

test("sem programa montado, o painel diz o que falta", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><DumpPane machine={null} /></I18nProvider>);
  });
  expect(container.textContent).toContain("Assemble a program");
});

describe("atalhos de navegação", () => {
  const shortcut = (label) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === label);

  // 4 bytes de código e 4 de dados, dentro da mesma imagem contígua.
  const SPLIT = [
    { name: ".text", start: 0, end: 4 },
    { name: ".data", start: 4, end: 8 },
  ];

  test("há um botão para cada região", async () => {
    await mount({ sections: SPLIT });
    ["EIP", "ESP", ".text", ".data"].forEach((label) => {
      expect(shortcut(label)).toBeTruthy();
    });
  });

  test("o nome da seção não é escrito em maiúscula", async () => {
    // `.DATA` não existe em fonte nenhum: é `.data`.
    await mount({ sections: SPLIT });
    expect(shortcut(".data").className).not.toContain("uppercase");
  });

  test(".data leva ao primeiro byte de dados e o seleciona", async () => {
    await mount({ sections: SPLIT });
    await act(async () => { shortcut(".data").click(); });

    expect(footer()).toContain("7F200104");
    expect(footer()).toContain(".data+0x0");
  });

  test(".text leva ao início do código", async () => {
    await mount({ sections: SPLIT });
    await act(async () => { shortcut(".data").click(); });
    await act(async () => { shortcut(".text").click(); });

    expect(footer()).toContain("7F200100");
    expect(footer()).toContain(".text+0x0");
  });

  test("sem `.data` declarada o botão continua lá, marcado como vazio", async () => {
    // Levar ao ponto onde ela começaria é a resposta certa para "onde ficam
    // os meus dados?" num programa que ainda não declarou nenhum.
    await mount({ sections: [{ name: ".text", start: 0, end: 8 }] });
    const button = shortcut(".data");
    expect(button).toBeTruthy();
    expect(button.getAttribute("title")).toContain("empty");

    await act(async () => { button.click(); });
    expect(footer()).toContain("7F200108");
  });
});

describe("posicionamento ao seguir um endereço", () => {
  // 0x7F200106 nao e multiplo de 16: com a grade alinhada a faixa, ele cairia
  // no MEIO de uma linha.
  const ODD = CODE_BASE + 6n;

  /** Endereço da primeira coluna de cada linha desenhada, de cima para baixo. */
  const rowAddresses = () =>
    [...container.querySelectorAll("[role=grid] .flex")]
      .map((row) => row.firstChild?.textContent)
      .filter((text) => /^[0-9A-F]{8}$/.test(text || ""));

  test("o endereço pedido vira o primeiro byte da linha", async () => {
    await mount({ target: { address: ODD, nonce: 1 } });
    expect(rowAddresses()).toContain("7F200106");
  });

  test("e as linhas seguintes continuam a partir dele", async () => {
    await mount({ target: { address: ODD, nonce: 1 } });
    const rows = rowAddresses();
    const index = rows.indexOf("7F200106");
    expect(rows[index + 1]).toBe("7F200116");
  });

  test("a linha fica no topo da área visível", async () => {
    await mount({ target: { address: ODD, nonce: 1 } });
    const grid = container.querySelector("[role=grid]");

    // A rolagem é medida em linhas de 18px a partir do começo da grade. Com o
    // endereço no topo, o que rolou é exatamente o que está acima dele:
    // a grade começa em 7F2000B6 e 7F200106 é a sexta linha (0x50 / 16 = 5).
    const gridStart = BigInt(`0x${rowAddresses()[0]}`);
    expect(grid.scrollTop).toBe(Number((ODD - gridStart) / 16n) * 18);
    // Sanidade: rolagem de verdade, não o topo por acaso.
    expect(grid.scrollTop).toBeGreaterThan(0);
  });

  test("trocar a largura da linha mantém o endereço no começo", async () => {
    await mount({ target: { address: ODD, nonce: 1 } });
    const select = container.querySelector("select");
    await act(async () => {
      select.value = "32";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowAddresses()).toContain("7F200106");
  });
});
