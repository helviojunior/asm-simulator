/**
 * Inspecao dos operandos da instrucao atual.
 *
 * E o que alimenta o painel de informacao (equivalente a barra abaixo da
 * desmontagem no x64dbg): antes de executar, mostrar QUAIS enderecos e
 * registradores a instrucao toca, que valor esta la agora, e — via
 * `Machine.preview()` — que valor vai ficar.
 */

import { hex } from "./format";
import {
  SIMULATED_SYSCALLS, SYSCALL_SIGNATURES, argumentSlot, syscallAbi, syscallNumber,
} from "./syscalls";
import { ntdllSummary, resolveSyscall } from "lib/ntdll";
import { syscallNameOverride } from "./syscallNames";
import { callKey, callNameOverride } from "./callNames";
import { prototypeByName, syscallNameByNumber } from "lib/prototypes";

// Quantos bytes olhar a frente ao tentar reconhecer uma string.
const STRING_SCAN = 24;
const MIN_STRING_LENGTH = 3;

/** Descreve a regiao de memoria de um endereco: codigo, dados, pilha ou nada. */
export function describeRegion(machine, address) {
  const value = BigInt(address);
  // `.data` ANTES de `code`: a regiao de dados mora dentro da imagem
  // carregada, e a ordem inversa chamaria de codigo o que e uma string.
  if (machine.isDataAddress(value)) {
    return { region: "data", offset: value - machine.dataBase };
  }
  if (value >= machine.codeBase && value < machine.codeEnd) {
    return { region: "code", offset: value - machine.codeBase };
  }
  // O teto leva a folga: um `[rsp+0x30]` logo depois do prologo cai acima do
  // ponteiro inicial, e e exatamente onde o shellcode espera o que o chamador
  // deixou — chamar aquilo de "fora da pilha" seria enganoso.
  if (value <= machine.stackCeiling && value >= machine.stackLimit) {
    return { region: "stack", offset: machine.stackTop - value };
  }
  return { region: null };
}

/**
 * Tenta ler uma string ASCII a partir de `address`.
 *
 * Serve para reconhecer o texto embutido no codigo — o `db "..."` da tecnica
 * JMP-CALL-POP. Devolve null quando os bytes nao formam algo legivel.
 */
export function readStringAt(machine, address, limit = STRING_SCAN) {
  let out = "";
  for (let i = 0; i < limit; i += 1) {
    const byte = machine.memory.readByte(BigInt(address) + BigInt(i));
    if (byte === 0x00) break;
    if (byte === 0x0a) { out += "\\n"; continue; }
    if (byte === 0x0d) { out += "\\r"; continue; }
    if (byte === 0x09) { out += "\\t"; continue; }
    if (byte < 0x20 || byte > 0x7e) break;
    out += String.fromCharCode(byte);
  }
  return out.length >= MIN_STRING_LENGTH ? out : null;
}

/**
 * Anota o que um VALOR aparenta ser: ponteiro para uma regiao conhecida,
 * inicio de string, ou apenas um numero.
 */
export function annotateValue(machine, value, { asPointer = true } = {}) {
  const notes = [];
  const numeric = BigInt(value);

  if (asPointer) {
    const { region, offset } = describeRegion(machine, numeric);
    if (region === "code") notes.push(`code+0x${offset.toString(16).toUpperCase()}`);
    if (region === "data") notes.push(`data+0x${offset.toString(16).toUpperCase()}`);
    // Offset negativo existe: e um endereco ACIMA do ponteiro inicial, dentro
    // da folga. O sinal precisa aparecer, senao "stack-0xFFFF..." confundiria.
    if (region === "stack") {
      notes.push(offset < 0n
        ? `stack+0x${(-offset).toString(16).toUpperCase()}`
        : `stack-0x${offset.toString(16).toUpperCase()}`);
    }
    if (region) {
      const text = readStringAt(machine, numeric);
      if (text) notes.push(`"${text}"`);
    }
  }

  // Bytes imprimiveis dentro do proprio valor (ex.: 0x41 -> 'A').
  const printable = asciiOfValue(numeric);
  if (printable) notes.push(printable);

  return notes;
}

/** Representacao ASCII dos bytes de um valor pequeno, se imprimiveis. */
function asciiOfValue(value) {
  const numeric = BigInt(value);
  if (numeric === 0n) return null;
  const chars = [];
  let remaining = numeric;
  while (remaining > 0n && chars.length < 8) {
    const byte = Number(remaining & 0xffn);
    if (byte < 0x20 || byte > 0x7e) return null;
    chars.push(String.fromCharCode(byte));
    remaining >>= 8n;
  }
  return chars.length ? `'${chars.join("")}'` : null;
}

