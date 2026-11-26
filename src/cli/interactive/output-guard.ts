import { isOutputLost, outputState, settleOutput } from '../closed-output';
import { promptCancellation } from '../prompt-cancellation';

/**
 * El asistente sigue despues de un error y pregunta: con una salida rota, lo primero se perderia y lo segundo seria a
 * ciegas (ERR-18). Solo el asistente: un comando con flags termina lo que se le pidio.
 */
let assistantRunning = false;

let assistantOpened = false;

/** Si en esta corrida se abrio el asistente, que no tiene salida JSON. */
export function wasAssistantOpened(): boolean {
  return assistantOpened;
}

export async function withOutputGuard(run: () => Promise<void>): Promise<void> {
  assistantRunning = true;
  assistantOpened = true;

  try {
    await run();
  } finally {
    assistantRunning = false;
  }
}

/**
 * Antes de emitir (y de cada pregunta): si lo mostrado hasta aca no se pudo escribir, no se sigue. Sale como un Ctrl+C,
 * que todos los flujos ya dejan pasar hasta el menu, y el menu, al volver a preguntar, termina. El aviso y el codigo
 * los pone `index.ts`, tambien si la cerro quien la leia: aca no es `| head`, es alguien que ya no ve las preguntas.
 */
export async function assertOutputVisible(): Promise<void> {
  if (!assistantRunning) {
    return;
  }

  await settleOutput('stdout');
  throwIfOutputLost();
}

function throwIfOutputLost(): void {
  if (!isOutputLost('stdout')) {
    return;
  }

  const closed = outputState.closed.get('stdout');

  if (closed && !outputState.failures.has('stdout')) {
    outputState.failures.set('stdout', closed);
  }

  throw promptCancellation('No se puede escribir la salida.');
}

/**
 * Abre una pregunta. En el asistente, no la abre con stdout roto y, si se rompe mientras espera (por ejemplo, al
 * dibujarla), la cierra con `signal`: nadie la ve. Un comando con flags pregunta como siempre, sin esperar ni un turno
 * antes de escuchar el teclado.
 */
export async function openPrompt<T>(run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!assistantRunning) {
    return run();
  }

  await assertOutputVisible();

  const controller = new AbortController();
  const onError = (): void => controller.abort();

  process.stdout.on('error', onError);

  try {
    return await run(controller.signal);
  } finally {
    process.stdout.off('error', onError);

    if (controller.signal.aborted) {
      throwIfOutputLost();
    }
  }
}
