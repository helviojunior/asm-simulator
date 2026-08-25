import React, { useCallback, useRef } from "react";
import { cn } from "lib/utils";

/**
 * Divisoria arrastavel entre dois paineis.
 *
 * Usa Pointer Events com `setPointerCapture`: uma vez capturado, o ponteiro
 * continua reportando movimento mesmo quando sai da barra — sem isso, arrastar
 * rapido "solta" a divisoria no meio do caminho.
 *
 * O delta e enviado de forma INCREMENTAL (diferenca desde o ultimo evento) em
 * vez de absoluta. Assim quem recebe apenas soma, e o clamp de tamanho minimo
 * nao faz a barra "escapar" do cursor.
 */
export default function Splitter({ direction = "horizontal", onResize, label }) {
  const last = useRef(null);
  const isVertical = direction === "vertical";

  const handlePointerDown = useCallback((event) => {
    event.preventDefault();
    last.current = isVertical ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [isVertical]);

  const handlePointerMove = useCallback((event) => {
    if (last.current === null) return;
    const current = isVertical ? event.clientX : event.clientY;
    const delta = current - last.current;
    if (delta === 0) return;
    last.current = current;
    onResize(delta);
  }, [isVertical, onResize]);

  const handlePointerUp = useCallback((event) => {
    last.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Teclado: a divisoria e um `separator` focavel, entao quem nao usa mouse
  // tambem consegue redimensionar.
  const handleKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 40 : 8;
    const decrease = isVertical ? "ArrowLeft" : "ArrowUp";
    const increase = isVertical ? "ArrowRight" : "ArrowDown";
    if (event.key === decrease) {
      event.preventDefault();
      onResize(-step);
    } else if (event.key === increase) {
      event.preventDefault();
      onResize(step);
    }
  }, [isVertical, onResize]);

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className={cn(
        "shrink-0 bg-[#3c3c3c] transition-colors hover:bg-[#0e639c] focus:bg-[#0e639c] focus:outline-none",
        // A barra visivel tem 1px, mas a area de agarre tem 5px: mirar em 1px
        // com o mouse e sofrido.
        isVertical
          ? "w-px cursor-col-resize border-x-2 border-transparent bg-clip-padding"
          : "h-px cursor-row-resize border-y-2 border-transparent bg-clip-padding"
      )}
      style={isVertical ? { width: 5 } : { height: 5 }}
    />
  );
}
