import React, { useCallback, useRef, useState } from "react";
import { AlertTriangle, Binary, Check, FileUp } from "lucide-react";
import { Modal } from "components/ui/modal";
import { Button } from "components/ui/button";
import { useI18n } from "i18n";
import { cn } from "lib/utils";
import api from "lib/api";
import { ARCH } from "lib/cpu/registers";
import { OS_OPTIONS } from "lib/cpu/os";

// O mesmo teto do backend (views/program.py:MAX_IMPORT_BYTES). Repetido aqui
// para o aviso sair ANTES do upload — mandar 40 MB para receber um 400 seria
// uma espera a toa.
export const MAX_IMPORT_BYTES = 4 * 1024;

const STEPS = ["file", "target", "result"];

/** True se o endereco cabe no espaco de enderecamento da arquitetura. */
function fitsArch(address, arch) {
  try {
    const value = BigInt(String(address).trim());
    const bits = BigInt(ARCH[arch]?.bits || 64);
    return value >= 0n && value < 1n << bits;
  } catch {
    return false;
  }
}

/**
 * Import de binario, em tres passos.
 *
 * Um passo so nao daria: a desmontagem depende da arquitetura, e ler bytes de
 * 64 bits como 32 produz instrucoes plausiveis e completamente erradas. Perguntar
 * DEPOIS de escolher o arquivo, e antes de decodificar, e a unica ordem em que
 * cada resposta chega a tempo de ser usada.
 *
 * O resultado e codigo-fonte editavel, nao uma listagem: o aluno abre no editor,
 * mexe, e decide se salva na biblioteca.
 */
export default function ImportBinaryWizard({ open, onClose, onImported, defaults }) {
  const { t, tf } = useI18n();
  const inputRef = useRef(null);

  const [step, setStep] = useState("file");
  const [file, setFile] = useState(null);
  const [arch, setArch] = useState(defaults?.arch || "x86");
  const [os, setOs] = useState(defaults?.os || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setStep("file");
    setFile(null);
    setError(null);
    setResult(null);
    setBusy(false);
  }, []);

  const close = () => {
    reset();
    onClose();
  };

  const pick = (chosen) => {
    setError(null);
    if (!chosen) return;
    if (chosen.size === 0) {
      setError(t("sim.binaryEmpty", "This file is empty."));
      return;
    }
    if (chosen.size > MAX_IMPORT_BYTES) {
      setError(tf(
        "sim.binaryTooLargeHint",
        { limit: (MAX_IMPORT_BYTES / 1024).toFixed(0), size: (chosen.size / 1024).toFixed(1) },
        "The limit is {limit} KB; this file has {size} KB."
      ));
      return;
    }
    setFile(chosen);
    setStep("target");
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("arch", arch);
      // A base so viaja se couber na arquitetura ESCOLHIDA AQUI. A barra pode
      // estar com o layout de 64 bits enquanto o binario e de 32, e um
      // programa de 32 bits acima de 0xFFFFFFFF quebra no primeiro salto: o
      // alvo e calculado com aritmetica de 32 e nao casa mais com o endereco
      // da instrucao. Sem a base, o servidor usa o padrao da arquitetura.
      if (defaults?.baseAddress && fitsArch(defaults.baseAddress, arch)) {
        form.append("base_address", defaults.baseAddress);
      }

      const { data } = await api.post("/api/program/import/", form);
      setResult(data);
      setStep("result");
    } catch (err) {
      setError(err.response?.data?.detail || String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    // A base vem do SERVIDOR: e a mesma com que o `org` do fonte foi gerado.
    // Adotar outra faria o codigo montar num endereco e a maquina carregar em
    // outro.
    onImported({
      source: result.source, arch, os, name: file.name,
      baseAddress: result.base_address,
    });
    close();
  };

  const suspect = result?.analysis?.verdict === "suspect";

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : close}
      size="xl"
      title={t("sim.importBinary", "Import binary")}
      icon={
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
          <Binary className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
      }
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          {step === "target" && (
            <Button onClick={run} loading={busy}>
              {t("sim.importDisassemble", "Disassemble")}
            </Button>
          )}
          {step === "result" && (
            <Button
              onClick={finish}
              variant={suspect ? "destructive" : "default"}
            >
              {suspect
                ? t("sim.binaryAnyway", "Open anyway")
                : t("sim.importOpen", "Open in the editor")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-left">
        <Steps current={step} />

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-500">
            {error}
          </p>
        )}

        {step === "file" && (
          <div>
            <button
              type="button"
              onClick={() => inputRef.current.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 transition-colors hover:border-primary hover:bg-accent"
            >
              <FileUp className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t("sim.importPick", "Choose a binary file")}
              </span>
              <span className="text-xs text-muted-foreground">
                {tf("sim.importLimit", { limit: MAX_IMPORT_BYTES / 1024 },
                    "Raw machine code, up to {limit} KB")}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                // Zerar permite reescolher o MESMO arquivo depois de um erro.
                event.target.value = "";
                pick(chosen);
              }}
            />
          </div>
        )}

        {step === "target" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tf("sim.importFileChosen", { name: file?.name, size: file?.size },
                  "{name} — {size} bytes")}
            </p>

            <Choice
              label={t("sim.arch", "Architecture")}
              hint={t("sim.importArchHint",
                      "Reading 64-bit code as 32-bit produces plausible and completely wrong instructions.")}
              options={Object.values(ARCH).map((item) => ({ value: item.id, label: item.label }))}
              value={arch}
              onChange={setArch}
            />

            <Choice
              label={t("sim.os", "Target")}
              hint={t("sim.importOsHint", "Decides which syscall table the numbers are read against.")}
              options={OS_OPTIONS.map((item) => ({
                value: item.id, label: item.label, icon: item.icon,
              }))}
              value={os}
              onChange={setOs}
            />
          </div>
        )}

        {step === "result" && result && (
          <Result result={result} suspect={suspect} />
        )}
      </div>
    </Modal>
  );
}