/** Monta "ECX(7F200123) + 0x19" para um operando de memoria. */
function memoryExpression(machine, operand) {
  const parts = [];
  if (operand.base) {
    const value = machine.cpu.readRegister(operand.base);
    parts.push(`${operand.base.toUpperCase()}=${hex(value, machine.arch.bits === 64 ? 16 : 8)}`);
  }
  if (operand.index) {
    const value = machine.cpu.readRegister(operand.index);
    const scale = operand.scale && operand.scale !== 1 ? `*${operand.scale}` : "";
    parts.push(`${operand.index.toUpperCase()}=${hex(value, 8)}${scale}`);
  }
  const disp = BigInt(operand.disp || 0);
  if (disp !== 0n) {
    parts.push(disp < 0n ? `-0x${(-disp).toString(16).toUpperCase()}` : `+0x${disp.toString(16).toUpperCase()}`);
  }
  return parts.join(" ");
}

/**
 * Descreve os operandos da instrucao atual, na ordem em que aparecem.
 *
 * Cada entrada vira uma linha do painel.
 */
export function inspectOperands(machine) {
  const insn = machine?.currentInstruction;
  if (!insn || insn.data) return [];

  const digits = machine.arch.bits === 64 ? 16 : 8;

  return (insn.operands || []).map((operand) => {
    if (operand.type === "reg") {
      const value = machine.cpu.readRegister(operand.reg);
      return {
        kind: "reg",
        label: operand.reg.toUpperCase(),
        size: operand.size,
        value: hex(value, operand.size * 2),
        // `raw` acompanha o texto ja formatado: o painel precisa do numero
        // para oferecer "ver no dump", e reconverter a string seria refazer o
        // trabalho de tras para frente.
        raw: value,
        notes: annotateValue(machine, value),
      };
    }

    if (operand.type === "imm") {
      const value = BigInt(operand.value);
      return {
        kind: "imm",
        label: `0x${BigInt.asUintN(operand.size * 8, value).toString(16).toUpperCase()}`,
        size: operand.size,
        value: BigInt.asIntN(operand.size * 8, value).toString(10),
        notes: annotateValue(machine, value, { asPointer: false }),
      };
    }

    if (operand.type === "mem") {
      const address = machine.effectiveAddress(operand);
      const value = machine.readMemory(address, operand.size);
      const notes = annotateValue(machine, value, { asPointer: operand.size >= 4 });
      const { region } = describeRegion(machine, address);
      if (region) notes.unshift(region);
      const text = readStringAt(machine, address);
      if (text) notes.push(`"${text}"`);
      return {
        kind: "mem",
        label: `[${hex(address, digits)}]`,
        expression: memoryExpression(machine, operand),
        size: operand.size,
        value: hex(value, operand.size * 2),
        // O operando de memoria tem DOIS enderecos de interesse: onde ele
        // esta (o endereco efetivo) e para onde aponta (o valor lido).
        address,
        raw: value,
        notes,
      };
    }

    return { kind: "unknown", label: "?", size: 0, value: "", notes: [] };
  });
}


// ---------------------------------------------------------------------------
// Ponteiros e argumentos de chamada
// ---------------------------------------------------------------------------

/**
 * Decide se um valor PARECE um ponteiro e, se sim, o que ha do outro lado.
 *
 * O criterio e conservador: so consideramos ponteiro um endereco dentro de uma
 * regiao conhecida (codigo ou pilha) ou que alguem ja escreveu. Sem isso,
 * qualquer inteiro pequeno viraria "ponteiro para 0x00000004" e o painel
 * mentiria mais do que ajudaria.
 */
export function describePointer(machine, value) {
  const address = BigInt(value);
  if (address === 0n) return { isPointer: false };

  const { region, offset } = describeRegion(machine, address);
  const written = machine.memory.isDefined(address);
  if (!region && !written) return { isPointer: false };

  const text = readStringAt(machine, address);
  const size = machine.arch.wordSize;
  return {
    isPointer: true,
    region,
    offset,
    string: text,
    // Sem string legivel, mostramos a palavra que esta no destino — que pode
    // ser, por sua vez, outro ponteiro.
    target: text ? null : machine.readMemory(address, size),
  };
}

/**
 * O endereco tem memoria de verdade atras dele?
 *
 * Mesmo criterio conservador de `describePointer`, isolado para quem so
 * precisa da resposta sim/nao — o menu "ver no dump" nao pode oferecer o
 * salto para um inteiro que por acaso estava num registrador.
 */
