import { writeTerminalError, writeTerminalOutput } from '../../ui';
import { isOutputLost, outputState, settleOutput } from '../closed-output';
import { formatCliError } from '../error-output';

/**
 * El asistente sigue despues de un error y pregunta: con una salida rota, lo primero se perderia y lo segundo seria a
 * ciegas (ERR-18). Solo el asistente: un comando con flags termina lo que se le pidio.
 */
let assistantRunning = false;

/** Para quien pregunta tambien desde un comando: ahi no se espera ni un turno antes de escuchar el teclado. */
export function isAssistantRunning(): boolean {
  return assistantRunning;
}

export async function withOutputGuard(run: () => Promise<void>): Promise<void> {
  assistantRunning = true;

  try {
    await run();
  } finally {
    assistantRunning = false;
  }
}

/**
 * Antes de cada pregunta y de emitir: si lo mostrado hasta aca no se pudo escribir, no se sigue. Sale como un Ctrl+C,
 * que todos los flujos ya dejan pasar hasta el menu, y el menu, al volver a preguntar, termina. El aviso y el codigo
 * los pone `index.ts`, tambien si la cerro quien la leia: aca no es `| head`, es alguien que ya no ve las preguntas.
 */
export async function assertOutputVisible(): Promise<void> {
  if (!assistantRunning) {
    return;
  }

  await settleOutput('stdout');

  if (!isOutputLost('stdout')) {
    return;
  }

  const closed = outputState.closed.get('stdout');

  if (closed && !outputState.failures.has('stdout')) {
    outputState.failures.set('stdout', closed);
  }

  throw Object.assign(new Error('No se puede escribir la salida.'), { name: 'ExitPromptError' });
}

/** Un error con el que el asistente sigue. Va a stderr y, si ahi se pierde (se sabe un turno despues), a stdout. */
export async function showAssistantError(error: unknown): Promise<void> {
  if (!isOutputLost('stderr')) {
    writeTerminalError(() => formatCliError(error, false));
    await settleOutput('stderr');
  }

  if (isOutputLost('stderr')) {
    writeTerminalOutput(formatCliError(error, false));
  }
}
