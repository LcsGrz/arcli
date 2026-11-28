// TEMPORAL (ARQ-30): medir cada fase en el CI de Windows. No se mergea.
export function tiempo<T>(name: string, work: () => T): T {
  const started = performance.now();
  const done = (outcome: string) =>
    console.error(`ARQ30 ${name} ${Math.round(performance.now() - started)}ms ${outcome}`);

  try {
    const result = work();

    if (result instanceof Promise) {
      return result.then(
        (value: unknown) => (done('ok'), value),
        (error: unknown) => {
          done(
            `error ${String((error as { reason?: string; code?: string })?.reason ?? (error as { code?: string })?.code)}`,
          );
          throw error;
        },
      ) as T;
    }

    done('ok');

    return result;
  } catch (error) {
    done(
      `error ${String((error as { reason?: string; code?: string })?.reason ?? (error as { code?: string })?.code)}`,
    );
    throw error;
  }
}
