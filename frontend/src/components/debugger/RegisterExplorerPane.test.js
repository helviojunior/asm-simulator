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

/** As celulas marcadas como alteradas dentro de uma view. */
const changedCells = (name) =>
  [...container.querySelectorAll(`[data-register="${name}"] [data-changed="true"]`)]
    .map((node) => node.textContent);

/** A maquina com AL reescrito, e o valor que RAX tinha antes disso. */
async function afterWritingAl() {
  const machine = build();
  machine.cpu.writeRegister("al", 0x41n);
  await mount(
    <RegisterExplorerPane machine={machine} register="rax" changed={[["rax", VALUE]]} />
  );
}

test("o byte escrito no ultimo passo ganha a caixa vermelha", async () => {
  // Antes 0x…6B, agora 0x…41: mudou o byte de baixo, e so ele.
  await afterWritingAl();
  // Dois nibbles por byte, e a marca aparece em TODAS as views que mostram
  // aquele byte — e o mesmo byte visto de quatro larguras.
  expect(changedCells("al")).toEqual(["01004", "00011"]);
  expect(changedCells("ax")).toEqual(["01004", "00011"]);
  expect(changedCells("eax")).toEqual(["01004", "00011"]);
  expect(changedCells("rax")).toEqual(["01004", "00011"]);
});

test("byte que ninguem tocou continua sem marca", async () => {
  await afterWritingAl();
  // RAX tem oito bytes e so um mudou: os outros sete ficam intocados.
  const all = container.querySelectorAll('[data-register="rax"] [data-changed]');
  expect(all).toHaveLength(2);
});

test("sem passo dado, nada e marcado", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  expect(changedCells("rax")).toEqual([]);
});

/** A barra de deslocamento e os dois numeros de uma view. */
const slider = () => container.querySelector('input[type="range"]');
const valueOf = (name) =>
  [...container.querySelectorAll(`[data-register="${name}"] span`)]
    .map((node) => node.textContent)
    .find((text) => text.startsWith("0x"));

const slide = async (bits) => {
  await act(async () => {
    const input = slider();
    // O React escuta o `input` nativo; mexer no `.value` a mao exige avisa-lo.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
      .set.call(input, String(bits));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("a barra desloca os bits para a esquerda em toda a cascata", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  await slide(4);

  // Um nibble a esquerda: 0x4D3476317231636B vira 0xD3476317231636B0.
  expect(valueOf("rax")).toBe("0xD3476317231636B0");
  // E a cascata acompanha: AL passa a ser o nibble que era o penultimo.
  expect(valueOf("al")).toBe("0xB0");
  expect(container.textContent).toContain("shl rax, 4");
});

test("para a direita os bits que saem sao perdidos", async () => {
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  await slide(-8);

  // O byte de baixo (0x6B) caiu fora e um 00 entrou pela esquerda.
  expect(valueOf("rax")).toBe("0x004D347631723163");
  expect(container.textContent).toContain("shr rax, 8");
});

test("o registrador de verdade nao e tocado", async () => {
  // A barra e simulacao: o painel mente na tela e diz que esta mentindo, mas
  // a CPU continua com o valor que tinha.
  const machine = build();
  await mount(<RegisterExplorerPane machine={machine} register="rax" />);
  await slide(16);

  expect(machine.cpu.readRegister("rax")).toBe(VALUE);
  expect(container.textContent).toContain("simulated");
});

test("voltar o cursor devolve o valor real, sem bit perdido pelo caminho", async () => {
  // A conta e refeita sempre a partir do valor da CPU: ir e voltar nao pode
  // deixar zeros no lugar dos bits que sairam.
  await mount(<RegisterExplorerPane machine={build()} register="rax" />);
  await slide(12);
  await slide(0);

  expect(valueOf("rax")).toBe("0x4D3476317231636B");
  expect(container.textContent).not.toContain("simulated");
});

test("com deslocamento, a marca do ultimo passo some", async () => {
  // O valor na tela nao veio de passo nenhum; marca-lo seria atribuir a
  // instrucao o que foi a barra que fez.
  const machine = build();
  machine.cpu.writeRegister("al", 0x41n);
  await mount(
    <RegisterExplorerPane machine={machine} register="rax" changed={[["rax", VALUE]]} />
  );
  expect(changedCells("al")).toHaveLength(2);

  await slide(4);
  expect(changedCells("al")).toHaveLength(0);
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
