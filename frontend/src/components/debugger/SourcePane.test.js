/**
 * Tab no editor e indentacao, nao troca de foco: 4 espacos ate a proxima
 * parada, como o Sublime com `translate_tabs_to_spaces`.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import SourcePane from "components/debugger/SourcePane";

let container;
let root;
let source;

/** Renderiza o painel como componente controlado, guardando o texto atual. */
async function mount(initial) {
  source = initial;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <SourcePane
            source={source}
            onChange={(value) => {
              source = value;
              render();
            }}
          />
        </I18nProvider>
      );
    });
  };
  await render();
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

const textarea = () => container.querySelector("textarea");

/** Posiciona o cursor/selecao e dispara a tecla, como o usuario faria. */
async function pressTab(start, end = start, shiftKey = false) {
  const field = textarea();
  field.focus();
  field.setSelectionRange(start, end);
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })
    );
  });
}

test("Tab insere espacos ate a proxima parada de 4, nunca \\t", async () => {
  await mount("mov rax, 1");
  await pressTab(0);
  expect(source).toBe("    mov rax, 1");
  expect(source).not.toContain("\t");
});

test("Tab completa a parada a partir da coluna atual", async () => {
  await mount("  mov rax, 1"); // cursor na coluna 2 → faltam 2 espacos
  await pressTab(2);
  expect(source).toBe("    mov rax, 1");
});

test("Tab substitui a selecao dentro de uma linha", async () => {
  await mount("mov rax, 1");
  await pressTab(0, 3); // "mov" selecionado da lugar aos espacos
  expect(source).toBe("     rax, 1");
});

test("Tab com varias linhas selecionadas indenta o bloco", async () => {
  await mount("mov rax, 1\n\nmov rdi, 0");
  await pressTab(0, "mov rax, 1\n\nmov rdi, 0".length);
  // A linha em branco fica em branco — recuo solto nao serve para nada.
  expect(source).toBe("    mov rax, 1\n\n    mov rdi, 0");
});

test("selecao terminada no inicio da linha nao arrasta a linha seguinte", async () => {
  await mount("mov rax, 1\nmov rdi, 0");
  await pressTab(0, "mov rax, 1\n".length);
  expect(source).toBe("    mov rax, 1\nmov rdi, 0");
});

test("Shift+Tab remove um nivel, inclusive do \\t herdado", async () => {
  await mount("    mov rax, 1\n\tmov rdi, 0\n  mov rsi, 2");
  await pressTab(0, "    mov rax, 1\n\tmov rdi, 0\n  mov rsi, 2".length, true);
  expect(source).toBe("mov rax, 1\nmov rdi, 0\nmov rsi, 2");
});

test("Shift+Tab sem selecao desindenta so a linha do cursor", async () => {
  await mount("    mov rax, 1\n    mov rdi, 0");
  await pressTab(8, 8, true);
  expect(source).toBe("mov rax, 1\n    mov rdi, 0");
});

test("Shift+Tab em linha sem recuo nao altera nada", async () => {
  await mount("mov rax, 1");
  await pressTab(0, 0, true);
  expect(source).toBe("mov rax, 1");
});
