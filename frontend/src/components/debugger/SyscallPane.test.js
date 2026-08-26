/**
 * O painel de chamada de sistema, e o que ele promete ANTES de executar.
 *
 * Uma syscall sem simulação não interrompe nada: ela é pulada e a execução
 * segue na instrução seguinte. O único efeito que deixa de acontecer é o
 * RETORNO — e quem só olhasse o registrador depois concluiria que a chamada
 * devolveu o que já estava lá. Dizer isso é o serviço do painel.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { Machine } from "lib/cpu/machine";
import SyscallPane from "components/debugger/SyscallPane";
import api from "lib/api";

// O painel busca o prototipo da funcao resolvida; aqui nao ha catalogo, e a
// ausencia dele nao pode quebrar a tela.
jest.mock("lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const BASE = 0x401000n;

let container;
let root;

/**
 * Máquina parada num `int 0x80` (ou `syscall`), com `number` no registrador
 * de número da chamada.
 */
function build({ os = "linux", arch = "x86", number }) {
  const machine = new Machine({ arch, os, codeBase: BASE, stackTop: 0x800000n });
  const gate = arch === "x86_64"
    ? { text: "syscall", mnemonic: "syscall", bytes: "0F 05", size: 2, operands: [] }
    : { text: "int 0x80", mnemonic: "int", bytes: "CD 80", size: 2,
        operands: [{ type: "imm", value: "128", size: 1 }] };

  machine.load({
    bytes: [0x90, 0x90],
    instructions: [{ address: BASE.toString(), groups: [], line: 1, ...gate }],
  });
  machine.cpu.writeRegister(arch === "x86_64" ? "rax" : "eax", BigInt(number));
  return machine;
}

async function mount(options) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <SyscallPane machine={build(options)} count={4} tick={0} onImportNtdll={() => {}} />
      </I18nProvider>
    );
  });
}

beforeEach(() => {
  api.get.mockResolvedValue({ data: { prototype: null, prototypes: [] } });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

const text = () => container.textContent;

test("syscall Linux sem simulação explica que vai ser pulada", async () => {
  // 5 = open no int 0x80 do Linux: conhecida, e sem simulação.
  await mount({ number: 5 });
  expect(text()).toContain("open");
  expect(text()).toContain("not simulated");
  expect(text()).toContain("The simulator reproduces write, read, exit and execve");
  expect(text()).toContain("does not exist here");
});

test("o selo NÃO diz que a execução para — porque ela não para", async () => {
  await mount({ number: 5 });
  expect(text()).not.toContain("stops execution");
});

test("syscall simulada não ganha o aviso", async () => {
  // 4 = write no int 0x80 do Linux, que o simulador reproduz.
  await mount({ number: 4 });
  expect(text()).toContain("simulated");
  expect(text()).not.toContain("The simulator reproduces write");
});

test("número desconhecido também avisa que será pulado", async () => {
  await mount({ number: 4242 });
  expect(text()).toContain("The simulator reproduces write, read, exit and execve");
});

test("no x86-64 do Linux vale a outra tabela, e o aviso é o mesmo", async () => {
  // 2 = open no syscall de 64 bits (1 seria write, que é simulada).
  await mount({ os: "linux", arch: "x86_64", number: 2 });
  expect(text()).toContain("open");
  expect(text()).toContain("The simulator reproduces write, read, exit and execve");
});

test("Windows sem ntdll continua com a explicação dele, e só com ela", async () => {
  // Ali o problema é outro: não há número estável a resolver. Repetir o aviso
  // de "não simulada" empilharia duas explicações para o mesmo `syscall`.
  await mount({ os: "windows", arch: "x86_64", number: 0x18 });
  expect(text()).toContain("Windows has no stable syscall number");
  expect(text()).not.toContain("The simulator reproduces write");
});
