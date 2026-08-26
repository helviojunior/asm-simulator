/**
 * A maquina simulada: CPU + memoria + programa carregado.
 *
 * NADA aqui executa codigo de verdade. Cada instrucao ja chega decodificada
 * do backend (Capstone) e este modulo apenas aplica o EFEITO descrito por ela
 * sobre um estado em memoria JavaScript. E um simulador, nao um emulador.
 *
 * O historico de diarios permite `stepBack()` — desfazer o ultimo passo,
 * recurso que um debugger real nao tem e que numa aula muda a dinamica.
 */

import { Cpu, toSigned, truncate } from "./cpu";
import { Memory } from "./memory";
import { ARCH, canonicalName } from "./registers";
import { execute } from "./instructions";
import { HALT, MachineHalt } from "./halt";
import { performSyscall } from "./syscalls";

export { HALT, MachineHalt };

// Teto de passos de um `run`. Um loop infinito no fonte do aluno e cenario
// esperado — sem o teto, a aba do navegador congela.
export const DEFAULT_RUN_LIMIT = 100000;

/**
 * Folga ACIMA do ponteiro de pilha inicial.
 *
 * Num processo de verdade existe o quadro de quem chamou logo acima do SP. Aqui
 * nao existe nada, e sem folga o painel abre com metade vazia e um
 * `mov rax, [rsp+0x30]` cairia "fora da pilha" — quando e exatamente onde o
 * shellcode espera encontrar o que o chamador deixou.
 */
export const STACK_MARGIN = 0x100;

/**
 * Ate onde a pilha pode crescer sozinha.
 *
 * Um `and rsp, 0xFFFFFFFFFFFFFFF0` ou um `sub rsp, 0x400` legitimos nao podem
 * esbarrar num limite arbitrario — mas recursao infinita tambem nao pode
 * consumir a aba do navegador. Dai o teto: cresce quando faz sentido, para
 * quando vira fuga.
 */
export const MAX_STACK_SIZE = 0x100000;

// Granularidade do crescimento. Em blocos, e nao byte a byte, para o painel
// nao mudar de tamanho a cada push.
const STACK_GROWTH = 0x1000;

export class Machine {
  constructor({ arch = "x86", os = "linux", codeBase, stackTop, stackSize = 0x4000 } = {}) {
    this.archId = arch;
    this.arch = ARCH[arch];
    // O alvo decide a tabela de syscalls: o mesmo numero em EAX resolve para
    // funcoes diferentes no Linux, no macOS e no Windows.
    this.osId = os;
    this.codeBase = BigInt(codeBase ?? 0);
    this.stackTop = BigInt(stackTop ?? 0);
    this.stackSize = BigInt(stackSize);

    this.memory = new Memory();
    this.cpu = new Cpu(arch);

    this.instructions = [];
    this.byAddress = new Map();
    // Rotulos do fonte por endereco (ver `lib/asm/labels`). Vazio num binario
    // importado, que nao tem fonte de onde tira-los.
    this.labels = new Map();
    this.codeEnd = this.codeBase;
    // Vazias ate a carga, mas SEMPRE presentes: quem lê `dataBase` antes de
    // montar recebe um endereco valido, nao `undefined`.
    this.sections = [
      { name: ".text", start: this.codeBase, end: this.codeBase },
      { name: ".data", start: this.codeBase, end: this.codeBase },
    ];

    this.history = [];
    this.halted = null;
    this.stepCount = 0;
    this.breakpoints = new Set();
    // Ligado quando uma escrita cai dentro da regiao de codigo: os bytes
    // desmontados deixaram de corresponder a memoria e precisam ser refeitos.
    this.codeDirty = false;
    // Saida produzida pelo programa via `write`. Cresce so no fim, o que
    // permite desfaze-la truncando — mesmo mecanismo do `stepBack`.
    this.output = [];
  }

  // ------------------------------------------------------------------
  // Carga do programa
  // ------------------------------------------------------------------

