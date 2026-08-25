import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Binary, ChevronDown, ChevronRight, Download, File, FilePlus, FileUp, Folder,
  FolderOpen, FolderPlus, Pencil, Save, Trash2, Upload,
} from "lucide-react";
import { useI18n } from "i18n";
import { useDialog } from "contexts/DialogContext";
import { cn } from "lib/utils";
import { ContextMenu, useContextMenu } from "components/ui/contextMenu";
import { OS, osIcon } from "lib/cpu/os";
import {
  BUNDLE_EXTENSION, KIND, buildTree, createNode, deleteNode, exportLibrary,
  fromParams, importLibrary, listNodes, readNode, toParams, updateNode,
} from "lib/library";

// Tipo MIME proprio para o arrasto interno. E o que distingue "mover um item da
// arvore" de "soltar um arquivo do sistema": os dois chegam no mesmo `drop`.
const NODE_MIME = "application/x-asm-library-node";

// Teto do upload, alinhado com o MAX_SOURCE_BYTES do backend.
const MAX_UPLOAD_BYTES = 256 * 1024;

// O que se pode soltar aqui: fonte avulso ou a biblioteca inteira empacotada.
// Qualquer outra coisa e recusada com o nome do arquivo — aceitar em silencio
// criaria um ".asm" com o conteudo de um PDF dentro.
const SOURCE_FILE = /\.(asm|s|inc)$/i;
const BUNDLE_FILE = /\.scasmlib$/i;

/**
 * Biblioteca de programas: pastas e arquivos .asm do aluno.
 *
 * Renomear e criar acontecem NA PROPRIA LINHA, com um input inline, em vez de
 * abrir um modal para cada nome — e o comportamento de qualquer gerenciador de
 * arquivos, e evita interromper o fluxo a cada item criado.
 *
 * Tres gestos movem material para dentro: arrastar um item para outra pasta,
 * soltar um arquivo do sistema, e importar um bundle inteiro pelo menu de
 * contexto.
 */
