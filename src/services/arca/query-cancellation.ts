import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Las consultas a ARCA que se corren adentro de un contexto cancelable. Es un contexto y no un parametro porque el SDK
 * no recibe señales: la lee `soap-deadline` en cada pedido.
 */
const context = new AsyncLocalStorage<AbortSignal>();

/**
 * Corre `run` con sus consultas a ARCA atadas a `signal`: abortada, cada una corta la espera y la conexion y rechaza con
 * `signal.reason`, y las que siguen ni se piden. La emision y el login nunca se cortan (ver `SOAP_OPERATIONS`). Un
 * contexto adentro de otro se corta con cualquiera de los dos. Lo que se pida despues, fuera de `run`, ya no se corta;
 * lo que arranco adentro y sigue (una promesa compartida, como la cache de tablas de la E o la cotizacion) lleva el
 * contexto con el que arranco y se sigue cortando con esta señal. La usan las esperas del asistente (`waitForArca`).
 */
export async function withCancellableQueries<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const outer = context.getStore();

  return context.run(outer ? AbortSignal.any([outer, signal]) : signal, run);
}

/** La señal del contexto en curso, si hay uno. Solo para `soap-deadline`. */
export function currentQuerySignal(): AbortSignal | undefined {
  return context.getStore();
}
