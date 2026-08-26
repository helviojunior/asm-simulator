/**
 * A regiao de dados dentro da imagem carregada.
 *
 * `.text` e `.data` moram na MESMA imagem contigua — e dessa contiguidade que
 * um `lea rcx, [rel msg]` depende. O que muda entre elas nao e o endereco, e o
 * significado: um byte da `.data` e dado, e escrever nele e uso normal do
 * programa, nao codigo automodificavel.
 */
import { Machine } from "./machine";
import { codeReference, describeRegion, describePointer, pointerString } from "./inspect";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

// Imagem de 12 bytes: 8 de codigo e 4 de "Oi\n\0" na `.data`.
const BYTES = [0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xc3, 0x4f, 0x69, 0x0a, 0x00];
const SECTIONS = [
  { name: ".text", start: 0, end: 8 },
  { name: ".data", start: 8, end: 12 },
];

function build({ sections = SECTIONS } = {}) {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({
    bytes: BYTES,
    sections,
    instructions: [
      { address: CODE_BASE.toString(), size: 8, text: "nop", mnemonic: "nop",
        groups: [], line: 1, operands: [] },
    ],
  });
  return machine;
}

describe("regiões da imagem", () => {
  test("a `.data` fica onde o montador disse", () => {
    const machine = build();
    expect(machine.dataBase).toBe(CODE_BASE + 8n);
    expect(machine.dataEnd).toBe(CODE_BASE + 12n);
    expect(machine.textEnd).toBe(CODE_BASE + 8n);
  });

  test("um endereço de dado é lido como dado, não como código", () => {
    const machine = build();
    expect(describeRegion(machine, CODE_BASE + 8n)).toEqual({
      region: "data", offset: 0n,
    });
    // O último byte de código continua sendo código.
    expect(describeRegion(machine, CODE_BASE + 7n).region).toBe("code");
  });

  test("`.data` existe mesmo sem o programa declarar uma", () => {
    // Vazia, logo depois da imagem: nenhum painel precisa tratar a ausência
    // como caso à parte.
    const machine = build({ sections: [{ name: ".text", start: 0, end: 12 }] });
    expect(machine.dataBase).toBe(machine.codeEnd);
    expect(machine.dataBase).toBe(machine.dataEnd);
    expect(machine.isDataAddress(machine.codeEnd)).toBe(false);
  });

  test("máquina sem programa montado já tem as duas seções", () => {
    const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
    expect(machine.section(".text")).toBeTruthy();
    expect(machine.dataBase).toBe(CODE_BASE);
  });

  test("binário importado, sem seção nenhuma, vira código do início ao fim", () => {
    // `null`, e nao `undefined`: e o que o backend manda para um binario
    // importado, que nao passou pelo montador.
    const machine = build({ sections: null });
    expect(machine.textEnd).toBe(machine.codeEnd);
    expect(machine.dataBase).toBe(machine.codeEnd);
  });
});

describe("escrita na `.data`", () => {
  test("não conta como código automodificável", () => {
    // Um `mov [rel age], 1` é o uso normal de uma variável declarada com `db`;
    // remontar a listagem a cada escrita seria uma ida ao servidor por passo.
    const machine = build();
    machine.writeMemory(CODE_BASE + 8n, 1, 0x41n);
    expect(machine.codeDirty).toBe(false);
  });

  test("escrita no código continua marcando a desmontagem como defasada", () => {
    const machine = build();
    machine.writeMemory(CODE_BASE + 2n, 1, 0x41n);
    expect(machine.codeDirty).toBe(true);
  });

  test("escrita que começa no código e invade a `.data` também marca", () => {
    const machine = build();
    machine.writeMemory(CODE_BASE + 6n, 4, 0n);
    expect(machine.codeDirty).toBe(true);
  });
});

describe("ponteiros para a `.data`", () => {
  test("são ponteiros, e a string do outro lado aparece", () => {
    const machine = build();
    const pointer = describePointer(machine, CODE_BASE + 8n);
    expect(pointer.isPointer).toBe(true);
    expect(pointer.region).toBe("data");
    expect(pointer.string).toBe("Oi\\n");
  });

  test("não são lidos como endereço de retorno", () => {
    // Um ponteiro para uma string está DENTRO da imagem, mas não é endereço de
    // código nenhum — chamá-lo de "return to" seria invenção.
    const machine = build();
    expect(codeReference(machine, CODE_BASE + 8n)).toBeNull();
    expect(codeReference(machine, CODE_BASE + 4n)).not.toBeNull();
  });
});

describe("acesso RIP-relativo à `.data`", () => {
  /**
   * `lea rcx, [rel msg]` — o acesso que todo programa com `.data` faz.
   *
   * Ele só acerta porque `.text` e `.data` estão na MESMA imagem contígua: o
   * deslocamento que o montador calculou é a distância entre a instrução
   * seguinte e a variável. Separar as seções em endereços distintos faria
   * RCX apontar para o vazio.
   */
  function withLea() {
    const machine = new Machine({ arch: "x86_64", codeBase: CODE_BASE, stackTop: STACK_TOP });
    machine.load({
      // 7 bytes de `lea` + 1 de `ret`, e a string logo depois.
      bytes: [0x48, 0x8d, 0x0d, 0x01, 0, 0, 0, 0xc3, 0x4f, 0x69, 0x0a, 0x00],
      sections: SECTIONS,
      instructions: [
        { address: CODE_BASE.toString(), size: 7, text: "lea rcx, [rip + 1]",
          mnemonic: "lea", groups: [], line: 1,
          operands: [
            { type: "reg", reg: "rcx", size: 8 },
            { type: "mem", base: "rip", disp: "1", size: 8 },
          ] },
      ],
    });
    return machine;
  }

  test("o registrador recebe o endereço da variável declarada", () => {
    const machine = withLea();
    machine.step();
    expect(machine.cpu.readRegister("rcx")).toBe(machine.dataBase);
  });

  test("e o painel mostra a string do outro lado", () => {
    const machine = withLea();
    machine.step();
    const value = machine.cpu.readRegister("rcx");
    expect(describeRegion(machine, value).region).toBe("data");
    expect(pointerString(machine, value)).toBe("Oi\\n");
  });
});