export function isMappedAddress(machine, value) {
  if (!machine || value === null || value === undefined) return false;
  try {
    const address = BigInt(value);
    if (address === 0n) return false;
    const { region } = describeRegion(machine, address);
    return Boolean(region) || machine.memory.isDefined(address);
  } catch {
    return false;
  }
}

/**
 * O que um valor aponta DENTRO da regiao de codigo — e, quando ele e um
 * endereco de retorno, de que chamada ele veio.
 *
 * Um endereco de retorno na pilha e um numero como outro qualquer; e o `call`
 * que o empilhou que lhe da sentido. Reconhece-lo e mecanico: o `call` que
 * empilhou o endereco X e a instrucao que TERMINA exatamente em X. Sem esta
 * leitura, o aluno ve `00007FF700001012` na pilha sem ter como saber que
 * aquilo e o caminho de volta — justamente o valor que o shellcode
 * sobrescreve.
 *
 * Devolve null quando o valor nao aponta para o codigo carregado.
 */
export function codeReference(machine, value) {
  if (!machine) return null;

  let address;
  try {
    address = BigInt(value ?? 0);
  } catch {
    return null;
  }
  // `.data` fora: um ponteiro para uma string declarada com `db` esta dentro
  // da imagem, mas nao e endereco de codigo nenhum.
  if (!machine.isExecutableAddress(address)) return null;

  const at = machine.byAddress?.get(address.toString()) || null;
  const from = (machine.instructions || []).find(
    (insn) =>
      !insn.data &&
      insn.groups?.includes("call") &&
      BigInt(insn.address) + BigInt(insn.size) === address
  );

  if (!from) {
    return { address, offset: address - machine.codeBase, isReturn: false, instruction: at };
  }

  // De QUEM se volta: o alvo do `call`. Chamada indireta nao tem alvo
  // imediato, e ai o nome so existe se alguem o tiver dito.
  const immediate = (from.operands || []).find((operand) => operand.type === "imm");
  const target = immediate ? BigInt(immediate.value) : null;
  // O rotulo do fonte responde o "from ???" do x64dbg sem ninguem digitar nada.
  const name =
    callNameOverride(machine.osId, machine.archId, callKey(target, from.address)) ||
    machine.labelAt(target);

  return {
    address,
    offset: address - machine.codeBase,
    isReturn: true,
    instruction: at,
    call: from,
    target,
    name,
  };
}

/**
 * Convencoes de chamada suportadas.
 *
 * `registers` sao os argumentos passados em registrador, na ordem; os demais
 * vem da pilha. `stackOffset` e o deslocamento do PRIMEIRO argumento de pilha
 * em relacao ao ponteiro de pilha NO MOMENTO DO CALL — antes, portanto, de o
 * endereco de retorno ser empilhado.
 */
export const CALL_CONVENTIONS = {
  cdecl: {
    id: "cdecl",
    label: "cdecl / stdcall (x86)",
    archs: ["x86"],
    registers: [],
    stackOffset: 0,
  },
  sysv: {
    id: "sysv",
    label: "System V (Linux x64)",
    archs: ["x86_64"],
    registers: ["rdi", "rsi", "rdx", "rcx", "r8", "r9"],
    stackOffset: 0,
  },
  fastcall: {
    id: "fastcall",
    label: "Microsoft x64 fastcall",
    archs: ["x86_64"],
    registers: ["rcx", "rdx", "r8", "r9"],
    // 32 bytes de "shadow space" reservados pelo chamador.
    stackOffset: 0x20,
  },
};

/**
 * Convencao padrao de um alvo.
 *
 * Nao depende so da arquitetura: em 64 bits, Linux e macOS usam System V e o
 * Windows usa a fastcall da Microsoft. Sao registradores DIFERENTES para os
 * mesmos argumentos — ler um binario do Windows pela tabela do Linux mostra
 * RDI e RSI onde o programa pos RCX e RDX.
 *
 * Em 32 bits todas passam pela pilha, e a diferenca (quem limpa) nao muda o
 * que o painel exibe.
 */
export function defaultConvention(archId, osId) {
  if (archId !== "x86_64") return "cdecl";
  return osId === "windows" ? "fastcall" : "sysv";
}

/**
 * Argumentos que a funcao chamada receberia, do ponto de vista do `call`
 * prestes a executar.
 *
 * Nao ha como saber quantos argumentos a funcao recebe — por isso a
 * quantidade e um parametro da interface: o aluno decide quantas posicoes quer
 * inspecionar.
 */
