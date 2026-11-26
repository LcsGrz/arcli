/**
 * Stub de Tests primero (ARQ-11 PR 6), lo implementa nucleo: hoy no cancela nada. Va a abrir un contexto con
 * `AsyncLocalStorage` para que las consultas a ARCA de `run` se corten al abortar `signal`; la emision y el login no.
 * `currentQuerySignal`, para `soap-deadline`, entra con la implementacion: sin quien la use, knip la rechaza.
 *
 * @internal
 */
export async function withCancellableQueries<T>(_signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return run();
}
