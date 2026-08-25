/**
 * Testes do interpretador.
 *
 * O primeiro bloco reproduz, passo a passo, a sequencia usada nos slides do
 * treinamento — enderecos, ESP e conteudo da pilha precisam bater exatamente
 * com o que e projetado em aula.
 */

import { Machine } from "./machine";
import { HALT } from "./halt";

const CODE_BASE = 0x7f200100n;
const STACK_TOP = 0x00804000n;

// Saida real de `nasm -f bin` + Capstone para o programa dos slides.
const SLIDE_BYTES = [
  0x68, 0x00, 0x22, 0x00, 0x22,
  0x68, 0x11, 0x00, 0x11, 0x00,
  0x58,
  0x5a,
];

// Enderecos derivados do codeBase, na ordem — e o mesmo calculo que o
// disassembler faz. Escrever os decimais a mao aqui so cria oportunidade de
// erro de digitacao.
const SLIDE_INSTRUCTIONS = withAddresses(CODE_BASE, [
  { size: 5, bytes: "68 00 22 00 22", mnemonic: "push", op_str: "0x22002200", text: "push 0x22002200", operands: [{ type: "imm", value: "570434048", size: 4 }] },
  { size: 5, bytes: "68 11 00 11 00", mnemonic: "push", op_str: "0x110011", text: "push 0x110011", operands: [{ type: "imm", value: "1114129", size: 4 }] },
  { size: 1, bytes: "58", mnemonic: "pop", op_str: "eax", text: "pop eax", operands: [{ type: "reg", reg: "eax", size: 4 }] },
  { size: 1, bytes: "5A", mnemonic: "pop", op_str: "edx", text: "pop edx", operands: [{ type: "reg", reg: "edx", size: 4 }] },
]);

/** Atribui enderecos sequenciais a partir de `base`, como faz o Capstone. */
function withAddresses(base, instructions) {
  let address = BigInt(base);
  return instructions.map((insn, index) => {
    const item = { index, groups: [], operands: [], ...insn, address: address.toString() };
    address += BigInt(item.size);
    return item;
  });
}

function slideMachine() {
  const machine = new Machine({ arch: "x86", codeBase: CODE_BASE, stackTop: STACK_TOP });
  machine.load({ bytes: SLIDE_BYTES, instructions: SLIDE_INSTRUCTIONS });
  // O slide comeca com 0x00C0FFEE ja no topo da pilha.
  machine.memory.write(STACK_TOP, 4, 0x00c0ffeen);
  return machine;
}

/** Monta uma maquina a partir de instrucoes escritas a mao, para os testes. */
function build(instructions, { arch = "x86", codeBase = CODE_BASE } = {}) {
  const decoded = withAddresses(
    codeBase,
    instructions.map((insn) => ({ size: 1, ...insn }))
  );
  const length = decoded.reduce((total, insn) => total + insn.size, 0);
  const machine = new Machine({ arch, codeBase, stackTop: STACK_TOP });
  machine.load({ bytes: new Array(length).fill(0x90), instructions: decoded });
  return machine;
}

const reg = (m, name) => m.cpu.readRegister(name);

