import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import api from "lib/api";
import brand from "lib/brand";
import { useI18n, LANGUAGE_OPTIONS } from "i18n";
import { useDialog } from "contexts/DialogContext";
import { Machine } from "lib/cpu/machine";
import { HALT } from "lib/cpu/halt";
import { ARCH } from "lib/cpu/registers";
import { defaultConvention } from "lib/cpu/inspect";
import { findArchMismatch } from "lib/asm/archCheck";
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
import Splitter from "components/debugger/Splitter";
import AboutModal, { AboutButton } from "components/AboutModal";
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
  const { alert, confirm } = useDialog();

  const [arch, setArch] = useState("x86");
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
  // Quantos argumentos inspecionar num `call`. A aridade real e desconhecida,
  // entao quem decide e quem esta olhando.
  const [argCount, setArgCount] = useState(4);
  const [convention, setConvention] = useState(() => defaultConvention("x86"));
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

  // A maquina e mutavel por natureza (e um modelo de CPU). Guardamos a
  // instancia numa ref e usamos `tick` apenas para pedir novo render — assim
  // nao clonamos o estado inteiro a cada passo.
  const machineRef = useRef(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const machine = machineRef.current;

  // Trocar de arquitetura reaproveita o layout tipico de cada uma.
  const handleArchChange = (value) => {
    setArch(value);
    setCodeBase(DEFAULT_LAYOUT[value].codeBase);
    setStackTop(DEFAULT_LAYOUT[value].stackTop);
    setConvention(defaultConvention(value));
  };

  // Parametros de execucao em vigor. Vao para a biblioteca no salvamento: sao
  // do ARQUIVO, nao da sessao.
  const params = { arch, codeBase, stackTop, argCount };

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
      codeBase: fileParams?.codeBase || DEFAULT_LAYOUT[nextArch].codeBase,
      stackTop: fileParams?.stackTop || DEFAULT_LAYOUT[nextArch].stackTop,
      argCount: Math.max(0, Math.min(16, fileParams?.argCount ?? 4)),
    };

    setArch(next.arch);
    setConvention(defaultConvention(next.arch));
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

  /** Volta ao estado "nada montado": nao ha programa a inspecionar. */
  const discardProgram = () => {
    machineRef.current = null;
    setInstructions([]);
    setLineMap({});
    setMessages([]);
    setChanges({ registers: [], flags: [], memory: [] });
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
        codeBase !== baseline.codeBase ||
        stackTop !== baseline.stackTop ||
        argCount !== baseline.argCount
      )
    : Boolean(source.trim());

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
   * Salva no arquivo aberto.
   *
   * Sem arquivo aberto nao ha onde gravar: o pedido vira "salvar como" e quem
   * conduz e a biblioteca, que tem a arvore para escolher a pasta e o campo de
   * nome. Esse e o unico caso em que salvar troca de aba.
   */
  const handleSave = useCallback(async () => {
    if (!source.trim()) return;
    if (!openFile) {
      setSaveAs(true);
      return;
    }
    if (!dirty) return;

    const snapshot = { source, arch, codeBase, stackTop, argCount };
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
  }, [alert, arch, argCount, codeBase, dirty, notify, openFile, source, stackTop, t, tf]);

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
      setBaseline({ source, arch, codeBase, stackTop, argCount });
      notify(tf("library.savedFile", { name }, 'File "{name}" saved.'));
    },
    [arch, argCount, codeBase, notify, source, stackTop, tf]
  );

  const assemble = useCallback(async () => {
    setBusy(true);
    setMessages([]);
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
      const next = new Machine({ arch, codeBase: base, stackTop: top });
      next.load({ bytes, instructions: data.instructions });

      machineRef.current = next;
      showSource();
      setInstructions(data.instructions);
      setLineMap(data.line_map || {});
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
  }, [alert, arch, codeBase, confirm, refresh, showSource, source, stackTop, t, tf]);

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
  }, [lineMap, refresh]);

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

  // Cada comando aplica o efeito na maquina e publica o diff para os paineis.
  const runCommand = useCallback(
    (command) => {
      const current = machineRef.current;
      if (!current) return;
      // Comparar ANTES e DEPOIS: so a parada NOVA abre modal. Sem isso, cada
      // passo dado com o programa ja parado reabriria o mesmo aviso.
      const wasHalted = Boolean(current.halted);
      const result = command(current);
      if (result && result.changes) setChanges(result.changes);
      refresh();
      if (current.codeDirty) refreshDisassembly();
      if (!wasHalted && current.halted) announceHalt(current.halted);
      // O destaque da linha atual so serve se o fonte estiver a vista — e o
      // fonte a vista e, por construcao, o do programa em execucao: abrir
      // outro arquivo descarta o programa montado.
      showSource();
    },
    [announceHalt, refresh, refreshDisassembly, showSource]
  );

  const stepInto = useCallback(() => runCommand((m) => m.step()), [runCommand]);
  const stepOver = useCallback(() => runCommand((m) => m.stepOver()), [runCommand]);
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
  }, [assemble, handleSave, reset, stepBack, stepInto, stepOver]);

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

      <Toolbar
        onAssemble={assemble}
        onStepInto={stepInto}
        onStepOver={stepOver}
        onStepBack={stepBack}
        onReset={reset}
        canStep={canStep}
        canStepBack={canStepBack}
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
            <OperandsPane machine={machine} tick={tick} />
          </div>

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
              messages={messages}
              busy={busy}
              currentLine={currentLine}
              openFile={openFile}
              onOpenFileChange={setOpenFile}
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
            <RegistersPane machine={machine} changed={changes.registers} />
          </div>
          <FlagsPane machine={machine} changed={changes.flags} />
          {/* So aparece quando a instrucao atual e um `call`. */}
          <CallPane
            machine={machine}
            count={argCount}
            convention={convention}
            onConventionChange={setConvention}
            tick={tick}
          />
          {/* ...e este quando ela e `int 0x80`/`syscall`. Os dois se excluem:
              uma instrucao nao e chamada e porta de kernel ao mesmo tempo. */}
          <SyscallPane machine={machine} count={argCount} tick={tick} />

          <Splitter
            label={t("sim.resizeStack", "Resize stack panel")}
            onResize={(delta) => resizePane("stack", -delta, { min: 80, max: 1200 })}
          />
          <div style={{ height: paneSizes.stack }} className="shrink-0 overflow-hidden">
            <StackPane machine={machine} changed={changes.memory} />
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
