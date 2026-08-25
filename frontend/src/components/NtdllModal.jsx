import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileUp, Library, Trash2 } from "lucide-react";
import { Modal } from "components/ui/modal";
import { Button } from "components/ui/button";
import { useI18n } from "i18n";
import { ARCH } from "lib/cpu/registers";
import { clearNtdll, importNtdll, ntdllSummary, refreshNtdll } from "lib/ntdll";

/**
 * Import da ``ntdll.dll`` para resolver numeros de syscall do Windows.
 *
 * O Windows nao tem SSN estavel: o numero de `NtCreateFile` muda entre builds.
 * Mas ele E determinado assim que se sabe DE QUAL build se fala — e quem sabe
 * disso e a ntdll daquela maquina, onde cada stub exportado comeca com um
 * `mov eax, <SSN>`.
 *
 * A tabela vive em memoria no servidor e some quando o container reinicia. E
 * de proposito: ela vale para UMA build, e uma copia esquecida resolveria
 * numeros para os nomes errados meses depois, com toda a confianca.
 */
export default function NtdllModal({ open, onClose, arch, onLoaded }) {
  const { t, tf } = useI18n();
  const inputRef = useRef(null);

  const [summary, setSummary] = useState(() => ntdllSummary(arch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sync = useCallback(async () => {
    try {
      setSummary(await refreshNtdll(arch));
    } catch {
      // Status indisponivel nao e erro do aluno: o modal simplesmente mostra
      // "nenhuma carregada" e o import continua funcionando.
      setSummary(null);
    }
  }, [arch]);

  useEffect(() => {
    if (open) sync();
  }, [open, sync]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const data = await importNtdll(file);
      setSummary({ count: data.count, origin: data.origin, exports: data.exports });
      onLoaded?.(data);
    } catch (err) {
      setError(err.response?.data?.detail || String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const unload = async () => {
    setBusy(true);
    try {
      await clearNtdll(arch);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      size="lg"
      title={t("ntdll.title", "Import ntdll.dll")}
      icon={
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
          <Library className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
      }
      footer={
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t("common.close", "Close")}
        </Button>
      }
    >
      <div className="space-y-4 text-left">
        <p className="text-sm text-muted-foreground">
          {t(
            "ntdll.why",
            "Windows has no stable syscall number — it changes between builds. Import the ntdll.dll of the build you are studying and the numbers resolve to function names."
          )}
        </p>

        {summary ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-emerald-500" />
              {tf(
                "ntdll.loaded",
                { count: summary.count, arch: ARCH[arch]?.label || arch },
                "{count} syscalls loaded for {arch}"
              )}
            </p>
            {summary.origin && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">{summary.origin}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={unload}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("ntdll.unload", "Unload")}
            </Button>
          </div>
        ) : (
          <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
            {tf("ntdll.none", { arch: ARCH[arch]?.label || arch },
                "No table loaded for {arch}.")}
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => inputRef.current.click()}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
        >
          <FileUp className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {summary
              ? t("ntdll.replace", "Import another ntdll.dll")
              : t("ntdll.pick", "Choose ntdll.dll")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("ntdll.where", "Usually at C:\\Windows\\System32\\ntdll.dll")}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dll,application/octet-stream"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            upload(file);
          }}
        />

        <p className="text-xs text-muted-foreground">
          {t(
            "ntdll.volatile",
            "The table is kept in memory only: restarting the container clears it, and nothing is written to disk."
          )}
        </p>
      </div>
    </Modal>
  );
}
