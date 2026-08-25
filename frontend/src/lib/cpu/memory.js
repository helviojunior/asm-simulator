/**
 * Memoria esparsa, byte a byte.
 *
 * Um programa de aula toca algumas dezenas de enderecos espalhados por um
 * espaco de 64 bits — alocar regioes contiguas seria desperdicio. Aqui so
 * existe o byte que alguem escreveu; ler um endereco nunca escrito devolve
 * o valor de `defaultByte` (0x00), como memoria zerada.
 *
 * Enderecos sao BigInt em todo lugar: um endereco de 64 bits nao cabe em
 * Number sem perder precisao.
 */

export class Memory {
  constructor({ defaultByte = 0 } = {}) {
    this.bytes = new Map();
    this.defaultByte = defaultByte;
  }

  /** Le um byte (0..255). Endereco nunca escrito devolve o valor padrao. */
  readByte(address) {
    const value = this.bytes.get(BigInt(address));
    return value === undefined ? this.defaultByte : value;
  }

  writeByte(address, value) {
    this.bytes.set(BigInt(address), Number(value) & 0xff);
  }

  /** Le `size` bytes em little-endian e devolve um BigInt sem sinal. */
  read(address, size) {
    const base = BigInt(address);
    let result = 0n;
    for (let i = size - 1; i >= 0; i -= 1) {
      result = (result << 8n) | BigInt(this.readByte(base + BigInt(i)));
    }
    return result;
  }

  /** Escreve `size` bytes em little-endian. */
  write(address, size, value) {
    const base = BigInt(address);
    let remaining = BigInt.asUintN(size * 8, BigInt(value));
    for (let i = 0; i < size; i += 1) {
      this.writeByte(base + BigInt(i), Number(remaining & 0xffn));
      remaining >>= 8n;
    }
  }

  /** Copia um bloco de bytes (usado para carregar o programa). */
  writeBytes(address, data) {
    const base = BigInt(address);
    for (let i = 0; i < data.length; i += 1) {
      this.writeByte(base + BigInt(i), data[i]);
    }
  }

  /** Devolve `length` bytes a partir de `address`, para o painel de dump. */
  readBytes(address, length) {
    const base = BigInt(address);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = this.readByte(base + BigInt(i));
    }
    return out;
  }

  /** True se o endereco ja foi escrito — o dump usa isso para esmaecer. */
  isDefined(address) {
    return this.bytes.has(BigInt(address));
  }
}
