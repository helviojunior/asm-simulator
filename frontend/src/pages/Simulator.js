import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import api from "lib/api";
import brand from "lib/brand";
import { useI18n, LANGUAGE_OPTIONS } from "i18n";
import { useDialog } from "contexts/DialogContext";
import { useToast } from "contexts/ToastContext";
import { Machine } from "lib/cpu/machine";
import { HALT } from "lib/cpu/halt";
import { ARCH } from "lib/cpu/registers";
import { OS, OS_OPTIONS, detectOs, osIcon } from "lib/cpu/os";
import { defaultConvention, syscallGate } from "lib/cpu/inspect";
import { findArchMismatch } from "lib/asm/archCheck";
import { labelMap } from "lib/asm/labels";
import { fromParams, updateNode } from "lib/library";
import { hex, parseAddress } from "lib/cpu/format";
import Toolbar from "components/debugger/Toolbar";
import EditorPane from "components/debugger/EditorPane";
import DisassemblyPane from "components/debugger/DisassemblyPane";
import RegistersPane from "components/debugger/RegistersPane";
import FlagsPane from "components/debugger/FlagsPane";
import StackPane from "components/debugger/StackPane";
import OperandsPane from "components/debugger/OperandsPane";
import CallPane from "components/debugger/CallPane";
import SyscallPane from "components/debugger/SyscallPane";
import StructPane from "components/debugger/StructPane";
import { loadTypeNames } from "lib/types";
import Splitter from "components/debugger/Splitter";
import AboutModal, { AboutButton } from "components/AboutModal";
import ImportBinaryWizard from "components/ImportBinaryWizard";
import NtdllModal from "components/NtdllModal";
import { ntdllSummary, refreshNtdll } from "lib/ntdll";
import { loadPrototypes } from "lib/prototypes";
import { clearSyscallNames } from "lib/cpu/syscallNames";
import { clearCallNames } from "lib/cpu/callNames";
import { usePaneSizes } from "lib/usePaneSizes";

// O editor abre VAZIO: quem chega escreve o proprio programa (ou abre um da
// biblioteca). Um exemplo pre-carregado seria apagado antes da primeira linha.
const DEFAULT_SOURCE = "";

// Tamanhos iniciais dos paineis, em pixels. Cada divisoria e arrastavel e o
// valor ajustado fica no localStorage do navegador.
const DEFAULT_PANE_SIZES = {
  rightColumn: 380,
  operands: 128,
  source: 380,
  stack: 260,
  callArgs: 150,
  syscall: 170,
  struct: 200,
};

// Quantos indicadores listar no aviso de arquitetura divergente. A lista serve
// para reconhecer o problema, nao para inventariar o arquivo inteiro.
const MAX_MISMATCH_HINTS = 6;

// Quanto tempo o aviso da barra de status fica no ar, em ms.
const NOTICE_TIMEOUT = 4000;

const DEFAULT_LAYOUT = {
  x86: { codeBase: "0x7F200100", stackTop: "0x00804000" },
  x86_64: { codeBase: "0x00007FF700001000", stackTop: "0x000000000080C000" },
};

