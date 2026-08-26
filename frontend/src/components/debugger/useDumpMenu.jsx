import React from "react";
import { MemoryStick } from "lucide-react";
import { useI18n } from "i18n";
import { hex } from "lib/cpu/format";
import { isMappedAddress } from "lib/cpu/inspect";
import { ContextMenu, useContextMenu } from "components/ui/contextMenu";

/**
 * Menu de contexto "ver no dump", compartilhado por todos os paineis que
 * mostram enderecos.
 *
 * Um mesmo gesto — clique direito sobre um valor — leva o dump ate ele, venha
 * o valor de um registrador, de uma palavra da pilha, de um argumento ou de um
 * campo de estrutura. Duplicar isso em cada painel faria a lista divergir na
 * primeira vez que um deles ganhasse um item novo.
 *
 * Uso:
 *
 *   const { openDumpMenu, dumpMenu } = useDumpMenu(machine, onViewInDump);
 *   <div onContextMenu={(e) => openDumpMenu(e, [{ label: "EAX", address: value }])}>
 *   {dumpMenu}
 *
 * So entram na lista os enderecos com memoria de verdade atras (`isMappedAddress`):
 * oferecer o salto para um contador de laco levaria o dump a um endereco vazio
 * e ensinaria que qualquer inteiro e um ponteiro.
 */
export function useDumpMenu(machine, onViewInDump) {
  const { t } = useI18n();
  const { menu, openMenu, closeMenu } = useContextMenu();
  const digits = machine?.arch.bits === 64 ? 16 : 8;

  const openDumpMenu = (event, entries) => {
    // Sem destino nao ha menu: o painel de dump pode nem estar montado.
    if (!onViewInDump || !machine) return;
    const valid = (entries || []).filter(
      (entry) => entry && isMappedAddress(machine, entry.address)
    );
    openMenu(event, valid);
  };

  const items =
    menu?.payload?.length > 0
      ? menu.payload.map((entry, index) => ({
          key: `${entry.label}-${index}`,
          icon: MemoryStick,
          // Com um destino so, o rotulo do valor seria repetir o que ja esta
          // embaixo do cursor; com varios, e ele que distingue os itens.
          label:
            menu.payload.length > 1
              ? `${t("dump.viewIn", "Follow in dump")}: ${entry.label} → ${hex(entry.address, digits)}`
              : `${t("dump.viewIn", "Follow in dump")} → ${hex(entry.address, digits)}`,
          onSelect: () => onViewInDump(entry.address),
        }))
      : [
          {
            key: "none",
            // Dito, e nao um menu que nao abre: silencio pareceria falha.
            label: t("dump.noAddressHere", "No memory address here"),
            disabled: true,
            onSelect: () => {},
          },
        ];

  const dumpMenu = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />
  ) : null;

  return { openDumpMenu, dumpMenu };
}

export default useDumpMenu;
