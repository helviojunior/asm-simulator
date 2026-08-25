/**
 * Abrir um arquivo tem de deixar a tela coerente com ELE: editor com o fonte
 * do arquivo (vazio inclusive) e nenhum programa montado do arquivo anterior.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { DialogProvider } from "contexts/DialogContext";
import { ToastProvider } from "contexts/ToastContext";
import Simulator from "pages/Simulator";
import api from "lib/api";

jest.mock("lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const META = { arch: "x86", os: "linux", code_base: "0x401000", stack_top: "0x800000", arg_count: 4 };
// `int 0x80` identifica o alvo sozinho: a montagem nao para para perguntar.
const LINUX_SOURCE = "xor ebx, ebx\nmov eax, 1\nint 0x80\n";
// Sem marca alguma — e o caso em que o simulador precisa perguntar.
const NEUTRAL_SOURCE = "push eax\npop ebx\n";
const row = (n, name) => ({ id: n, parent: null, kind: "file", name,
                            updated: "2026-08-25T10:00:00Z", metadata: META });

// jsdom nao implementa scrollIntoView; a desmontagem o usa para seguir o RIP.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};

let container;
let root;

beforeEach(async () => {
  api.get.mockImplementation((url) => {
    if (url === "/api/library/") {
      return Promise.resolve({ data: { nodes: [row(A, "cheio.asm"), row(B, "vazio.asm")] } });
    }
    if (url === `/api/library/${A}/`) {
      return Promise.resolve({ data: { id: A, name: "cheio.asm", kind: "file",
                                       source: LINUX_SOURCE, metadata: META } });
    }
    if (url === `/api/library/${B}/`) {
      return Promise.resolve({ data: { id: B, name: "vazio.asm", kind: "file",
                                       source: "", metadata: META } });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  // Montagem: `xor ebx, ebx` / `mov eax, 1` / `int 0x80` — termina em exit(0).
  api.post.mockResolvedValue({
    data: {
      data: btoa("\x31\xdb\xb8\x01\x00\x00\x00\xcd\x80"),
      instructions: [
        { address: "4198400", size: 2, text: "xor ebx, ebx", bytes: "31 db",
          mnemonic: "xor", op_str: "ebx, ebx", groups: [], line: 1,
          operands: [{ type: "reg", reg: "ebx", size: 4 },
                     { type: "reg", reg: "ebx", size: 4 }] },
        { address: "4198402", size: 5, text: "mov eax, 1", bytes: "b8 01 00 00 00",
          mnemonic: "mov", op_str: "eax, 1", groups: [], line: 2,
          operands: [{ type: "reg", reg: "eax", size: 4 },
                     { type: "imm", value: "1", size: 4 }] },
        { address: "4198407", size: 2, text: "int 0x80", bytes: "cd 80",
          mnemonic: "int", op_str: "0x80", groups: ["int"], line: 3,
          operands: [{ type: "imm", value: "128", size: 1 }] },
      ],
      line_map: { 0: 1, 2: 2, 7: 3 },
      warnings: [],
    },
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><DialogProvider><ToastProvider><Simulator /></ToastProvider></DialogProvider></I18nProvider>);
  });
  await act(async () => { await Promise.resolve(); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const buttons = () => [...container.querySelectorAll("button")];
const byText = (re) => buttons().find((b) => re.test(b.textContent));
const textarea = () => container.querySelector("textarea");
const click = async (element) => { await act(async () => { element.click(); }); await flush(); };

test("abrir arquivo vazio limpa o editor E descarta o programa montado", async () => {
  // 1. abre o arquivo com conteudo e monta
  await click(byText(/cheio\.asm/));
  expect(textarea().value).toBe(LINUX_SOURCE);

  await click(byText(/Montar|Assemble/));
  expect(container.textContent).toMatch(/int/);
  // A desmontagem mostra o endereco do programa montado.
  expect(container.textContent).toMatch(/00401000/);

  // 2. volta para a biblioteca e abre o arquivo VAZIO
  await click(byText(/Biblioteca|Library/));
  await click(byText(/vazio\.asm/));

  // O editor limpou...
  expect(textarea().value).toBe("");
  // ...e a desmontagem do arquivo anterior nao ficou para tras.
  expect(container.textContent).not.toMatch(/00401000/);
  expect(container.textContent).toMatch(/Monte um programa|Assemble a program/);
});


test("uma acao de execucao traz o codigo-fonte a vista", async () => {
  await click(byText(/cheio\.asm/));
  await click(byText(/Montar|Assemble/));

  // Volta para a biblioteca e da um passo de la.
  await click(byText(/Biblioteca|Library/));
  expect(textarea()).toBeNull();

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true }));
  });
  await flush();

  // O destaque da linha atual so serve com o fonte a vista.
  expect(textarea()).not.toBeNull();
  expect(textarea().value).toBe(LINUX_SOURCE);
});

test("a desmontagem fica esmaecida ao parar, e volta ao reiniciar", async () => {
  await click(byText(/cheio\.asm/));
  await click(byText(/Montar|Assemble/));

  const listing = () => [...container.querySelectorAll("div")]
    .find((d) => d.className.includes("overflow-auto") && d.textContent.includes("int"));
  expect(listing().className).not.toMatch(/grayscale/);

  // Executa ate o exit(0): tres passos.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true }));
    });
    await flush();
  }

  expect(container.textContent).toMatch(/Execução encerrada|Execution ended/);
  expect(listing().className).toMatch(/grayscale/);

  // "Voltar passo" desfaz a parada — a listagem volta antes de reiniciar.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", ctrlKey: true, bubbles: true }));
  });
  await flush();

  expect(listing().className).not.toMatch(/grayscale/);
  expect(container.textContent).not.toMatch(/Execução encerrada|Execution ended/);

  // ...e reiniciar tambem, vindo de uma parada nova.
  for (let i = 0; i < 1; i += 1) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true }));
    });
    await flush();
  }
  expect(listing().className).toMatch(/grayscale/);

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", ctrlKey: true, bubbles: true }));
  });
  await flush();

  expect(listing().className).not.toMatch(/grayscale/);
  expect(container.textContent).not.toMatch(/Execução encerrada|Execution ended/);
});


/** Dispara F7 uma vez. */
const step = async () => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true }));
  });
  await flush();
};

