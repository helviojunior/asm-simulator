import React from "react";
import { ExternalLink, Github, Globe, Info } from "lucide-react";
import { Modal } from "components/ui/modal";
import { Button } from "components/ui/button";
import brand from "lib/brand";
import { useI18n } from "i18n";

// Links do autor. Ficam aqui, e nao no brand: sao a autoria do projeto, nao a
// identidade visual configuravel por ambiente.
const AUTHOR = {
  name: "Helvio Junior",
  site: "https://helviojunior.com.br/",
  github: "https://github.com/helviojunior/",
};

/**
 * "Sobre": quem fez, e — o que importa mais numa ferramenta de ensino — o que
 * ela NAO faz.
 *
 * O simulador se parece o suficiente com um debugger de verdade para alguem
 * concluir que esta executando o programa. Nao esta: o codigo e interpretado
 * por um modelo de CPU em JavaScript, para mostrar registradores e pilha
 * mudando passo a passo. Dizer isso em voz alta e o proposito deste modal.
 */
export default function AboutModal({ open, onClose }) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("about.title", "About ASMSimulator")}
      footer={
        <Button onClick={onClose}>{t("common.close", "Close")}</Button>
      }
    >
      <div className="space-y-4 text-left">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("about.authorTitle", "Author")}
          </h3>
          <p className="mt-1 font-medium">{AUTHOR.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <AuthorLink href={AUTHOR.site} icon={Globe} label="helviojunior.com.br" />
            <AuthorLink href={AUTHOR.github} icon={Github} label="github.com/helviojunior" />
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("about.purposeTitle", "What this is")}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {t(
              "about.purposeBody",
              "An academic simulator. It does not run Assembly: the instructions are interpreted by a CPU model written in JavaScript, so you can watch registers, flags, the stack and memory change one step at a time."
            )}
          </p>
        </section>

        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            {t("about.limitsTitle", "What this is not")}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {t(
              "about.limitsBody",
              "It is not a code validator, an emulator, or an execution environment. Only part of the instruction set is covered, system calls are not performed, and a program that works here may behave differently on a real machine — and the other way round. Never take a result from this simulator as proof that a program is correct."
            )}
          </p>
        </section>

        <p className="text-xs text-muted-foreground">
          {brand.name} {brand.version}
        </p>
      </div>
    </Modal>
  );
}

function AuthorLink({ href, icon: Icon, label }) {
  return (
    <a
      href={href}
      target="_blank"
      // noreferrer junto de noopener: sem ele a pagina de destino recebe a URL
      // de origem no Referer.
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
    </a>
  );
}

/** Botao discreto que abre o modal — pensado para o canto da barra superior. */
export function AboutButton({ onClick }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("about.title", "About ASMSimulator")}
      aria-label={t("about.title", "About ASMSimulator")}
      className="rounded p-1 text-[#6b6b6b] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
    >
      <Info size={14} />
    </button>
  );
}
