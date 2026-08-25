import React from "react";
import { Link2 } from "lucide-react";
import { useI18n } from "i18n";
import { hex } from "lib/cpu/format";
import { describePointer } from "lib/cpu/inspect";

/**
 * Uma posicao de argumento: de onde vem, que valor tem, e — se for ponteiro —
 * o que ha do outro lado.
 *
 * Compartilhado pelos paineis de `call` e de syscall: as duas leituras sao a
 * mesma, e duplicar o componente faria uma delas divergir na primeira vez que
 * o realce de ponteiro mudasse.
 *
 * `name` e opcional: existe quando o prototipo e conhecido (o caso das
 * syscalls), e ai a coluna mostra `buf` em vez de so o registrador.
 */
export default function ArgumentRow({ machine, arg, digits, name, type, description }) {
  const { t } = useI18n();
  const pointer = describePointer(machine, arg.value);

  return (
    <div
      className="flex items-baseline gap-2 whitespace-pre px-2 hover:bg-[#2d2d2d]"
      // A descricao inteira no title: a linha e estreita, e truncar o texto
      // util seria pior que escondê-lo atras do ponteiro do mouse.
      title={description || undefined}
    >
      <span className="w-6 shrink-0 text-[#6b6b6b]">{arg.index + 1}:</span>
      <span className="w-[14ch] shrink-0 text-[#c586c0]">{arg.source}</span>
      {/* O TIPO vem do prototipo. E o que diz se aquele numero e um contador ou
          um ponteiro para uma estrutura. */}
      {type && <span className="w-[16ch] shrink-0 truncate text-[#4ec9b0]">{type}</span>}
      {name && <span className="w-[14ch] shrink-0 truncate text-[#4fc1ff]">{name}</span>}
      <span className="shrink-0 text-[#d4d4d4]">{hex(arg.value, digits)}</span>

      {/* Marcador visual de ponteiro: o icone diz "isto aponta para algo",
          antes mesmo de o aluno ler o que vem depois. */}
      {pointer.isPointer ? (
        <>
          <Link2 size={11} className="shrink-0 text-[#4ec9b0]" />
          <span className="shrink-0 text-[#4ec9b0]">
            {pointer.region || t("sim.ptrMemory", "mem")}
          </span>
          {pointer.string !== null && pointer.string !== undefined ? (
            <span className="truncate text-[#ce9178]">&quot;{pointer.string}&quot;</span>
          ) : (
            <span className="shrink-0 text-[#6a9955]">
              → {hex(pointer.target ?? 0n, digits)}
            </span>
          )}
        </>
      ) : (
        <span className="shrink-0 text-[10px] text-[#6b6b6b]">
          {BigInt.asIntN(machine.arch.bits, BigInt(arg.value)).toString(10)}
        </span>
      )}
    </div>
  );
}
