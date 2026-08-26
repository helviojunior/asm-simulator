/**
 * O registrador visto por dentro.
 *
 * O que se verifica aqui e o ENCAIXE: que as views aparecem da mais larga para
 * a mais estreita, que cada uma mostra os bits que realmente lhe pertencem, e
 * que a arquitetura ativa manda no que existe — num programa de 32 bits nao ha
 * RAX para mostrar.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import RegisterExplorerPane from "components/debugger/RegisterExplorerPane";
import RegistersPane from "components/debugger/RegistersPane";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

// O valor do diagrama da aula: 4D34 7631 7231 636B.
const VALUE = 0x4d3476317231636bn;

let container;
let root;

function build(arch = "x86_64") {
  const machine = new Machine({ arch, codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: new Array(0x20).fill(0x90),
    instructions: [
      { address: CODE_BASE.toString(), size: 1, text: "nop", mnemonic: "nop",
        groups: [], line: 1, operands: [] },
    ],
  });
  machine.cpu.writeRegister(arch === "x86_64" ? "rax" : "eax", VALUE);
  return machine;
}

async function mount(element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider>{element}</I18nProvider>);
  });
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

/** Os rotulos das views desenhadas, de cima para baixo. */
const labels = () =>
  [...container.querySelectorAll(".text-\\[\\#c586c0\\]")].map((node) => node.textContent);

test("empilha as views da mais larga para a mais estreita", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  expect(labels()).toEqual(["RAX or r0", "EAX or r0d", "AX or r0w", "AL or r0b"]);
});

test("cada nibble aparece em binario e em hexadecimal", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  const text = container.textContent;
  // O primeiro nibble de RAX: 0x4 = 0100.
  expect(text).toContain("0100");
  // E o ultimo: 0xB = 1011.
  expect(text).toContain("1011");
});

test("a view mais estreita mostra so os bits que lhe pertencem", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  // AL sao dois nibbles — 6 e B —, e o valor lido tem de ser 0x6B.
  const al = container.querySelector('[data-register="al"]');
  expect(al.textContent).toContain("AL or r0b");
  expect(al.textContent).toContain("0x6B");
  // Os dois numeros sao o mesmo valor em duas bases, e a seta e quem diz isso.
  expect(al.textContent).toContain("0x6B\u2192107");
  expect(al.textContent).not.toContain("4D");
});

test("num programa de 32 bits nao ha RAX para mostrar", async () => {
  await mount(<RegisterExplorerPane machine={build("x86")} register="eax" />);
  // E nem a nomenclatura numerada: r0d nasceu com o x86-64, e em 32 bits esse
  // nome nao existe.
  expect(labels()).toEqual(["EAX", "AX", "AL"]);
});

test("registrador sem numero de codificacao aparece so com o nome", async () => {
  // RIP nao entra na contagem do ModR/M: nao existe "RIP ou R?".
  await mount(<RegisterExplorerPane machine={build()} register="rip" />);
  expect(labels()).toEqual(["RIP", "EIP"]);
});

test("sem maquina montada, o painel diz o que falta", async () => {
  await mount(<RegisterExplorerPane machine={null} register="rax" />);
  expect(container.textContent).toContain("Assemble a program");
});

test("o menu do registrador oferece explorar, mesmo sem endereco atras", async () => {
  const explored = [];
  const machine = build("x86");
  await mount(
    <RegistersPane machine={machine} onViewInDump={() => {}} onExplore={(r) => explored.push(r)} />
  );

  // 0x4D3476317231636B truncado em 32 bits nao aponta para lugar nenhum: o
  // item de dump nao se aplica, e o de explorar tem de aparecer assim mesmo.
  const row = [...container.querySelectorAll("div")].find((node) =>
    node.className.includes("items-baseline") && node.textContent.startsWith("eax")
  );
  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });

  const item = [...document.querySelectorAll("[role=menuitem]")]
    .find((node) => node.textContent.includes("Explore"));
  expect(item).toBeTruthy();
  await act(async () => { item.click(); });
  expect(explored).toEqual(["eax"]);
});
