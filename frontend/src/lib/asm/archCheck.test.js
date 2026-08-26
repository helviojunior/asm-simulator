/**
 * Deteccao de arquitetura pelo texto do fonte.
 *
 * Duas leituras, com consequencias diferentes: `findArchMismatch` AVISA na
 * montagem, com a evidencia na mao, e deixa a decisao com quem esta lendo;
 * `archForNewSource` TROCA sozinho, e por isso vale numa condicao so — o
 * editor vazio recebendo um bloco de texto colado.
 */
import { archForNewSource, detectArch, findArchMismatch } from "lib/asm/archCheck";

const CODE64 = "[BITS 64]\nsection .text\n_start:\n    mov rax, 60\n    syscall\n";
const CODE32 = "[BITS 32]\nsection .text\n_start:\n    mov eax, 1\n    int 0x80\n";

describe("o que o fonte aparenta ser", () => {
  test("a diretiva `bits` decide sozinha", async () => {
    expect(detectArch(CODE64).target).toBe("x86_64");
    expect(detectArch(CODE32).target).toBe("x86");
  });

  test("sem diretiva, as marcas de cada modo votam", async () => {
    expect(detectArch("mov rax, 1\nsyscall\n").target).toBe("x86_64");
    expect(detectArch("mov eax, 1\nint 0x80\n").target).toBe("x86");
  });

  test("texto sem marca nenhuma nao aparenta nada", async () => {
    expect(detectArch("nop\nnop\n").target).toBeNull();
  });
});

describe("troca automatica ao colar no editor vazio", () => {
  test("editor vazio recebendo codigo de outra arquitetura", async () => {
    expect(archForNewSource("", CODE64, "x86")).toBe("x86_64");
    expect(archForNewSource("", CODE32, "x86_64")).toBe("x86");
  });

  test("so espaco em branco no editor tambem conta como vazio", async () => {
    expect(archForNewSource("\n  \n", CODE64, "x86")).toBe("x86_64");
  });

  test("com codigo ja escrito, a escolha continua sendo do usuario", async () => {
    // Aqui quem fala e o aviso da montagem, que mostra a evidencia em vez de
    // mexer no combo pelas costas de quem escreveu o programa.
    expect(archForNewSource("nop\n", CODE64, "x86")).toBeNull();
    expect(findArchMismatch(CODE64, "x86").target).toBe("x86_64");
  });

  test("digitar nao troca nada: um caractere nao tem marca de arquitetura", async () => {
    expect(archForNewSource("", "m", "x86")).toBeNull();
    expect(archForNewSource("m", "mo", "x86")).toBeNull();
  });

  test("codigo colado da MESMA arquitetura nao mexe no combo", async () => {
    expect(archForNewSource("", CODE64, "x86_64")).toBeNull();
  });

  test("texto sem marca de arquitetura nao mexe no combo", async () => {
    expect(archForNewSource("", "nop\nnop\n", "x86")).toBeNull();
  });

  test("apagar tudo nao troca nada", async () => {
    expect(archForNewSource(CODE64, "", "x86_64")).toBeNull();
  });
});
