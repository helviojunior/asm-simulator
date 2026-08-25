import React, { useEffect } from "react";
import { Terminal } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { hex } from "lib/cpu/format";
import { syscallInvocation } from "lib/cpu/inspect";
import ArgumentRow from "components/debugger/ArgumentRow";
import SyscallNameField from "components/debugger/SyscallNameField";
import { setSyscallName } from "lib/cpu/syscallNames";
import { loadPrototype } from "lib/prototypes";

/**
 * A chamada de sistema prestes a acontecer.
 *
 * Irmao do painel de `call`, para a outra forma de chamar codigo alheio. A
 * diferenca esta no que da para afirmar: num `call` a aridade e desconhecida,
 * mas aqui o numero em EAX/RAX identifica a funcao — entao o painel mostra o
 * NOME dela e o nome de cada parametro.
 *
 * O numero e o ponto que mais confunde quem escreve shellcode: `write` e 4 em
 * `int 0x80` e 1 em `syscall`. Por isso a resolucao numero -> nome fica na
 * primeira linha, e nao escondida num tooltip.
 */
export default function SyscallPane({ machine, count, tick, onImportNtdll, onNameChange, onParse }) {
  const { t, tf } = useI18n();

  // A maquina muda por mutacao; `tick` forca o recalculo a cada passo.
  void tick;

  const call =
    machine && !machine.halted ? syscallInvocation(machine, { count }) : null;

  // Busca o prototipo da funcao resolvida. Vem do catalogo YAML e traz tipo e
  // descricao de cada argumento — e o que faz os campos se atualizarem quando o
  // aluno escolhe outra funcao. Hook antes de qualquer `return`: a regra dos
  // hooks nao admite chamada condicional.
  const resolvedName = call?.name || null;
  const target = call?.os || null;
  useEffect(() => {
    if (resolvedName && target) loadPrototype(target, machine.archId, resolvedName)
      .then((found) => { if (found) onNameChange?.(); });
  }, [resolvedName, target, machine?.archId, onNameChange]);

  // Parado, a instrucao sob o ponteiro nunca vai executar: anunciar a chamada
  // sugeriria que ela ainda vai acontecer. Sem `call`, a instrucao atual nao e
  // porta de kernel e o painel inteiro nao tem o que dizer.
  if (!machine || machine.halted || !call) return null;

  const digits = machine.arch.bits === 64 ? 16 : 8;
  const numberDigits = digits;

  return (
    <section className="flex h-full flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-3 py-1.5">
        <Terminal size={12} className="shrink-0 text-[#9cdcfe]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {t("sim.syscall", "System call")}
        </span>
        {/* Qual TABELA esta em uso. O numero sozinho nao quer dizer nada: 4 e
            `write` no int 0x80 do Linux e `close` no syscall de 64 bits. */}
        <span className="ml-auto truncate rounded bg-[#3c3c3c] px-1.5 py-0.5 font-mono text-[10px] text-[#d4d4d4]">
          {call.via} · {call.table}
        </span>
      </header>

      <div className="flex-1 overflow-auto py-1 text-[12px] leading-[1.6]">
        {/* Numero -> funcao. */}
        <div className="flex items-baseline gap-2 whitespace-pre border-b border-[#3c3c3c] px-2 pb-1">
          <span className="w-6 shrink-0 text-[#6b6b6b]">#</span>
          <span className="w-[14ch] shrink-0 uppercase text-[#c586c0]">
            {call.numberRegister}
          </span>
          <span className="shrink-0 text-[#d4d4d4]">{hex(call.raw, numberDigits)}</span>
          {/* No macOS o valor no registrador carrega a classe UNIX somada; o
              numero que a tabela indexa e o que sobra. Mostrar os dois lado a
              lado e o que explica o 0x2000000. */}
          {call.number !== Number(call.raw) && (
            <span className="shrink-0 text-[#6b6b6b]">
              (#{call.number})
            </span>
          )}
          <span className="shrink-0 text-[#6b6b6b]">→</span>
          {/* O nome e editavel SEMPRE, resolvido ou nao: a tabela pode estar
              certa e o aluno querer anotar outra coisa, ou a ntdll ser de outra
              build. Clicar abre um campo com auto-completar. */}
          <SyscallNameField
            os={call.os}
            arch={machine.archId}
            number={call.number}
            name={call.name}
            origin={call.origin}
            onChange={(chosen) => {
              setSyscallName(call.os, machine.archId, call.number, chosen);
              onNameChange?.();
            }}
          />
          <span
            className={cn(
              "ml-auto shrink-0 text-[10px]",
              call.simulated ? "text-[#6a9955]" : "text-[#dcdcaa]"
            )}
          >
            {call.simulated
              ? t("sim.syscallSimulated", "simulated")
              : t("sim.syscallNotSimulated", "stops execution")}
          </span>
        </div>

        {call.args.map((arg) => (
          <ArgumentRow
            key={arg.index}
            machine={machine}
            arg={arg}
            digits={digits}
            onParse={onParse}
            name={call.known ? arg.name : null}
            type={arg.type}
            description={arg.description}
          />
        ))}

        {/* De ONDE veio o nome. Separa "isto e NtCreateFile" de "isto e
            NtCreateFile naquela build" e de "voce disse que e". */}
        {call.origin === "ntdll" && call.source && (
          <p className="px-2 pt-1 text-[10px] text-[#6a9955]">
            {tf("sim.syscallFromNtdll", { origin: call.source }, "resolved by {origin}")}
          </p>
        )}
        {call.origin === "manual" && (
          <p className="px-2 pt-1 text-[10px] text-[#6a9955]">
            {t("sim.syscallNameManual", "named by you")}
          </p>
        )}

        {call.needsNtdll && (
          <div className="px-2 pt-1 text-[10px] text-[#dcdcaa]">
            <p>
              {t(
                "sim.syscallWindowsHint",
                "Windows has no stable syscall number: the SSN changes between builds, and the usual path goes through the DLLs (kernel32 → ntdll), not through this instruction."
              )}
            </p>
            <button
              type="button"
              onClick={onImportNtdll}
              className="mt-0.5 underline decoration-dotted hover:text-[#9cdcfe]"
            >
              {t("ntdll.offerConfirm", "Import ntdll.dll")}
            </button>
          </div>
        )}

        {call.resolvable && !call.known && call.name && (
          <p className="px-2 pt-1 text-[10px] text-[#6b6b6b]">
            {t("sim.syscallNoPrototype", "No known prototype — showing the argument registers.")}
          </p>
        )}
      </div>
    </section>
  );
}
