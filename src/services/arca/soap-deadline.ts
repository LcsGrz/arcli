import { SoapClient } from '@arcasdk/core';

import { ArcaDeadlineError } from '../../lib/errors/deadline-error';

import { currentQuerySignal } from './query-cancellation';

const LOGIN_OPERATION = 'loginCms';

interface SoapOperation {
  /** Se corta con la señal de `withCancellableQueries` y con la que se pase al pedido. */
  readonly cancellable: boolean;
  /** El plazo total de cada pedido, no por inactividad: una respuesta que gotea tambien vence. */
  readonly ms: number;
}

/**
 * Las operaciones que no son una consulta. La emision y el login no se cortan con ninguna señal de afuera, solo con su
 * plazo: una emision cortada quedaria sin saber si se autorizo, y el login va adentro de la emision cuando el ticket
 * vencio recien.
 *
 * @internal Exportada para los tests, que fijan por tipo que esas tres no se cancelan.
 */
export const SOAP_OPERATIONS = {
  FECAESolicitar: { cancellable: false, ms: 120_000 },
  FEXAuthorize: { cancellable: false, ms: 120_000 },
  [LOGIN_OPERATION]: { cancellable: false, ms: 60_000 },
} as const satisfies Readonly<Record<string, SoapOperation>>;

/** Lo que no esta en `SOAP_OPERATIONS`. */
const QUERY: SoapOperation = { cancellable: true, ms: 30_000 };

function operationOf(name: string): SoapOperation {
  return Object.hasOwn(SOAP_OPERATIONS, name) ? SOAP_OPERATIONS[name as keyof typeof SOAP_OPERATIONS] : QUERY;
}

const ASYNC_SUFFIX = 'Async';

/** Queda en el metodo envuelto y no en una variable del modulo: vale aunque el modulo se cargue dos veces. */
const INSTALLED = Symbol.for('arcli.soapDeadlines');

type RequestOptions = { readonly signal?: AbortSignal } & Readonly<Record<string, unknown>>;
type SoapCall = (args?: unknown, options?: RequestOptions, ...rest: readonly unknown[]) => Promise<unknown>;

/**
 * Vencido, corta la espera y la conexion. No cancela nada en ARCA: lo que ya recibio lo sigue procesando. Lo que pase
 * primero gana, y lo que llegue despues se ignora. En la emision, el SDK pide el login adentro de la misma llamada si el
 * ticket vencio recien: ese login vencido tambien cuenta como emision sin confirmar, como cualquier error de ahi.
 *
 * Abortada `cancelled`, corta igual que el plazo pero rechaza con su razon, que no es un error de conexion ni un plazo
 * vencido. Si ya estaba abortada, no se pide nada.
 */
async function withDeadline<T>(
  operation: string,
  cancelled: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  cancelled?.throwIfAborted();

  const { ms } = operationOf(operation);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let cancel: (() => void) | undefined;
  const ended = new Promise<never>((_resolve, reject) => {
    // No `AbortSignal.timeout`: no se puede limpiar al terminar.
    timer = setTimeout(() => {
      reject(new ArcaDeadlineError(operation === LOGIN_OPERATION ? 'WSAA' : 'ARCA', ms));
      controller.abort();
    }, ms);

    if (cancelled) {
      // Rechaza antes de cortar la conexion: el error de axios llega despues y se ignora.
      cancel = () => {
        reject(cancelled.reason);
        controller.abort();
      };
      cancelled.addEventListener('abort', cancel, { once: true });
    }
  });

  try {
    return await Promise.race([request(controller.signal), ended]);
  } finally {
    clearTimeout(timer);

    if (cancel) {
      cancelled?.removeEventListener('abort', cancel);
    }
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
      const { cancellable } = operationOf(operation);
      const callWithDeadline: SoapCall = async (args, options, ...rest) => {
        // La emision y el login, solo con su plazo: ni la señal del contexto ni la de quien llama.
        const external = cancellable ? options?.signal : undefined;

        return withDeadline(operation, cancellable ? currentQuerySignal() : undefined, async (deadline) => {
          const signal = external ? AbortSignal.any([deadline, external]) : deadline;

          return call(args, { ...options, signal }, ...rest);
        });
      };

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