  load({ bytes, instructions, sections }) {
    this.codeEnd = this.codeBase + BigInt(bytes.length);
    this.setSections(sections, bytes.length);

    // Escrita secao a secao, e nao a imagem inteira de uma vez: o vao entre o
    // fim do `.text` e a `.data` — que existe para a `.data` cair numa
    // fronteira de pagina — nao e byte de programa nenhum. Deixando-o SEM
    // escrever, a memoria esparsa continua sem registro ali e o dump o mostra
    // esmaecido, que e a leitura correta: nao ha nada la.
    this.sections.forEach((item) => {
      const start = Number(item.start - this.codeBase);
      const end = Number(item.end - this.codeBase);
      if (end > start) this.memory.writeBytes(item.start, bytes.slice(start, end));
    });

    this.setInstructions(instructions);
    this.reset();
  }

  /**
   * Onde `.text` e `.data` cairam na imagem carregada.
   *
   * O montador so aceita essas duas secoes, e a `.data` EXISTE SEMPRE — vazia,
   * logo depois da imagem, quando o programa nao declara uma. Assim nenhum
   * painel precisa tratar "programa sem .data" como caso a parte, e o aluno ve
   * onde ela comecaria. Um binario importado, que nao tem secao nenhuma, cai
   * no mesmo formato: codigo do primeiro ao ultimo byte.
   *
   * As duas moram DENTRO da imagem: o `nasm -f bin` concatena as secoes, e e
   * dessa contiguidade que um `lea rcx, [rel msg]` depende para acertar o
   * alvo. Separa-las em enderecos distintos quebraria o RIP-relativo.
   */
  setSections(sections, size) {
    const list = (sections || []).map((item) => ({
      name: item.name,
      start: this.codeBase + BigInt(item.start),
      end: this.codeBase + BigInt(item.end),
    }));

    if (!list.some((item) => item.name === ".text")) {
      list.unshift({ name: ".text", start: this.codeBase, end: this.codeBase + BigInt(size) });
    }
    if (!list.some((item) => item.name === ".data")) {
      list.push({ name: ".data", start: this.codeEnd, end: this.codeEnd });
    }
    this.sections = list;
  }

  /**
   * Nomes que o fonte da a cada endereco.
   *
   * Vem de fora porque o montador nao devolve tabela de simbolos: quem cruza
   * os rotulos do fonte com o mapa de linhas e o `lib/asm/labels`.
   */
  setLabels(labels) {
    this.labels = labels instanceof Map ? labels : new Map(labels || []);
  }

  /** Rotulo declarado exatamente neste endereco, ou null. */
  labelAt(address) {
    if (address === null || address === undefined) return null;
    return this.labels.get(BigInt(address).toString()) || null;
  }

  section(name) {
    return (this.sections || []).find((item) => item.name === name) || null;
  }

  get textBase() {
    return this.section(".text")?.start ?? this.codeBase;
  }

  get textEnd() {
    return this.section(".text")?.end ?? this.codeEnd;
  }

  get dataBase() {
    return this.section(".data")?.start ?? this.codeEnd;
  }

  get dataEnd() {
    return this.section(".data")?.end ?? this.codeEnd;
  }

  /**
   * True se `address` cai na regiao de dados.
   *
   * Uma `.data` vazia nunca casa (`start === end`), que e o comportamento
   * correto: nao ha byte de dado nenhum para apontar.
   */
  isDataAddress(address) {
    const value = BigInt(address);
    return value >= this.dataBase && value < this.dataEnd;
  }

  /**
   * Substitui a lista de instrucoes SEM tocar no estado de execucao.
   *
   * E o que permite re-desmontar codigo automodificavel no meio da execucao:
   * os bytes mudaram, a leitura deles muda junto, mas registradores, pilha e
   * historico continuam de pe.
   */
  setInstructions(instructions) {
    this.instructions = instructions;
    this.byAddress = new Map();
    instructions.forEach((insn) => {
      this.byAddress.set(BigInt(insn.address).toString(), insn);
    });
    this.codeDirty = false;
  }

  /** Bytes atuais da regiao de codigo — a fonte para re-desmontar. */
  codeBytes() {
    return this.memory.readBytes(this.codeBase, Number(this.codeEnd - this.codeBase));
  }

  /** True se `address` cai dentro da IMAGEM carregada (codigo e dados). */
  isCodeAddress(address) {
    const value = BigInt(address);
    return value >= this.codeBase && value < this.codeEnd;
  }

  /**
   * True se `address` e codigo EXECUTAVEL — dentro da imagem e fora da
   * `.data`.
   *
   * A distincao importa em dois lugares: escrever num `db` da `.data` e uso
   * normal do programa e nao pode ser lido como codigo automodificavel, e um
   * ponteiro para a `.data` na pilha e um ponteiro para dado, nao um endereco
   * de retorno.
   */
  isExecutableAddress(address) {
    return this.isCodeAddress(address) && !this.isDataAddress(address);
  }

