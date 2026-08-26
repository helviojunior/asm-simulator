/**
 * Apoio do painel de dump de memoria.
 *
 * Duas responsabilidades: decidir QUE faixa de enderecos o painel navega, e
 * formatar a selecao para a area de transferencia.
 */

import { asciiByte, hex } from "./format";

// Alinhamento das linhas do dump. E o maior valor de "bytes por linha"
// oferecido — alinhar por ele deixa o inicio da faixa alinhado tambem para 8
// e 16, e a coluna de endereco sai sempre em multiplos redondos.
export const DUMP_ALIGN = 32n;

// Folga fora da regiao conhecida. Sem ela nao daria para ver o que ha logo
// antes do codigo ou logo depois do topo da pilha — e e exatamente ali que um
// estouro de buffer aparece.
const REGION_MARGIN = 0x40n;

// Faixa navegavel de um endereco que nao cai em regiao nenhuma. Um espaco de
// 64 bits nao cabe numa barra de rolagem; o que cabe e a vizinhanca do
// endereco que alguem pediu para ver.
const FREE_SPAN = 0x400n;

const alignDown = (value) => value - (((value % DUMP_ALIGN) + DUMP_ALIGN) % DUMP_ALIGN);
const alignUp = (value) => alignDown(value + DUMP_ALIGN - 1n);

/**
 * Faixa de enderecos que o painel percorre ao redor de `address`.
 *
 * A barra de rolagem precisa de um comeco e um fim. Regiao conhecida da os
 * dois de graca (codigo e pilha tem limites); fora delas, a faixa e uma
 * janela ao redor do endereco pedido — rolar para sempre num espaco vazio nao
 * mostraria nada de qualquer forma.
 */
export function dumpWindow(machine, address) {
  const at = BigInt(address ?? 0);

  if (machine) {
    const codeStart = machine.codeBase - REGION_MARGIN;
    const codeEnd = machine.codeEnd + REGION_MARGIN;
    if (at >= codeStart && at < codeEnd) {
      return clamp(alignDown(codeStart), alignUp(codeEnd), "code");
    }

    const stackStart = machine.stackLimit - REGION_MARGIN;
    const stackEnd = machine.stackCeiling + REGION_MARGIN;
    if (at >= stackStart && at <= stackEnd) {
      return clamp(alignDown(stackStart), alignUp(stackEnd + 1n), "stack");
    }
  }

  return clamp(alignDown(at - FREE_SPAN), alignUp(at + FREE_SPAN), null);
}

function clamp(start, end, region) {
  const from = start < 0n ? 0n : start;
  return { start: from, end: end > from ? end : from + DUMP_ALIGN, region };
}

/** True se `address` esta dentro da faixa navegavel. */
export function inWindow(window, address) {
  const at = BigInt(address);
  return at >= window.start && at < window.end;
}

// ---------------------------------------------------------------------------
// Copia
// ---------------------------------------------------------------------------

/**
 * Formatos de copia oferecidos pelo menu de contexto.
 *
 * `escaped` e `db` nao sao enfeite: sao as duas formas em que um trecho de
 * memoria volta para dentro de um programa — colado num `db` do proprio
 * fonte, ou numa string de shellcode.
 */
export const COPY_FORMATS = ["hex", "hexRaw", "escaped", "db", "ascii"];

// Quantos bytes por linha na saida `db` — mesma largura das listagens de
// shellcode, que e onde esse texto vai parar.
const DB_PER_LINE = 8;

/** Serializa os bytes selecionados no formato pedido. */
export function formatBytes(bytes, format) {
  const list = Array.from(bytes, (byte) => Number(byte) & 0xff);
  if (list.length === 0) return "";

  const pair = (byte) => hex(BigInt(byte), 2);

  switch (format) {
    case "hexRaw":
      return list.map(pair).join("");
    case "escaped":
      return list.map((byte) => `\\x${pair(byte).toLowerCase()}`).join("");
    case "db":
      return chunk(list, DB_PER_LINE)
        .map((line) => `    db ${line.map((byte) => `0x${pair(byte)}`).join(", ")}`)
        .join("\n");
    case "ascii":
      return list.map(asciiByte).join("");
    case "hex":
    default:
      return list.map(pair).join(" ");
  }
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Le a selecao como um numero little-endian, quando ela tem o tamanho de um
 * inteiro (1, 2, 4 ou 8 bytes).
 *
 * E o que responde "que valor esta aqui" sem obrigar a inverter os bytes de
 * cabeca — o erro mais comum de quem esta comecando a ler um dump.
 */
export function selectionValue(bytes) {
  if (![1, 2, 4, 8].includes(bytes.length)) return null;
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i] & 0xff);
  }
  return { value, digits: bytes.length * 2 };
}