describe("sequencia dos slides (push/push/pop/pop)", () => {
  it("empilha o primeiro valor e desce ESP em 4", () => {
    const m = slideMachine();
    expect(m.cpu.ip).toBe(0x7f200100n);
    expect(m.cpu.sp).toBe(0x00804000n);

    const step = m.step();

    expect(m.cpu.ip).toBe(0x7f200105n);
    expect(m.cpu.sp).toBe(0x00803ffcn);
    expect(m.memory.read(0x00803ffcn, 4)).toBe(0x22002200n);
    // A celula que o slide destaca em branco.
    expect(step.changes.memory).toContain(0x00803ffcn);
  });

  it("chega ao fim com EAX e EDX na ordem inversa do push", () => {
    const m = slideMachine();
    m.step();
    m.step();
    expect(m.cpu.sp).toBe(0x00803ff8n);
    expect(m.memory.read(0x00803ff8n, 4)).toBe(0x00110011n);

    m.step();
    m.step();

    // LIFO: o ultimo empilhado e o primeiro a sair.
    expect(reg(m, "eax")).toBe(0x00110011n);
    expect(reg(m, "edx")).toBe(0x22002200n);
    expect(m.cpu.sp).toBe(0x00804000n);
    // 0x00C0FFEE nunca foi desempilhado: continua no topo.
    expect(m.memory.read(0x00804000n, 4)).toBe(0x00c0ffeen);
  });

  it("desfaz os passos e volta ao estado inicial", () => {
    const m = slideMachine();
    for (let i = 0; i < 4; i += 1) m.step();
    for (let i = 0; i < 4; i += 1) m.stepBack();

    expect(m.cpu.ip).toBe(0x7f200100n);
    expect(m.cpu.sp).toBe(0x00804000n);
    expect(reg(m, "eax")).toBe(0n);
    expect(reg(m, "edx")).toBe(0n);
    // A memoria escrita pelos pushes voltou ao valor anterior.
    expect(m.memory.read(0x00803ffcn, 4)).toBe(0n);
  });

  it("reporta fim de programa apos a ultima instrucao", () => {
    const m = slideMachine();
    for (let i = 0; i < 5; i += 1) m.step();
    expect(m.halted.reason).toBe(HALT.END_OF_PROGRAM);
  });
});

describe("larguras de registrador", () => {
  it("escrita de 32 bits zera a metade alta em x86-64", () => {
    const m = build(
      [{ mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "1", size: 4 }] }],
      { arch: "x86_64" }
    );
    m.cpu.setCanonical("rax", 0xffffffffffffffffn);
    m.step();
    expect(reg(m, "rax")).toBe(0x0000000000000001n);
  });

  it("escrita de 8 bits preserva o resto do registrador", () => {
    const m = build([
      { mnemonic: "mov", size: 2, operands: [{ type: "reg", reg: "al", size: 1 }, { type: "imm", value: "65", size: 1 }] },
    ]);
    m.cpu.setCanonical("rax", 0xdeadbeefn);
    m.step();
    expect(reg(m, "eax")).toBe(0xdeadbe41n);
  });

  it("ah escreve os bits 8..15", () => {
    const m = build([
      { mnemonic: "mov", size: 2, operands: [{ type: "reg", reg: "ah", size: 1 }, { type: "imm", value: "255", size: 1 }] },
    ]);
    m.cpu.setCanonical("rax", 0x00000000n);
    m.step();
    expect(reg(m, "eax")).toBe(0x0000ff00n);
  });
});

describe("flags", () => {
  const cmp = (a, b) => {
    const m = build([
      { mnemonic: "cmp", size: 3, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: String(b), size: 4 }] },
    ]);
    m.cpu.writeRegister("eax", BigInt(a));
    m.step();
    return m.cpu.flags;
  };

  it("valores iguais ligam ZF", () => {
    expect(cmp(5, 5).ZF).toBe(true);
  });

  it("menor sem sinal liga CF", () => {
    const flags = cmp(1, 2);
    expect(flags.CF).toBe(true);
    expect(flags.ZF).toBe(false);
  });

  it("maior sem sinal deixa CF e ZF desligados", () => {
    const flags = cmp(9, 2);
    expect(flags.CF).toBe(false);
    expect(flags.ZF).toBe(false);
  });

  it("overflow com sinal liga OF sem ligar CF", () => {
    // 0x7FFFFFFF + 1 estoura o maior positivo de 32 bits.
    const m = build([
      { mnemonic: "add", size: 6, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "1", size: 4 }] },
    ]);
    m.cpu.writeRegister("eax", 0x7fffffffn);
    m.step();
    expect(m.cpu.flags.OF).toBe(true);
    expect(m.cpu.flags.CF).toBe(false);
    expect(m.cpu.flags.SF).toBe(true);
  });

  it("PF olha apenas o byte baixo do resultado", () => {
    const m = build([
      { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "0", size: 4 }] },
      { mnemonic: "add", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "771", size: 4 }] },
    ]);
    m.step();
    m.step();
    // 771 = 0x0303; byte baixo 0x03 tem dois bits ligados -> paridade par.
    expect(m.cpu.flags.PF).toBe(true);
  });

  it("inc preserva CF", () => {
    const m = build([
      { mnemonic: "inc", size: 1, operands: [{ type: "reg", reg: "eax", size: 4 }] },
    ]);
    m.cpu.setFlag("CF", true);
    m.step();
    expect(m.cpu.flags.CF).toBe(true);
  });
});

