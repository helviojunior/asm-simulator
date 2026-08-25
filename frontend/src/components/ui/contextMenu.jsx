import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "lib/utils";

/**
 * Menu de contexto ancorado no cursor.
 *
 * Em portal, como os modais do sistema: dentro da arvore o menu seria cortado
 * pelo `overflow: auto` do painel — o item de baixo simplesmente sumiria.
 *
 * `items` e uma lista de `{ key, label, icon, onSelect, danger, disabled }`;
 * `{ separator: true }` desenha uma divisoria.
 */
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Reposiciona quando o menu nasceria fora da janela — perto da borda de
  // baixo, que e onde o clique direito acontece com mais frequencia.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      onClose();
    };
    // `mousedown` e nao `click`: fechar so no click deixaria o menu aberto
    // enquanto o botao esta pressionado em outro lugar.
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismiss);
    window.addEventListener("resize", dismiss);
    // Rolar o painel embaixo levaria o menu para longe do item que o abriu.
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      // O mousedown proprio nao pode chegar ao `window`, senao o menu fecharia
      // antes de o clique virar selecao.
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[100] min-w-[190px] rounded border border-[#454545] bg-[#252526] py-1 font-mono text-[12px] text-[#d4d4d4] shadow-lg shadow-black/40"
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="my-1 border-t border-[#3c3c3c]" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1 text-left transition-colors",
              item.disabled
                ? "cursor-not-allowed text-[#5a5a5a]"
                : item.danger
                ? "text-[#f14c4c] hover:bg-[#5a1d1d]"
                : "hover:bg-[#094771]"
            )}
          >
            {item.icon ? <item.icon size={13} className="shrink-0" /> : <span className="w-[13px]" />}
            <span className="truncate">{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  );
}

/**
 * Estado de um menu de contexto: onde abriu e sobre o que.
 *
 * Devolve `{ menu, openMenu, closeMenu }` — `openMenu(event, payload)` ja faz o
 * preventDefault do menu nativo do navegador.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState(null);

  const openMenu = (event, payload) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, payload });
  };

  return { menu, openMenu, closeMenu: () => setMenu(null) };
}

export default ContextMenu;