  reset() {
    this.cpu = new Cpu(this.archId);
    this.cpu.setCanonical("rip", this.codeBase);
    this.cpu.writeRegister(this.arch.stackPointer, this.stackTop);
    this.cpu.writeRegister(this.arch.basePointer, this.stackTop);
    this.history = [];
    this.halted = null;
    this.stepCount = 0;
    this.output = [];
  }

  /** Anexa texto a saida do programa (chamado pelo handler de `write`). */
  writeOutput(fd, text, bytes) {
    this.output.push({ fd, text, bytes: bytes ?? text.length });
  }

  // ------------------------------------------------------------------
  // Memoria com diario (para destacar e desfazer)
  // ------------------------------------------------------------------

  writeMemory(address, size, value) {
    const base = BigInt(address);
    const journal = this.cpu.journal;
    if (journal) {
      for (let i = 0; i < size; i += 1) {
        const addr = base + BigInt(i);
        if (!journal.memory.has(addr)) {
          journal.memory.set(addr, this.memory.readByte(addr));
        }
      }
    }
    this.memory.write(base, size, value);

    // Escrita dentro do proprio codigo: a desmontagem em tela ficou defasada.
    // Quem observa `codeDirty` decide quando refazer — aqui so sinalizamos.
    // A `.data` fica de fora: escrever numa variavel declarada com `db` e o
    // uso normal dela, e remontar a listagem a cada `mov [rel age], 1` seria
    // uma ida ao servidor por passo sem nada mudar na tela.
    if (this.isExecutableAddress(base) || this.isExecutableAddress(base + BigInt(size - 1))) {
      this.codeDirty = true;
    }
  }

  readMemory(address, size) {
    return this.memory.read(address, size);
  }

  // ------------------------------------------------------------------
  // Operandos
  // ------------------------------------------------------------------

  /**
   * Endereco efetivo de um operando de memoria:
   *   segmento:[base + indice*escala + deslocamento]
   *
   * Segmentos sao ignorados de proposito: em modo plano (o unico que este
   * simulador modela) FS/GS exigiriam uma tabela de descritores que nao
   * existe aqui.
   */
  effectiveAddress(operand) {
    let address = 0n;
    if (operand.base) {
      let base = this.cpu.readRegister(operand.base);
      // RIP-relative: o x86-64 mede o deslocamento a partir da PROXIMA
      // instrucao, nao da atual.
      if (canonicalName(operand.base) === "rip") {
        base = this.nextAddress;
      }
      address += base;
    }
    if (operand.index) {
      address += this.cpu.readRegister(operand.index) * BigInt(operand.scale || 1);
    }
    address += BigInt(operand.disp || 0);
    return truncate(address, this.arch.wordSize);
  }

  readOperand(operand) {
    switch (operand.type) {
      case "reg":
        return this.cpu.readRegister(operand.reg);
      case "imm":
        return truncate(BigInt(operand.value), operand.size || this.arch.wordSize);
      case "mem":
        return this.readMemory(this.effectiveAddress(operand), operand.size);
      default:
        throw new Error(`Unsupported operand type: ${operand.type}`);
    }
  }

  /** Le um operando ja com sinal — usado por imediatos e comparacoes. */
  readOperandSigned(operand, size) {
    return toSigned(this.readOperand(operand), size || operand.size);
  }

  writeOperand(operand, value) {
    switch (operand.type) {
      case "reg":
        this.cpu.writeRegister(operand.reg, value);
        return;
      case "mem":
        this.writeMemory(this.effectiveAddress(operand), operand.size, value);
        return;
      default:
        throw new Error(`Cannot write to operand of type: ${operand.type}`);
    }
  }

  // ------------------------------------------------------------------
  // Pilha
  // ------------------------------------------------------------------

  get stackLimit() {
    return this.stackTop - this.stackSize;
  }

  /** Endereco mais alto que ainda conta como pilha (topo + folga). */
  get stackCeiling() {
    return this.stackTop + BigInt(STACK_MARGIN);
  }

  /** Piso absoluto: abaixo daqui e estouro, nao crescimento. */
  get stackFloor() {
    return this.stackTop - BigInt(MAX_STACK_SIZE);
  }

