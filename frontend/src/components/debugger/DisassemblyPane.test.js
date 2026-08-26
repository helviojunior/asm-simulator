/**
 * A listagem de desmontagem: onde uma seção acaba e a outra começa.
 *
 * Sem a marca, a passagem de `.text` para `.data` é só mais uma linha de `db`
 * no meio de outras — some justamente a fronteira que a aula está ensinando.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import DisassemblyPane from "components/debugger/DisassemblyPane";

const CODE_BASE = 0x7f200100n;

// Duas instruções e, depois do vão, um bloco de dados — o layout que o
// montador entrega para um programa com `section .data`.
const SECTIONS = [
  { name: ".text", start: 0, end: 2 },
  { name: ".data", start: 0x1000, end: 0x1004 },
];

const INSTRUCTIONS = [
  { address: CODE_BASE.toString(), size: 1, bytes: "90", mnemonic: "nop", op_str: "",
    text: "nop", data: false, fill: false, line: 2, operands: [], groups: [] },
  { address: (CODE_BASE + 1n).toString(), size: 1, bytes: "C3", mnemonic: "ret", op_str: "",
    text: "ret", data: false, fill: false, line: 3, operands: [], groups: [] },
  { address: (CODE_BASE + 2n).toString(), size: 0xffe, bytes: "00", mnemonic: "times",
    op_str: "4094 db 0x00", text: "times 4094 db 0x00", data: true, fill: true,
    line: null, operands: [], groups: [] },
  { address: (CODE_BASE + 0x1000n).toString(), size: 4, bytes: "4F 69 0A 00", mnemonic: "db",
    op_str: "0x4F, 0x69, 0x0A, 0x00", text: "db 0x4F, 0x69, 0x0A, 0x00", data: true,
    fill: false, line: 6, operands: [], groups: [] },
];

let container;
let root;

function build() {
  const machine = new Machine({ arch: "x86_64", codeBase: CODE_BASE, stackTop: 0x804000n });
  const bytes = new Uint8Array(0x1004);
  machine.load({ bytes, sections: SECTIONS, instructions: INSTRUCTIONS });
  return machine;
}

async function mount(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <DisassemblyPane
          machine={build()}
          instructions={INSTRUCTIONS}
          currentAddress={CODE_BASE}
          breakpoints={new Set()}
          onToggleBreakpoint={() => {}}
          {...props}
        />
      </I18nProvider>
    );
  });
}

beforeAll(() => {
  // jsdom não implementa scrollIntoView; a listagem o usa para seguir o RIP.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

/**
 * Texto de cada linha da listagem, na ordem em que aparece.
 *
 * `items-` filtra a área rolável, cuja classe também começa com `flex` e cujo
 * texto é o da listagem inteira.
 */
const lines = () =>
  [...container.querySelectorAll("div")]
    .filter((node) => node.className.includes("items-") && node.textContent.trim())
    .map((node) => node.textContent);

test("cada seção ganha uma divisória com o nome", async () => {
  await mount();
  expect(container.textContent).toContain(".text");
  expect(container.textContent).toContain(".data");
});

test("a divisória vem ANTES da primeira linha da seção", async () => {
  await mount();
  const all = lines();
  const rule = all.findIndex((text) => text.trim() === ".data");
  // Pelo ENDEREÇO: a listagem mostra os bytes como texto legível (`"Oi\n·"`),
  // não como os `0x..` do operando.
  const first = all.findIndex((text) => text.includes("7F201100"));
  expect(rule).toBeGreaterThanOrEqual(0);
  expect(rule).toBeLessThan(first);
});

test("a divisória é uma linha, não uma instrução", async () => {
  // Ela não pode virar mais um endereço na listagem: não há byte nenhum ali.
  await mount();
  const rule = [...container.querySelectorAll("div")]
    .find((node) => node.textContent.trim() === ".data");
  expect(rule.querySelector("button")).toBeNull();
  expect(rule.textContent).not.toMatch(/[0-9A-F]{8}/);
});

test("o enchimento entre as seções aparece como uma linha de `times`", async () => {
  await mount();
  const fill = lines().find((text) => text.includes("times"));
  expect(fill).toContain("4094 db 0x00");
  // E não lido como texto: `"\x00\x00…"` não diria quantos bytes são.
  expect(fill).not.toContain("\\x00\\x00");
});

test("sem programa montado não há divisória nenhuma", async () => {
  await mount({ machine: null, instructions: [] });
  expect(container.textContent).not.toContain(".data");
});
