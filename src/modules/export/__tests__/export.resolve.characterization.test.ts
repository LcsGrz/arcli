import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import type { ExportGateway } from '../export.gateway';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND } from '../export.kinds';
import type { ExportVoucherInput } from '../export.types';

import {
  drive,
  GOODS,
  GOODS_BY_CODE,
  holdGateway,
  newestFirst,
  type Outcome,
  PERMIT,
  type Pick,
  type ReadMethod,
} from './export-resolve.fixture';

/** Lo que resuelve la E y con qué error corta (ARQ8-6), conteste WSFEX en el orden que conteste. */

const answeredError = async (): Promise<never> => {
  throw new AppError('ARCA devolvió un error', { code: 'ARCA_EXPORT_ERROR' });
};

const ALL_TABLES_DOWN: Partial<ExportGateway> = {
  getActivities: answeredError,
  getCurrencies: answeredError,
  getDestinationCountryCuits: answeredError,
  getIncoterms: answeredError,
  getLanguages: answeredError,
  getUnits: answeredError,
};

describe('lo que resuelve: solicitud, nombres y avisos, en orden', () => {
  // El nombre es el del archivo.
  it.each<[string, ExportVoucherInput, Partial<ExportGateway>]>([
    ['factura', GOODS, {}],
    ['factura con tablas vacias', GOODS, { getActivities: async () => [], getIncoterms: async () => [] }],
    ['factura por codigo sin tablas', { ...GOODS_BY_CODE, exchangeRate: 5000 }, ALL_TABLES_DOWN],
    [
      'nota de credito con asociado',
      {
        amount: 500,
        associatedVoucher: { cuit: '20111111112', number: 12 },
        emit: false,
        permits: [PERMIT],
        voucherKind: EXPORT_CREDIT_NOTE_KIND,
      },
      {},
    ],
    [
      'nota de debito sin asociado',
      {
        ...GOODS_BY_CODE,
        paymentDate: undefined,
        permits: undefined,
        permitsExisting: undefined,
        voucherKind: EXPORT_DEBIT_NOTE_KIND,
      },
      {},
    ],
  ])('%s', async (name, input, gateway) => {
    const outcome = await drive(holdGateway(gateway), input, newestFirst);

    expect(outcome).toHaveProperty('resolved');

    // Como texto: también el orden de las claves.
    await expect(
      `${JSON.stringify((outcome as { readonly resolved: unknown }).resolved, null, 2)}\n`,
    ).toMatchFileSnapshot(`__golden__/resolve/${name.replaceAll(' ', '-')}.txt`);
  });
});

/** `datos`: ARCA contesta, pero lo que trae no sirve para lo que se escribió. */
type Failure = 'arca' | 'conexion' | 'datos' | 'wsaa';

interface Scenario {
  readonly input: ExportVoucherInput;
  readonly name: string;
  /** Las tablas de las que sale algo que se emite: si fallan, cortan. */
  readonly required: readonly ReadMethod[];
  /** La cotización escrita solo se compara: se tolera que falle. */
  readonly writtenRate: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  {
    input: GOODS,
    name: 'si lo que se emite sale de las tablas',
    required: ['getDestinationCountryCuits', 'getUnits', 'getIncoterms'],
    writtenRate: false,
  },
  { input: GOODS_BY_CODE, name: 'con todo por código', required: [], writtenRate: false },
  {
    input: { ...GOODS_BY_CODE, exchangeRate: 900 },
    name: 'con todo por código y la cotización escrita',
    required: [],
    writtenRate: true,
  },
];

/** El orden en que se usan las respuestas: con dos fallas gana la primera. */
const ORDER = [
  'getDestinationCountries',
  'getDestinationCountryCuits',
  'getUnits',
  'getIncoterms',
  'getLanguages',
  'getCurrencies',
  'getQuotations',
  'getLastVoucherNumber',
  'getLastRequestId',
  'getActivities',
  'checkPermit',
] as const satisfies readonly ReadMethod[];

type OrderedRead = (typeof ORDER)[number];
type Failures = Partial<Record<OrderedRead, Failure>>;

const NOT_TABLES: readonly ReadMethod[] = ['getDestinationCountries', 'getLastVoucherNumber', 'getLastRequestId'];

/** Contesta, pero lo que se pidió no está o el número pasa el máximo; y el error de entrada que da. */
const USELESS: Record<OrderedRead, readonly [answer: () => Promise<unknown>, error: RegExp]> = {
  checkPermit: [async () => 'NO', /permiso de embarque 26001EC01000123A no es válido/],
  getActivities: [async () => [{ id: 11111, name: 'CULTIVO DE ARROZ' }], /La actividad 620100 no está/],
  getCurrencies: [async () => [{ code: 'PES', name: 'Pesos Argentinos' }], /[Mm]oneda.*(USD|DOL)/],
  getDestinationCountries: [async () => [{ code: 203, name: 'BRASIL' }], /El país de destino ".*" no existe/],
  getDestinationCountryCuits: [
    async () => [{ countryName: 'BRASIL - Persona Jurídica', cuit: 55000000050 }],
    /no tiene CUIT para "CHILE"|El CUIT de país 55000000052 no existe/,
  ],
  getIncoterms: [async () => [{ code: 'EXW', name: 'Ex Works' }], /El incoterm "fob" no existe/],
  getLanguages: [async () => [{ id: 1, name: 'Español' }], /El idioma 2 no existe/],
  getLastRequestId: [async () => 999_999_999_999_999, /El ID de la solicitud supera/],
  getLastVoucherNumber: [async () => 99_999_999, /El número del comprobante supera/],
  getQuotations: [async () => [], /ARCA no informó la cotización de DOL/],
  getUnits: [async () => [{ id: 7, name: 'unidades' }], /unidad/],
};

