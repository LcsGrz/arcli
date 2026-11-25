/** Tareas que arrancan en el orden en que se agregan, hasta `limit` a la vez. */
export interface TaskQueue {
  /**
   * Arranca la tarea, o la deja en la cola si no hay lugar. La promesa se puede esperar mas tarde o no esperarse nunca:
   * un rechazo que nadie espera no es un `unhandledRejection`.
   */
  readonly add: <T>(task: () => Promise<T>) => Promise<T>;
  /** Lo que esta en la cola ya no arranca y su promesa se rechaza. Lo que esta en curso sigue: no se aborta. */
  readonly stop: () => void;
}

export function createTaskQueue(limit: number): TaskQueue {
  const waiting: Array<{ readonly discard: () => void; readonly start: () => Promise<void> }> = [];
  let running = 0;
  let stopped = false;

  const startWaiting = () => {
    while (running < limit) {
      const next = waiting.shift();

      if (!next) {
        return;
      }

      running += 1;
      void next.start().finally(() => {
        running -= 1;
        startWaiting();
      });
    }
  };

  return {
    add: <T>(task: () => Promise<T>) => {
      const result = new Promise<T>((resolve, reject) => {
        const discard = () => reject(new Error('La tarea se descartó antes de arrancar.'));

        if (stopped) {
          discard();

          return;
        }

        waiting.push({
          discard,
          start: async () => {
            try {
              resolve(await task());
            } catch (error) {
              reject(error);
            }
          },
        });
      });

      result.catch(() => undefined);
      startWaiting();

      return result;
    },
    stop: () => {
      stopped = true;
      waiting.splice(0).forEach(({ discard }) => discard());
    },
  };
}
