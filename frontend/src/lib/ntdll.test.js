import api from "lib/api";
import { clearNtdll, importNtdll, ntdllSummary, resolveSyscall } from "lib/ntdll";

jest.mock("lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

beforeEach(async () => {
  api.delete.mockResolvedValue({ data: null });
  await clearNtdll();
  jest.clearAllMocks();
});

test("sem tabela, nada resolve — e e isso que o painel precisa saber", () => {
  expect(resolveSyscall("x86_64", 0x55)).toBeNull();
  expect(ntdllSummary("x86_64")).toBeNull();
});

test("importada, o SSN vira nome de funcao", async () => {
  api.post.mockResolvedValue({
    data: {
      arch: "x86_64", count: 2, origin: "ntdll.dll", exports: 2400,
      syscalls: { 85: "NtCreateFile", 38: "NtOpenProcess" },
    },
  });

  await importNtdll(new Blob([new Uint8Array([1])]));

  expect(resolveSyscall("x86_64", 0x55)).toBe("NtCreateFile");
  expect(resolveSyscall("x86_64", 38)).toBe("NtOpenProcess");
  expect(ntdllSummary("x86_64").origin).toBe("ntdll.dll");

  // A tabela e por arquitetura: a de 64 bits nao responde por x86.
  expect(resolveSyscall("x86", 0x55)).toBeNull();
});

test("descarregar limpa o registro local, nao so o servidor", async () => {
  api.post.mockResolvedValue({
    data: { arch: "x86_64", count: 1, origin: "ntdll.dll", syscalls: { 8: "NtWriteFile" } },
  });
  await importNtdll(new Blob([new Uint8Array([1])]));
  expect(resolveSyscall("x86_64", 8)).toBe("NtWriteFile");

  api.delete.mockResolvedValue({ data: null });
  await clearNtdll("x86_64");
  expect(resolveSyscall("x86_64", 8)).toBeNull();
});

test("o upload vai como multipart, nao como JSON", async () => {
  api.post.mockResolvedValue({
    data: { arch: "x86_64", count: 0, syscalls: {} },
  });
  await importNtdll(new Blob([new Uint8Array([1])]));

  const [url, body] = api.post.mock.calls[0];
  expect(url).toBe("/api/ntdll/");
  expect(body).toBeInstanceOf(FormData);
});
