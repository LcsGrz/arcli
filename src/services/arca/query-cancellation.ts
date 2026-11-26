import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Las consultas a ARCA que se corren adentro de un contexto cancelable. Es un contexto y no un parametro porque el SDK
 * no recibe señales: la lee `soap-deadline` en cada pedido.
 */
const context = new AsyncLocalStorage<AbortSignal>();

/**
 * Corre `run` con sus consultas a ARCA atadas a `signal`: abortada, cada una corta la espera y la conexion y rechaza con
 * `signal.reason`, y las que siguen ni se piden. La emision y el login nunca se cortan (ver `SOAP_OPERATIONS`). Un
 * contexto adentro de otro se corta con cualquiera de los dos. Terminado `run`, la señal ya no corta nada.
 *
 * @internal Hasta que la use el asistente (ARQ-11 PR 5), solo la usan los tests.
 */
export async function withCancellableQueries<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const outer = context.getStore();

  return context.run(outer ? AbortSignal.any([outer, signal]) : signal, run);
}

/** La señal del contexto en curso, si hay uno. Solo para `soap-deadline`. */
export function currentQuerySignal(): AbortSignal | undefined {
  return context.getStore();
}