/** Converte a base64 devolvida pelo backend em bytes. */
function decodeBase64(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function Simulator() {
  const { t, tf, lang, setLanguage } = useI18n();
  const { alert, confirm, choose } = useDialog();
  const { toast, dismissAll } = useToast();

  const [arch, setArch] = useState("x86");
  // Alvo do programa. null = ainda nao definido; e resolvido (por deteccao ou
  // perguntando) antes de montar ou salvar, e vai junto no metadado.
  const [os, setOs] = useState(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  // Arquivo da biblioteca atualmente aberto no editor ({ id, name }), ou null
  // quando o conteudo nao veio de lugar nenhum.
  const [openFile, setOpenFile] = useState(null);
  const [codeBase, setCodeBase] = useState(DEFAULT_LAYOUT.x86.codeBase);
  const [stackTop, setStackTop] = useState(DEFAULT_LAYOUT.x86.stackTop);

  const [paneSizes, resizePane] = usePaneSizes(DEFAULT_PANE_SIZES);
  const [instructions, setInstructions] = useState([]);
  // Mapa offset -> linha do fonte. Guardado a parte para sobreviver a uma
  // re-desmontagem (codigo automodificavel), que nao passa pelo montador.
  const [lineMap, setLineMap] = useState({});
  // Faixas de bytes que sao DADOS (vieram de `db`/`times`/`incbin`). Guardadas
  // ao lado do lineMap e pelo mesmo motivo: a re-desmontagem de codigo
  // automodificavel precisa reaplica-las, senao a string embutida volta a ser
  // lida como instrucao.
  const [dataRanges, setDataRanges] = useState([]);
  // Quantos argumentos inspecionar num `call`. A quantidade real e desconhecida,
  // entao quem decide e quem esta olhando.
  const [argCount, setArgCount] = useState(4);
  const [convention, setConvention] = useState(() => defaultConvention("x86", null));
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  // Retrato do que ESTA no arquivo salvo. E com ele que se decide se ha algo a
  // salvar; sem baseline, "salvar" ficaria sempre ativo e nao diria nada.
  const [baseline, setBaseline] = useState(null);
  // Pedido de "salvar como": sem arquivo aberto e preciso nomear um novo, e o
  // nome se digita na arvore da biblioteca.
  const [saveAs, setSaveAs] = useState(false);
  const clearSaveAs = useCallback(() => setSaveAs(false), []);
  // Mensagem transitoria da barra de status ("arquivo X salvo").
  const [notice, setNotice] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ntdllOpen, setNtdllOpen] = useState(false);
  // Ponteiro sendo lido como estrutura: `{ address, type, name }`, ou null.
  const [parsed, setParsed] = useState(null);
  // Contador de salvamentos. A arvore da biblioteca mostra a data de alteracao
  // de cada arquivo; sem este sinal ela ficaria defasada ate a proxima troca
  // de aba.
  const [savedTick, setSavedTick] = useState(0);
  // Toda acao que MOVE o ponteiro de execucao incrementa isto, e a aba do
  // codigo-fonte vem para a frente. Sem isso, dar um passo com a biblioteca
  // aberta destacaria uma linha que ninguem esta vendo.
  const [focusSource, setFocusSource] = useState(0);
  const showSource = useCallback(() => setFocusSource((value) => value + 1), []);
  const [changes, setChanges] = useState({ registers: [], flags: [], memory: [] });
  // Endereco que o dump deve mostrar, pedido por outro painel. O `nonce` faz
  // parte do valor de proposito: pedir DUAS vezes o mesmo endereco tem de
  // rolar as duas, e um estado que nao muda nao dispara efeito nenhum.
  const [dumpTarget, setDumpTarget] = useState(null);
  const viewInDump = useCallback((address) => {
    setDumpTarget((current) => ({
      address: BigInt(address),
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }, []);

  // A maquina e mutavel por natureza (e um modelo de CPU). Guardamos a
  // instancia numa ref e usamos `tick` apenas para pedir novo render — assim
  // nao clonamos o estado inteiro a cada passo.
  const machineRef = useRef(null);
  // Destinos de chamada externa ja anunciados. Sem isto, um `call` para fora
  // dentro de um laco abriria o mesmo modal a cada volta.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const machine = machineRef.current;

  // A convencao segue o alvo. Trocar de sistema sem trocar a convencao deixaria
  // o painel lendo os argumentos nos registradores errados — em 64 bits, RDI/RSI
  // no Linux contra RCX/RDX no Windows. Escolha manual vale ate a proxima
  // mudanca de arquitetura ou de alvo, que e um sinal mais forte.
  useEffect(() => {
    setConvention(defaultConvention(arch, os));
  }, [arch, os]);

  // Trocar de arquitetura reaproveita o layout tipico de cada uma.
  const handleArchChange = (value) => {
    setArch(value);
    setCodeBase(DEFAULT_LAYOUT[value].codeBase);
    setStackTop(DEFAULT_LAYOUT[value].stackTop);
  };

  // Parametros de execucao em vigor. Vao para a biblioteca no salvamento: sao
  // do ARQUIVO, nao da sessao.
  const params = { arch, os, codeBase, stackTop, argCount };

  /**
   * Abre um arquivo da biblioteca: fonte e parametros de execucao.
   *
   * Arquivo antigo, salvo antes de os parametros existirem, chega sem eles —
   * dai o fallback para o layout padrao da arquitetura, e nao para o layout que
   * estava na tela, que seria o do programa anterior.
   */
  const handleOpenFile = (text, fileParams) => {
    setSource(text);

    const nextArch = DEFAULT_LAYOUT[fileParams?.arch] ? fileParams.arch : arch;
    const next = {
      source: text,
      arch: nextArch,
      // Arquivo salvo antes de o alvo existir chega sem ele: fica indefinido e
      // sera resolvido na proxima montagem, e nao herdado do programa anterior.
      os: OS[fileParams?.os] ? fileParams.os : null,
      codeBase: fileParams?.codeBase || DEFAULT_LAYOUT[nextArch].codeBase,
      stackTop: fileParams?.stackTop || DEFAULT_LAYOUT[nextArch].stackTop,
      argCount: Math.max(0, Math.min(16, fileParams?.argCount ?? 4)),
    };

    setArch(next.arch);
    setOs(next.os);
    setCodeBase(next.codeBase);
    setStackTop(next.stackTop);
    setArgCount(next.argCount);
    // Acabou de vir do disco: e exatamente isto que esta salvo.
    setBaseline(next);

    // O programa montado era do arquivo ANTERIOR. Mantido, a desmontagem, os
    // registradores e a pilha continuariam mostrando outro codigo — e com um
    // arquivo vazio a tela inteira pareceria nao ter sido limpa.
    discardProgram();
  };

  /**
   * Pede confirmacao antes de descartar uma simulacao em andamento.
   *
   * Trocar de arquivo joga fora o programa montado e TODO o estado da corrida
   * — registradores, pilha, historico de passos. Feito em silencio, um clique
   * errado na arvore apagaria uma aula inteira sem deixar rastro.
   *
   * So pergunta se a execucao COMECOU: com o programa apenas montado nao ha o
   * que perder alem de um F9.
   */
  const confirmDiscardRun = useCallback(async () => {
    const current = machineRef.current;
    if (!current || current.stepCount === 0) return true;

    return confirm({
      title: t("sim.discardRun", "There is a simulation in progress"),
      description: (
        <>
          <p>
            {tf(
              "sim.discardRunHint",
              { steps: current.stepCount },
              "Opening another file stops it and clears the disassembly, registers and stack. {steps} step(s) will be lost."
            )}
          </p>
        </>
      ),
      variant: "warning",
      confirmLabel: t("sim.discardRunConfirm", "Stop and open"),
    });
  }, [confirm, t, tf]);

  /**
   * Carrega o catalogo do alvo para o painel de syscall resolver NUMERO -> NOME.
   *
   * Sao as 440 syscalls do i386 e as 362 do x86-64, com o numero de cada uma.
   * A tabela embutida em `lib/cpu/syscalls` cobre uma duzia — o suficiente para
   * o primeiro render, e nao para o programa do aluno, que pode chamar
   * qualquer uma. Carregado aqui, na troca de alvo, e nao no primeiro passo:
   * assim o nome ja esta la quando a execucao chega no `int 0x80`.
   */
  useEffect(() => {
    if (!os || !arch) return;
    loadPrototypes(os, arch, "syscall").then((list) => {
      if (list.length) refresh();
    });
  }, [os, arch, refresh]);

  /** Volta ao estado "nada montado": nao ha programa a inspecionar. */
  const discardProgram = () => {
    machineRef.current = null;
    // Os nomes que o aluno deu valem para o programa que estava carregado.
    clearSyscallNames();
    // Os do `call` mais ainda: sao presos a um endereco, e no proximo programa
    // aquele mesmo endereco e outra coisa.
    clearCallNames();
    setParsed(null);
    setInstructions([]);
    setLineMap({});
    setDataRanges([]);
    setMessages([]);
    setChanges({ registers: [], flags: [], memory: [] });
    // Idem para os avisos: eles falavam de um programa que nao existe mais.
    dismissAll();
    refresh();
  };

  /**
   * Ha algo a salvar?
   *
   * Compara o estado atual com o retrato do arquivo salvo — fonte E parametros
   * de execucao, que tambem vao para o banco. Sem arquivo aberto, o criterio e
   * outro: so ha o que salvar se houver codigo escrito.
   */
  const dirty = openFile
    ? Boolean(baseline) && (
        source !== baseline.source ||
        arch !== baseline.arch ||
        os !== baseline.os ||
        codeBase !== baseline.codeBase ||
        stackTop !== baseline.stackTop ||
        argCount !== baseline.argCount
      )
    // Sem arquivo aberto sempre ha o que fazer: "salvar como". Um arquivo
    // vazio e legitimo — comeca-se um exercicio criando o arquivo, nao
    // escrevendo nele.
    : true;

  /**
   * Fecha o arquivo: editor em branco e nada montado, como no primeiro boot.
   *
   * Pergunta pelo que se perde, na ordem em que importa: alteracao nao salva
   * primeiro (e o que nao da para recuperar), depois a simulacao em andamento.
   */
  const handleCloseFile = useCallback(async () => {
    if (openFile && dirty) {
      const ok = await confirm({
        title: t("sim.closeDirty", "There are unsaved changes"),
        description: tf(
          "sim.closeDirtyHint",
          { name: openFile.name },
          'Closing "{name}" discards what you changed since the last save.'
        ),
        variant: "warning",
        confirmLabel: t("sim.closeConfirm", "Discard and close"),
      });
      if (!ok) return;
    } else if (!(await confirmDiscardRun())) {
      return;
    }

    setSource("");
    setOpenFile(null);
    setBaseline(null);
    setOs(null);
    discardProgram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, confirmDiscardRun, dirty, openFile, t, tf]);

  /** Publica um aviso na barra de status; ele some sozinho. */
  const notify = useCallback((message) => {
    setNotice({ message, at: Date.now() });
  }, []);

  // O aviso e transitorio: deixado fixo, viraria parte do rodape e ninguem
  // repararia no proximo.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_TIMEOUT);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Garante que o alvo esta definido, devolvendo-o (ou null se desistirem).
   *
   * Tenta reconhecer pelo fonte primeiro. So pergunta quando nao da para
   * afirmar: chutar resolveria os numeros de syscall para as funcoes erradas,
   * e o painel mentiria com toda a confianca — pior que nao saber.
   */
  const resolveOs = useCallback(async () => {
    if (os) return os;

    const detected = detectOs(source);
    if (detected.os) {
      setOs(detected.os);
      return detected.os;
    }

    const chosen = await choose({
      title: t("sim.pickOs", "Which system is this program for?"),
      description: t(
        "sim.pickOsHint",
        "The syscall number depends on it: 4 is write on Linux i386 and close on Linux x86-64. Nothing in the source says which one this is."
      ),
      options: OS_OPTIONS.map((item) => ({
        value: item.id,
        label: item.label,
        icon: item.icon,
        description: t(`sim.osHint.${item.id}`, ""),
      })),
    });
    if (chosen) setOs(chosen);
    return chosen;
  }, [choose, os, source, t]);

  /** Abre o wizard de import, se nao houver nada a perder no caminho. */
  const openImport = useCallback(async () => {
    if (await confirmDiscardRun()) setImportOpen(true);
  }, [confirmDiscardRun]);

  /**
   * Import concluido: o fonte reconstruido entra no editor SEM arquivo.
   *
   * Sem arquivo de proposito — o binario nao veio da biblioteca, e quem decide
   * se aquilo merece ser guardado e o aluno, depois de olhar. Como o baseline
   * fica nulo, o botao de salvar ja nasce ativo.
   */
  const handleBinaryImported = useCallback(
    ({ source: text, arch: nextArch, os: nextOs, name, baseAddress }) => {
      setSource(text);
      setOpenFile(null);
      setBaseline(null);
      setArch(nextArch);
      setOs(nextOs || null);

      // O layout tem de acompanhar a arquitetura importada. Ficando o de 64
      // bits com um binario de 32, o programa nasceria acima de 0xFFFFFFFF e
      // pararia no primeiro salto. A base e a que o servidor usou para gerar o
      // `org` do fonte; o topo da pilha vem do padrao da arquitetura.
      const layout = DEFAULT_LAYOUT[nextArch];
      setCodeBase(baseAddress ? `0x${BigInt(baseAddress).toString(16).toUpperCase()}` : layout.codeBase);
      if (nextArch !== arch) setStackTop(layout.stackTop);
      discardProgram();
      showSource();
      notify(tf("sim.binaryImported", { name }, 'Binary "{name}" disassembled into source.'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arch, notify, showSource, tf]
  );

  /**
   * Salva no arquivo aberto.
   *
   * Sem arquivo aberto nao ha onde gravar: o pedido vira "salvar como" e quem
   * conduz e a biblioteca, que tem a arvore para escolher a pasta e o campo de
   * nome. Esse e o unico caso em que salvar troca de aba.
   */
  const handleSave = useCallback(async () => {
    // O alvo faz parte do que se salva: um arquivo sem ele reabriria sem saber
    // ler os proprios numeros de syscall.
    const target = await resolveOs();
    if (!target) return;

    if (!openFile) {
      setSaveAs(true);
      return;
    }
    if (!dirty) return;

    const snapshot = { source, arch, os: target, codeBase, stackTop, argCount };
    setBusy(true);
    try {
      await updateNode(openFile.id, {
        source: snapshot.source,
        metadata: fromParams(snapshot),
      });
      // O retrato e o que FOI enviado, nao o estado no fim da requisicao: um
      // caractere digitado durante o await continua sendo alteracao pendente.
      setBaseline(snapshot);
      setSavedTick((value) => value + 1);
      notify(tf("library.savedFile", { name: openFile.name }, 'File "{name}" saved.'));
    } catch (error) {
      await alert({
        title: t("library.saveFailed", "Could not save"),
        description: error.response?.data?.detail || String(error.message || error),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }, [alert, arch, argCount, codeBase, dirty, notify, openFile, resolveOs, source, stackTop, t, tf]);

  /** Import concluido: a biblioteca diz quantos itens entraram. */
  const handleImported = useCallback(
    (imported) => {
      notify(tf("library.importedCount", { count: imported }, "{count} item(s) imported."));
    },
    [notify, tf]
  );

  /** Confirmacao de que a biblioteca salvou (criou um arquivo novo). */
  const handleSaved = useCallback(
    (name) => {
      setBaseline({ source, arch, os, codeBase, stackTop, argCount });
      notify(tf("library.savedFile", { name }, 'File "{name}" saved.'));
    },
    [arch, argCount, codeBase, notify, os, source, stackTop, tf]
  );

  /**
   * Convida a importar a ntdll quando ela faria diferenca.
   *
   * So no alvo Windows, so quando o programa REALMENTE entra no kernel, e so
   * se ainda nao houver tabela. Fora disso o convite seria interrupcao: num
   * shellcode que so chama a API por DLL, nao ha SSN a resolver.
   *
   * Ja carregada, usa-se a que esta la — sem perguntar nada.
   */
  const offerNtdll = useCallback(
    async (target) => {
      if (target !== OS.windows.id) return;
      if (!/\b(syscall|sysenter)\b/i.test(source.replace(/;.*$/gm, ""))) return;

      // Pode ter sido importada em outra aba, ou por outro worker do uwsgi.
      let summary = ntdllSummary(arch);
      if (!summary) {
        try {
          summary = await refreshNtdll(arch);
        } catch {
          summary = null;
        }
      }
      if (summary) return;

      const wants = await confirm({
        title: t("ntdll.offerTitle", "Import ntdll.dll to read the syscalls?"),
        description: t(
          "ntdll.offerHint",
          "This program enters the kernel, but Windows has no stable syscall number — it changes between builds. With the ntdll.dll of the build you are studying, the numbers resolve to function names."
        ),
        variant: "info",
        confirmLabel: t("ntdll.offerConfirm", "Import now"),
        cancelLabel: t("ntdll.offerSkip", "Continue without it"),
      });
      if (wants) setNtdllOpen(true);
    },
    [arch, confirm, source, t]
  );

  const assemble = useCallback(async () => {
    setBusy(true);
    setMessages([]);
    // Montar de novo joga fora o programa que gerou os avisos na tela.
    dismissAll();
    try {
      // Editor vazio e o estado inicial: montar dai carregaria um programa de
      // zero bytes e a barra de status diria apenas "sem instrucao", sem dizer
      // por que. A mensagem vai para o painel do fonte, junto dos erros de
      // sintaxe — nao em modal.
      if (!source.trim()) {
        setMessages([
          { level: "error", line: null, message: t("sim.sourceEmpty", "Write your program here, or open one from the library.") },
        ]);
        return;
      }

      // O fonte declara uma arquitetura (via `bits`) ou a denuncia pelo que
      // usa. Montar com a errada da erro obscuro do nasm — ou, pior, monta e
      // roda diferente (o caso de `int 0x80` em 64 bits).
      // O alvo entra ANTES da montagem: e ele que decide a tabela de syscalls
      // com que a maquina vai ser criada.
      const target = await resolveOs();
      if (!target) return;

      if (target === OS.windows.id) await offerNtdll(target);

      const mismatch = findArchMismatch(source, arch);
      if (mismatch) {
        const proceed = await confirm({
          title: t("sim.archMismatch", "Architecture does not match the code"),
          description: (
            <>
              <p>
                {tf(
                  "sim.archMismatchHint",
                  { target: ARCH[mismatch.target].label, selected: ARCH[arch].label },
                  "The code looks like {target}, but {selected} is selected. Change the architecture in the header, or assemble anyway."
                )}
              </p>
              <ul className="mt-2 space-y-0.5 font-mono text-xs">
                {mismatch.indicators.slice(0, MAX_MISMATCH_HINTS).map((item, index) => (
                  <li key={`${item.line}-${index}`}>
                    {t("sim.line", "line")} {item.line}: <strong>{item.text}</strong>
                  </li>
                ))}
              </ul>
              {mismatch.indicators.length > MAX_MISMATCH_HINTS && (
                <p className="mt-1 text-xs">
                  {tf(
                    "sim.archMismatchMore",
                    { count: mismatch.indicators.length - MAX_MISMATCH_HINTS },
                    "and {count} more."
                  )}
                </p>
              )}
            </>
          ),
          variant: "warning",
          confirmLabel: t("sim.assembleAnyway", "Assemble anyway"),
        });
        if (!proceed) return;
      }

      const base = parseAddress(codeBase);
      const top = parseAddress(stackTop);
      if (base === null || top === null) {
        await alert({
          title: t("sim.invalidLayout", "Invalid memory layout"),
          description: t(
            "sim.invalidLayoutHint",
            "Code base and stack top must be numbers (e.g. 0x401000)."
          ),
          variant: "danger",
        });
        return;
      }

      const response = await api.post("/api/program/assemble/", {
        source,
        arch,
        base_address: base.toString(),
      });

      const data = response.data;
      const bytes = decodeBase64(data.data);
      const next = new Machine({ arch, os: target, codeBase: base, stackTop: top });
      next.load({ bytes, instructions: data.instructions, sections: data.sections });
      // O montador nao devolve tabela de simbolos; os nomes estao no fonte que
      // acabou de ser montado, e o mapa de linhas diz onde cada um caiu.
      next.setLabels(labelMap(source, data.line_map, base));

      machineRef.current = next;
        showSource();
      setInstructions(data.instructions);
      setLineMap(data.line_map || {});
      setDataRanges(data.data_ranges || []);
      setMessages(data.warnings || []);
      setChanges({ registers: [], flags: [], memory: [] });
      refresh();
    } catch (error) {
      const payload = error.response?.data;
      if (payload?.messages?.length) {
        // Erro de sintaxe fica no painel, ancorado na linha — nao em modal.
        setMessages(payload.messages);
      } else {
        await alert({
          title: t("sim.assembleFailed", "Could not assemble"),
          description: payload?.detail || String(error.message || error),
          variant: "danger",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [alert, arch, codeBase, confirm, dismissAll, offerNtdll, refresh, resolveOs, showSource,
      source, stackTop, t, tf]);

  /**
   * Re-desmonta o codigo depois de uma escrita que caiu dentro dele.
   *
   * Codigo automodificavel invalida a desmontagem em tela: os bytes mudaram e
   * ate as fronteiras entre instrucoes podem ter mudado. Como o decodificador
   * vive no backend, mandamos os bytes ATUAIS da memoria e reaplicamos o mapa
   * de linhas — que continua valido, por ser indexado por offset.
   *
   * O estado de execucao nao e tocado: `setInstructions` troca so a leitura.
   */
  const refreshDisassembly = useCallback(async () => {
    const current = machineRef.current;
    if (!current || !current.codeDirty) return;

    const bytes = current.codeBytes();
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    try {
      const response = await api.post("/api/program/disassemble/", {
        data: window.btoa(binary),
        arch: current.archId,
        base_address: current.codeBase.toString(),
        data_ranges: dataRanges,
      });
      const decoded = (response.data.instructions || []).map((insn) => ({
        ...insn,
        line: lineMap[String(BigInt(insn.address) - current.codeBase)] ?? null,
      }));
      current.setInstructions(decoded);
      setInstructions(decoded);
      refresh();
    } catch {
      // Falhar aqui nao pode interromper a simulacao: a desmontagem fica
      // defasada, mas a execucao continua correta.
      current.codeDirty = false;
    }
  }, [dataRanges, lineMap, refresh]);

  /**
   * Modal ao fim da execucao.
   *
   * A barra de status ja registra o motivo, mas num rodape de 11px — e o
   * momento em que o shellcode chama `execve("/bin/sh", ...)` e o ponto alto
   * da aula, nao uma nota de rodape. O mesmo vale para um estouro de pilha:
   * quem esta aprendendo precisa ver que a execucao PAROU, e por que.
   */
  const announceHalt = useCallback(
    (halted) => {
      const variant = HALT_ALERTS[halted.reason];
      if (!variant) return;

      alert({
        title: haltLabel(halted.reason, t),
        variant,
        description: (
          <>
            {/* A chamada exata, como o programa a fez. */}
            {halted.message && (
              <p className="rounded bg-muted px-2 py-1 font-mono text-xs">{halted.message}</p>
            )}
            <p className="mt-2">
              {t(
                "sim.haltModalHint",
                "Execution stopped here. Restart to run the program again."
              )}
            </p>
          </>
        ),
      });
    },
    [alert, t]
  );

  /**
   * Avisa que um `call` apontou para fora do programa carregado.
   *
   * A execucao NAO parou — a chamada foi ignorada e o fluxo seguiu na
   * instrucao seguinte. Isso precisa ser dito: quem so olhasse os registradores
   * concluiria que a funcao rodou e devolveu o que ja estava la.
   *
   * Modal na primeira vez para CADA destino; repeticoes (um `call` dentro de um
   * laco) so atualizam a barra de status.
   */
  const announceExternalCall = useCallback(
    ({ address }) => {
      const digits = machineRef.current?.arch.bits === 64 ? 16 : 8;
      const target = hex(address, digits);

      toast({
        // A chave e o destino: o mesmo `call` dentro de um laco reinicia o
        // aviso que ja esta na tela em vez de empilhar copias.
        key: `call:${address.toString()}`,
        variant: "warning",
        title: t("sim.externalCall", "Call to an address outside the program"),
        description: (
          <>
            <span className="font-mono">call {target}</span> —{" "}
            {t(
              "sim.externalCallHint",
              "There is no loaded code at that address, so the call was skipped and execution continued at the next instruction."
            )}{" "}
            <span className="text-white/70">
              {t(
                "sim.externalCallEffect",
                "Nothing was pushed and no register changed — the value the function would return does not exist here."
              )}
            </span>
          </>
        ),
      });
    },
    [t, toast]
  );

  /**
   * Avisa que a chamada de sistema foi ATENDIDA — por um modelo.
   *
   * O contraponto do aviso abaixo, e igualmente necessario: o efeito
   * aconteceu, entao nada na tela denuncia que ali nao houve kernel nenhum. O
   * valor que ficou no registrador de retorno e convencao nossa — aqui todo
   * `write` da certo e todo `read` devolve fim de arquivo, o que num sistema
   * de verdade dependeria do descritor, da permissao e do que ha do outro
   * lado. Quem levar esse retorno como real tira conclusao errada do proximo
   * `cmp`.
   */
  const announceSimulated = useCallback(
    ({ name, text, returnRegister, value }) => {
      toast({
        key: `syscall:simulated:${name}`,
        variant: "info",
        title: t("sim.syscallSimulatedTitle", "This system call was simulated"),
        description: (
          <>
            <span className="font-mono">{text}</span> —{" "}
            {t(
              "sim.syscallSimulatedHint",
              "No kernel ran here: what you see is this simulator's model of the call."
            )}{" "}
            <span className="text-white/70">
              {tf(
                "sim.syscallSimulatedEffect",
                {
                  register: returnRegister.toUpperCase(),
                  value: `0x${BigInt(value).toString(16).toUpperCase()}`,
                },
                "{register} was left with {value} by convention, not by a real result — here every write succeeds and every read reports end of input."
              )}
            </span>
          </>
        ),
      });
    },
    [t, tf, toast]
  );

  /**
   * Avisa que uma chamada de sistema nao tem simulacao.
   *
   * A execucao NAO parou: a chamada passou direto. Precisa ser dito porque o
   * unico efeito que deixou de acontecer e o RETORNO — e quem so olhasse o
   * registrador depois concluiria que a chamada devolveu o que ja estava la.
   *
   * Modal na primeira vez para cada chamada; repeticoes so atualizam a barra
   * de status.
   */
  const announceUnsimulated = useCallback(
    ({ name, number, text, reason }) => {
      toast({
        key: `syscall:${reason}:${name || number}`,
        variant: "info",
        title: t("sim.syscallSkipped", "This system call is not simulated"),
        description: (
          <>
            <span className="font-mono">{text}</span> —{" "}
            {reason === "windows"
              ? t(
                  "sim.syscallSkippedWindows",
                  "Windows syscall numbers change between builds, so there is nothing to resolve without the ntdll.dll of that build."
                )
              : t(
                  "sim.syscallSkippedHint",
                  "The simulator reproduces write, read, exit and execve; the others have no plausible effect to reproduce here."
                )}{" "}
            <span className="text-white/70">
              {t(
                "sim.syscallSkippedEffect",
                "Execution continued at the next instruction. No register changed — the value the call would return does not exist here."
              )}
            </span>
          </>
        ),
      });
    },
    [t, toast]
  );

  // Cada comando aplica o efeito na maquina e publica o diff para os paineis.
  const runCommand = useCallback(
    (command) => {
      const current = machineRef.current;
      if (!current) return;
      // O aviso na tela fala do passo ANTERIOR. Dado outro comando, ele deixa
      // de descrever o que se ve — some aqui, ANTES de executar, para o que
      // este passo tiver a dizer aparecer em seguida.
      dismissAll();
      // Comparar ANTES e DEPOIS: so a parada NOVA abre modal. Sem isso, cada
      // passo dado com o programa ja parado reabriria o mesmo aviso.
      const wasHalted = Boolean(current.halted);
      const result = command(current);
      if (result && result.changes) setChanges(result.changes);
      refresh();
      if (current.codeDirty) refreshDisassembly();
      if (result && result.externalCall) announceExternalCall(result.externalCall);
      if (result && result.unsimulated) announceUnsimulated(result.unsimulated);
      if (result && result.simulated) announceSimulated(result.simulated);
      if (!wasHalted && current.halted) announceHalt(current.halted);
      // O destaque da linha atual so serve se o fonte estiver a vista — e o
      // fonte a vista e, por construcao, o do programa em execucao: abrir
      // outro arquivo descarta o programa montado.
      showSource();
    },
    [announceExternalCall, announceHalt, announceSimulated, announceUnsimulated, dismissAll,
     refresh, refreshDisassembly, showSource]
  );

  const stepInto = useCallback(() => runCommand((m) => m.step()), [runCommand]);
  const stepOver = useCallback(() => runCommand((m) => m.stepOver()), [runCommand]);
  const skip = useCallback(() => runCommand((m) => m.skip()), [runCommand]);
  const stepBack = useCallback(
    () =>
      runCommand((m) => {
        m.stepBack();
        // Voltar nao tem "o que mudou": o destaque some junto.
        return { changes: { registers: [], flags: [], memory: [] } };
      }),
    [runCommand]
  );
  const reset = useCallback(
    () =>
      runCommand((m) => {
        m.reset();
        return { changes: { registers: [], flags: [], memory: [] } };
      }),
    [runCommand]
  );

  /**
   * Atalhos do x64dbg (F7/F8), mais os nossos: F9 monta, Ctrl+F7 desfaz o
   * passo, Ctrl+F2 reinicia, Ctrl/Cmd+S salva.
   *
   * Valem em QUALQUER lugar, o editor de codigo incluido. Deixar o textarea de
   * fora nao "protegia" nada: a tecla escapava para o navegador, e F7 no
   * Firefox abre o dialogo de navegacao por cursor. Toda tecla tratada leva
   * preventDefault — e o que impede tanto esse dialogo quanto o "salvar pagina
   * como" do Ctrl+S.
   */
  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
        return;
      }

      if (event.key === "F9") {
        event.preventDefault();
        assemble();
        return;
      }
      if (event.key === "F8" && event.ctrlKey) {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key === "F7" && event.ctrlKey) {
        event.preventDefault();
        stepBack();
        return;
      }
      if (event.key === "F2" && event.ctrlKey) {
        event.preventDefault();
        reset();
        return;
      }
      if (event.key === "F7") {
        event.preventDefault();
        stepInto();
      } else if (event.key === "F8") {
        event.preventDefault();
        stepOver();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [assemble, handleSave, reset, skip, stepBack, stepInto, stepOver]);

  /**
   * Impede o navegador de ABRIR um arquivo solto fora da biblioteca.
   *
   * O comportamento padrao de um drop em qualquer ponto da pagina e navegar
   * para o arquivo — o que descartaria a sessao inteira sem aviso. A biblioteca
   * chama `stopPropagation` no seu proprio drop, entao continua funcionando.
   */
  useEffect(() => {
    const swallow = (event) => {
      event.preventDefault();
      if (event.type === "drop" && event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const toggleBreakpoint = useCallback(
    (address) => {
      if (!machineRef.current) return;
      machineRef.current.toggleBreakpoint(address);
      refresh();
    },
    [refresh]
  );

  // Sem useMemo de proposito: `machine` e mutavel e sua identidade nao muda a
  // cada passo, entao a memoizacao devolveria sempre o primeiro valor. O
  // `tick` no corpo do componente e o que garante o recalculo por render.
  void tick;
  const status = describeStatus(machine, t);
  const canStep = Boolean(machine) && !machine.halted;
  // Linha do fonte correspondente a instrucao atual. Vem do listing do nasm,
  // entao so existe quando a correspondencia e exata — bytes de dados no meio
  // do codigo, por exemplo, nao tem linha a destacar.
  const currentLine = machine?.currentInstruction?.line ?? null;
  const canStepBack = Boolean(machine) && machine.history.length > 0;
  // Pular vale mesmo PARADO: e o jeito de sair de uma instrucao que o
  // simulador nao cobre. So nao vale quando nao ha instrucao sob o ponteiro.
  // Quais tipos existem para o alvo. Chega uma vez e habilita o botao de ler
  // ponteiro como estrutura nas linhas de argumento.
  useEffect(() => {
    if (os) loadTypeNames(os, arch).then(() => refresh());
  }, [os, arch, refresh]);

  const canSkip = Boolean(machine?.currentInstruction);

  // Quais paineis de chamada estao na tela agora. A condicao e a mesma que os
  // proprios paineis aplicam; aqui ela decide se a divisoria aparece junto.
  const currentInsn = machine?.halted ? null : machine?.currentInstruction;
  const showsCall = Boolean(currentInsn && !currentInsn.data
    && currentInsn.groups?.includes("call"));
  const showsSyscall = Boolean(currentInsn && syscallGate(currentInsn));

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#1e1e1e] text-[#d4d4d4]">
      {/* Cabecalho */}
      <header className="flex shrink-0 items-center gap-4 border-b border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2">
        <img src={brand.logoDark} alt={brand.name} className="h-5 w-auto" />
        <span className="text-[13px] font-semibold">{t("sim.title", "Assembly Simulator")}</span>

        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[#9a9a9a]">
          {t("sim.arch", "Architecture")}
          <select
            value={arch}
            onChange={(event) => handleArchChange(event.target.value)}
            className="rounded bg-[#3c3c3c] px-1.5 py-0.5 text-[11px] text-[#d4d4d4] outline-none"
          >
            {Object.values(ARCH).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {/* Alvo: decide a tabela de syscalls. "Detectar" deixa o fonte falar;
            escolher fixa, e o valor vai para o metadado do arquivo. */}
        <label className="flex items-center gap-1.5 text-[11px] text-[#9a9a9a]">
          {t("sim.os", "Target")}
          {/* O glifo fica FORA do <select>: o navegador desenha a lista com a
              fonte do sistema, onde ele nao existe. */}
          {os && (
            <span className="font-dump text-[13px] text-[#dcb67a]" title={OS[os]?.label}>
              {osIcon(os)}
            </span>
          )}
          <select
            value={os || ""}
            onChange={(event) => setOs(event.target.value || null)}
            className="rounded bg-[#3c3c3c] px-1.5 py-0.5 text-[11px] text-[#d4d4d4] outline-none"
          >
            <option value="">{t("sim.osAuto", "Detect")}</option>
            {OS_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <LayoutInput
          label={t("sim.codeBase", "Code base")}
          value={codeBase}
          onChange={setCodeBase}
        />
        <LayoutInput
          label={t("sim.stackTop", "Stack top")}
          value={stackTop}
          onChange={setStackTop}
        />

        {/* Quantos argumentos mostrar quando a instrucao atual for um call. */}
        <label className="flex items-center gap-1.5 text-[11px] text-[#9a9a9a]">
          {t("sim.argCount", "Args")}
          <input
            type="number"
            min={0}
            max={16}
            value={argCount}
            onChange={(event) =>
              setArgCount(Math.max(0, Math.min(16, Number(event.target.value) || 0)))
            }
            // Os botoes de incremento do input[type=number] comem largura: em
            // 5ch o proprio valor ficava cortado.
            className="w-16 rounded bg-[#3c3c3c] px-1.5 py-0.5 text-[11px] text-[#d4d4d4] outline-none"
          />
        </label>

        <select
          value={lang}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label={t("common.language", "Language")}
          className="rounded bg-[#3c3c3c] px-1.5 py-0.5 text-[11px] text-[#d4d4d4] outline-none"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <AboutButton onClick={() => setAboutOpen(true)} />
      </header>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <NtdllModal
        open={ntdllOpen}
        onClose={() => setNtdllOpen(false)}
        arch={arch}
        onLoaded={() => refresh()}
      />

      <ImportBinaryWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleBinaryImported}
        defaults={{ arch, os, baseAddress: codeBase }}
      />

      <Toolbar
        onAssemble={assemble}
        onStepInto={stepInto}
        onStepOver={stepOver}
        onSkip={skip}
        onStepBack={stepBack}
        onReset={reset}
        canStep={canStep}
        canStepBack={canStepBack}
        canSkip={canSkip}
        busy={busy}
      />

      {/* Corpo: desmontagem + registradores em cima, fonte + pilha embaixo */}
      {/* Corpo. Cada divisoria e um <Splitter> arrastavel; os paineis que
          crescem sozinhos usam flex-1, os demais tem altura/largura fixa que o
          arrasto ajusta. */}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[#3c3c3c]">
        {/* Coluna esquerda: desmontagem, operandos e codigo-fonte */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <DisassemblyPane
              machine={machine}
              instructions={instructions}
              currentAddress={machine ? machine.cpu.ip : null}
              breakpoints={machine ? machine.breakpoints : new Set()}
              onToggleBreakpoint={toggleBreakpoint}
              halted={machine?.halted || null}
            />
          </div>

          <Splitter
            label={t("sim.resizeOperands", "Resize operands panel")}
            onResize={(delta) => resizePane("operands", -delta, { min: 48, max: 600 })}
          />
          <div style={{ height: paneSizes.operands }} className="shrink-0 overflow-hidden">
            <OperandsPane machine={machine} tick={tick} onViewInDump={viewInDump} />
          </div>

          {/* Ponteiro lido como estrutura. Fica na coluna da esquerda, dividindo
              a altura com o editor: e leitura demorada, e a pilha ao lado
              continua visivel para comparar endereco por endereco. */}
          {parsed && (
            <>
              <Splitter
                label={t("sim.resizeStruct", "Resize structure panel")}
                onResize={(delta) => resizePane("struct", -delta, { min: 80, max: 900 })}
              />
              <div style={{ height: paneSizes.struct }} className="shrink-0 overflow-hidden">
                <StructPane
                  machine={machine}
                  target={parsed}
                  tick={tick}
                  onClose={() => setParsed(null)}
                  onViewInDump={viewInDump}
                />
              </div>
            </>
          )}

          <Splitter
            label={t("sim.resizeSource", "Resize source panel")}
            onResize={(delta) => resizePane("source", -delta, { min: 80, max: 1200 })}
          />
          <div style={{ height: paneSizes.source }} className="shrink-0 overflow-hidden">
            <EditorPane
              source={source}
              onSourceChange={setSource}
              params={params}
              onOpenFile={handleOpenFile}
              dirty={dirty}
              onSave={handleSave}
              onSaved={handleSaved}
              saveAs={saveAs}
              onSaveAsHandled={clearSaveAs}
              savedTick={savedTick}
              onImported={handleImported}
              focusSource={focusSource}
              onBeforeOpen={confirmDiscardRun}
              onCloseFile={handleCloseFile}
              onImportBinary={openImport}
              messages={messages}
              busy={busy}
              currentLine={currentLine}
              openFile={openFile}
              onOpenFileChange={setOpenFile}
              machine={machine}
              changedMemory={changes.memory}
              dumpTarget={dumpTarget}
              tick={tick}
            />
          </div>
        </div>

        <Splitter
          direction="vertical"
          label={t("sim.resizeColumns", "Resize columns")}
          onResize={(delta) => resizePane("rightColumn", -delta, { min: 260, max: 900 })}
        />

        {/* Coluna direita: registradores, flags, argumentos e pilha */}
        <div
          style={{ width: paneSizes.rightColumn }}
          className="flex shrink-0 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            <RegistersPane
              machine={machine}
              changed={changes.registers}
              onViewInDump={viewInDump}
            />
          </div>
          <FlagsPane machine={machine} changed={changes.flags} />
          {/* So aparece quando a instrucao atual e um `call`. */}
          {/* A divisoria so aparece com o painel: uma alca para redimensionar
              o que nao esta na tela seria um controle sem efeito. */}
          {showsCall && (
            <>
              <Splitter
                label={t("sim.resizeCallArgs", "Resize call arguments panel")}
                onResize={(delta) => resizePane("callArgs", -delta, { min: 60, max: 600 })}
              />
              <div style={{ height: paneSizes.callArgs }} className="shrink-0 overflow-hidden">
                <CallPane
                  machine={machine}
                  count={argCount}
                  convention={convention}
                  onConventionChange={setConvention}
                  tick={tick}
                  onNameChange={refresh}
                  onParse={setParsed}
                  onViewInDump={viewInDump}
                />
              </div>
            </>
          )}

          {/* ...e este quando ela e `int 0x80`/`syscall`. Os dois se excluem:
              uma instrucao nao e chamada e porta de kernel ao mesmo tempo. */}
          {showsSyscall && (
            <>
              <Splitter
                label={t("sim.resizeSyscall", "Resize system call panel")}
                onResize={(delta) => resizePane("syscall", -delta, { min: 60, max: 600 })}
              />
              <div style={{ height: paneSizes.syscall }} className="shrink-0 overflow-hidden">
                <SyscallPane
                  machine={machine}
                  count={argCount}
                  tick={tick}
                  onImportNtdll={() => setNtdllOpen(true)}
                  onNameChange={refresh}
                  onParse={setParsed}
                  onViewInDump={viewInDump}
                />
              </div>
            </>
          )}

          <Splitter
            label={t("sim.resizeStack", "Resize stack panel")}
            onResize={(delta) => resizePane("stack", -delta, { min: 80, max: 1200 })}
          />
          <div style={{ height: paneSizes.stack }} className="shrink-0 overflow-hidden">
            <StackPane machine={machine} changed={changes.memory} onViewInDump={viewInDump} />
          </div>
        </div>
      </div>

      {/* Barra de status */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-[#3c3c3c] bg-[#007acc] px-3 py-1 font-mono text-[11px] text-white">
        <span className="min-w-0 truncate">{status}</span>
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {notice && (
            <span className="flex items-center gap-1.5 rounded bg-white/20 px-2 py-0.5">
              <Check size={12} />
              {notice.message}
            </span>
          )}
          {machine && (
            <span>
              {t("sim.steps", "Steps")}: {machine.stepCount}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

function LayoutInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[#9a9a9a]">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        // 20ch: um endereco de 64 bits tem 18 caracteres com o "0x".
        className="w-[20ch] rounded bg-[#3c3c3c] px-1.5 py-0.5 font-mono text-[11px] text-[#d4d4d4] outline-none"
      />
    </label>
  );
}

/** Texto da barra de status: pronto, ou o motivo da parada. */
function describeStatus(machine, t) {
  if (!machine) return t("sim.statusIdle", "No program loaded — assemble to start.");
  if (!machine.halted) {
    const insn = machine.currentInstruction;
    const digits = machine.arch.bits === 64 ? 16 : 8;
    return insn
      ? `${hex(machine.cpu.ip, digits)}  ${insn.text}`
      : t("sim.statusReady", "Ready.");
  }

  const detail = machine.halted.message ? ` (${machine.halted.message})` : "";
  return `${haltLabel(machine.halted.reason, t)}${detail}`;
}

/** Texto de um motivo de parada. */
function haltLabel(reason, t) {
  const labels = {
    [HALT.END_OF_PROGRAM]: t("sim.halt.endOfProgram", "End of program."),
    [HALT.NO_INSTRUCTION]: t("sim.halt.noInstruction", "No instruction at this address."),
    [HALT.DATA]: t("sim.halt.data", "These bytes are data, not an instruction."),
    [HALT.UNSUPPORTED]: t("sim.halt.unsupported", "Instruction not supported by the simulator."),
    [HALT.SYSCALL]: t("sim.halt.syscall", "System call not simulated."),
    [HALT.EXITED]: t("sim.halt.exited", "Program exited."),
    [HALT.EXECVE]: t("sim.halt.execve", "Program replaced itself (execve)."),
    [HALT.STACK_OVERFLOW]: t("sim.halt.stackOverflow", "Stack overflow."),
    [HALT.STEP_LIMIT]: t("sim.halt.stepLimit", "Step limit reached (possible infinite loop)."),
    [HALT.ERROR]: t("sim.halt.error", "Simulation error."),
  };
  return labels[reason] || reason;
}

/**
 * Paradas que merecem um modal, e com que tom.
 *
 * Ausente daqui = a execucao apenas chegou ao fim do codigo carregado. Isso a
 * barra de status ja diz, e um modal a cada vez viraria ruido. O que entra sao
 * as paradas que o PROGRAMA causou — e que, num shellcode, sao justamente o
 * resultado que se queria ver.
 */
const HALT_ALERTS = {
  [HALT.EXECVE]: "success",
  [HALT.EXITED]: "success",
  [HALT.SYSCALL]: "info",
  [HALT.UNSUPPORTED]: "warning",
  [HALT.STEP_LIMIT]: "warning",
  [HALT.STACK_OVERFLOW]: "danger",
  [HALT.ERROR]: "danger",
};