  /**
   * Garante que `address` cabe na pilha, crescendo a regiao se preciso.
   *
   * Devolve false so quando o endereco passa do piso — ai e estouro de
   * verdade. Existe porque a pilha aqui e ficticia: seu tamanho e uma escolha
   * nossa, e recusar um `sub rsp` legitimo por causa dessa escolha seria o
   * simulador reclamar de si mesmo.
   */
  ensureStack(address) {
    const value = BigInt(address);
    if (value >= this.stackLimit) return true;
    if (value < this.stackFloor) return false;

    const needed = this.stackTop - value;
    const blocks = (needed + BigInt(STACK_GROWTH) - 1n) / BigInt(STACK_GROWTH);
    this.stackSize = blocks * BigInt(STACK_GROWTH);
    return true;
  }

  push(value, size = this.arch.wordSize) {
    const sp = this.cpu.sp - BigInt(size);
    if (!this.ensureStack(sp)) {
      throw new MachineHalt(HALT.STACK_OVERFLOW, "Stack overflow.");
    }
    this.cpu.sp = sp;
    this.writeMemory(sp, size, value);
    return sp;
  }

  pop(size = this.arch.wordSize) {
    const sp = this.cpu.sp;
    const value = this.readMemory(sp, size);
    this.cpu.sp = sp + BigInt(size);
    return value;
  }

  // ------------------------------------------------------------------
  // Execucao
  // ------------------------------------------------------------------

  get currentInstruction() {
    return this.byAddress.get(this.cpu.ip.toString()) || null;
  }

  /**
   * Ha instrucao decodificada neste endereco?
   *
   * E mais estreito que `isCodeAddress`: um endereco DENTRO da regiao mas no
   * meio de uma instrucao tambem nao tem o que executar.
   */
  hasCodeAt(address) {
    return this.byAddress.has(BigInt(address).toString());
  }

  get nextAddress() {
    const insn = this.currentInstruction;
    return insn ? this.cpu.ip + BigInt(insn.size) : this.cpu.ip;
  }

  /**
   * Executa UMA instrucao e devolve o registro do passo.
   *
   * O contrato: quem chama sempre recebe um objeto descrevendo o que
   * aconteceu; falhas viram `halted`, nunca excecao vazando para a UI.
   */
  step() {
    if (this.halted) return { halted: this.halted, changes: emptyChanges() };

    const insn = this.currentInstruction;
    if (!insn) {
      // Fim natural do codigo carregado x salto para o nada sao coisas
      // diferentes, e o aluno precisa distinguir uma da outra.
      const reason =
        this.cpu.ip >= this.codeEnd && this.cpu.ip <= this.codeEnd + 16n
          ? HALT.END_OF_PROGRAM
          : HALT.NO_INSTRUCTION;
      this.halted = { reason, address: this.cpu.ip };
      return { halted: this.halted, changes: emptyChanges() };
    }

    // Dados nao se executam. Parar aqui, com motivo proprio, e muito mais
    // util do que deixar o interpretador tropecar num mnemonico "db".
    if (insn.data) {
      this.halted = { reason: HALT.DATA, address: this.cpu.ip, message: insn.bytes };
      return { instruction: insn, halted: this.halted, changes: emptyChanges() };
    }

    this.cpu.beginStep();
    const addressBefore = this.cpu.ip;
    const outputBefore = this.output.length;
    let halt = null;
    let externalCall = null;
    let unsimulated = null;
    let simulated = null;

    try {
      const outcome = execute(this, insn);
      if (outcome && outcome.simulated) {
        // Chamada de sistema ATENDIDA. A execucao segue normalmente; o aviso
        // sobe junto para a interface dizer que o efeito veio do modelo, e
        // nao de um kernel.
        simulated = outcome.simulated;
        this.cpu.ip = addressBefore + BigInt(insn.size);
      } else if (outcome && outcome.unsimulated) {
        // Chamada de sistema sem simulacao: avisa e segue. Mesma decisao do
        // `call` para fora do programa — o que interessa na aula quase sempre
        // vem depois, e parar aqui a interromperia por algo que nem e o
        // assunto. `exit` e `execve` continuam parando: ali o PROGRAMA acabou.
        unsimulated = outcome.unsimulated;
        this.cpu.ip = addressBefore + BigInt(insn.size);
      } else if (outcome && outcome.externalCall) {
        // Nao e parada: a execucao segue na proxima instrucao. O aviso sobe
        // junto com o resultado do passo para a interface mostrar.
        externalCall = outcome.externalCall;
        this.cpu.ip = addressBefore + BigInt(insn.size);
      } else if (outcome && outcome.halt) {
        // Parou AQUI: o ponteiro fica na instrucao que parou, e nao na
        // seguinte. E o que um debugger faz, e o que faz a desmontagem
        // destacar a linha certa — e o que da sentido a "pular instrucao",
        // que precisa ter o que pular.
        halt = outcome.halt;
      } else if (!outcome || !outcome.jumped) {
        // Instrucao que nao mexeu no RIP avanca para a proxima; salto, chamada
        // e retorno ja escreveram o destino.
        this.cpu.ip = addressBefore + BigInt(insn.size);
      }
    } catch (error) {
      halt =
        error instanceof MachineHalt
          ? { reason: error.reason, message: error.message }
          : { reason: HALT.ERROR, message: error.message };
    }

    // O programa pode ter movido o SP DIRETO, sem push — e o que fazem o
    // `and rsp, 0xFFFFFFFFFFFFFFF0` de alinhamento e o `sub rsp, 0x20` do
    // shadow space. A regiao acompanha, senao o painel da pilha ficaria em
    // branco justamente depois do prologo.
    //
    // Aqui nao ha recusa: um `sub rsp` alem do teto nao falha num processador
    // real (a falha viria no primeiro acesso), e quem cobra o piso e o `push`.
    this.ensureStack(this.cpu.sp);

    const journal = this.cpu.endStep();
    this.history.push({
      journal,
      address: addressBefore,
      halted: this.halted,
      outputLength: outputBefore,
    });
    this.stepCount += 1;
    if (halt) this.halted = { ...halt, address: addressBefore };

    return {
      instruction: insn,
      address: addressBefore,
      halted: this.halted,
      externalCall,
      unsimulated,
      simulated,
      changes: describeChanges(journal),
    };
  }