export function callArguments(machine, { count = 4, convention } = {}) {
  const spec =
    CALL_CONVENTIONS[convention] ||
    CALL_CONVENTIONS[defaultConvention(machine.archId, machine.osId)];
  const wordSize = machine.arch.wordSize;
  const sp = machine.cpu.sp;
  const args = [];

  for (let index = 0; index < count; index += 1) {
    if (index < spec.registers.length) {
      const name = spec.registers[index];
      args.push({
        index,
        source: name.toUpperCase(),
        origin: "register",
        value: machine.cpu.readRegister(name),
      });
      continue;
    }
    const slot = index - spec.registers.length;
    const address = sp + BigInt(spec.stackOffset) + BigInt(slot) * BigInt(wordSize);
    args.push({
      index,
      source: `[${machine.arch.stackPointer.toUpperCase()}${
        spec.stackOffset + slot * wordSize
          ? `+0x${(spec.stackOffset + slot * wordSize).toString(16).toUpperCase()}`
          : ""
      }]`,
      origin: "stack",
      address,
      value: machine.readMemory(address, wordSize),
    });
  }

  return { convention: spec, args };
}

/**
 * A chamada prestes a acontecer, com o prototipo quando ele e conhecido.
 *
 * Espelho do painel de syscall, para a outra forma de chamar codigo alheio. A
 * diferenca esta em como o nome aparece: num `syscall` o numero em RAX
 * identifica a funcao, e aqui nao ha o que deduzir de um endereco — o nome e
 * dito pelo aluno (`lib/cpu/callNames`). Dito uma vez, o prototipo do catalogo
 * entra e a descrição deixa de ser um chute da barra superior.
 *
 * E o que traz as Rtl* e Ldr* da ntdll para o painel: elas nunca passam por
 * `syscall`, entao so por aqui um `call` para `RtlInitUnicodeString` mostra
 * que RCX e a UNICODE_STRING de saida e RDX o texto de origem.
 */
export function callInvocation(machine, { count = 4, convention } = {}) {
  const insn = machine?.currentInstruction;
  if (!insn || insn.data || !insn.groups?.includes("call")) return null;

  // Destino, quando e um imediato. Chamada indireta (`call rbx`, `call [rax]`)
  // so se resolve na hora de executar, entao nao ha o que antecipar — e a
  // chave do nome passa a ser o ponto do programa, nao a funcao.
  const immediate = (insn.operands || []).find((operand) => operand.type === "imm");
  const target = immediate ? BigInt(immediate.value) : null;

  const key = callKey(target, insn.address);
  // O nome dito pelo aluno ganha do rotulo: ele pode ter reconhecido que
  // aquele `Function1` e, na verdade, um stub de `NtWriteFile`.
  const manual = callNameOverride(machine.osId, machine.archId, key);
  const label = manual ? null : machine.labelAt(target);
  const name = manual || label;
  const prototype = name ? prototypeByName(machine.osId, machine.archId, name) : null;

  const { convention: spec, args } = callArguments(machine, {
    // Com prototipo, a quantidade e a DELE: mostrar quatro posicoes para uma
    // funcao de dois argumentos inventaria dois argumentos.
    count: prototype ? prototype.input_args.length : count,
    convention,
  });

  return {
    convention: spec,
    target,
    key,
    name,
    // De onde saiu o nome: dito pelo aluno, ou lido do fonte. Um rotulo e
    // fato; um nome digitado e leitura de quem esta lendo o codigo.
    origin: manual ? "manual" : label ? "label" : null,
    prototype,
    known: Boolean(prototype),
    args: args.map((arg, index) => {
      const param = prototype?.input_args?.[index];
      return param
        ? { ...arg, name: param.name, type: param.type, description: param.description }
        : arg;
    }),
  };
}

/**
 * String apontada por um valor, ou null.
 *
 * Atalho de `describePointer` para os paineis que so querem a anotacao
 * `→ "texto"` ao lado do valor (registradores e pilha). O criterio conservador
 * e o mesmo: so um endereco dentro de uma regiao conhecida — ou que alguem ja
 * escreveu — chega a ser lido como texto.
 */