const ERROR_TEXT = {
  arca: 'ARCA devolvió un error',
  conexion: 'socket hang up',
  wsaa: 'ns1:coe.alreadyAuthenticated: El CEE ya posee un TA valido',
} as const;

function failureError(method: ReadMethod, failure: Exclude<Failure, 'datos'>): Error {
  const error =
    failure === 'arca' ? new AppError(ERROR_TEXT.arca, { code: 'ARCA_EXPORT_ERROR' }) : new Error(ERROR_TEXT[failure]);

  return Object.assign(error, { method });
}

type Expected = 'resuelve' | { readonly error: Error } | { readonly useless: OrderedRead };

/** Con qué tiene que terminar, recorriendo las respuestas en `ORDER`. */
function expectedOutcome(scenario: Scenario, failures: Failures, errors: ReadonlyMap<ReadMethod, Error>): Expected {
  let firstConnectionError: Error | undefined;

  for (const method of ORDER) {
    const failure = failures[method];
    const error = errors.get(method);

    if (failure === 'datos') {
      // Una cotización escrita en bienes no necesita la de ARCA.
      if (method === 'getQuotations' && scenario.writtenRate) {
        continue;
      }

      return { useless: method };
    }

    if (!error) {
      continue;
    }

    // Un permiso que no se pudo consultar avisa, salvo que sea el segundo error de conexión.
    if (method === 'checkPermit') {
      return failure === 'conexion' && firstConnectionError ? { error: firstConnectionError } : 'resuelve';
    }

    const isTable = !NOT_TABLES.includes(method) && (method !== 'getQuotations' || scenario.writtenRate);

    if (isTable && failure === 'conexion') {
      if (firstConnectionError) {
        return { error: firstConnectionError };
      }

      firstConnectionError = error;
    }

    if (!isTable || failure === 'wsaa' || scenario.required.includes(method)) {
      return { error };
    }
  }

  return 'resuelve';
}

function describeError(error: unknown): string {
  const { message, method } = error as { readonly message: string; readonly method?: string };

  return method ? `${method}: ${message}` : message;
}

/** Vacío si terminó como tenía que terminar; si no, qué pasó. */
function mismatch(expected: Expected, outcome: Outcome): string | undefined {
  const actual = 'error' in outcome ? describeError(outcome.error) : 'resuelve';

  if (expected === 'resuelve') {
    return 'resolved' in outcome ? undefined : `esperaba que resuelva y dio "${actual}"`;
  }

  if ('useless' in expected) {
    return 'error' in outcome && USELESS[expected.useless][1].test(actual)
      ? undefined
      : `esperaba el error de entrada de ${expected.useless} y dio "${actual}"`;
  }

  return 'error' in outcome && outcome.error === expected.error
    ? undefined
    : `esperaba "${describeError(expected.error)}" y dio "${actual}"`;
}

async function check(scenario: Scenario, failures: Failures, pick: Pick): Promise<string | undefined> {
  const errors = new Map<ReadMethod, Error>();
  const overrides: Record<string, () => Promise<unknown>> = {};

  for (const [method, failure] of Object.entries(failures) as Array<[OrderedRead, Failure]>) {
    if (failure === 'datos') {
      [overrides[method]] = USELESS[method];
    } else {
      const error = failureError(method, failure);

      errors.set(method, error);
      overrides[method] = async () => {
        throw error;
      };
    }
  }

  const outcome = await drive(holdGateway(overrides as Partial<ExportGateway>), scenario.input, pick);

  return mismatch(expectedOutcome(scenario, failures, errors), outcome);
}

const FAILURES: readonly Failure[] = ['arca', 'conexion', 'datos', 'wsaa'];

const PAIRS: readonly Failures[] = ORDER.flatMap((first, position) =>
  ORDER.slice(position + 1).flatMap((second) =>
    FAILURES.flatMap((one) => FAILURES.map((other) => ({ [first]: one, [second]: other }))),
  ),
);

describe.each(SCENARIOS)('con qué corta, $name', (scenario) => {
  it('con cada par de fallas gana la primera, aunque la segunda conteste antes', async () => {
    const wrong: string[] = [];

    for (const failures of PAIRS) {
      const problem = await check(scenario, failures, newestFirst);

      if (problem) {
        wrong.push(`${JSON.stringify(failures)}: ${problem}`);
      }
    }

    expect(wrong).toEqual([]);
  }, 20_000);

  it('con cualquier combinación de fallas y cualquier orden de respuesta', async () => {
    const failure = fc.constantFrom(...FAILURES);

    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.constantFrom(...ORDER), failure),
        fc.array(fc.nat(20), { maxLength: 15, minLength: 15 }),
        async (failures, order) => {
          let turn = 0;
          const pick: Pick = (pending) => order[turn++ % order.length] % Math.max(pending.length, 1);

          expect(await check(scenario, failures, pick)).toBeUndefined();
        },
      ),
    );
  });
});
