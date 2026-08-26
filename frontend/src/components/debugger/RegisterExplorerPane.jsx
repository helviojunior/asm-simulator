import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { hex, signedDecimal } from "lib/cpu/format";
import { canonicalName, registerViews } from "lib/cpu/registers";

// Largura de uma celula: um nibble e "0110" em cima e "6" embaixo. Fixa em
// `ch` de proposito — e ela que faz as linhas de 64, 32, 16 e 8 bits ficarem
// alinhadas pela DIREITA, que e o que mostra o encaixe de uma dentro da outra.
//
// `ch` e a largura do "0" NA FONTE DO PROPRIO ELEMENTO. Entao nenhum elemento
// que carregue uma destas larguras pode mudar de fonte ou de tamanho: uma
// regua em `text-[10px]` media 6.5ch de 10px e saia dessincronizada das
// celulas de 12px — que era exatamente o desalinhamento dos marcadores de
// bit. O tamanho menor vive nos <span> de dentro, que nao tem largura.
const CELL = "6.5ch";

/**
 * O registrador visto por dentro: bit a bit, nibble a nibble.
 *
 * A pergunta que este painel responde e a que todo mundo faz na primeira aula:
 * *onde* AL esta dentro de RAX. Ver o valor de cada view numa linha separada
 * nao responde — o que responde e ver as quatro EMPILHADAS e alinhadas pela
 * direita, cada uma cobrindo um pedaco da de cima.
 *
 * Por isso a cascata, e nao uma tabela: RAX inteiro, depois EAX embaixo dos
 * seus 32 bits, AX embaixo dos 16, AL embaixo dos 8. A regua de bits em cima
 * marca 63, 47, 31, 15, 7 e 0 — os limites que o aluno vai encontrar escritos
 * em todo manual.
 */
export default function RegisterExplorerPane({ machine, register, changed = [], tick = 0 }) {
  const { t } = useI18n();

  const canonical = register ? canonicalName(register) : null;

  /**
   * Deslocamento SIMULADO, em bits: positivo para a esquerda, negativo para a
   * direita, zero para o valor como ele esta.
   *
   * O registrador nao e tocado. `shl`/`shr` sao das poucas instrucoes cujo
   * efeito e obvio quando se ve e opaco quando se le, e experimenta-las de
   * verdade custaria escrever, montar e dar o passo — para descobrir que era
   * um bit a mais. Aqui a barra move os bits na tela e a resposta e imediata.
   */
  const [shift, setShift] = useState(0);

  // Outro registrador (ou outro programa) e outro assunto: manter o
  // deslocamento faria o painel abrir mentindo sobre o valor.
  useEffect(() => { setShift(0); }, [canonical, machine]);

  /**
   * Valor que este registrador tinha ANTES do ultimo passo, ou null.
   *
   * O diario guarda o valor antigo inteiro, e nao a largura do que foi
   * escrito: e comparando os dois que se sabe QUE BYTES mudaram — a mesma
   * marca vermelha do dump e do painel de registradores, aqui na granularidade
   * em que o painel desenha.
   */
  const before = useMemo(() => {
    const entry = (changed || []).find(([name]) => name === canonical);
    return entry ? BigInt(entry[1]) : null;
  }, [changed, canonical]);

  const views = useMemo(() => {
    if (!machine || !canonical) return [];
    const list = registerViews(canonical, machine.arch.bits);
    if (!list.length) return [];

    // Uma leitura so, da view mais larga: as menores sao FATIAS dela, e
    // deriva-las aqui e o que faz o deslocamento simulado descer por toda a
    // cascata — mover RAX tem de mover AL junto.
    const bits = list[0].size * 8;
    const full = shiftValue(machine.cpu.readRegister(list[0].name), bits, shift);
    return list.map((view) => ({ ...view, value: BigInt.asUintN(view.size * 8, full) }));
    // `tick` entra porque a CPU muda por MUTACAO e nao troca de identidade:
    // sem ele o painel mostraria os bits do primeiro render para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, canonical, shift, tick]);

  if (!machine || !views.length) {
    return (
      <section className="flex h-full flex-col items-start bg-[#1e1e1e] p-3">
        <p className="text-[12px] text-[#6b6b6b]">
          {t("explore.idle", "Assemble a program and explore a register.")}
        </p>
      </section>
    );
  }

  const widest = views[0].size * 8;

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <ShiftBar
        bits={widest}
        name={views[0].name}
        shift={shift}
        onChange={setShift}
        t={t}
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px]">
        {/* Largura minima da area: a linha mais larga nao pode ser quebrada,
            ou o alinhamento entre as views — que e o assunto — se perde. */}
        <div
          className="flex flex-col gap-6"
          style={{ minWidth: `calc(${widest / 4} * ${CELL})`, width: "max-content" }}
        >
          {views.map((view) => (
            <View
              key={view.name}
              view={view}
              widest={widest}
              // Deslocado, o valor na tela nao veio de passo nenhum: marcar
              // "mudou no ultimo passo" ali seria atribuir a instrucao o que
              // foi a barra que fez.
              before={shift === 0 ? before : null}
              t={t}
            />
          ))}
        </div>
      </div>

      <footer className="shrink-0 whitespace-pre border-t border-[#3c3c3c] px-4 py-1.5 font-mono text-[11px] text-[#6b6b6b]">
        {t(
          "explore.legend",
          "Each cell is one nibble: the four bits above, the hexadecimal digit below."
        )}
      </footer>
    </section>
  );
}

