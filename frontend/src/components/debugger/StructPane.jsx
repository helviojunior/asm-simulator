import React, { useEffect, useState } from "react";
import { Braces, ChevronDown, ChevronRight, X } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import { hex } from "lib/cpu/format";
import { parseStruct, previewBytes } from "lib/cpu/parseStruct";
import { isParseable, layoutOf, loadType } from "lib/types";

/**
 * Um ponteiro lido como estrutura.
 *
 * O painel de argumentos mostra que RCX vale 0x7FF7…; aqui mostra que ali ha um
 * OBJECT_ATTRIBUTES com `Length` 48 e `ObjectName` apontando para uma
 * UNICODE_STRING. E a diferenca entre ver o endereco e ver o objeto.
 *
 * Campo que aponta para outro tipo conhecido expande no lugar, seguindo o
 * ponteiro — e como se percorre uma cadeia de estruturas sem sair do painel.
 */
export default function StructPane({ machine, target, onClose, tick }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => new Set());
  const [, setLoaded] = useState(0);

  // `tick` nao e usado no corpo: existe para o painel reler a memoria a cada
  // passo, ja que a maquina muda por mutacao.
  void tick;

  const os = machine?.osId;
  const arch = machine?.archId;
  const layout = target ? layoutOf(os, arch, target.type) : null;

  useEffect(() => {
    if (target && !layout) {
      loadType(os, arch, target.type).then(() => setLoaded((n) => n + 1));
    }
  }, [target, layout, os, arch]);

  if (!machine || !target) return null;

  const toggle = (path) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const digits = machine.arch.bits === 64 ? 16 : 8;
  const nodes = layout ? parseStruct(machine, target.address, layout) : [];

  return (
    <section className="flex h-full flex-col overflow-hidden border-t border-[#3c3c3c] bg-[#252526]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] px-2 py-1.5">
        <Braces size={12} className="shrink-0 text-[#9cdcfe]" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-[#9cdcfe]">
          {target.type}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[#6b6b6b]">
          @ {hex(target.address, digits)}
          {layout && ` · ${layout.size} bytes`}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t("common.close", "Close")}
          className="ml-auto shrink-0 rounded p-0.5 text-[#6b6b6b] hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
        >
          <X size={12} />
        </button>
      </header>

      <div className="flex-1 overflow-auto py-1 font-mono text-[11px] leading-[1.6]">
        {!layout && (
          <p className="px-2 text-[#6b6b6b]">{t("common.loading", "Loading…")}</p>
        )}
        {layout?.summary && (
          <p className="px-2 pb-1 font-sans text-[10px] leading-[1.5] text-[#9a9a9a]">
            {layout.summary}
          </p>
        )}
        {nodes.map((node) => (
          <Field
            key={node.path}
            node={node}
            depth={0}
            machine={machine}
            digits={digits}
            expanded={expanded}
            onToggle={toggle}
          />
        ))}
      </div>
    </section>
  );
}

function Field({ node, depth, machine, digits, expanded, onToggle }) {
  const os = machine.osId;
  const arch = machine.archId;

  // Filhos vêm de duas origens: bloco anonimo (mesmo endereco) ou ponteiro
  // para outro tipo conhecido (endereco novo).
  const pointed =
    !node.inline && node.type && isParseable(os, arch, node.type)
      ? layoutOf(os, arch, node.type)
      : null;
  const canExpand = Boolean(node.children || pointed);
  const open = expanded.has(node.path);

  useEffect(() => {
    if (open && !node.inline && !pointed && node.type && isParseable(os, arch, node.type)) {
      loadType(os, arch, node.type);
    }
  }, [open, node.inline, node.type, pointed, os, arch]);

  const children = node.children
    ? node.children
    : open && pointed && node.value
    ? parseStruct(machine, node.value, pointed, node.path)
    : [];

  return (
    <>
      <div
        className="flex items-baseline gap-2 whitespace-pre px-2 hover:bg-[#2d2d2d]"
        style={{ paddingLeft: 8 + depth * 12 }}
        title={node.description || undefined}
      >
        <button
          type="button"
          onClick={() => canExpand && onToggle(node.path)}
          disabled={!canExpand}
          className={cn("w-3 shrink-0", canExpand ? "text-[#6b6b6b]" : "opacity-0")}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>

        <span className="w-[6ch] shrink-0 text-right text-[#6b6b6b]">+{node.offset}</span>
        <span className="w-[18ch] shrink-0 truncate text-[#4ec9b0]">{node.type}</span>
        <span className="w-[20ch] shrink-0 truncate text-[#4fc1ff]">{node.name}</span>

        {node.inline ? (
          <span className="text-[#6b6b6b]">{"{…}"}</span>
        ) : node.bytes ? (
          <span className="truncate text-[#ce9178]">&quot;{previewBytes(node.bytes)}&quot;</span>
        ) : (
          <span className="shrink-0 text-[#d4d4d4]">
            {hex(node.value ?? 0n, node.size * 2)}
          </span>
        )}
      </div>

      {open &&
        children.map((child) => (
          <Field
            key={child.path}
            node={child}
            depth={depth + 1}
            machine={machine}
            digits={digits}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}
