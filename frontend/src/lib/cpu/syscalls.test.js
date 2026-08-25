import { argumentSlot, syscallAbi, syscallNumber } from "lib/cpu/syscalls";
import { defaultConvention } from "lib/cpu/inspect";
import {
  clearSyscallNames, setSyscallName, syscallNameOverride,
} from "lib/cpu/syscallNames";
import { detectOs } from "lib/cpu/os";

describe("ABI de syscall por sistema", () => {
  // O mesmo `mov eax, 4` significa coisas diferentes em cada alvo — e o erro
  // mais comum de quem escreve shellcode.
  test("o mesmo numero resolve para funcoes diferentes conforme o alvo", () => {
    const resolve = (os, arch, raw) => {
      const abi = syscallAbi(os, arch);
      return abi.names[syscallNumber(abi, raw)] ?? null;
    };

    expect(resolve("linux", "x86", 4)).toBe("write");
    expect(resolve("linux", "x86_64", 4)).toBe(null); // 4 nao e write em x86-64
    expect(resolve("linux", "x86_64", 1)).toBe("write");
    expect(resolve("linux", "x86", 1)).toBe("exit");
  });

  test("macOS de 64 bits tira a classe UNIX do numero", () => {
    const abi = syscallAbi("macos", "x86_64");
    expect(syscallNumber(abi, 0x2000004)).toBe(4);
    expect(abi.names[syscallNumber(abi, 0x2000004)]).toBe("write");
    expect(abi.names[syscallNumber(abi, 0x200003b)]).toBe("execve");
    expect(abi.names[syscallNumber(abi, 0x2000001)]).toBe("exit");
  });

  test("macOS de 32 bits usa numeros BSD crus e argumentos na pilha", () => {
    const abi = syscallAbi("macos", "x86");
    expect(syscallNumber(abi, 4)).toBe(4);
    expect(abi.names[4]).toBe("write");
    expect(abi.argumentsOn).toBe("stack");
  });

  test("Windows nao resolve numero para nome", () => {
    for (const arch of ["x86", "x86_64"]) {
      expect(syscallAbi("windows", arch).resolvable).toBe(false);
    }
  });

  test("alvo desconhecido cai no Linux, sem quebrar", () => {
    expect(syscallAbi("plan9", "x86").table).toBe(syscallAbi("linux", "x86").table);
  });
});

describe("deteccao do alvo", () => {
  const cases = [
    ["linux", "mov eax, 4\nint 0x80\n"],
    ["linux", "global _start\nsection .text\n_start:\n nop\n"],
    ["linux", 'jmp s\nc: pop ebx\nmov eax, 11\nint 0x80\ns: call c\ndb "/bin/sh", 0\n'],
    ["macos", "mov rax, 0x2000004\nsyscall\n"],
    ["windows", "mov eax, [fs:0x30]\n"],
    ["windows", "mov rax, [gs:0x60]\n"],
    ["windows", ".model flat, stdcall\n.code\n"],
    ["windows", 'db "kernel32.dll", 0\ncall ebp\n'],
  ];

  test.each(cases)("reconhece %s", (expected, source) => {
    expect(detectOs(source).os).toBe(expected);
  });

  test("sem marca alguma, nao chuta", () => {
    // Chutar aqui resolveria os numeros para as funcoes erradas, e o painel
    // mentiria com toda a confianca. Melhor perguntar.
    expect(detectOs("push eax\npop ebx\n").os).toBeNull();
    expect(detectOs("; int 0x80 num comentario\nnop\n").os).toBeNull();
  });
});

