import { MONOTRIBUTO_CATEGORIES_URL } from './monotributo';

/** Corto: la pagina es chica y, si ARCA no contesta, hay tabla guardada o incluida. */
const MONOTRIBUTO_FETCH_TIMEOUT_MS = 5000;

export type MonotributoPageFetch =
  | { readonly html: string; readonly ok: true }
  | { readonly ok: false; readonly reason: 'sin-conexion' | 'sin-respuesta' }
  | { readonly ok: false; readonly reason: 'error-http'; readonly status: number };

export type FetchMonotributoPage = () => Promise<MonotributoPageFetch>;

/** Baja la pagina de categorias de ARCA. Es publica: no usa certificado. Nunca lanza. */
export async function fetchMonotributoPage(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = MONOTRIBUTO_FETCH_TIMEOUT_MS,
): Promise<MonotributoPageFetch> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(MONOTRIBUTO_CATEGORIES_URL, { signal: controller.signal });

    if (!response.ok) {
      return { ok: false, reason: 'error-http', status: response.status };
    }

    return { html: await response.text(), ok: true };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'sin-respuesta' : 'sin-conexion' };
  } finally {
    clearTimeout(timeout);
  }
}
