/**
 * Copia para a area de transferencia.
 *
 * `navigator.clipboard` NAO serve sozinho aqui: a API so existe em contexto
 * seguro, e o simulador e servido em HTTP puro (o nginx nao termina TLS —
 * ver a regra 9.3 do projeto). Fora de `localhost`, `navigator.clipboard` e
 * `undefined` e a copia falharia em silencio justamente na maquina do aluno.
 *
 * Por isso o caminho antigo — `document.execCommand("copy")` sobre um
 * textarea fora da tela — continua sendo o padrao real de funcionamento, e
 * nao um detalhe de compatibilidade.
 */
export async function copyText(text) {
  const value = String(text ?? "");
  if (value === "") return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permissao negada ou contexto inseguro: cai no caminho de baixo.
    }
  }

  return legacyCopy(value);
}

/**
 * Copia pelo `execCommand`, que exige que o texto esteja SELECIONADO num
 * elemento do documento — dai o textarea temporario.
 */
function legacyCopy(value) {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const field = document.createElement("textarea");
  field.value = value;
  // `readOnly` evita o teclado virtual no iOS; a posicao fixa no canto evita
  // que a pagina role ate o elemento no momento do foco.
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(field);

  // Quem estava selecionado antes volta a estar: copiar do dump nao pode
  // apagar a selecao que o usuario tinha no editor.
  const previous = document.activeElement;
  let ok = false;
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    field.remove();
    if (previous && typeof previous.focus === "function") previous.focus();
  }
  return ok;
}

export default copyText;