/** Botao do modal de confirmacao, procurado no document (ele vive num portal). */
const dialogButton = (re) =>
  [...document.querySelectorAll("button")].find((b) => re.test(b.textContent));

test("trocar de arquivo com simulacao em andamento pede confirmacao", async () => {
  await click(byText(/cheio\.asm/));
  await click(byText(/Montar|Assemble/));
  await step();
  expect(container.textContent).toMatch(/00401002/);

  // 1. Cancelar mantem tudo: a simulacao continua e o arquivo nao muda.
  await click(byText(/Biblioteca|Library/));
  await click(byText(/vazio\.asm/));
  expect(document.body.textContent).toMatch(/simulação em andamento|simulation in progress/i);

  await act(async () => { dialogButton(/Cancelar|Cancel/).click(); });
  await flush();

  expect(container.textContent).toMatch(/00401002/);
  expect(container.textContent).toMatch(/cheio\.asm/);

  // 2. Confirmar para a simulacao e limpa a desmontagem.
  await click(byText(/vazio\.asm/));
  await act(async () => { dialogButton(/Parar e abrir|Stop and open/).click(); });
  await flush();

  expect(container.textContent).not.toMatch(/00401002/);
  expect(container.textContent).toMatch(/Monte um programa|Assemble a program/);
  expect(textarea().value).toBe("");
});

test("sem passos dados, trocar de arquivo nao pergunta nada", async () => {
  await click(byText(/cheio\.asm/));
  await click(byText(/Montar|Assemble/));

  // Montado, mas nenhum passo: nao ha corrida a perder.
  await click(byText(/Biblioteca|Library/));
  await click(byText(/vazio\.asm/));

  expect(document.body.textContent).not.toMatch(/simulação em andamento|simulation in progress/i);
  expect(textarea().value).toBe("");
});


test("alvo desconhecido: o simulador pergunta antes de montar", async () => {
  // Terceiro arquivo, sem nenhuma marca de sistema no fonte.
  api.get.mockImplementation((url) => {
    if (url === "/api/library/") {
      return Promise.resolve({ data: { nodes: [row(A, "neutro.asm")] } });
    }
    return Promise.resolve({ data: { id: A, name: "neutro.asm", kind: "file",
                                     source: NEUTRAL_SOURCE, metadata: { ...META, os: "" } } });
  });

  await act(async () => { root.unmount(); });
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><DialogProvider><ToastProvider><Simulator /></ToastProvider></DialogProvider></I18nProvider>);
  });
  await flush();

  await click(byText(/neutro\.asm/));
  await click(byText(/Montar|Assemble/));

  // Nada foi montado ainda: o simulador esta esperando a resposta.
  expect(document.body.textContent).toMatch(/Para qual sistema|Which system/i);
  expect(container.textContent).not.toMatch(/00401000/);

  // Escolhido o alvo, a montagem segue.
  // O rotulo vem precedido do glifo do sistema, entao nao ancorar no inicio.
  const linux = [...document.querySelectorAll("button")].find((b) => /Linux/.test(b.textContent));
  await act(async () => { linux.click(); });
  await flush();

  expect(container.textContent).toMatch(/00401000/);
  // E a escolha fica registrada na barra superior, sem perguntar de novo.
  const combo = [...container.querySelectorAll("select")]
    .find((el) => [...el.options].some((o) => o.value === "linux"));
  expect(combo.value).toBe("linux");
});