function Steps({ current }) {
  const { t } = useI18n();
  const labels = {
    file: t("sim.importStepFile", "File"),
    target: t("sim.importStepTarget", "Target"),
    result: t("sim.importStepResult", "Result"),
  };
  const index = STEPS.indexOf(current);

  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((step, position) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
              position < index && "bg-primary/20 text-primary",
              position === index && "bg-primary text-primary-foreground",
              position > index && "border border-border text-muted-foreground"
            )}
          >
            {position < index ? <Check className="h-3 w-3" /> : position + 1}
          </span>
          <span className={position === index ? "font-medium" : "text-muted-foreground"}>
            {labels[step]}
          </span>
          {position < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  );
}

function Choice({ label, hint, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
              value === option.value
                ? "border-primary bg-accent"
                : "border-border hover:border-primary"
            )}
          >
            {option.icon && (
              <span className="font-dump text-base leading-none">{option.icon}</span>
            )}
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Analise + previa do fonte reconstruido. */
function Result({ result, suspect }) {
  const { t, tf } = useI18n();
  const { analysis } = result;

  const reason = (key) =>
    tf(
      key,
      {
        percent: key === "analysis.text"
          ? Math.round(analysis.printable_ratio * 100)
          : Math.round(analysis.undecodable_ratio * 100),
      },
      key
    );

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-lg border p-3",
          suspect
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-emerald-500/40 bg-emerald-500/5"
        )}
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          {suspect ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <Check className="h-4 w-4 text-emerald-500" />
          )}
          {suspect
            ? t("sim.binarySuspect", "This does not look like machine code")
            : t("sim.binaryOk", "This looks like machine code")}
        </p>

        {suspect && (
          <>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {analysis.reasons.map((key) => (
                <li key={key}>{reason(key)}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("sim.binarySuspectHint",
                 "Disassembling it anyway will produce instructions, but they will be meaningless — any sequence of bytes decodes into something.")}
            </p>
          </>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          {tf("sim.binaryStats",
              { size: analysis.size, count: analysis.instructions,
                percent: Math.round(analysis.undecodable_ratio * 100) },
              "{size} bytes · {count} instructions · {percent}% undecodable")}
        </p>
      </div>

      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-[1.5]">
        {result.source}
      </pre>
    </div>
  );
}