describe("fluxo de controle", () => {
  it("call empilha o endereco de retorno e ret volta para ele", () => {
    const target = CODE_BASE + 10n;
    const m = build([
      { mnemonic: "call", size: 5, groups: ["call"], operands: [{ type: "imm", value: String(target), size: 4 }] },
      { mnemonic: "nop", size: 1 },
    ]);
    // Coloca um `ret` no destino do call.
    m.byAddress.set(target.toString(), {
      index: 9, address: target.toString(), size: 1, bytes: "C3",
      mnemonic: "ret", op_str: "", text: "ret", operands: [], groups: ["ret"],
    });

    m.step();
    const returnAddress = CODE_BASE + 5n;
    expect(m.cpu.ip).toBe(target);
    expect(m.memory.read(m.cpu.sp, 4)).toBe(returnAddress);

    m.step();
    expect(m.cpu.ip).toBe(returnAddress);
  });

  it("jcc so desvia quando a condicao e verdadeira", () => {
    const target = CODE_BASE + 100n;
    const make = (zf) => {
      const m = build([
        { mnemonic: "je", size: 2, groups: ["jump"], operands: [{ type: "imm", value: String(target), size: 4 }] },
      ]);
      m.cpu.setFlag("ZF", zf);
      m.step();
      return m.cpu.ip;
    };
    expect(make(true)).toBe(target);
    expect(make(false)).toBe(CODE_BASE + 2n);
  });
});

describe("paradas", () => {
  it("instrucao nao suportada para com o motivo correto", () => {
    const m = build([{ mnemonic: "vpxor", size: 4, text: "vpxor xmm0, xmm0, xmm0" }]);
    m.step();
    expect(m.halted.reason).toBe(HALT.UNSUPPORTED);
  });

  it("syscall sem simulacao avisa mas NAO para", () => {
    // EAX=0 nao corresponde a nenhuma syscall de 32 bits. Parar aqui
    // interromperia a aula por algo que quase nunca e o assunto — o que
    // interessa costuma vir depois.
    const m = build([{ mnemonic: "syscall", size: 2 }, { mnemonic: "nop", size: 1 }]);
    const result = m.step();

    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 2n);
    expect(result.unsimulated.reason).toBe("unknown");
  });

  it("run respeita o teto de passos em loop infinito", () => {
    const m = build([
      { mnemonic: "jmp", size: 2, groups: ["jump"], operands: [{ type: "imm", value: String(CODE_BASE), size: 4 }] },
    ]);
    m.run(500);
    expect(m.halted.reason).toBe(HALT.STEP_LIMIT);
  });

  it("estouro da pilha e detectado no piso, nao no tamanho inicial", () => {
    const push = { mnemonic: "push", size: 1,
                   operands: [{ type: "reg", reg: "eax", size: 4 }] };
    const m = build([push, push]);

    // No limite ATUAL a pilha apenas cresce: o tamanho inicial e escolha nossa,
    // e recusar um push por causa dela seria o simulador reclamar de si mesmo.
    m.cpu.sp = m.stackLimit;
    m.step();
    expect(m.halted).toBeNull();

    // No piso, sim: dali para baixo e fuga, nao uso legitimo.
    m.cpu.sp = m.stackFloor;
    m.step();
    expect(m.halted.reason).toBe(HALT.STACK_OVERFLOW);
  });
});

