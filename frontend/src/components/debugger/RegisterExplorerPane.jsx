import React, { useMemo } from "react";
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
export default function RegisterExplorerPane({ machine, register, tick = 0 }) {
  const { t } = useI18n();

  const canonical = register ? canonicalName(register) : null;

  const views = useMemo(() => {
    if (!machine || !canonical) return [];
    return registerViews(canonical, machine.arch.bits).map((view) => ({
      ...view,
      value: machine.cpu.readRegister(view.name),
    }));
    // `tick` entra porque a CPU muda por MUTACAO e nao troca de identidade:
    // sem ele o painel mostraria os bits do primeiro render para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, canonical, tick]);

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
      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px]">
        {/* Largura minima da area: a linha mais larga nao pode ser quebrada,
            ou o alinhamento entre as views — que e o assunto — se perde. */}
        <div
          className="flex flex-col gap-6"
          style={{ minWidth: `calc(${widest / 4} * ${CELL})`, width: "max-content" }}
        >
          {views.map((view) => (
            <View key={view.name} view={view} widest={widest} t={t} />
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
 * Uma view do registrador: regua, rotulo e a fileira de nibbles.
 *
 * `widest` e a largura da view MAIOR desta tela, em bits. Todas as linhas
 * reservam essa largura e desenham os proprios nibbles encostados a direita —
 * e assim que AL cai debaixo dos oito bits baixos de RAX.
 */
function View({ view, widest, t }) {
  const bits = view.size * 8;
  const value = BigInt.asUintN(bits, BigInt(view.value));

  const cells = [];
  for (let index = 0; index < view.size * 2; index += 1) {
    const top = bits - 1 - index * 4;
    cells.push({
      top,
      nibble: Number((value >> BigInt(top - 3)) & 0xfn),
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
              style={{ width: CELL }}
              className={cn(
                "px-0.5 py-0.5 text-center tabular-nums",
                cell.top !== bits - 1 && "border-l",
                cell.boundary ? "border-l-[#6b6b6b]" : "border-l-[#3c3c3c]"
              )}
            >
              <div className="text-[#9cdcfe]">{cell.nibble.toString(2).padStart(4, "0")}</div>
              <div className="text-[#dcdcaa]">{cell.nibble.toString(16)}</div>
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