export function pointerString(machine, value) {
  if (!machine) return null;
  try {
    return describePointer(machine, value).string || null;
  } catch {
    // Valor absurdo (endereco fora de qualquer faixa) nao pode derrubar o painel.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chamadas de sistema
// ---------------------------------------------------------------------------

/**
 * Reconhece a instrucao que ENTRA no kernel, ou null.
 *
 * `int` sozinho nao basta: so o vetor 0x80 e a porta de syscall do Linux de 32
 * bits — `int 3` e breakpoint, e anunciar argumentos ali seria invencao.
 */
export function syscallGate(insn) {
  if (!insn || insn.data) return null;

  const mnemonic = (insn.mnemonic || "").toLowerCase();
  if (mnemonic === "syscall" || mnemonic === "sysenter") return mnemonic;

  if (mnemonic === "int") {
    const operand = (insn.operands || [])[0];
    if (operand?.type === "imm" && BigInt(operand.value) === 0x80n) return "int 0x80";
  }
  return null;
}

/**
 * O que a syscall prestes a acontecer esta pedindo.
 *
 * Diferente de um `call`, aqui a quantidade de argumentos NAO e desconhecida:
 * o numero em EAX/RAX identifica a funcao, e o prototipo dela diz quantos
 * argumentos ler e como se chamam. So quando o numero nao esta na tabela e que se cai no
 * generico — e ai a quantidade vem da barra superior, como no painel de call.
 */
export function syscallInvocation(machine, { count = 4 } = {}) {
  const via = syscallGate(machine?.currentInstruction);
  if (!via) return null;

  const abi = syscallAbi(machine.osId, machine.archId);
  const raw = machine.cpu.readRegister(abi.numberRegister);
  // No macOS de 64 bits o numero vem somado a classe UNIX (0x2000000): sem
  // tirar a classe, `mov rax, 0x2000004` viraria "syscall 33554436".
  const number = syscallNumber(abi, raw);
  // Ordem de precedencia: o que o aluno afirmou, depois a ntdll que ele
  // importou, depois a tabela fixa. A escolha manual vem primeiro porque e a
  // unica que carrega conhecimento que o simulador nao tem como ter.
  const chosen = syscallNameOverride(machine.osId, machine.archId, number);
  const fromNtdll =
    !chosen && abi.resolvable === false
      ? resolveSyscall(machine.archId, number)
      : null;
  // O catalogo vem antes da tabela embutida: ele tem as 440 syscalls do i386 e
  // as 362 do x86-64, e a tabela em `syscalls.js` e so o punhado que resolve
  // antes de a lista chegar do servidor.
  const fromCatalog =
    !chosen && !fromNtdll && abi.resolvable !== false
      ? syscallNameByNumber(machine.osId, machine.archId, number)
      : null;
  const name =
    chosen || fromNtdll || fromCatalog
    || (abi.resolvable === false ? null : abi.names[number] || null);

  // O prototipo do catalogo (YAML) tem nome, tipo e descricao de cada
  // argumento; a tabela embutida so tem os nomes. O catalogo vem primeiro, e o
  // que faz os campos se atualizarem ao escolher outra funcao.
  const prototype = name ? prototypeByName(machine.osId, machine.archId, name) : null;
  const fallback = name ? SYSCALL_SIGNATURES[name] : null;

  const params =
    prototype?.input_args?.map((arg) => ({
      name: arg.name,
      type: arg.type,
      description: arg.description,
      direction: arg.direction,
    })) ??
    fallback?.map((paramName) => ({ name: paramName })) ??
    // Sem prototipo, quem decide quantas posicoes olhar e a barra superior.
    Array.from({ length: count }, (_, i) => ({ name: `arg${i}` }));

  return {
    via,
    os: machine.osId,
    table: abi.table,
    numberRegister: abi.numberRegister,
    // `raw` e o que esta no registrador; `number` e o que a tabela indexa. Os
    // dois aparecem no painel quando diferem — e o que explica o 0x2000000.
    raw,
    number,
    name,
    // Windows nao tem numero estavel POR SI SO: sem a ntdll importada nao ha o
    // que resolver, e dizer isso e mais util que exibir um nome inventado.
    resolvable: abi.resolvable !== false || Boolean(fromNtdll) || Boolean(chosen),
    // De onde veio o nome: escolha do aluno, DLL importada, ou a tabela.
    origin: chosen ? "manual" : fromNtdll ? "ntdll" : name ? "table" : null,
    source: fromNtdll ? ntdllSummary(machine.archId)?.origin || "ntdll.dll" : null,
    // True quando o alvo e Windows, NAO ha tabela e o aluno tambem nao disse
    // nada: e o gatilho do convite a importar a ntdll.
    needsNtdll: abi.resolvable === false && !fromNtdll && !chosen,
    // Sem prototipo conhecido nao ha o que nomear: o painel avisa em vez de
    // apresentar "arg0" como se fosse o nome real do parametro.
    known: Boolean(prototype || fallback),
    prototype,
    simulated: Boolean(name && SIMULATED_SYSCALLS.has(name)),
    args: params.map((param, index) => ({
      index,
      ...param,
      ...argumentSlot(machine, abi, index),
      // `argumentSlot` traz o `name` da ORIGEM (registrador); o do parametro
      // vem do prototipo e e o que interessa mostrar.
      name: param.name,
    })),
  };
}