describe("x86-64", () => {
  it("movabs carrega um imediato de 64 bits inteiro", () => {
    const m = build(
      [
        {
          mnemonic: "movabs",
          size: 10,
          operands: [
            { type: "reg", reg: "rax", size: 8 },
            { type: "imm", value: "1234605616436508552", size: 8 },
          ],
        },
      ],
      { arch: "x86_64" }
    );
    m.step();
    expect(reg(m, "rax")).toBe(0x1122334455667788n);
  });

  it("push/pop movem RSP em 8 bytes", () => {
    const m = build(
      [
        { mnemonic: "push", size: 1, operands: [{ type: "reg", reg: "rax", size: 8 }] },
        { mnemonic: "pop", size: 1, operands: [{ type: "reg", reg: "rbx", size: 8 }] },
      ],
      { arch: "x86_64" }
    );
    m.cpu.writeRegister("rax", 0xdeadbeefcafebaben);
    const top = m.cpu.sp;
    m.step();
    expect(m.cpu.sp).toBe(top - 8n);
    m.step();
    expect(reg(m, "rbx")).toBe(0xdeadbeefcafebaben);
    expect(m.cpu.sp).toBe(top);
  });
});

describe("chamadas de sistema", () => {
  /** Programa 32 bits que escreve uma string e sai — o exercicio classico. */
  function writeAndExit(text) {
    const bytes = Array.from(text).map((c) => c.charCodeAt(0));
    const dataAddress = CODE_BASE + 0x100n;

    const m = build(
      [
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "4", size: 4 }] },
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "ebx", size: 4 }, { type: "imm", value: "1", size: 4 }] },
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "ecx", size: 4 }, { type: "imm", value: String(dataAddress), size: 4 }] },
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "edx", size: 4 }, { type: "imm", value: String(bytes.length), size: 4 }] },
        { mnemonic: "int", size: 2, operands: [{ type: "imm", value: "128", size: 1 }] },
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "1", size: 4 }] },
        { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "ebx", size: 4 }, { type: "imm", value: "7", size: 4 }] },
        { mnemonic: "int", size: 2, operands: [{ type: "imm", value: "128", size: 1 }] },
      ]
    );
    m.memory.writeBytes(dataAddress, bytes);
    return m;
  }

  it("write escreve no console e a execucao continua", () => {
    const m = writeAndExit("Treinamento\n");
    for (let i = 0; i < 5; i += 1) m.step();

    expect(m.halted).toBeNull();
    expect(m.output.map((o) => o.text).join("")).toBe("Treinamento\n");
    // write devolve a quantidade de bytes escritos.
    expect(reg(m, "eax")).toBe(12n);
  });

  it("exit encerra com o codigo de saida", () => {
    const m = writeAndExit("ok\n");
    m.run();
    expect(m.halted.reason).toBe(HALT.EXITED);
    expect(m.halted.exitCode).toBe(7);
  });

  it("desfazer o passo remove o que foi escrito", () => {
    const m = writeAndExit("abc");
    for (let i = 0; i < 5; i += 1) m.step();
    expect(m.output).toHaveLength(1);

    m.stepBack();
    expect(m.output).toHaveLength(0);
  });

  it("write respeita o tamanho pedido, mesmo passando do texto", () => {
    // Pede 5 bytes de um texto de 3: os dois seguintes vem da memoria zerada,
    // e o aluno precisa VER esse lixo em vez de uma saida limpa enganosa.
    const m = writeAndExit("abc");
    m.instructions[3].operands[1].value = "5";
    for (let i = 0; i < 5; i += 1) m.step();
    expect(m.output[0].text).toBe("abc\\x00\\x00");
  });

  it("syscall nao simulada para com o nome resolvido", () => {
    const m = build([
      { mnemonic: "mov", size: 5, operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "imm", value: "5", size: 4 }] },
      { mnemonic: "int", size: 2, operands: [{ type: "imm", value: "128", size: 1 }] },
    ]);
    m.step();
    const result = m.step();
    // Nao para: avisa com o nome resolvido e segue.
    expect(m.halted).toBeNull();
    expect(result.unsimulated.name).toBe("open");
  });

  it("numeros de syscall diferem entre 32 e 64 bits", () => {
    // Em x86-64, 1 e `write` (em 32 bits, 1 e `exit`).
    const m = build(
      [
        { mnemonic: "mov", size: 7, operands: [{ type: "reg", reg: "rax", size: 8 }, { type: "imm", value: "1", size: 4 }] },
        { mnemonic: "mov", size: 7, operands: [{ type: "reg", reg: "rdi", size: 8 }, { type: "imm", value: "1", size: 4 }] },
        { mnemonic: "mov", size: 7, operands: [{ type: "reg", reg: "rsi", size: 8 }, { type: "imm", value: String(CODE_BASE + 0x100n), size: 4 }] },
        { mnemonic: "mov", size: 7, operands: [{ type: "reg", reg: "rdx", size: 8 }, { type: "imm", value: "2", size: 4 }] },
        { mnemonic: "syscall", size: 2 },
      ],
      { arch: "x86_64" }
    );
    m.memory.writeBytes(CODE_BASE + 0x100n, [0x4f, 0x4b]);
    for (let i = 0; i < 5; i += 1) m.step();
    expect(m.halted).toBeNull();
    expect(m.output[0].text).toBe("OK");
  });
});

