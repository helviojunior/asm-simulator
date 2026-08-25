/**
 * Motivos de parada da simulacao.
 *
 * Em modulo proprio para quebrar o ciclo de imports: `machine` precisa das
 * instrucoes para executar, e as instrucoes precisam sinalizar parada.
 */

export const HALT = {
  END_OF_PROGRAM: "endOfProgram",
  NO_INSTRUCTION: "noInstruction",
  // Bytes que o desmontador nao reconheceu como instrucao — tipicamente
  // uma string embutida na secao de codigo (tecnica JMP-CALL-POP).
  DATA: "data",
  UNSUPPORTED: "unsupported",
  // Syscall reconhecida mas sem simulacao plausivel (open, socket, ...).
  SYSCALL: "syscall",
  // exit()/exit_group(): fim normal do programa.
  EXITED: "exited",
  // execve(): o shellcode chegou ao objetivo.
  EXECVE: "execve",
  STACK_OVERFLOW: "stackOverflow",
  STEP_LIMIT: "stepLimit",
  ERROR: "error",
};

/** Parada controlada, lancada de dentro de uma instrucao. */
export class MachineHalt extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
