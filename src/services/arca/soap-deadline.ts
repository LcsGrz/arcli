import { SoapClient } from '@arcasdk/core';

import { ArcaDeadlineError } from '../../lib/errors/deadline-error';

/** El plazo total de cada pedido, no por inactividad: una respuesta que gotea tambien vence. */
const QUERY_DEADLINE_MS = 30_000;
const LOGIN_OPERATION = 'loginCms';

/** Lo que no esta aca es una consulta. */
const DEADLINES_MS: ReadonlyMap<string, number> = new Map([
  ['FECAESolicitar', 120_000],
  ['FEXAuthorize', 120_000],
  [LOGIN_OPERATION, 60_000],
]);

const ASYNC_SUFFIX = 'Async';

/** Queda en el metodo envuelto y no en una variable del modulo: vale aunque el modulo se cargue dos veces. */
const INSTALLED = Symbol.for('arcli.soapDeadlines');

type RequestOptions = { readonly signal?: AbortSignal } & Readonly<Record<string, unknown>>;
type SoapCall = (args?: unknown, options?: RequestOptions, ...rest: readonly unknown[]) => Promise<unknown>;

/**
 * Vencido, corta la espera y la conexion. No cancela nada en ARCA: lo que ya recibio lo sigue procesando. Lo que pase
 * primero gana, y lo que llegue despues se ignora. En la emision, el SDK pide el login adentro de la misma llamada si el
 * ticket vencio recien: ese login vencido tambien cuenta como emision sin confirmar, como cualquier error de ahi.
 */
async function withDeadline<T>(operation: string, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ms = DEADLINES_MS.get(operation) ?? QUERY_DEADLINE_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    // No `AbortSignal.timeout`: no se puede limpiar al terminar.
    timer = setTimeout(() => {
      reject(new ArcaDeadlineError(operation === LOGIN_OPERATION ? 'WSAA' : 'ARCA', ms));
      controller.abort();
    }, ms);
  });

  try {
    return await Promise.race([request(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function addDeadlines<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);

      if (typeof property !== 'string' || !property.endsWith(ASYNC_SUFFIX) || typeof value !== 'function') {
        return value;
      }

      const call = value as SoapCall;
      const operation = property.slice(0, -ASYNC_SUFFIX.length);
      const callWithDeadline: SoapCall = async (args, options, ...rest) =>
        withDeadline(operation, async (deadline) => {
          const signal = options?.signal ? AbortSignal.any([deadline, options.signal]) : deadline;

          return call(args, { ...options, signal }, ...rest);
        });

      return callWithDeadline;
    },
  });
}

/**
 * Le pone un plazo a cada pedido a ARCA. El SDK no tiene como, pero todos sus servicios, el login en WSAA y los `Dummy`
 * arman su cliente con `SoapClient.createClient`. Es un `Proxy` porque node-soap vuelve a armar los metodos cuando el
 * SDK cambia la direccion del servicio. Lo demas del pedido (TLS, proxy, headers) no se toca.
 */
export function installSoapDeadlines(): void {
  // La clase y no una instancia: cada servicio del SDK crea la suya.
  const prototype = SoapClient.prototype as { createClient: (...args: unknown[]) => Promise<object> };
  const { createClient } = prototype;

  if (INSTALLED in createClient) {
    return;
  }

  async function createClientWithDeadlines(this: SoapClient, ...args: unknown[]): Promise<object> {
    return addDeadlines(await createClient.apply(this, args));
  }

  prototype.createClient = Object.assign(createClientWithDeadlines, { [INSTALLED]: true });
}
