import { fakeExportGateway } from '../../../testing/arca-gateways';
import { arcliConfigSchema } from '../../config/config.schemas';
import type { ExportGateway } from '../export.gateway';
import { ExportService } from '../export.service';
import type { ExportIssuedVoucher, ExportVoucherInput, ResolvedExportVoucher } from '../export.types';

/**
 * Resoluciones de la E con un WSFEX que contesta cuando el test quiere (ARQ8-6): cada consulta queda en vuelo hasta que
 * el test la contesta, en el orden que elija, se lean en serie o en paralelo.
 */

const NOW = new Date('2026-06-01T15:00:00Z');
export const PERMIT = '26001EC01000123A';
const CHILE_CUIT = 55000000052;

const RUNTIME = {
  config: arcliConfigSchema.parse({ cuit: '20111111112', exportacion: { actividad: 620100 }, puntoVentaPorDefecto: 3 }),
  cuit: 20111111112,
  environment: 'testing' as const,
};

/** Una factura E de bienes a Chile: el asociado de las notas. */
const ASSOCIATED: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: 'Alameda 100',
  clientCountryCuit: CHILE_CUIT,
  clientName: 'ACME LTDA',
  clientTaxId: '123456789',
  currencyCode: 'DOL',
  date: '20260520',
  destinationCountry: 202,
  exchangeRate: 880.25,
  exportType: 1,
  incoterm: 'FOB',
  incotermDescription: 'Puerto de origen',
  language: 2,
  number: 12,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

export type ReadMethod = Exclude<keyof ExportGateway, 'authorize'>;

const ANSWERS: Partial<ExportGateway> = {
  getCurrencies: async () => [
    { code: 'DOL', name: 'Dólar Estadounidense' },
    { code: 'PES', name: 'Pesos Argentinos' },
  ],
  getDestinationCountries: async () => [
    { code: 202, name: 'CHILE' },
    { code: 203, name: 'BRASIL' },
  ],
  getDestinationCountryCuits: async () => [
    { countryName: 'CHILE - Persona Física', cuit: 50000000056 },
    { countryName: 'CHILE - Persona Jurídica', cuit: CHILE_CUIT },
  ],
  getLanguages: async () => [
    { id: 1, name: 'Español' },
    { id: 2, name: 'Inglés' },
  ],
  getLastVoucherNumber: async () => 41,
  getQuotations: async () => [{ code: 'DOL', date: '20260529', rate: 900.5 }],
  getUnits: async () => [
    { id: 1, name: 'kilogramos' },
    { id: 7, name: 'unidades' },
  ],
  getVoucher: async () => ASSOCIATED,
};

/** Factura de bienes que consulta todo, y de las tablas sale lo que se emite: país, CUIT, unidad e incoterm. */
export const GOODS: ExportVoucherInput = {
  amount: 1500,
  clientAddress: 'Alameda 100',
  clientName: 'ACME LTDA',
  currencyCode: 'USD',
  destinationCountry: 'chile',
  emit: false,
  exportType: 1,
  incoterm: 'fob',
  items: [{ description: 'Vino', quantity: 3, unit: 'kilogramos', unitPrice: 500 }],
  language: 2,
  paymentDate: '10/06/2026',
  permits: [PERMIT],
  permitsExisting: true,
  voucherDate: '03/06/2026',
};

/** La misma, toda por código: de las tablas solo salen nombres y validaciones. */
export const GOODS_BY_CODE: ExportVoucherInput = {
  ...GOODS,
  clientCountryCuit: CHILE_CUIT,
  clientTaxId: '123456789',
  destinationCountry: '202',
  incotermDescription: 'Puerto de origen',
  items: [{ description: 'Vino', quantity: 3, unit: 1, unitPrice: 500 }],
};

interface Pending {
  readonly answer: () => void;
  readonly method: ReadMethod;
}

/** Cuál se contesta de las que están en vuelo. */
export type Pick = (pending: readonly Pending[]) => number;

interface HeldGateway {
  /** `inicio <consulta>` y `fin <consulta>`, en orden. */
  readonly events: readonly string[];
  readonly gateway: ExportGateway;
  /** Cuántas hubo en vuelo a la vez, como máximo. */
  readonly peak: () => number;
  /** Las consultas en vuelo, en el orden en que arrancaron. */
  readonly pending: readonly Pending[];
  /** Las consultas que arrancaron, en orden. */
  readonly started: () => ReadMethod[];
}

export function holdGateway(overrides: Partial<ExportGateway> = {}): HeldGateway {
  const answers = fakeExportGateway({ ...ANSWERS, ...overrides });
  const pending: Pending[] = [];
  const events: string[] = [];
  const started: ReadMethod[] = [];
  let peak = 0;

  const hold =
    (method: ReadMethod) =>
    (...args: readonly unknown[]) =>
      new Promise((resolve, reject) => {
        const entry: Pending = {
          answer: () => {
            pending.splice(pending.indexOf(entry), 1);
            events.push(`fin ${method}`);
            (answers[method] as (...values: readonly unknown[]) => Promise<unknown>)(...args).then(resolve, reject);
          },
          method,
        };

        started.push(method);
        events.push(`inicio ${method}`);
        pending.push(entry);
        peak = Math.max(peak, pending.length);
      });

  return {
    events,
    gateway: {
      ...(Object.fromEntries(
        Object.keys(answers).map((method) => [method, hold(method as ReadMethod)]),
      ) as unknown as ExportGateway),
      authorize: answers.authorize,
    },
    peak: () => peak,
    pending,
    started: () => [...started],
  };
}

/** Deja correr todo lo que ya puede correr. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Si van en paralelo, contestan en el orden inverso al que arrancaron. */
export const newestFirst: Pick = (pending) => pending.length - 1;
export const oldestFirst: Pick = () => 0;

export type Outcome = { readonly error: unknown } | { readonly resolved: ResolvedExportVoucher };

/** Arranca la resolución, sin contestar nada. El resultado es `undefined` mientras no termina. */
export function startResolve(held: HeldGateway, input: ExportVoucherInput): () => Outcome | undefined {
  let outcome: Outcome | undefined;

  new ExportService({ clock: { now: () => NOW } }).resolve(input, held.gateway, RUNTIME).then(
    (resolved) => {
      outcome = { resolved };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );

  return () => outcome;
}

/** Resuelve contestando de a una, la que diga `pick`, hasta que termina. */
export async function drive(held: HeldGateway, input: ExportVoucherInput, pick: Pick): Promise<Outcome> {
  const outcome = startResolve(held, input);

  for (;;) {
    await settle();

    const result = outcome();

    if (result) {
      return result;
    }

    const next = held.pending[pick(held.pending)];

    if (!next) {
      throw new Error('La resolución no termina y no hay consultas en vuelo.');
    }

    next.answer();
  }
}

/** Contesta, en ese orden, consultas que están en vuelo. */
export async function answer(held: HeldGateway, ...methods: readonly ReadMethod[]): Promise<void> {
  for (const method of methods) {
    const entry = held.pending.find((item) => item.method === method);

    if (!entry) {
      throw new Error(`"${method}" no está en vuelo: ${held.pending.map((item) => item.method).join(', ') || 'nada'}`);
    }

    entry.answer();
  }

  await settle();
}

/** Contesta todo lo que quede en vuelo, y lo que arranque por eso. */
export async function answerAll(held: HeldGateway): Promise<void> {
  while (held.pending.length > 0) {
    held.pending[0].answer();
    await settle();
  }
}
