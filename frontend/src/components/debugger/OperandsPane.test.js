/**
 * O veredito do salto no painel de operandos.
 *
 * `cmp` seguido de `jne` e o ponto em que quem esta aprendendo perde o fio: o
 * salto nao escreve registrador nem memoria, entao o painel parecia dizer que
 * a instrucao nao faz nada. O que se verifica aqui e que ele responde "vai
 * saltar?" ANTES do passo, diz em cima de que flags decidiu, e muda de
 * resposta assim que a flag muda — inclusive quando a troca e a mao.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "i18n";
import { ToastProvider } from "contexts/ToastContext";
import { Machine } from "lib/cpu/machine";
import { CONDITIONS, CONDITION_FLAGS, describeJump } from "lib/cpu/instructions";
import { FLAGS } from "lib/cpu/cpu";
import OperandsPane from "components/debugger/OperandsPane";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;
const TARGET = CODE_BASE + 0x10n;

let container;
let root;

/** Maquina parada sobre um salto de 2 bytes para CODE_BASE+0x10. */
function build(mnemonic) {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: new Array(0x20).fill(0x90),
    instructions: [
      { address: CODE_BASE.toString(), size: 2, text: `${mnemonic} 0x${TARGET.toString(16)}`,
        mnemonic, groups: ["jump"], line: 1,
        operands: [{ type: "imm", value: TARGET.toString(), size: 4 }] },
      { address: (CODE_BASE + 2n).toString(), size: 1, text: "nop", mnemonic: "nop",
        groups: [], line: 2, operands: [] },
    ],
  });
  return machine;
}

async function mount(machine) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <ToastProvider>
          <OperandsPane machine={machine} tick={0} />
        </ToastProvider>
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

test("salto incondicional e sempre dado, e diz que e incondicional", async () => {
  await mount(build("jmp"));
  expect(container.textContent).toContain("JMP is taken (unconditional)");
});

test("salto que nao sera dado mostra o valor que a flag PRECISARIA ter", async () => {
  // ZF=0: `je` nao salta, e o que falta e ZF=1 — entao a linha diz "ZF!=1", e
  // nao "ZF=0". Mostrar o valor atual responderia "como esta"; a pergunta de
  // quem olha um salto que nao acontece e "o que precisaria mudar?".
  await mount(build("je"));
  expect(container.textContent).toContain("JMP is not taken");
  expect(container.textContent).toContain("ZF\u22601");
  expect(container.textContent).not.toContain("ZF=0");
});

test("a mesma instrucao com a flag ligada passa a saltar", async () => {
  const machine = build("je");
  machine.setFlag("ZF", true);
  await mount(machine);

  expect(container.textContent).toContain("JMP is taken");
  expect(container.textContent).not.toContain("not taken");
  // Dado o salto, nada impede: a flag aparece como esta.
  expect(container.textContent).toContain("ZF=1");
});

test("so a flag que atrapalha e marcada; a que ja esta certa fica como esta", async () => {
  // `ja` quer CF=0 e ZF=0. Com ZF=1, CF ja esta no ponto e so ZF atrapalha.
  const machine = build("ja");
  machine.setFlag("ZF", true);
  await mount(machine);

  expect(container.textContent).toContain("CF=0");
  expect(container.textContent).toContain("ZF\u22600");
});

test("com duas marcadas, o operador diz se e preciso mexer nas duas", async () => {
  // `ja` quer CF=0 E ZF=0: com as duas erradas, arrumar uma so nao resolve.
  const machine = build("ja");
  machine.setFlag("CF", true);
  machine.setFlag("ZF", true);
  await mount(machine);
  expect(container.textContent).toContain("CF\u22600&&ZF\u22600");
});

test("...ou em qualquer uma delas", async () => {
  // `jge` quer SF=OF: com SF=1 e OF=0, virar qualquer uma das duas resolve.
  const machine = build("jge");
  machine.setFlag("SF", true);
  await mount(machine);
  expect(container.textContent).toContain("SF\u22600||OF\u22601");
});

test("com uma marcada so nao ha o que ligar", async () => {
  const machine = build("ja");
  machine.setFlag("ZF", true);
  await mount(machine);
  expect(container.textContent).not.toContain("&&");
  expect(container.textContent).not.toContain("||");
});

test("as duas erradas sao marcadas, mesmo que virar uma so nao resolva", async () => {
  // `ja` com CF=1 e ZF=1: virar so uma continua sem saltar. Sem esta regra o
  // painel diria "nao sera dado" sem apontar nada.
  const machine = build("ja");
  machine.setFlag("CF", true);
  machine.setFlag("ZF", true);
  await mount(machine);

  expect(container.textContent).toContain("CF\u22600");
  expect(container.textContent).toContain("ZF\u22600");
});