describe("argumentos alem dos registradores", () => {
  // Um esboco de maquina: so o que `argumentSlot` consulta.
  const fake = (arch = "x86_64", sp = 0x800000n) => ({
    arch: { wordSize: arch === "x86_64" ? 8 : 4, stackPointer: arch === "x86_64" ? "rsp" : "esp" },
    cpu: { sp, readRegister: (r) => BigInt(`0x${r.length}0`) },
    readMemory: (address) => address,
  });

  test("Windows: do quinto em diante vem da pilha, apos o shadow space", () => {
    const abi = syscallAbi("windows", "x86_64");
    const m = fake();

    // Os quatro primeiros sao registradores...
    expect(argumentSlot(m, abi, 0).source).toBe("R10");
    expect(argumentSlot(m, abi, 3).source).toBe("R9");

    // ...e o quinto NAO para de existir: vem de [RSP+0x20], depois dos 32
    // bytes de shadow space. Antes disto o painel travava em quatro.
    expect(argumentSlot(m, abi, 4).source).toBe("[RSP+0x20]");
    expect(argumentSlot(m, abi, 5).source).toBe("[RSP+0x28]");
    expect(argumentSlot(m, abi, 4).address).toBe(0x800020n);
  });

  test("Linux x86-64: seis registradores, depois a pilha", () => {
    const abi = syscallAbi("linux", "x86_64");
    const m = fake();

    expect(argumentSlot(m, abi, 0).source).toBe("RDI");
    expect(argumentSlot(m, abi, 5).source).toBe("R9");
    expect(argumentSlot(m, abi, 6).source).toBe("[RSP]");
    expect(argumentSlot(m, abi, 7).source).toBe("[RSP+0x8]");
  });

  test("macOS de 32 bits le tudo da pilha", () => {
    const abi = syscallAbi("macos", "x86");
    const m = fake("x86");

    expect(argumentSlot(m, abi, 0).source).toBe("[ESP+0x4]");
    expect(argumentSlot(m, abi, 1).source).toBe("[ESP+0x8]");
  });
});

describe("convencao de chamada segue o alvo", () => {
  test("64 bits: Windows usa fastcall, Linux e macOS usam System V", () => {
    // Sao registradores DIFERENTES para os mesmos argumentos: ler um binario
    // do Windows pela tabela do Linux mostra RDI onde o programa pos RCX.
    expect(defaultConvention("x86_64", "windows")).toBe("fastcall");
    expect(defaultConvention("x86_64", "linux")).toBe("sysv");
    expect(defaultConvention("x86_64", "macos")).toBe("sysv");
    expect(defaultConvention("x86_64", null)).toBe("sysv");
  });

  test("32 bits e sempre pela pilha, independente do alvo", () => {
    for (const os of ["windows", "linux", "macos", null]) {
      expect(defaultConvention("x86", os)).toBe("cdecl");
    }
  });
});

describe("nome escolhido a mao", () => {
  // A resolucao automatica cobre o que da: a tabela fixa no Linux, a ntdll no
  // Windows. Fora disso quem sabe do que se trata e quem le o codigo.
  beforeEach(() => clearSyscallNames());
  afterEach(() => clearSyscallNames());

  test("vale por (alvo, arquitetura, numero)", () => {
    setSyscallName("windows", "x86_64", 0x3b, "NtCreateFile");

    expect(syscallNameOverride("windows", "x86_64", 0x3b)).toBe("NtCreateFile");
    // O mesmo numero em outro alvo e outra chamada.
    expect(syscallNameOverride("linux", "x86_64", 0x3b)).toBeNull();
    expect(syscallNameOverride("windows", "x86", 0x3b)).toBeNull();
  });

  test("esvaziar desfaz e devolve o nome a resolucao automatica", () => {
    setSyscallName("windows", "x86_64", 5, "NtOpenFile");
    setSyscallName("windows", "x86_64", 5, null);

    expect(syscallNameOverride("windows", "x86_64", 5)).toBeNull();
  });

  test("trocar o programa carregado descarta as escolhas", () => {
    setSyscallName("windows", "x86_64", 5, "NtOpenFile");
    clearSyscallNames();

    expect(syscallNameOverride("windows", "x86_64", 5)).toBeNull();
  });
});
