/**
 * As abas do painel inferior esquerdo: biblioteca, codigo-fonte e dump.
 *
 * A regra que importa aqui e a de FOCO. Dar um passo traz o codigo para a
 * frente quando quem esta na biblioteca nao veria a linha destacada — mas quem
 * escolheu o dump esta olhando a memoria mudar, e devolve-lo ao codigo a cada
 * passo tiraria da vista justamente o que ele foi ver. Ao voltar, a linha de
 * execucao tem de estar onde a CPU parou.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { DialogProvider } from "contexts/DialogContext";
import { Machine } from "lib/cpu/machine";
import EditorPane from "components/debugger/EditorPane";
import api from "lib/api";

jest.mock("lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const CODE_BASE = 0x7f200100n;
const SOURCE = "xor eax, eax\nmov ebx, 1\nint 0x80\n";

let container;
let root;
let render;

function machine() {
  const item = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: 0x00804000n });
  item.load({
    bytes: [0x31, 0xc0],
    instructions: [
      { address: CODE_BASE.toString(), size: 2, text: "xor eax, eax", mnemonic: "xor",
        groups: [], line: 1, operands: [] },
    ],
  });
  return item;
}

beforeEach(async () => {
  api.get.mockResolvedValue({ data: { nodes: [] } });
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render = async (props = {}) => {
    await act(async () => {
      root.render(
        <I18nProvider><DialogProvider>
          <EditorPane
            source={SOURCE}
            onSourceChange={() => {}}
            messages={[]}
            machine={machine()}
            params={{}}
            onOpenFile={() => {}}
            onOpenFileChange={() => {}}
            openFile={null}
            dirty={false}
            onSave={() => {}}
            currentLine={3}
            {...props}
          />
        </DialogProvider></I18nProvider>
      );
    });
  };
  await render();
  await act(async () => { await Promise.resolve(); });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

const tab = (label) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent.includes(label));

const click = async (node) => { await act(async () => { node.click(); }); };

/** True se a linha `n` do gutter esta com a faixa da linha em execucao. */
const gutterHighlights = (n) =>
  [...container.querySelectorAll("div")].some(
    (node) => node.textContent === String(n) && node.className.includes("bg-[#094771]")
  );

test("ha uma aba de dump ao lado do codigo-fonte", async () => {
  expect(tab("Dump")).toBeTruthy();
  await click(tab("Dump"));
  expect(container.textContent).toContain("7F200100");
});

test("dar um passo com o dump aberto NAO devolve a aba ao codigo-fonte", async () => {
  await click(tab("Dump"));
  // Cada acao de execucao incrementa `focusSource`.
  await render({ focusSource: 1 });
  await render({ focusSource: 2 });

  expect(container.textContent).toContain("7F200100");
  expect(container.querySelector("textarea")).toBeNull();
});

test("da biblioteca, o passo continua trazendo o codigo para a frente", async () => {
  // A aba inicial e a biblioteca: ali um passo destacaria uma linha que
  // ninguem esta vendo.
  await render({ focusSource: 1 });
  expect(container.querySelector("textarea")).toBeTruthy();
});

test("ao voltar do dump, a linha de execucao esta onde a CPU parou", async () => {
  await click(tab("Dump"));
  await render({ focusSource: 1, currentLine: 3 });
  await click(tab("Source"));

  expect(container.querySelector("textarea").value).toBe(SOURCE);
  expect(gutterHighlights(3)).toBe(true);
  expect(gutterHighlights(1)).toBe(false);
});

test("erro de montagem ainda ganha do dump: o erro fica ancorado no fonte", async () => {
  await click(tab("Dump"));
  await render({ messages: [{ line: 2, message: "boom", level: "error" }] });

  expect(container.textContent).toContain("boom");
  expect(container.querySelector("textarea")).toBeTruthy();
});
