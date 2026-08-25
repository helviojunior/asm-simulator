import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { loadPrototypes, prototypesFor } from "lib/prototypes";

// Quantas sugestoes mostrar. Mais que isto vira uma lista que ninguem percorre.
const MAX_SUGGESTIONS = 8;

/**
 * O nome da funcao de uma chamada — resolvido automaticamente, ou dito pelo
 * aluno.
 *
 * A resolucao automatica cobre o que da: a tabela fixa no Linux, a ntdll
 * importada no Windows. Fora disso nao ha o que deduzir — e num `call` para um
 * endereco nao ha sequer numero a consultar. Quem sabe do que se trata e quem
 * esta lendo o codigo: clicar no nome (ou no lugar dele) abre um campo com
 * auto-completar sobre os prototipos que temos.
 *
 * Vale TAMBEM quando o nome ja foi resolvido: a tabela pode estar certa e o
 * aluno querer anotar outra coisa, ou a ntdll ser de outra build.
 *
 * `kind` estreita o auto-completar. O painel de syscall pede `"syscall"`:
 * oferecer `RtlInitUnicodeString` para um numero em RAX sugeriria que aquilo
 * se chama por `syscall`, e nao se chama. O painel de `call` nao filtra — ali
 * tanto o stub `Nt*` quanto a funcao de modo usuario sao alvos legitimos.
 */
export default function PrototypeNameField({
  os, arch, kind, name, origin, onChange, emptyLabel, editTitle,
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);

  // A lista chega do backend uma vez por alvo; enquanto nao chega, o campo
  // funciona e o auto-completar fica vazio.
  useEffect(() => {
    if (editing) loadPrototypes(os, arch, kind);
  }, [editing, os, arch, kind]);

  const suggestions = useMemo(() => {
    if (!editing) return [];
    const term = draft.trim().toLowerCase();
    const all = prototypesFor(os, arch, kind);
    const matches = term
      ? all.filter((item) => item.function_name.toLowerCase().includes(term))
      : all;
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [draft, editing, os, arch, kind]);

  const open = () => {
    setDraft(name || "");
    setHighlight(0);
    setEditing(true);
  };

  const commit = (value) => {
    const chosen = (value ?? draft).trim();
    setEditing(false);
    // Campo esvaziado desfaz a escolha e devolve o nome a resolucao automatica.
    onChange(chosen || null);
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        title={editTitle || t("sim.callNameEdit", "Click to name this function")}
        className={cn(
          "group flex shrink-0 items-center gap-1 rounded px-1 hover:bg-[#3c3c3c]",
          name ? "font-bold text-[#dcdcaa]" : "text-[#f14c4c]"
        )}
      >
        {name || emptyLabel || t("sim.callNameUnknown", "unnamed")}
        {/* O lapis so no hover: a linha fica limpa enquanto se le. */}
        <Pencil size={9} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    );
  }

  return (
    <span className="relative shrink-0">
      <input
        ref={inputRef}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setHighlight(0);
        }}
        // Sair do campo confirma o que esta escrito, como o resto da interface.
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit(suggestions[highlight]?.function_name ?? draft);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((current) => {
              const total = suggestions.length || 1;
              return (current + step + total) % total;
            });
          }
        }}
        className="w-[26ch] rounded border border-[#0e639c] bg-[#3c3c3c] px-1 font-mono text-[12px] text-[#d4d4d4] outline-none"
      />

      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-20 mt-0.5 max-h-48 w-[34ch] overflow-auto rounded border border-[#454545] bg-[#252526] py-1 shadow-lg shadow-black/40">
          {suggestions.map((item, index) => (
            <li key={item.function_name}>
              <button
                type="button"
                // `mousedown` e nao `click`: o blur do input dispara antes do
                // click e fecharia a lista sem registrar a escolha.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(item.function_name);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex w-full flex-col items-start px-2 py-0.5 text-left",
                  index === highlight ? "bg-[#094771]" : "hover:bg-[#2d2d2d]"
                )}
              >
                <span className="font-mono text-[12px] text-[#dcdcaa]">
                  {item.function_name}
                  {item.ssn !== null && item.ssn !== undefined && (
                    <span className="ml-2 text-[10px] text-[#6b6b6b]">#{item.ssn}</span>
                  )}
                  {/* Sem numero, o que distingue as duas listas e a natureza da
                      funcao: `RtlInitUnicodeString` nao entra no kernel. */}
                  {item.kind === "function" && (
                    <span className="ml-2 text-[10px] text-[#6a9955]">
                      {t("sim.protoUserMode", "user mode")}
                    </span>
                  )}
                </span>
                {item.summary && (
                  <span className="truncate text-[10px] text-[#9a9a9a]">{item.summary}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Sem sugestao: o campo continua valendo — um nome que nao esta nos
          nossos prototipos ainda e uma anotacao util. */}
      {suggestions.length === 0 && draft.trim() && (
        <span className="absolute left-0 top-full z-20 mt-0.5 whitespace-nowrap rounded border border-[#454545] bg-[#252526] px-2 py-0.5 text-[10px] text-[#6b6b6b]">
          {t("sim.syscallNameFree", "Enter to use this name")}
        </span>
      )}

      {origin === "manual" && (
        <span className="sr-only">{t("sim.syscallNameManual", "named by you")}</span>
      )}
    </span>
  );
}
