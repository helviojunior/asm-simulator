import React from "react";
import { asciiCell, hex } from "lib/cpu/format";
import { pointerString } from "lib/cpu/inspect";
import { Switch } from "components/ui/switch";
import { useI18n } from "i18n";
import { cn } from "lib/utils";

// Quantas palavras mostrar acima e abaixo do ponteiro de pilha.
const ROWS_BELOW = 4;
const ROWS_ABOVE = 12;

// Cor de cada classe de byte no dump: quem le distingue "aqui ha texto" de
// "aqui ha binario" sem decodificar o hexadecimal ao lado.
const ASCII_COLOR = {
  printable: "text-[#ce9178]",
  control: "text-[#569cd6]",
  null: "text-[#4a4a4a]",
  unknown: "text-[#6b6b6b]",
};

/**
 * Painel da pilha.
 *
 * A linha apontada por ESP/RSP fica marcada, e as celulas escritas no ultimo
 * passo vem destacadas — e a mesma leitura dos slides, em que a celula nova
 * aparece em branco sobre o fundo escuro.
 */
export default function StackPane({ machine, changed = [] }) {
  const { t } = useI18n();
  // Ligado por padrao: numa aula de shellcode a pilha quase sempre carrega
  // texto, e o dump e o que revela isso sem precisar abrir outro painel.
  const [showAscii, setShowAscii] = React.useState(true);

  if (!machine) return null;

  const { arch, cpu, memory } = machine;
  const wordSize = BigInt(arch.wordSize);
  const digits = arch.bits === 64 ? 16 : 8;
  const sp = cpu.sp;

  // Enderecos alterados no passo (byte a byte) reduzidos a palavra da pilha.
  const changedWords = new Set(
    changed.map((address) => {
      const value = BigInt(address);
      return (value - (value % wordSize)).toString();
    })
  );

  const rows = [];
  for (let i = -ROWS_BELOW; i <= ROWS_ABOVE; i += 1) {
    const address = sp + BigInt(i) * wordSize;
    if (address < machine.stackLimit || address > machine.stackTop) continue;
    const value = memory.read(address, arch.wordSize);
    rows.push({
      address,
      value,
      isPointer: address === sp,
      isBase: address === cpu.readRegister(arch.basePointer),
      changed: changedWords.has(address.toString()),
      // Ordem de memoria (byte baixo primeiro): e assim que uma string na
      // pilha se le da esquerda para a direita, ao contrario do hexadecimal
      // little-endian ao lado.
      bytes: memory.readBytes(address, arch.wordSize),
      string: pointerString(machine, value),
    });
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.stack", "Stack")}
        </span>
        {/* Div, e nao <label>: o Switch e um <button>, e um label associado
            reenviaria o clique para ele — o texto alternaria duas vezes. */}
        <div className="ml-auto flex select-none items-center gap-2 text-[10px] uppercase tracking-wider text-[#9a9a9a]">
          <span className="cursor-pointer" onClick={() => setShowAscii(!showAscii)}>
            {t("sim.viewAscii", "View ASCII")}
          </span>
          {/* O Switch padrao tem 24px de altura e engordaria o cabecalho em
              relacao aos demais paineis; a escala mantem o mesmo componente. */}
          <span className="flex origin-right scale-75 items-center">
            <Switch
              checked={showAscii}
              onChange={setShowAscii}
              ariaLabel={t("sim.viewAscii", "View ASCII")}
            />
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-auto font-mono text-[12px] leading-[1.5]">
        {rows.map((row) => (
          <div
            key={row.address.toString()}
            className={cn(
              "flex items-baseline gap-3 whitespace-pre px-2",
              row.isPointer && "bg-[#094771]"
            )}
          >
            <span className="w-[5ch] shrink-0 text-[#c586c0]">
              {row.isPointer
                ? arch.stackPointer.toUpperCase()
                : row.isBase
                ? arch.basePointer.toUpperCase()
                : " "}
            </span>
            <span className={cn("shrink-0", row.isPointer ? "text-white" : "text-[#858585]")}>
              {hex(row.address, digits)}
            </span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                row.changed
                  ? "-mx-1 bg-[#5a1d1d] px-1 font-bold text-[#ff6b6b]"
                  : "text-[#d4d4d4]"
              )}
            >
              {hex(row.value, digits)}
            </span>
            {showAscii && <AsciiDump bytes={row.bytes} />}
            {row.string && (
              <span className="min-w-0 truncate text-[11px] text-[#ce9178]" title={row.string}>
                <span className="text-[#6b6b6b]">{"→ "}</span>
                {`"${row.string}"`}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Dump ASCII de uma palavra da pilha.
 *
 * Uma coluna de largura fixa por byte (`w-[1ch]`): assim o dump continua
 * alinhado entre linhas mesmo quando um byte cai num glifo de controle ou no
 * caractere de "nao conhecido", que nao tem a mesma largura da fonte.
 */
function AsciiDump({ bytes }) {
  return (
    <span className="shrink-0 border-l border-[#3c3c3c] pl-2 font-dump">
      {Array.from(bytes, (byte, index) => {
        const cell = asciiCell(byte);
        return (
          <span
            key={index}
            title={cell.label}
            // overflow-hidden e a ultima linha de defesa: se ainda assim um
            // glifo vier de outra fonte, ele e cortado na celula em vez de
            // vazar por cima da proxima.
            className={cn(
              "inline-block w-[1ch] overflow-hidden text-center",
              ASCII_COLOR[cell.kind]
            )}
          >
            {cell.char}
          </span>
        );
      })}
    </span>
  );
}
