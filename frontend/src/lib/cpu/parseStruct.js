/**
 * Leitura de uma struct na memoria simulada.
 *
 * O layout (offset e tamanho de cada campo) vem do catalogo de tipos; aqui so
 * se le a memoria naqueles deslocamentos. E por isso que o offset precisa estar
 * exato: um erro nao apareceria como falha, apareceria como um campo mostrando
 * o byte errado com toda a aparencia de estar certo.
 */

import { asciiCell } from "./format";

// Ate onde tentar ler texto a partir de um ponteiro de string.
const STRING_SCAN = 64;

/**
 * Monta a arvore de campos de `type` lido em `address`.
 *
 * `path` identifica cada no de forma estavel entre passos — e o que permite ao
 * painel lembrar o que estava expandido depois de a execucao avancar.
 */
export function parseStruct(machine, address, type, path = "") {
  if (!machine || !type) return [];
  const base = BigInt(address);

  return type.fields.map((field) => {
    const at = base + BigInt(field.offset);
    const node = {
      path: `${path}/${field.name}`,
      name: field.name,
      type: field.type || "",
      offset: field.offset,
      size: field.size,
      address: at,
      description: field.description || "",
    };

    if (field.fields) {
      // Bloco anonimo: mora no MESMO endereco, e os campos dele sao filhos
      // diretos — nao ha ponteiro a seguir.
      return { ...node, inline: true, children: parseStruct(machine, at, { fields: field.fields }, node.path) };
    }

    // Campo grande demais para um numero (um `char[64]`) nao vira valor: vira
    // o texto que estiver la, que e o que se quer ver num nome de arquivo.
    if (field.size > 8) {
      return { ...node, bytes: machine.memory.readBytes(at, Math.min(field.size, 256)) };
    }

    return { ...node, value: machine.readMemory(at, field.size) };
  });
}

/** Texto legivel de um bloco de bytes, ate o primeiro NUL. */
export function previewBytes(bytes) {
  const out = [];
  for (const byte of bytes) {
    if (byte === 0) break;
    out.push(asciiCell(byte).char);
  }
  return out.join("");
}

/** Le uma string terminada em NUL a partir de um endereco. */
export function readString(machine, address, wide = false) {
  const step = wide ? 2 : 1;
  let out = "";
  for (let i = 0; i < STRING_SCAN; i += 1) {
    const at = BigInt(address) + BigInt(i * step);
    const code = Number(machine.readMemory(at, step));
    if (code === 0) break;
    out += asciiCell(code & 0xff).char;
  }
  return out;
}