describe("instrucoes sem efeito", () => {
  // Aparecem o tempo todo em codigo real — `endbr64` em toda funcao que o
  // compilador emite, `cld` antes de uma instrucao de string, barreiras de
  // memoria. Parar em cada uma interromperia a aula por algo que, na maquina
  // real, nao teria acontecido.
  const BENIGN = [
    "pause", "lfence", "sfence", "mfence", "endbr64", "endbr32",
    "fnop", "fwait", "cli", "sti", "prefetcht0", "int3", "cld", "std",
  ];

  it.each(BENIGN)("%s avanca sem parar a execucao", (mnemonic) => {
    const m = build([{ mnemonic, size: 4 }, { mnemonic: "nop", size: 1 }]);
    m.step();

    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 4n);
  });

  it("nao mexe em registrador, memoria nem flag", () => {
    const m = build([{ mnemonic: "endbr64", size: 4 }]);
    m.cpu.writeRegister("eax", 0x1234n);
    m.cpu.setFlag("ZF", true);

    const changes = m.step().changes;

    expect(m.cpu.readRegister("eax")).toBe(0x1234n);
    expect(m.cpu.getFlag("ZF")).toBe(true);
    // O RIP muda em toda instrucao; o resto tem de ficar intacto.
    expect(changes.memory).toEqual([]);
    expect(changes.flags).toEqual([]);
  });

  it("uma instrucao realmente desconhecida continua parando", () => {
    // A lista de benignas e estreita de proposito: aceitar qualquer coisa
    // esconderia do aluno que o simulador nao cobre aquela instrucao.
    const m = build([{ mnemonic: "vpxor", size: 4 }]);
    m.step();
    expect(m.halted.reason).toBe(HALT.UNSUPPORTED);
  });
});

