/**
 * Rótulos do fonte, e o endereço de cada um.
 *
 * O `nasm -f bin` não devolve tabela de símbolos: o desmontador vê
 * `call 0x7FF70000101E` sem saber que aquilo se chama `Function1`. O nome está
 * no fonte, e o mapa de linhas diz que byte veio de que linha — cruzando os
 * dois, o rótulo volta a ter endereço.
 */
import { labelMap, parseLabels } from "./labels";
import { Machine } from "lib/cpu/machine";
import { callInvocation, codeReference } from "lib/cpu/inspect";

const BASE = 0x7f200100n;

describe("parseLabels", () => {
  test("reconhece rótulo com dois-pontos, com ou sem instrução na linha", () => {
    const labels = parseLabels("_start:\n    nop\nloop: nop\n");
    expect(labels.map((item) => item.name)).toEqual(["_start", "loop"]);
    expect(labels.map((item) => item.line)).toEqual([1, 3]);
  });

  test("reconhece a forma sem dois-pontos, recuada ou não", () => {
    // É como quase todo `.data` se escreve.
    const labels = parseLabels('msg db "oi", 0\n    buf resb 64\n');
    expect(labels.map((item) => item.name)).toEqual(["msg", "buf"]);
  });

  test("diretiva de dados sem nome não vira rótulo", () => {
    expect(parseLabels("    db 0x90\n    times 16 db 0\n")).toEqual([]);
  });

  test("instrução comum não vira rótulo", () => {
    // O que separa `msg db 1` de `mov rax, 1` é o que vem DEPOIS do nome.
    expect(parseLabels("    mov rax, 1\n    add dl, 2\n    dec dword [x]\n")).toEqual([]);
  });

  test("rótulo dentro de comentário não é rótulo", () => {
    expect(parseLabels("; fim:\n    nop\n")).toEqual([]);
  });

  test("rótulo local (`.loop`) conta como rótulo", () => {
    expect(parseLabels(".loop:\n nop\n")[0].name).toBe(".loop");
  });

  test("diretiva não vira rótulo", () => {
    expect(parseLabels("global _start\nsection .text\nbits 64\n")).toEqual([]);
  });

  test("cada troca de seção separa os rótulos", () => {
    const labels = parseLabels("section .data\nmsg db 1\nsection .text\nfn:\n nop\n");
    expect(labels[0].section).not.toBe(labels[1].section);
  });
});

describe("labelMap", () => {
  // O exemplo real: `.data` declarada antes de `.text`, e cada seção com o
  // offset que o montador devolveu.
  const SOURCE = [
    "[BITS 64]",              // 1
    "",                       // 2
    "section .data",          // 3
    '    msg db "oi", 0',     // 4  -> offset 0x1000
    "",                       // 5
    "section .text",          // 6
    "_start:",                // 7
    "    call Function1",     // 8  -> offset 0
    "    ret",                // 9  -> offset 5
    "",                       // 10
    "Function1:",             // 11
    "    nop",                // 12 -> offset 6
    "    ret",                // 13 -> offset 7
  ].join("\n");

  const LINE_MAP = { 0: 8, 5: 9, 6: 12, 7: 13, 4096: 4 };

  const map = () => labelMap(SOURCE, LINE_MAP, BASE);

  test("o rótulo aponta para o primeiro byte emitido dele em diante", () => {
    // `Function1:` está na linha 11 e não emite byte nenhum; o endereço é o do
    // `nop` da linha 12.
    expect(map().get((BASE + 6n).toString())).toBe("Function1");
  });

  test("rótulo no começo do programa também resolve", () => {
    expect(map().get(BASE.toString())).toBe("_start");
  });

  test("rótulo de dado resolve no endereço da `.data`", () => {
    expect(map().get((BASE + 4096n).toString())).toBe("msg");
  });

  test("rótulo não atravessa troca de seção", () => {
    // `fim:` fecha o `.text` e nada mais é emitido nele: o endereço do
    // primeiro byte da `.data`, que vem depois no fonte, não é dele.
    const source = "section .text\n nop\nfim:\nsection .data\n k db 1\n";
    const result = labelMap(source, { 0: 2, 4096: 5 }, BASE);
    expect(result.get((BASE + 4096n).toString())).toBe("k");
    expect([...result.values()]).not.toContain("fim");
  });

  test("dois rótulos no mesmo endereço: vale o de cima", () => {
    const source = "inicio:\nentry:\n nop\n";
    const result = labelMap(source, { 0: 3 }, BASE);
    expect(result.get(BASE.toString())).toBe("inicio");
  });

  test("fonte sem rótulo nenhum devolve mapa vazio", () => {
    expect(labelMap(" nop\n nop\n", { 0: 1, 1: 2 }, BASE).size).toBe(0);
  });

  test("sem mapa de linhas não há endereço a atribuir", () => {
    expect(labelMap(SOURCE, {}, BASE).size).toBe(0);
  });
});

describe("o rótulo como nome da função", () => {
  const BASE = 0x7f200100n;

  // `call Function1` seguido de `ret`, e a função logo depois.
  const SOURCE = [
    "section .text",   // 1
    "_start:",         // 2
    "    call Function1", // 3 -> offset 0, 5 bytes
    "    ret",         // 4 -> offset 5
    "Function1:",      // 5
    "    ret",         // 6 -> offset 6
  ].join("\n");

  const LINE_MAP = { 0: 3, 5: 4, 6: 6 };

  function build() {
    const machine = new Machine({ arch: "x86_64", codeBase: BASE, stackTop: 0x804000n });
    machine.load({
      bytes: [0xe8, 0x01, 0x00, 0x00, 0x00, 0xc3, 0xc3],
      instructions: [
        { address: BASE.toString(), size: 5, text: "call 0x7f200106", mnemonic: "call",
          groups: ["call"], line: 3,
          operands: [{ type: "imm", value: (BASE + 6n).toString(), size: 4 }] },
        { address: (BASE + 5n).toString(), size: 1, text: "ret", mnemonic: "ret",
          groups: ["ret"], line: 4, operands: [] },
        { address: (BASE + 6n).toString(), size: 1, text: "ret", mnemonic: "ret",
          groups: ["ret"], line: 6, operands: [] },
      ],
    });
    machine.setLabels(labelMap(SOURCE, LINE_MAP, BASE));
    return machine;
  }

  test("a chamada mostra o nome do rótulo em vez de `sem nome`", () => {
    const call = callInvocation(build(), { count: 4 });
    expect(call.name).toBe("Function1");
    expect(call.origin).toBe("label");
  });

  test("um `call` para endereço sem rótulo continua sem nome", () => {
    const machine = build();
    machine.setLabels(new Map());
    expect(callInvocation(machine, { count: 4 }).name).toBeNull();
  });

  test("o endereço de retorno na pilha também vem nomeado", () => {
    // É o "from ???" do x64dbg respondido sem ninguém digitar nada.
    const reference = codeReference(build(), BASE + 5n);
    expect(reference.isReturn).toBe(true);
    expect(reference.name).toBe("Function1");
  });
});