test("numa condicao com OU, qualquer uma das flags destrava — e as duas sao marcadas", async () => {
  // `jbe` salta com CF=1 OU ZF=1; com as duas em 0, mexer em qualquer uma
  // resolve, e dizer so uma esconderia o outro caminho.
  await mount(build("jbe"));
  expect(container.textContent).toContain("JMP is not taken");
  expect(container.textContent).toContain("CF\u22601");
  expect(container.textContent).toContain("ZF\u22601");
});

test("mostra TODAS as flags da condicao, mesmo as que nao decidiram", async () => {
  // `ja` olha CF e ZF; dizer so uma delas esconderia metade da regra.
  await mount(build("ja"));
  expect(container.textContent).toContain("CF=0");
  expect(container.textContent).toContain("ZF=0");
});

test("salto que SERA dado diz o que o esta segurando de pe", async () => {
  // A pergunta simetrica de "o que falta?" e "por que ele vai acontecer?".
  // `ja` com CF=0 e ZF=0 salta porque as DUAS estao assim: virar qualquer uma
  // o desfaz, entao as duas sao necessarias.
  await mount(build("ja"));
  expect(container.textContent).toContain("JMP is taken");
  expect(container.textContent).toContain("CF=0&&ZF=0");
});

test("num salto dado por OU, qualquer uma das flags bastaria", async () => {
  // `jbe` salta com CF=1 OU ZF=1; com as duas ligadas, virar uma so nao o
  // desfaz — e por isso elas aparecem como alternativas.
  const machine = build("jbe");
  machine.setFlag("CF", true);
  machine.setFlag("ZF", true);
  await mount(machine);
  expect(container.textContent).toContain("CF=1||ZF=1");
});

test("flag que nao segura nada num salto dado fica sem marca", async () => {
  // `jbe` com CF=1 e ZF=0: quem segura o salto e CF sozinha.
  const machine = build("jbe");
  machine.setFlag("CF", true);
  await mount(machine);
  expect(container.textContent).toContain("CF=1");
  expect(container.textContent).toContain("ZF=0");
  expect(container.textContent).not.toContain("||");
  expect(container.textContent).not.toContain("&&");
});

test("as tres flags de uma condicao entram na conta", async () => {
  // `jle` salta com ZF=1 OU SF!=OF. Com as tres zeradas nao salta, e mexer em
  // qualquer uma das tres resolve.
  await mount(build("jle"));
  expect(container.textContent).toContain("ZF\u22601||SF\u22601||OF\u22601");
});

test("...e tambem quando e ele que segura o salto", async () => {
  // `jg` quer ZF=0 E SF=OF: com as tres zeradas ele salta, e virar qualquer
  // uma das tres o desfaz.
  await mount(build("jg"));
  expect(container.textContent).toContain("JMP is taken");
  expect(container.textContent).toContain("ZF=0&&SF=0&&OF=0");
});

test("instrucao que nao e salto nao ganha veredito", async () => {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: [0x90],
    instructions: [
      { address: CODE_BASE.toString(), size: 1, text: "nop", mnemonic: "nop",
        groups: [], line: 1, operands: [] },
    ],
  });
  await mount(machine);
  expect(container.textContent).not.toContain("JMP is");
});

test("a flag trocada a mao decide tambem o que o passo faz", async () => {
  // O veredito e o F7 leem a MESMA funcao de condicao: se o painel disser
  // "sera dado", o passo tem de saltar.
  const machine = build("je");
  machine.setFlag("ZF", true);
  machine.step();
  expect(machine.cpu.ip).toBe(TARGET);

  const other = build("je");
  other.step();
  expect(other.cpu.ip).toBe(CODE_BASE + 2n);
});

test("`jecxz` e companhia nao viram veredito", async () => {
  // Nao decidem por flag, e o interpretador ainda nao os executa: prever um
  // salto que o passo nao sabe dar seria mentir.
  expect(describeJump("jecxz")).toBeNull();
  expect(describeJump("loop")).toBeNull();
  expect(describeJump("mov")).toBeNull();
});

test("cada condicao declara exatamente as flags que le", async () => {
  // A tabela de flags e escrita a mao ao lado da tabela de condicoes; este
  // teste e o que impede as duas de divergirem. Para cada condicao, varre as
  // 128 combinacoes de flags e vira uma de cada vez: se a resposta muda, a
  // flag e lida — e tem de estar declarada.
  const combos = [];
  for (let mask = 0; mask < 1 << FLAGS.length; mask += 1) {
    const flags = {};
    FLAGS.forEach((flag, index) => { flags[flag] = Boolean(mask & (1 << index)); });
    combos.push(flags);
  }

  Object.entries(CONDITIONS).forEach(([suffix, check]) => {
    const used = new Set();
    combos.forEach((flags) => {
      FLAGS.forEach((flag) => {
        const flipped = { ...flags, [flag]: !flags[flag] };
        if (Boolean(check(flags)) !== Boolean(check(flipped))) used.add(flag);
      });
    });
    expect([...used].sort()).toEqual([...(CONDITION_FLAGS[suffix] || [])].sort());
  });
});