describe("flags de controle", () => {
  // Ao contrario do DF, o CF E lido aqui — por `adc`, `sbb`, `jc`. Trata-las
  // como nop nao seria "sem efeito", seria dar resultado errado.
  it("clc, stc e cmc mexem no carry", () => {
    const m = build([
      { mnemonic: "stc", size: 1 },
      { mnemonic: "cmc", size: 1 },
      { mnemonic: "clc", size: 1 },
    ]);

    m.step();
    expect(m.cpu.getFlag("CF")).toBe(true);
    m.step();
    expect(m.cpu.getFlag("CF")).toBe(false);
    m.cpu.setFlag("CF", true);
    m.step();
    expect(m.cpu.getFlag("CF")).toBe(false);
  });

  it("voltar o passo desfaz a flag", () => {
    const m = build([{ mnemonic: "stc", size: 1 }]);
    m.step();
    expect(m.cpu.getFlag("CF")).toBe(true);

    m.stepBack();
    expect(m.cpu.getFlag("CF")).toBe(false);
  });

  it("int 3 na forma de dois bytes tambem nao para", () => {
    const m = build([{
      mnemonic: "int", size: 2,
      operands: [{ type: "imm", value: "3", size: 1 }],
    }]);
    m.step();
    expect(m.halted).toBeNull();
  });

  it("int 0x80 continua sendo porta de chamada de sistema", () => {
    // O `int` generico nao virou nop: so o vetor 3 e inofensivo. Com EAX=0 nao
    // ha syscall correspondente, entao o resultado e um aviso — mas um aviso
    // de SYSCALL, e nao o silencio de um nop.
    const m = build([{
      mnemonic: "int", size: 2,
      operands: [{ type: "imm", value: "128", size: 1 }],
    }]);
    const result = m.step();
    expect(result.unsimulated).toBeTruthy();
    expect(result.unsimulated.via).toBe("int 0x80");
  });
});


describe("pilha ficticia: folga e crescimento", () => {
  const AND_RSP = (value) => ({
    mnemonic: "and", size: 4,
    operands: [{ type: "reg", reg: "rsp", size: 8 },
               { type: "imm", value: String(value), size: 8 }],
  });
  const SUB_RSP = (value) => ({
    mnemonic: "sub", size: 4,
    operands: [{ type: "reg", reg: "rsp", size: 8 },
               { type: "imm", value: String(value), size: 8 }],
  });

  const x64 = (list) => build(list, { arch: "x86_64", codeBase: 0x7ff700001000n });

  it("ha pilha ACIMA do ponteiro inicial", () => {
    const m = x64([{ mnemonic: "nop" }]);
    // Num processo real o quadro de quem chamou esta ai. Sem a folga, um
    // `[rsp+0x30]` logo depois do prologo cairia "fora da pilha".
    expect(m.stackCeiling).toBeGreaterThan(m.stackTop);
    expect(m.stackCeiling - m.stackTop).toBe(0x100n);
  });

  it("alinhar o RSP nao deixa o ponteiro fora da regiao", () => {
    const m = x64([AND_RSP(-16)]);
    // Topo desalinhado de proposito: o `and` desce o RSP.
    m.cpu.sp = m.stackLimit + 8n;
    m.step();

    expect(m.halted).toBeNull();
    expect(m.cpu.sp % 16n).toBe(0n);
    // A regiao acompanhou o ponteiro, em vez de o painel ficar em branco.
    expect(m.cpu.sp).toBeGreaterThanOrEqual(m.stackLimit);
  });

  it("um sub rsp grande estica a regiao em vez de parar", () => {
    const m = x64([SUB_RSP(0x8000)]);
    const before = m.stackLimit;
    m.step();

    expect(m.halted).toBeNull();
    expect(m.stackLimit).toBeLessThan(before);
    expect(m.cpu.sp).toBeGreaterThanOrEqual(m.stackLimit);
  });

  it("o crescimento tem teto", () => {
    const m = x64([SUB_RSP(0x8000)]);
    m.ensureStack(m.stackFloor);
    expect(m.stackLimit).toBeGreaterThanOrEqual(m.stackFloor);
    // Abaixo do piso nao cresce: dai em diante e recursao fugindo.
    expect(m.ensureStack(m.stackFloor - 1n)).toBe(false);
  });
});

