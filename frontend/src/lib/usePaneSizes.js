import { useCallback, useState } from "react";

/**
 * Tamanhos dos paineis do debugger, persistidos entre sessoes.
 *
 * Quem ajusta a divisoria espera encontra-la no mesmo lugar ao voltar — e o
 * layout de um debugger e preferencia pessoal, nao configuracao do projeto.
 * Por isso vive no localStorage do proprio navegador.
 */
const STORAGE_KEY = "simulator.paneSizes";

export function usePaneSizes(defaults) {
  const [sizes, setSizes] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...defaults, ...stored };
    } catch {
      // Modo privado, storage desabilitado, JSON corrompido: os padroes bastam.
      return defaults;
    }
  });

  /**
   * Soma `delta` ao tamanho de um painel, respeitando os limites.
   *
   * O clamp e essencial: sem ele, arrastar demais deixa um painel com altura
   * negativa e o layout inteiro colapsa.
   */
  const resize = useCallback((key, delta, { min = 60, max = 2000 } = {}) => {
    setSizes((current) => {
      const next = { ...current, [key]: Math.max(min, Math.min(max, current[key] + delta)) };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Nao poder persistir nao pode impedir o redimensionamento.
      }
      return next;
    });
  }, []);

  return [sizes, resize];
}
