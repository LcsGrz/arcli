/** Una consulta que el asistente no espera. Quien la muestra se entera con `subscribe` de que termino. */
export interface BackgroundQuery<T> {
  /** Corta la consulta: si contesta despues, no cuenta. */
  readonly cancel: () => void;
  /** Termina cuando la consulta contesta o se cancela. Nunca falla. */
  readonly settled: Promise<void>;
  /** Avisa una vez, al contestar. Devuelve como dejar de escuchar. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Lo que contesto, o `undefined` si todavia no (o se cancelo). */
  readonly value: () => T | undefined;
}

/** Si `run` falla, contesta `onError`. */
export function startBackgroundQuery<T>(run: (signal: AbortSignal) => Promise<T>, onError: T): BackgroundQuery<T> {
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  const cancelled = new Promise<void>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve());
  });
  let value: T | undefined;
  const answered = run(controller.signal)
    .catch(() => onError)
    .then((answer) => {
      if (!controller.signal.aborted) {
        value = answer;
        listeners.forEach((listener) => listener());
      }
    });

  return {
    cancel: () => controller.abort(),
    settled: Promise.race([answered, cancelled]),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    value: () => value,
  };
}