describe("pular instrucao", () => {
  const XOR_EAX = {
    mnemonic: "xor", size: 2,
    operands: [{ type: "reg", reg: "eax", size: 4 }, { type: "reg", reg: "eax", size: 4 }],
  };

  it("avanca sem executar", () => {
    const m = build([
      { mnemonic: "mov", size: 5,
        operands: [{ type: "reg", reg: "eax", size: 4 },
                   { type: "imm", value: "7", size: 4 }] },
      { mnemonic: "nop", size: 1 },
    ]);

    m.skip();

    // O efeito da instrucao NAO aconteceu; so o ponteiro andou.
    expect(m.cpu.readRegister("eax")).toBe(0n);
    expect(m.cpu.ip).toBe(CODE_BASE + 5n);
    expect(m.halted).toBeNull();
  });

  it("destrava uma parada por instrucao nao suportada", () => {
    // E o caso de uso principal: o simulador nao cobre aquela instrucao e o
    // que interessa na aula esta depois dela.
    const m = build([{ mnemonic: "vpxor", size: 4 }, XOR_EAX]);
    m.step();
    expect(m.halted.reason).toBe(HALT.UNSUPPORTED);

    m.skip();

    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 4n);
    // E a execucao continua normalmente dali.
    m.step();
    expect(m.halted).toBeNull();
  });

  it("voltar o passo desfaz o pulo E traz a parada de volta", () => {
    const m = build([{ mnemonic: "vpxor", size: 4 }, XOR_EAX]);
    m.step();
    m.skip();
    expect(m.halted).toBeNull();

    m.stepBack();

    expect(m.cpu.ip).toBe(CODE_BASE);
    expect(m.halted.reason).toBe(HALT.UNSUPPORTED);
  });

  it("sem instrucao sob o ponteiro nao ha o que pular", () => {
    const m = build([{ mnemonic: "nop", size: 1 }]);
    m.cpu.ip = CODE_BASE + 0x100n;

    const before = m.cpu.ip;
    m.skip();

    // Inventar um avanco aqui levaria o ponteiro para o meio do nada.
    expect(m.cpu.ip).toBe(before);
    expect(m.history).toHaveLength(0);
  });

  it("pula dados sem tentar executa-los", () => {
    const m = build([
      { mnemonic: "db", size: 8, data: true, bytes: "2F 62 69 6E 2F 73 68 01" },
      { mnemonic: "nop", size: 1 },
    ]);
    m.step();
    expect(m.halted.reason).toBe(HALT.DATA);

    m.skip();
    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 8n);
  });
});

describe("call para fora do programa", () => {
  const CALL = (target) => ({
    mnemonic: "call", size: 5, groups: ["call"],
    operands: [{ type: "imm", value: String(target), size: 4 }],
  });

  it("nao para: passa direto e segue na instrucao seguinte", () => {
    const m = build([CALL(0x7ffe1234), { mnemonic: "nop", size: 1 }]);
    const spBefore = m.cpu.sp;

    const result = m.step();

    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 5n);
    // Nada foi empilhado: nao ha retorno a guardar quando nao ha para onde ir.
    expect(m.cpu.sp).toBe(spBefore);
    expect(result.externalCall.address).toBe(0x7ffe1234n);
  });

  it("um call de verdade continua empilhando e desviando", () => {
    // A mudanca nao pode ter afrouxado o caso normal.
    const m = build([CALL(CODE_BASE + 5n), { mnemonic: "nop", size: 1 }]);
    const spBefore = m.cpu.sp;

    const result = m.step();

    expect(result.externalCall).toBeFalsy();
    expect(m.cpu.ip).toBe(CODE_BASE + 5n);
    expect(m.cpu.sp).toBe(spBefore - 4n);
    // O endereco de retorno na pilha e o que um overflow sobrescreve.
    expect(m.readMemory(m.cpu.sp, 4)).toBe(CODE_BASE + 5n);
  });

  it("destino no MEIO de uma instrucao tambem conta como desconhecido", () => {
    // Esta dentro da regiao de codigo, mas nao ha instrucao decodificada ali.
    const m = build([CALL(CODE_BASE + 2n), { mnemonic: "nop", size: 1 }]);
    const result = m.step();

    expect(m.halted).toBeNull();
    expect(result.externalCall.address).toBe(CODE_BASE + 2n);
  });

  it("voltar o passo desfaz a chamada ignorada", () => {
    const m = build([CALL(0x7ffe1234), { mnemonic: "nop", size: 1 }]);
    m.step();
    m.stepBack();

    expect(m.cpu.ip).toBe(CODE_BASE);
    expect(m.halted).toBeNull();
  });

  it("passar por cima de uma chamada ignorada nao trava", () => {
    const m = build([CALL(0x7ffe1234), { mnemonic: "nop", size: 1 }]);
    m.stepOver();

    expect(m.halted).toBeNull();
    expect(m.cpu.ip).toBe(CODE_BASE + 5n);
  });
});

