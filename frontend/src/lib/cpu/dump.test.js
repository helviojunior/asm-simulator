/**
 * A faixa navegavel do dump e os formatos de copia.
 *
 * A faixa e o que impede a barra de rolagem de tentar cobrir 64 bits de
 * enderecos; os formatos sao o caminho de volta dos bytes para dentro de um
 * programa.
 */
import { Machine } from "./machine";
import { COPY_FORMATS, dumpWindow, formatBytes, inWindow, selectionValue } from "./dump";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

function machine() {
  const item = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  item.load({
    bytes: [0x90, 0x90, 0x90, 0x90],
    instructions: [
      { address: CODE_BASE.toString(), size: 4, text: "nop", mnemonic: "nop",
        bytes: "90 90 90 90", groups: [], operands: [] },
    ],
  });
  return item;
}

describe("dumpWindow", () => {
  test("endereco no codigo navega a regiao de codigo, com folga dos dois lados", () => {
    const window = dumpWindow(machine(), CODE_BASE);
    expect(window.region).toBe("code");
    // A folga e o que deixa ver o que ha ANTES do programa — onde um estouro
    // de buffer chega.
    expect(window.start).toBeLessThan(CODE_BASE);
    expect(window.end).toBeGreaterThan(CODE_BASE + 4n);
  });

  test("endereco na pilha navega a pilha inteira", () => {
    const item = machine();
    const window = dumpWindow(item, STACK_TOP);
    expect(window.region).toBe("stack");
    expect(window.start).toBeLessThanOrEqual(item.stackLimit);
    expect(window.end).toBeGreaterThan(item.stackCeiling);
  });

  test("fora de qualquer regiao, a faixa e a vizinhanca do endereco pedido", () => {
    const at = 0x4141414100n;
    const window = dumpWindow(machine(), at);
    expect(window.region).toBeNull();
    expect(inWindow(window, at)).toBe(true);
    // Limitada: uma barra de rolagem para 64 bits nao existe.
    expect(window.end - window.start).toBeLessThanOrEqual(0x1000n);
  });

  test("a faixa comeca alinhada, para a coluna de endereco sair redonda", () => {
    const window = dumpWindow(machine(), 0x4141414107n);
    expect(window.start % 32n).toBe(0n);
    expect((window.end - window.start) % 32n).toBe(0n);
  });

  test("endereco baixo nao produz faixa negativa", () => {
    const window = dumpWindow(null, 0x10n);
    expect(window.start).toBe(0n);
    expect(window.end).toBeGreaterThan(0n);
  });
});

describe("formatBytes", () => {
  const bytes = new Uint8Array([0x48, 0x31, 0xc0, 0x41]);

  test("hex e o formato do proprio dump", () => {
    expect(formatBytes(bytes, "hex")).toBe("48 31 C0 41");
  });

  test("hexRaw serve para colar onde espacos atrapalham", () => {
    expect(formatBytes(bytes, "hexRaw")).toBe("4831C041");
  });

  test("escaped e a forma de shellcode", () => {
    expect(formatBytes(bytes, "escaped")).toBe("\\x48\\x31\\xc0\\x41");
  });

  test("db volta direto para dentro do fonte", () => {
    expect(formatBytes(bytes, "db")).toBe("    db 0x48, 0x31, 0xC0, 0x41");
  });

  test("db quebra em linhas de 8 bytes", () => {
    const long = new Uint8Array(Array.from({ length: 9 }, (_, i) => i));
    expect(formatBytes(long, "db").split("\n")).toHaveLength(2);
  });

  test("ascii mostra ponto no que nao e imprimivel", () => {
    expect(formatBytes(bytes, "ascii")).toBe("H1.A");
  });

  test("selecao vazia nao produz texto", () => {
    COPY_FORMATS.forEach((format) => {
      expect(formatBytes(new Uint8Array(0), format)).toBe("");
    });
  });
});

describe("selectionValue", () => {
  test("le a selecao em little-endian", () => {
    const read = selectionValue(new Uint8Array([0xdd, 0x92, 0xd2, 0x61]));
    expect(read.value).toBe(0x61d292ddn);
    expect(read.digits).toBe(8);
  });

  test("tamanho que nao e de um inteiro nao vira numero", () => {
    expect(selectionValue(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(selectionValue(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