export default function LibraryPane({
  source, openFile, onOpen, onOpenFileChange, onBeforeOpen,
  // Parametros de execucao atuais — vao junto no salvamento.
  params,
  // Salvamento: quem grava no arquivo aberto e o pai (a barra de status e dele);
  // aqui so se conduz o "salvar como", que precisa da arvore para nomear.
  dirty, onSave, onSaved, saveAs = false, onSaveAsHandled, savedTick = 0,
  // Avisa quantos itens um import trouxe — vira mensagem na barra de status.
  onImported,
  // Abre o wizard de import de binario. Mora aqui, e nao na barra de comandos,
  // porque e um jeito de TRAZER material para dentro — vizinho do import de
  // biblioteca, e nao dos comandos de execucao.
  onImportBinary,
  // Pastas abertas e pasta selecionada vivem NO PAI: este painel desmonta ao
  // trocar de aba, e o estado morreria junto (a arvore reabriria fechada).
  expanded, onExpandedChange, selectedFolder, onSelectedFolderChange,
}) {
  const { t, tf, lang } = useI18n();
  const { confirm, alert } = useDialog();
  const { menu, openMenu, closeMenu } = useContextMenu();

  const [nodes, setNodes] = useState([]);
  const [busy, setBusy] = useState(false);
  // { id } quando renomeando; { parent, kind } quando criando.
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  // Pasta sob o cursor durante um arrasto; null e a raiz, undefined e "nenhum".
  const [dropTarget, setDropTarget] = useState(undefined);

  const importInputRef = useRef(null);

  const fail = useCallback(
    async (titleKey, titleText, error) => {
      await alert({
        title: t(titleKey, titleText),
        description: error?.response?.data?.detail || String(error?.message || error),
        variant: "danger",
      });
    },
    [alert, t]
  );

  const reload = useCallback(async () => {
    try {
      setNodes(await listNodes());
    } catch (error) {
      await fail("library.loadFailed", "Could not load the library", error);
    }
  }, [fail]);

  // Recarrega ao montar e depois de cada salvamento — a linha do arquivo
  // mostra a data de alteracao, que muda a cada gravacao.
  useEffect(() => {
    reload();
  }, [reload, savedTick]);

  const tree = buildTree(nodes);

  const toggle = (id) =>
    onExpandedChange((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expand = (id) =>
    onExpandedChange((current) => (id ? new Set(current).add(id) : current));

  const startCreate = (kind, parent = selectedFolder) => {
    if (parent) expand(parent);
    setEditing({ parent, kind });
    // Sem pre-preenchimento: o cursor fica no fim do campo, entao um ".asm"
    // ja escrito viraria ".asmNOME" assim que o aluno digitasse. A extensao e
    // acrescentada na confirmacao, se faltar.
    setDraft("");
  };

  const startRename = (node) => {
    setEditing({ id: node.id });
    setDraft(node.name);
  };

  /** Garante a extensao .asm nos arquivos, sem duplicar quando ja existe. */
  const withExtension = (name, kind) =>
    kind === KIND.FILE && !/\.(asm|s|inc)$/i.test(name) ? `${name}.asm` : name;

  const commitEdit = async () => {
    // Enter confirma E o onBlur do input dispara ao desmontar: sem limpar o
    // estado ANTES do await, a segunda chamada repetiria a criacao, colidiria
    // no nome e abriria um modal de erro que trava a interface.
    const current = editing;
    const name = draft.trim();
    setEditing(null);
    if (!current || !name) return;

    setBusy(true);
    try {
      if (current.id) {
        const node = nodes.find((item) => item.id === current.id);
        const finalName = withExtension(name, node?.kind);
        await updateNode(current.id, { name: finalName });
        if (openFile?.id === current.id) onOpenFileChange({ ...openFile, name: finalName });
      } else {
        const created = await createNode({
          kind: current.kind,
          name: withExtension(name, current.kind),
          parent: current.parent,
          // Arquivo novo nasce com o que esta no editor: quem clica em "novo
          // arquivo" quase sempre quer guardar o que acabou de escrever.
          source: current.kind === KIND.FILE ? source : "",
          // ...e com os parametros de execucao em uso agora, pelo mesmo motivo.
          metadata: current.kind === KIND.FILE ? fromParams(params) : undefined,
        });
        if (created.kind === KIND.FILE) {
          onOpenFileChange({ id: created.id, name: created.name });
          // O arquivo passa a ser o destino do "salvar", e o que ha nele e
          // exatamente o que esta na tela: nao ha mais nada pendente.
          onSaved?.(created.name);
        }
      }
      await reload();
    } catch (error) {
      await fail("library.saveFailed", "Could not save", error);
    } finally {
      setBusy(false);
    }
  };

  const open = async (node) => {
    // A pergunta vem ANTES da leitura: cancelando, nada foi tocado — nem o
    // arquivo aberto, nem a simulacao em andamento.
    if (onBeforeOpen && !(await onBeforeOpen())) return;

    setBusy(true);
    try {
      const full = await readNode(node.id);
      // Os parametros vao junto com o fonte: montar um programa de 64 bits com
      // o layout do exemplo de 32 que estava aberto antes daria erro sem que a
      // causa aparecesse em lugar nenhum.
      onOpen(full.source || "", toParams(full.metadata));
      onOpenFileChange({ id: full.id, name: full.name });
    } catch (error) {
      await fail("library.openFailed", "Could not open the file", error);
    } finally {
      setBusy(false);
    }
  };

  // Pedido de "salvar como" vindo da aba do fonte: sem arquivo aberto, o que
  // falta e um nome — e o nome se digita aqui.
  useEffect(() => {
    if (!saveAs) return;
    // Baixa a bandeira ANTES de agir: senao um re-render reentraria no efeito
    // com o pedido ainda de pe.
    onSaveAsHandled?.();
    startCreate(KIND.FILE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAs, onSaveAsHandled]);

  const remove = async (node) => {
    const isFolder = node.kind === KIND.FOLDER;
    const ok = await confirm({
      title: isFolder
        ? t("library.deleteFolderTitle", "Delete folder?")
        : t("library.deleteFileTitle", "Delete file?"),
      description: isFolder
        ? t("library.deleteFolderHint", "Everything inside it will be deleted too.")
        : node.name,
      variant: "danger",
      confirmLabel: t("common.delete", "Delete"),
      onConfirm: () => deleteNode(node.id),
    });
    if (!ok) return;
    if (openFile?.id === node.id) onOpenFileChange(null);
    if (isFolder) {
      onExpandedChange((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
      if (selectedFolder === node.id) onSelectedFolderChange(null);
    }
    await reload();
  };

  // --- Mover, soltar e importar -----------------------------------------

  /** Move um no para dentro de `parent` (null = raiz). */
  const move = async (id, parent) => {
    const node = nodes.find((item) => item.id === id);
    // Soltar onde ja esta nao e erro, e so nao e nada.
    if (!node || (node.parent ?? null) === (parent ?? null)) return;

    setBusy(true);
    try {
      await updateNode(id, { parent });
      if (parent) expand(parent);
      await reload();
    } catch (error) {
      // Ciclo e colisao de nome sao recusados pelo backend, com mensagem — e
      // uma explicacao util, nao uma falha silenciosa.
      await fail("library.moveFailed", "Could not move", error);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Distribui o que foi solto do sistema.
   *
   * Um `.scasmlib` e a biblioteca inteira e vai para o import; um `.asm` e um
   * programa avulso e vira arquivo. O resto e recusado por nome.
   */
  const dropFiles = async (files, parent) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    const bundles = list.filter((file) => BUNDLE_FILE.test(file.name));
    const sources = list.filter((file) => SOURCE_FILE.test(file.name));
    const rejected = list.filter(
      (file) => !BUNDLE_FILE.test(file.name) && !SOURCE_FILE.test(file.name)
    );

    for (const bundle of bundles) {
      // Um de cada vez: cada import e uma transacao no backend, e o segundo
      // precisa ver o que o primeiro criou para resolver colisao de nome.
      await doImport(bundle, parent);
    }
    if (sources.length) await uploadFiles(sources, parent);

    // O aviso vem por ULTIMO: soltando uma pasta com um `.asm` e um `.png`
    // junto, o que era valido ja entrou antes de o modal aparecer.
    if (rejected.length) {
      await alert({
        title: t("library.invalidDrop", "Invalid file"),
        description: tf(
          "library.invalidDropHint",
          { names: rejected.map((file) => file.name).join(", ") },
          "Only .asm, .s and .inc sources or a .scasmlib bundle can be dropped here. Rejected: {names}"
        ),
        variant: "danger",
      });
    }
  };

  /** Cria um arquivo por vez a partir dos fontes soltos. */
  const uploadFiles = async (files, parent) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    setBusy(true);
    try {
      for (const file of list) {
        if (file.size > MAX_UPLOAD_BYTES) {
          await fail("library.uploadFailed", "Could not import the file", {
            message: t("library.sourceTooLarge", "File is too large."),
          });
          continue;
        }
        const text = await file.text();
        const created = await createNode({
          kind: KIND.FILE,
          name: withExtension(file.name, KIND.FILE),
          parent: parent ?? null,
          source: text,
          // Arquivo de fora nao traz parametros: nasce com os que estao em uso.
          metadata: fromParams(params),
        });
        if (parent) expand(parent);
        void created;
      }
      await reload();
    } catch (error) {
      await fail("library.uploadFailed", "Could not import the file", error);
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (event, parent) => {
    event.preventDefault();
    // O `window` do simulador engole qualquer drop para o navegador nao abrir
    // o arquivo; aqui o evento tem destino, entao nao pode subir.
    event.stopPropagation();
    setDropTarget(undefined);

    const id = event.dataTransfer.getData(NODE_MIME);
    if (id) return move(id, parent ?? null);
    if (event.dataTransfer.files?.length) return dropFiles(event.dataTransfer.files, parent);
    return undefined;
  };

  const handleDragOver = (event, parent) => {
    // Sem o preventDefault o navegador recusa o drop e o cursor mostra "proibido".
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(NODE_MIME)
      ? "move"
      : "copy";
    setDropTarget(parent ?? null);
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const blob = await exportLibrary();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `library${BUNDLE_EXTENSION}`;
      link.click();
      // Sem o revoke o blob fica na memoria da aba ate ela fechar.
      URL.revokeObjectURL(url);
    } catch (error) {
      await fail("library.exportFailed", "Could not export the library", error);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file, parent) => {
    if (!file) return;
    setBusy(true);
    try {
      // O bundle e binario e quem o valida e o backend, que precisa abrir o
      // tar de qualquer jeito: conferir a extensao aqui so recusaria antes um
      // arquivo renomeado, e aceitaria um `.scasmlib` invalido do mesmo modo.
      const { imported } = await importLibrary(file, parent ?? null);
      if (parent) expand(parent);
      await reload();
      onImported?.(imported);
    } catch (error) {
      await fail("library.importFailed", "Could not import the library", error);
    } finally {
      setBusy(false);
    }
  };

  // --- Menus de contexto -------------------------------------------------

  /** Itens comuns as duas areas: criar e importar, sempre na pasta alvo. */
  const creationItems = (parent) => [
    {
      key: "new-file",
      label: t("library.newFile", "New file"),
      icon: FilePlus,
      onSelect: () => startCreate(KIND.FILE, parent),
    },
    {
      key: "new-folder",
      label: t("library.newFolder", "New folder"),
      icon: FolderPlus,
      onSelect: () => startCreate(KIND.FOLDER, parent),
    },
    { separator: true },
    {
      key: "import",
      label: t("library.import", "Import library…"),
      icon: Upload,
      onSelect: () => {
        // O destino do import vem do item clicado, e o input e um so — daí
        // guardar a pasta nele ate o arquivo ser escolhido.
        importInputRef.current.dataset.parent = parent ?? "";
        importInputRef.current.click();
      },
    },
    {
      key: "export",
      label: t("library.export", "Export library…"),
      icon: Download,
      onSelect: doExport,
    },
    { separator: true },
    {
      key: "import-binary",
      label: t("sim.importBinary", "Import binary…"),
      icon: Binary,
      // Nao cria nada na arvore: o binario vira codigo-fonte no editor, e quem
      // decide se aquilo merece ser guardado e o aluno.
      onSelect: () => onImportBinary?.(),
    },
  ];

  const menuItems = () => {
    const node = menu?.payload;
    if (!node) return creationItems(null);

    if (node.kind === KIND.FOLDER) {
      return [
        ...creationItems(node.id),
        { separator: true },
        {
          key: "rename",
          label: t("library.rename", "Rename"),
          icon: Pencil,
          onSelect: () => startRename(node),
        },
        {
          key: "delete",
          label: t("common.delete", "Delete"),
          icon: Trash2,
          danger: true,
          onSelect: () => remove(node),
        },
      ];
    }

    return [
      {
        key: "open",
        label: t("library.open", "Open"),
        icon: FileUp,
        onSelect: () => open(node),
      },
      {
        key: "save",
        label: t("library.save", "Save to open file"),
        icon: Save,
        disabled: openFile?.id !== node.id || !dirty,
        onSelect: () => onSave?.(),
      },
      { separator: true },
      {
        key: "rename",
        label: t("library.rename", "Rename"),
        icon: Pencil,
        onSelect: () => startRename(node),
      },
      {
        key: "delete",
        label: t("common.delete", "Delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => remove(node),
      },
    ];
  };

  const rootHighlighted = dropTarget === null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1e1e1e]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[#3c3c3c] px-2 py-1">
        <Action icon={FolderPlus} label={t("library.newFolder", "New folder")}
                onClick={() => startCreate(KIND.FOLDER)} disabled={busy} />
        <Action icon={FilePlus} label={t("library.newFile", "New file")}
                onClick={() => startCreate(KIND.FILE)} disabled={busy} />
        <Action
          icon={Save}
          label={openFile
            ? t("library.save", "Save to open file")
            : t("library.saveAs", "Save to a new file")}
          onClick={onSave}
          disabled={busy || !dirty}
        />
        <span className="mx-1 h-4 w-px bg-[#3c3c3c]" />
        <Action
          icon={Binary}
          label={t("sim.importBinary", "Import binary…")}
          onClick={() => onImportBinary?.()}
          disabled={busy}
        />
        {selectedFolder && (
          <button
            type="button"
            onClick={() => onSelectedFolderChange(null)}
            className="rounded px-1.5 py-0.5 text-[10px] text-[#6b6b6b] hover:bg-[#3c3c3c] hover:text-[#d4d4d4]"
          >
            {t("library.toRoot", "to root")}
          </button>
        )}

      </div>

      {/* A area inteira e alvo de drop: soltar no vazio manda para a raiz. */}
      <div
        className={cn(
          "flex-1 overflow-auto py-1 text-[12px] leading-[1.6]",
          rootHighlighted && "bg-[#0e639c]/10 ring-1 ring-inset ring-[#0e639c]"
        )}
        onContextMenu={(event) => openMenu(event, null)}
        onDragOver={(event) => handleDragOver(event, null)}
        onDragLeave={() => setDropTarget(undefined)}
        onDrop={(event) => handleDrop(event, null)}
      >
        {tree.length === 0 && !editing && (
          <p className="px-3 text-[#6b6b6b]">
            {t("library.emptyHint", "Empty library — right-click to create, or drop .asm files here.")}
          </p>
        )}

        {/* Item novo criado na raiz */}
        {editing && !editing.id && editing.parent === null && (
          <NameInput depth={0} value={draft} onChange={setDraft}
                     onCommit={commitEdit} onCancel={() => setEditing(null)} />
        )}

        {tree.map((node) => (
          <Row
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            editing={editing}
            draft={draft}
            openFileId={openFile?.id}
            busy={busy}
            selectedFolder={selectedFolder}
            dropTarget={dropTarget}
            lang={lang}
            onToggle={(id) => {
              toggle(id);
              onSelectedFolderChange(id);
            }}
            onOpen={open}
            onRename={startRename}
            onRemove={remove}
            onDraftChange={setDraft}
            onCommit={commitEdit}
            onCancel={() => setEditing(null)}
            onContextMenu={openMenu}
            onDragOver={handleDragOver}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={closeMenu} />}

      {/* Input do import: escondido, acionado pelo menu. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".scasmlib,application/gzip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const parent = event.target.dataset.parent || null;
          // Zerar o valor permite reimportar o MESMO arquivo em seguida: sem
          // isso o `change` nao dispara na segunda vez.
          event.target.value = "";
          doImport(file, parent);
        }}
      />
    </div>
  );
}

function Action({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "rounded p-1 transition-colors",
        disabled ? "cursor-not-allowed text-[#5a5a5a]" : "text-[#d4d4d4] hover:bg-[#3c3c3c]"
      )}
    >
      <Icon size={14} />
    </button>
  );
}

function Row({
  node, depth, expanded, editing, draft, openFileId, busy, selectedFolder, dropTarget,
  lang,
  onToggle, onOpen, onRename, onRemove, onDraftChange, onCommit, onCancel,
  onContextMenu, onDragOver, onDragLeave, onDrop,
}) {
  const isFolder = node.kind === KIND.FOLDER;
  const isOpen = expanded.has(node.id);
  const isRenaming = editing?.id === node.id;
  const FolderIcon = isOpen ? FolderOpen : Folder;

  if (isRenaming) {
    return (
      <NameInput depth={depth} value={draft} onChange={onDraftChange}
                 onCommit={onCommit} onCancel={onCancel} />
    );
  }

  // Arquivo nao recebe drop: o destino e a pasta que o contem, e e o que o
  // realce mostra enquanto se arrasta por cima dele.
  const dropParent = isFolder ? node.id : (node.parent ?? null);

  return (
    <>
      <div
        draggable={!busy}
        onDragStart={(event) => {
          event.dataTransfer.setData(NODE_MIME, node.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => onDragOver(event, dropParent)}
        onDragLeave={onDragLeave}
        onDrop={(event) => onDrop(event, dropParent)}
        onContextMenu={(event) => onContextMenu(event, node)}
        className={cn(
          "group flex items-center gap-1 pr-2 hover:bg-[#2d2d2d]",
          node.id === openFileId && "bg-[#094771]",
          // Pasta selecionada: e nela que "nova pasta"/"novo arquivo" criam.
          node.id === selectedFolder && node.id !== openFileId && "bg-[#37373d]",
          isFolder && dropTarget === node.id && "ring-1 ring-inset ring-[#0e639c]"
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => (isFolder ? onToggle(node.id) : onOpen(node))}
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left"
        >
          {isFolder ? (
            <>
              {isOpen ? <ChevronDown size={12} className="shrink-0 text-[#6b6b6b]" />
                      : <ChevronRight size={12} className="shrink-0 text-[#6b6b6b]" />}
              <FolderIcon size={13} className="shrink-0 text-[#dcb67a]" />
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <File size={13} className="shrink-0 text-[#9cdcfe]" />
            </>
          )}
          <span className="truncate text-[#d4d4d4]">{node.name}</span>
        </button>

        <FileMeta node={node} lang={lang} />

        {/* Acoes so no hover: a lista fica limpa enquanto se navega. O menu de
            contexto tem as mesmas opcoes, e mais algumas. */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Action icon={Pencil} label="rename" onClick={() => onRename(node)} disabled={busy} />
          <Action icon={Trash2} label="delete" onClick={() => onRemove(node)} disabled={busy} />
        </span>
      </div>

      {/* Item novo sendo criado dentro desta pasta */}
      {isOpen && editing && !editing.id && editing.parent === node.id && (
        <NameInput depth={depth + 1} value={draft} onChange={onDraftChange}
                   onCommit={onCommit} onCancel={onCancel} />
      )}

      {isOpen &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            editing={editing}
            draft={draft}
            openFileId={openFileId}
            busy={busy}
            selectedFolder={selectedFolder}
            dropTarget={dropTarget}
            lang={lang}
            onToggle={onToggle}
            onOpen={onOpen}
            onRename={onRename}
            onRemove={onRemove}
            onDraftChange={onDraftChange}
            onCommit={onCommit}
            onCancel={onCancel}
            onContextMenu={onContextMenu}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        ))}
    </>
  );
}

/**
 * Dados do arquivo a direita da linha: arquitetura e ultima alteracao.
 *
 * Sao os dois campos que mudam a leitura do arquivo antes mesmo de abri-lo —
 * um `.asm` de 64 bits e um de 32 tem o mesmo icone e o mesmo nome, e nada na
 * arvore os distinguia. A data responde "qual e a versao boa?" sem obrigar a
 * abrir os dois.
 *
 * Pasta nao tem nenhum dos dois: `metadata` vem null do backend.
 */
function FileMeta({ node, lang }) {
  if (node.kind !== KIND.FILE) return null;

  const arch = node.metadata?.arch;
  const target = node.metadata?.os;
  const updated = formatTimestamp(node.updated, lang);

  return (
    <span
      className="flex shrink-0 items-center gap-2 pl-2 text-[10px] text-[#6b6b6b]"
      title={node.updated ? new Date(node.updated).toLocaleString(lang) : undefined}
    >
      {/* O glifo do sistema vem da Nerd Font embarcada, na familia que tem a
          cobertura garantida (ver o @font-face "MesloLGS NF Embedded"). */}
      {target && (
        <span className="font-dump text-[12px] text-[#dcb67a]" title={OS[target]?.label}>
          {osIcon(target)}
        </span>
      )}
      {arch && (
        <span className="rounded bg-[#3c3c3c] px-1 py-px text-[#9cdcfe]">
          {arch === "x86_64" ? "x64" : "x86"}
        </span>
      )}
      {updated && <span className="tabular-nums">{updated}</span>}
    </span>
  );
}

/**
 * Data curta: hora quando e de hoje, dia/mes no ano corrente, com ano fora
 * dele. A coluna e estreita, e o que interessa e "quando, mais ou menos" —
 * o carimbo completo fica no `title`.
 */
function formatTimestamp(value, lang) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(lang, {
    day: "2-digit",
    month: "2-digit",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Input inline de nome — Enter confirma, Esc cancela, sair do campo confirma. */
function NameInput({ depth, value, onChange, onCommit, onCancel }) {
  return (
    <div className="flex items-center py-0.5" style={{ paddingLeft: 8 + depth * 14 + 20 }}>
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") onCancel();
          // Ctrl+S dentro do campo de nome nao pode virar "salvar": aqui a
          // confirmacao e o Enter.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        className="w-full rounded border border-[#0e639c] bg-[#3c3c3c] px-1 text-[12px] text-[#d4d4d4] outline-none"
      />
    </div>
  );
}