/**
 * O valor deslocado de `bits` de largura: `> 0` para a esquerda, `< 0` para a
 * direita, e sempre recortado na largura.
 *
 * Os bits que saem sao PERDIDOS e entram zeros — como no `shl`/`shr` de
 * verdade, e nao numa rotacao. E metade do que a barra existe para mostrar:
 * deslocar e ida sem volta, e voltar o cursor nao traz o bit de volta porque
 * a conta e refeita sempre a partir do valor real.
 */
function shiftValue(value, bits, shift) {
  const raw = BigInt.asUintN(bits, BigInt(value));
  if (!shift) return raw;
  const amount = BigInt(Math.abs(shift));
  return BigInt.asUintN(bits, shift > 0 ? raw << amount : raw >> amount);
}

/**
 * A barra que desloca os bits.
 *
 * Um `range` nativo, e nao um controle proprio: arrastar da a leitura continua
 * (os bits escorrendo pela cascata) e as setas do teclado dao o passo de UM
 * bit, que e a granularidade em que a duvida costuma estar — "faltou um" e o
 * erro classico de quem monta uma mascara.
 */
function ShiftBar({ bits, name, shift, onChange, t }) {
  const instruction = shift === 0
    ? null
    : `${shift > 0 ? "shl" : "shr"} ${name}, ${Math.abs(shift)}`;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[#3c3c3c] px-4 py-1.5 font-mono text-[11px]">
      <span className="shrink-0 uppercase tracking-wider text-[#9a9a9a]">
        {t("explore.shift", "Shift")}
      </span>
      <span className="shrink-0 text-[#6b6b6b]">shr</span>
      <input
        type="range"
        min={-bits}
        max={bits}
        step={1}
        value={shift}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={t("explore.shift", "Shift")}
        aria-valuetext={instruction || "0"}
        className="h-1 w-full max-w-[420px] cursor-pointer accent-[#0e639c]"
      />
      <span className="shrink-0 text-[#6b6b6b]">shl</span>

      {/* O que a barra esta simulando, escrito como a instrucao que faria o
          mesmo: e assim que o aluno leva a resposta para o codigo dele. */}
      <span className={cn("shrink-0", instruction ? "text-[#dcdcaa]" : "text-[#6b6b6b]")}>
        {instruction || t("explore.shiftNone", "no shift")}
      </span>

      {shift !== 0 && (
        <>
          <span className="shrink-0 text-[#ce9178]">
            {t("explore.shiftSimulated", "simulated — the register does not change")}
          </span>
          <button
            type="button"
            onClick={() => onChange(0)}
            title={t("explore.shiftReset", "Back to the real value")}
            aria-label={t("explore.shiftReset", "Back to the real value")}
            className="ml-auto shrink-0 rounded p-1 text-[#6b6b6b] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
          >
            <RotateCcw size={12} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Uma view do registrador: regua, rotulo e a fileira de nibbles.
 *
 * `widest` e a largura da view MAIOR desta tela, em bits. Todas as linhas
 * reservam essa largura e desenham os proprios nibbles encostados a direita —
 * e assim que AL cai debaixo dos oito bits baixos de RAX.
 */
function View({ view, widest, before, t }) {
  const bits = view.size * 8;
  const value = BigInt.asUintN(bits, BigInt(view.value));
  // Recortado na largura DESTA view: os bytes altos de RAX nao dizem nada
  // sobre AL, e compara-los marcaria a view inteira a cada passo.
  const previous = before === null ? null : BigInt.asUintN(bits, before);

  const cells = [];
  for (let index = 0; index < view.size * 2; index += 1) {
    const top = bits - 1 - index * 4;
    // Por BYTE, e nao por nibble: e a unidade em que o dump marca o que mudou,
    // e um `mov al, 7` escreveu o byte inteiro ainda que so meio dele tenha
    // mudado de valor.
    const byte = BigInt(Math.floor((top - 3) / 8) * 8);
    cells.push({
      top,
      nibble: Number((value >> BigInt(top - 3)) & 0xfn),
      changed:
        previous !== null && ((value >> byte) & 0xffn) !== ((previous >> byte) & 0xffn),
      // Divisoria mais forte a cada 16 bits: e onde a regua marca um limite,
      // e e o agrupamento em que os manuais falam (word, dword, qword).
      boundary: index > 0 && (top + 1) % 16 === 0,
    });
  }

  const label = view.numbered && view.numbered !== view.name
    ? `${view.name.toUpperCase()} ${t("explore.or", "or")} ${view.numbered}`
    : view.name.toUpperCase();

  return (
    // O nome no proprio elemento: e por ele que o teste encontra uma view, e e
    // o que responde "que view e esta?" ao inspecionar a pagina.
    <div data-register={view.name}>
      {/* A regua so acompanha as views largas. Em 16 e 8 bits os limites sao
          os mesmos ja marcados em cima, e repeti-los seria ruido. */}
      {bits >= 32 && <Ruler cells={cells} widest={widest} />}

      <div className="flex justify-end" style={{ width: `calc(${widest / 4} * ${CELL})` }}>
        <div className="text-center" style={{ width: `calc(${bits / 4} * ${CELL})` }}>
          <span className="text-[11px] text-[#c586c0]">{label}</span>
        </div>
      </div>

      <div className="flex justify-end" style={{ width: `calc(${widest / 4} * ${CELL})` }}>
        <div className="flex border border-[#4a4a4a] bg-[#232b36]">
          {cells.map((cell) => (
            <div
              key={cell.top}
              data-changed={cell.changed ? "true" : undefined}
              style={{ width: CELL }}
              className={cn(
                "px-0.5 py-0.5 text-center tabular-nums",
                cell.top !== bits - 1 && "border-l",
                cell.boundary ? "border-l-[#6b6b6b]" : "border-l-[#3c3c3c]",
                // Byte escrito no ultimo passo: a mesma caixa vermelha do dump
                // e dos registradores. Aqui ela cobre a celula inteira porque
                // as duas linhas — bits e hexadecimal — sao o mesmo byte.
                cell.changed && "bg-[#5a1d1d] font-bold"
              )}
            >
              <div className={cell.changed ? "text-[#ff6b6b]" : "text-[#9cdcfe]"}>
                {cell.nibble.toString(2).padStart(4, "0")}
              </div>
              <div className={cell.changed ? "text-[#ff6b6b]" : "text-[#dcdcaa]"}>
                {cell.nibble.toString(16)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* O mesmo valor lido como numero, ao lado da leitura bit a bit: e a
          ponte entre o que este painel mostra e o que o resto da tela mostra.
          O `0x` e obrigatorio aqui: `41` e `65` sao o MESMO byte lido nas duas
          bases, e sem o prefixo os dois numeros so se distinguem adivinhando. */}
      <div
        className="flex justify-end gap-2 pt-1"
        style={{ width: `calc(${widest / 4} * ${CELL})` }}
      >
        <span className="text-[11px] text-[#858585]">{`0x${hex(value, view.size * 2)}`}</span>
        {/* A seta diz que os dois numeros sao O MESMO valor em duas bases, e
            nao dois valores lado a lado — a mesma leitura do "→" do painel de
            registradores e da pilha. */}
        <span className="text-[11px] text-[#6b6b6b]">{"\u2192"}</span>
        <span className="text-[11px] text-[#6a9955]">{signedDecimal(value, bits)}</span>
      </div>
    </div>
  );
}

/**
 * Regua de bits: 63, 47, 31, 15, 7 — e o 0 na ponta direita.
 *
 * Os numeros marcam o bit MAIS ALTO da celula em que estao, encostados a
 * esquerda dela, como num diagrama de manual: cada marca fica exatamente sobre
 * a divisoria que ela nomeia.
 */
function Ruler({ cells, widest }) {
  const bits = cells.length * 4;
  return (
    <div className="flex justify-end" style={{ width: `calc(${widest / 4} * ${CELL})` }}>
      <div className="relative flex" style={{ width: `calc(${bits / 4} * ${CELL})` }}>
        {cells.map((cell) => (
          <div key={cell.top} style={{ width: CELL }} className="leading-[14px]">
            {(cell.top + 1) % 16 === 0 || cell.top === 7 ? (
              <span className="border-l border-[#6b6b6b] pl-0.5 text-[10px] text-[#6b6b6b]">
                {cell.top}
              </span>
            ) : null}
          </div>
        ))}
        {/* O zero nao comeca celula nenhuma: e o bit menos significativo, na
            borda direita da ultima. */}
        <span className="absolute right-0 top-0 pr-0.5 text-[10px] leading-[14px] text-[#6b6b6b]">
          0
        </span>
      </div>
    </div>
  );
}
