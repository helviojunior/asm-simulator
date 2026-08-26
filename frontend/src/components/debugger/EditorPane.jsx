import React, { useEffect, useState } from "react";
import { Binary, Code2, Library, MemoryStick, Save, X } from "lucide-react";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import SourcePane from "components/debugger/SourcePane";
import LibraryPane from "components/debugger/LibraryPane";
import DumpPane from "components/debugger/DumpPane";
import RegisterExplorerPane from "components/debugger/RegisterExplorerPane";

// Rotulo do atalho: no macOS o modificador e o Cmd.
const SAVE_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "")
    ? "⌘S"
    : "Ctrl+S";

/**
 * Painel inferior esquerdo: editor de codigo-fonte e biblioteca, em abas.
 *
 * As duas dividem o mesmo espaco de propósito — a biblioteca existe para
 * alimentar o editor, e ve-las lado a lado tiraria largura justamente de onde
 * o codigo e lido.
 */
export default function EditorPane({
  source, onSourceChange, messages, busy, currentLine, openFile, onOpenFileChange,
  // Parametros de execucao atuais e o que fazer com os do arquivo aberto.
  params, onOpenFile,
  // Salvamento: `dirty` diz se ha algo pendente, `onSave` grava no arquivo
  // aberto, e `saveAs` e o pedido de nomear um arquivo novo.
  dirty, onSave, onSaved, saveAs = false, onSaveAsHandled, savedTick = 0, onImported,
  // Sobe a cada acao de execucao: traz o fonte do programa em execucao a vista.
  focusSource = 0,
  // Guarda assincrona: a biblioteca a consulta ANTES de ler o arquivo.
  onBeforeOpen, onCloseFile, onImportBinary,
  // Dump de memoria: a maquina, os bytes escritos no ultimo passo e o pedido
  // de "ver no dump" vindo dos outros paineis.
  machine, changedMemory = [], dumpTarget = null, tick = 0,
  // Registrador a explorar bit a bit, pedido pelo painel de registradores.
  exploreTarget = null, onCloseExplore,
}) {
  const { t } = useI18n();
  // A biblioteca abre primeiro: com o editor vazio, o caminho natural de quem
  // chega e abrir um programa guardado, nao encarar uma tela em branco.
  const [tab, setTab] = useState("library");

  // Pastas abertas e pasta selecionada moram aqui, e nao na biblioteca: ela
  // desmonta ao trocar de aba, e a arvore voltaria toda fechada a cada ida ao
  // codigo-fonte.
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedFolder, setSelectedFolder] = useState(null);

  // Comeca em 0 e so cresce: na montagem o efeito nao faz nada, e cada passo
  // (ou montagem, ou reinicio) depois disso traz o codigo para a frente.
  //
  // So SAI da biblioteca: quem esta no dump acompanhando a memoria mudar
  // escolheu aquela aba, e devolve-lo ao codigo a cada passo tiraria da vista
  // justamente o que ele foi olhar.
  useEffect(() => {
    if (focusSource) setTab((current) => (current === "library" ? "source" : current));
  }, [focusSource]);

  // "Salvar como" precisa da arvore: e la que se escolhe a pasta e se digita o
  // nome. Salvar num arquivo JA aberto nao troca de aba nenhuma.
  useEffect(() => {
    if (saveAs) setTab("library");
  }, [saveAs]);

  // Erro de montagem aparece ANCORADO na linha, dentro do painel do fonte —
  // com a biblioteca aberta por padrao, ninguem o veria sem esta troca de aba.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (hasMessages) setTab("source");
  }, [hasMessages, messages]);

  // "Ver no dump" pedido de outro painel: a aba vem para a frente sozinha.
  // Sem isto o salto aconteceria numa aba escondida e pareceria nao ter
  // acontecido. O `nonce` faz o mesmo endereco poder ser pedido duas vezes.
  const dumpNonce = dumpTarget?.nonce ?? 0;
  useEffect(() => {
    if (dumpNonce) setTab("dump");
  }, [dumpNonce]);

  // "Explorar" pedido no menu do registrador: mesma logica do dump. O `nonce`
  // faz explorar o MESMO registrador duas vezes trazer a aba de volta.
  const exploreNonce = exploreTarget?.nonce ?? 0;
  useEffect(() => {
    if (exploreNonce) setTab("explore");
  }, [exploreNonce]);

  // Aba fechada com a aba aberta: sem isto o painel ficaria sem conteudo, ja
  // que `tab` continuaria apontando para o que nao existe mais.
  const exploring = exploreTarget?.register || null;
  useEffect(() => {
    if (!exploring) setTab((current) => (current === "explore" ? "source" : current));
  }, [exploring]);

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <div className="flex shrink-0 items-center border-b border-[#3c3c3c]">
        <Tab
          icon={Library}
          label={t("library.title", "Library")}
          active={tab === "library"}
          onClick={() => setTab("library")}
        />
        <Tab
          icon={Code2}
          label={t("sim.source", "Source (NASM)")}
          active={tab === "source"}
          onClick={() => setTab("source")}
        />
        <Tab
          icon={MemoryStick}
          label={t("dump.title", "Dump")}
          active={tab === "dump"}
          onClick={() => setTab("dump")}
        />
        {/* A aba do explorador so existe depois de pedida, e a direita do
            dump: e uma vista aberta sob demanda, nao uma parte fixa do
            painel. Fechavel pelo mesmo motivo. */}
        {exploring && (
          <div className="flex items-center">
            <Tab
              icon={Binary}
              label={`${t("explore.title", "Explore")} ${exploring.toUpperCase()}`}
              active={tab === "explore"}
              onClick={() => setTab("explore")}
            />
            <button
              type="button"
              onClick={onCloseExplore}
              title={t("explore.close", "Close explorer")}
              aria-label={t("explore.close", "Close explorer")}
              className="-ml-2 mr-1 rounded p-0.5 text-[#6b6b6b] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* O arquivo aberto vale nas duas abas: e o destino do "salvar". */}
        {openFile && (
          <span className="ml-auto truncate pl-3 text-[11px] text-[#6a9955]">
            {openFile.name}
          </span>
        )}
        {/* Fechar: devolve o editor em branco. Aparece havendo arquivo aberto
            ou codigo escrito — nos dois casos ha o que limpar. */}
        {(openFile || source) && (
          <button
            type="button"
            onClick={onCloseFile}
            title={t("sim.closeFile", "Close file")}
            aria-label={t("sim.closeFile", "Close file")}
            className={cn(
              "rounded p-1 text-[#6b6b6b] transition-colors hover:bg-[#3c3c3c] hover:text-[#d4d4d4]",
              openFile ? "ml-1 mr-2" : "ml-auto mr-2"
            )}
          >
            <X size={13} />
          </button>
        )}
        {tab === "source" && currentLine && (
          <span className={cn("px-3 text-[10px] text-[#6a9955]", openFile && "ml-0")}>
            {t("sim.line", "line")} {currentLine}
          </span>
        )}

        {/* Salvar sem sair da aba: escrever o programa e guarda-lo sao o mesmo
            gesto. So fica ativo havendo algo pendente. */}
        {tab === "source" && (
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty}
            title={`${
              openFile
                ? t("library.save", "Save to open file")
                : t("library.saveAs", "Save to a new file")
            } (${SAVE_SHORTCUT})`}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors",
              !openFile && !currentLine && "ml-auto",
              busy || !dirty
                ? "cursor-not-allowed text-[#5a5a5a]"
                : "text-[#d4d4d4] hover:text-[#9cdcfe]"
            )}
          >
            <Save size={13} />
            {t("common.save", "Save")}
            {/* O ponto marca alteracao pendente, como em qualquer editor. */}
            {dirty && openFile && <span className="text-[#dcdcaa]">●</span>}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "explore" ? (
          <RegisterExplorerPane machine={machine} register={exploring} tick={tick} />
        ) : tab === "dump" ? (
          <DumpPane
            machine={machine}
            changed={changedMemory}
            target={dumpTarget}
            tick={tick}
          />
        ) : tab === "source" ? (
          <SourcePane
            source={source}
            onChange={onSourceChange}
            messages={messages}
            disabled={busy}
            currentLine={currentLine}
            hideHeader
          />
        ) : (
          <LibraryPane
            source={source}
            openFile={openFile}
            onOpen={(text, fileParams) => {
              // Abrir um arquivo leva para o editor: o proximo gesto e ler ou
              // montar o codigo, nao continuar navegando na arvore.
              onOpenFile(text, fileParams);
              setTab("source");
            }}
            onOpenFileChange={onOpenFileChange}
            onBeforeOpen={onBeforeOpen}
            params={params}
            dirty={dirty}
            onSave={onSave}
            onSaved={onSaved}
            saveAs={saveAs}
            onSaveAsHandled={onSaveAsHandled}
            savedTick={savedTick}
            onImported={onImported}
            onImportBinary={onImportBinary}
            expanded={expanded}
            onExpandedChange={setExpanded}
            selectedFolder={selectedFolder}
            onSelectedFolderChange={setSelectedFolder}
          />
        )}
      </div>
    </section>
  );
}

function Tab({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
        active
          ? "border-[#0e639c] text-[#9cdcfe]"
          : "border-transparent text-[#6b6b6b] hover:text-[#d4d4d4]"
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