  /**
   * Executa a instrucao atual "no vazio" e devolve o que ela MUDARIA.
   *
   * Em vez de reimplementar a semantica de cada instrucao so para prever o
   * resultado — o que duplicaria o interpretador e sairia do ar na primeira
   * divergencia — executamos de verdade, lemos o diario e desfazemos. O
   * `stepBack()` restaura registradores, flags, memoria, contador e estado de
   * parada, entao a maquina volta exatamente ao ponto anterior.
   *
   * Devolve null quando nao ha o que prever (parado, ou sobre dados).
   */
  preview() {
    const insn = this.currentInstruction;
    if (!insn || insn.data || this.halted) return null;

    const haltedBefore = this.halted;
    // O passo especulativo pode escrever em codigo e ligar `codeDirty`; como
    // ele sera desfeito, o sinal seria falso.
    const dirtyBefore = this.codeDirty;
    const outputBefore = this.output.length;
    this.step();
    const entry = this.history[this.history.length - 1];

    const writes = [];
    if (entry) {
      // Diario guarda o valor ANTIGO; o novo esta no estado atual.
      entry.journal.registers.forEach((previous, canonical) => {
        writes.push({
          kind: "register",
          name: canonical,
          previous,
          next: this.cpu.readCanonical(canonical),
        });
      });
      entry.journal.memory.forEach((previous, address) => {
        writes.push({
          kind: "memory",
          address,
          previous: BigInt(previous),
          next: BigInt(this.memory.readByte(address)),
        });
      });
      entry.journal.flags.forEach((previous, flag) => {
        writes.push({
          kind: "flag",
          name: flag,
          previous,
          next: this.cpu.getFlag(flag),
        });
      });
    }

    this.stepBack();
    this.halted = haltedBefore;
    this.codeDirty = dirtyBefore;
    this.output.length = outputBefore;

    return { instruction: insn, writes };
  }

