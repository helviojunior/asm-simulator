/**
 * Tipo generico que so se resolve lendo um campo dele.
 *
 * `sockaddr` e o caso que motivou isto: os 16 bytes nao dizem nada ate se saber
 * a familia, e ai o layout de verdade e o do `sockaddr_in`, `sockaddr_in6` ou
 * `sockaddr_un`.
 */
import { variantOf } from "lib/cpu/parseStruct";

// So o que `variantOf` usa: ler uma palavra num endereco.
const machineWith = (bytesByAddress) => ({
  readMemory: (address, size) => {
    const key = `${BigInt(address)}:${size}`;
    if (!(key in bytesByAddress)) throw new Error(`sem memoria em ${key}`);
    return BigInt(bytesByAddress[key]);
  },
});

// Como o catalogo do Linux declara: AF_UNIX 1, AF_INET 2, AF_INET6 10.
const SOCKADDR = {
  type_name: "sockaddr",
  size: 16,
  fields: [
    { name: "sa_family", offset: 0, size: 2 },
    { name: "sa_data", offset: 2, size: 14 },
  ],
  variants: {
    field: "sa_family",
    cases: { 1: "sockaddr_un", 2: "sockaddr_in", 10: "sockaddr_in6" },
  },
};

test("a familia escolhe o layout derivado", () => {
  const machine = machineWith({ "4096:2": 2 });
  expect(variantOf(machine, 4096n, SOCKADDR)).toBe("sockaddr_in");
});

test("cada familia leva ao seu tipo", () => {
  expect(variantOf(machineWith({ "0:2": 1 }), 0n, SOCKADDR)).toBe("sockaddr_un");
  expect(variantOf(machineWith({ "0:2": 10 }), 0n, SOCKADDR)).toBe("sockaddr_in6");
});

test("familia desconhecida nao inventa tipo", () => {
  // AF_INET6 do Windows (23) num alvo Linux: melhor ficar no generico do que
  // ler 28 bytes de um objeto que pode ter 16.
  expect(variantOf(machineWith({ "0:2": 23 }), 0n, SOCKADDR)).toBeNull();
});

test("o campo lido e o declarado, no offset dele", () => {
  const layout = {
    ...SOCKADDR,
    fields: [
      { name: "outro", offset: 0, size: 2 },
      { name: "sa_family", offset: 8, size: 2 },
    ],
    variants: { field: "sa_family", cases: { 2: "sockaddr_in" } },
  };
  // O valor certo esta em +8; em +0 ha outra coisa, que nao pode ser lida no
  // lugar dele.
  expect(variantOf(machineWith({ "0:2": 99, "8:2": 2 }), 0n, layout)).toBe("sockaddr_in");
});

test("tipo sem variantes nao muda de layout", () => {
  const plain = { type_name: "sockaddr_in", size: 16, fields: [{ name: "sin_family", offset: 0, size: 2 }] };
  expect(variantOf(machineWith({ "0:2": 2 }), 0n, plain)).toBeNull();
});

test("endereco ilegivel mantem o generico", () => {
  // Ponteiro nulo ou fora da memoria escrita: o painel segue mostrando
  // `sockaddr` em vez de derrubar a tela.
  expect(variantOf(machineWith({}), 0n, SOCKADDR)).toBeNull();
});