describe("chamada de sistema sem simulacao", () => {
  const SYSCALL = { mnemonic: "syscall", size: 2 };
  const x64 = (list) => build(list, { arch: "x86_64", codeBase: 0x400000n });

  it("uma syscall conhecida mas nao simulada segue em frente", () => {
    // `open` (2 em x86-64) tem nome na tabela, mas abrir arquivo de verdade
    // nao tem equivalente aqui.
    const m = x64([SYSCALL, { mnemonic: "nop", size: 1 }]);
    m.cpu.writeRegister("rax", 2n);

    const result = m.step();

    expect(m.halted).toBeNull();
    expect(result.unsimulated.name).toBe("open");
    expect(result.unsimulated.reason).toBe("notSimulated");
    // Nenhum registrador mudou: o retorno nao existe, e inventar um ensinaria
    // algo falso.
    expect(m.cpu.readRegister("rax")).toBe(2n);
  });

  it("no Windows o aviso diz que o numero nao e estavel", () => {
    const m = build([SYSCALL, { mnemonic: "nop", size: 1 }],
                    { arch: "x86_64", codeBase: 0x400000n });
    m.osId = "windows";
    m.cpu.writeRegister("rax", 0x3bn);

    const result = m.step();

    expect(m.halted).toBeNull();
    expect(result.unsimulated.reason).toBe("windows");
  });

  it("exit e execve continuam PARANDO — ali o programa acabou", () => {
    const exit = x64([SYSCALL]);
    exit.cpu.writeRegister("rax", 60n);
    exit.step();
    expect(exit.halted.reason).toBe(HALT.EXITED);

    const execve = x64([SYSCALL]);
    execve.cpu.writeRegister("rax", 59n);
    execve.step();
    expect(execve.halted.reason).toBe(HALT.EXECVE);
  });

  it("write continua sendo simulada de verdade", () => {
    // A mudanca nao pode ter afrouxado o que JA funcionava.
    const m = x64([SYSCALL]);
    m.memory.writeBytes(0x500000n, [0x4f, 0x69]);
    m.cpu.writeRegister("rax", 1n);
    m.cpu.writeRegister("rdi", 1n);
    m.cpu.writeRegister("rsi", 0x500000n);
    m.cpu.writeRegister("rdx", 2n);

    const result = m.step();

    expect(result.unsimulated).toBeFalsy();
    expect(m.output[0].text).toBe("Oi");
    expect(m.cpu.readRegister("rax")).toBe(2n);
  });

  it("voltar o passo desfaz a chamada ignorada", () => {
    const m = x64([SYSCALL, { mnemonic: "nop", size: 1 }]);
    m.cpu.writeRegister("rax", 2n);
    m.step();
    m.stepBack();

    expect(m.cpu.ip).toBe(0x400000n);
    expect(m.halted).toBeNull();
  });
});