  /** Desfaz o ultimo passo. Devolve false se nao havia o que desfazer. */
  stepBack() {
    const entry = this.history.pop();
    if (!entry) return false;

    entry.journal.registers.forEach((previous, canonical) => {
      this.cpu.registers.set(canonical, previous);
    });
    entry.journal.flags.forEach((previous, flag) => {
      this.cpu.flags[flag] = previous;
    });
    entry.journal.memory.forEach((previous, address) => {
      this.memory.writeByte(address, previous);
      if (this.isExecutableAddress(address)) this.codeDirty = true;
    });

    // A saida do programa tambem volta: um `write` desfeito nao pode deixar
    // texto no console.
    if (entry.outputLength !== undefined) this.output.length = entry.outputLength;

    this.halted = entry.halted;
    this.stepCount = Math.max(0, this.stepCount - 1);
    return true;
  }

  /**
   * Pula a instrucao atual SEM executa-la.
   *
   * Existe principalmente para destravar: o simulador parou numa instrucao que
   * nao cobre (uma extensao SSE, uma syscall sem equivalente) e o que interessa
   * na aula esta depois dela. Sem isto, a alternativa seria remontar o programa
   * sem aquela linha — e perder todo o estado ja construido.
   *
   * Por isso pular LIMPA a parada: destravar e o proposito. E entra no
   * historico como qualquer passo, entao `stepBack` desfaz o pulo e traz a
   * parada de volta.
   */
  skip() {
    const insn = this.currentInstruction;
    if (!insn) {
      // Nada sob o ponteiro: nao ha o que pular, e inventar um avanco levaria
      // o RIP para o meio do nada.
      return { halted: this.halted, changes: emptyChanges() };
    }

    const addressBefore = this.cpu.ip;
    const haltedBefore = this.halted;

    this.cpu.beginStep();
    this.cpu.ip = addressBefore + BigInt(insn.size);
    const journal = this.cpu.endStep();

    this.history.push({
      journal,
      address: addressBefore,
      halted: haltedBefore,
      outputLength: this.output.length,
    });
    this.stepCount += 1;
    this.halted = null;

    return {
      instruction: insn,
      address: addressBefore,
      halted: null,
      skipped: true,
      changes: describeChanges(journal),
    };
  }

  /**
   * Step over: em `call`, roda a sub-rotina inteira e para na instrucao
   * seguinte; em qualquer outra instrucao, e igual ao step normal.
   */
  stepOver(limit = DEFAULT_RUN_LIMIT) {
    const insn = this.currentInstruction;
    if (!insn || !insn.groups.includes("call")) return this.step();

    const returnAddress = this.cpu.ip + BigInt(insn.size);
    const depthBefore = this.history.length;
    let executed = 0;

    let result = this.step();
    executed += 1;
    while (!this.halted && executed < limit) {
      if (this.cpu.ip === returnAddress) break;
      if (this.breakpoints.has(this.cpu.ip.toString())) break;
      result = this.step();
      executed += 1;
    }
    if (executed >= limit && !this.halted) {
      this.halted = { reason: HALT.STEP_LIMIT, address: this.cpu.ip };
    }
    return { ...result, steps: this.history.length - depthBefore };
  }

  /** Roda ate um breakpoint, uma parada ou o teto de passos. */
  run(limit = DEFAULT_RUN_LIMIT) {
    let executed = 0;
    let result = null;
    while (!this.halted && executed < limit) {
      result = this.step();
      executed += 1;
      if (this.halted) break;
      if (this.breakpoints.has(this.cpu.ip.toString())) break;
    }
    if (executed >= limit && !this.halted) {
      this.halted = { reason: HALT.STEP_LIMIT, address: this.cpu.ip };
    }
    return { ...(result || {}), steps: executed };
  }

  /**
   * Atende uma chamada de sistema.
   *
   * `via` distingue a porta de entrada (`int 0x80` ou `syscall`), que muda a
   * tabela de numeros — `write` e 4 numa e 1 na outra.
   */
  syscall(via) {
    return performSyscall(this, { via });
  }

  toggleBreakpoint(address) {
    const key = BigInt(address).toString();
    if (this.breakpoints.has(key)) this.breakpoints.delete(key);
    else this.breakpoints.add(key);
    return this.breakpoints.has(key);
  }
}

function emptyChanges() {
  return { registers: [], flags: [], memory: [] };
}

/** Converte o diario na lista do que a UI precisa destacar. */
function describeChanges(journal) {
  if (!journal) return emptyChanges();
  return {
    registers: Array.from(journal.registers.keys()),
    flags: Array.from(journal.flags.keys()),
    memory: Array.from(journal.memory.keys()),
  };
}
