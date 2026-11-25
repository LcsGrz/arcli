import { describe, expect, it, vi } from 'vitest';

import { unreadableVoucherError, voucherQueryError } from '../../../services/arca/voucher-query-error';
import type { IssuedVoucher, VoucherQueryError } from '../../vouchers/voucher-history';
import { previewBilling, type PreviewBillingOptions } from '../billing.preview';
import { type BillingCommandInput, billingCommandSchema } from '../billing.schemas';

/**
 * REV-53: quien ya leyo el asociado (el asistente) se lo pasa a `previewBilling`. No se consulta de nuevo y el
 * resultado es el mismo que consultandolo: la entrada, los avisos, su orden y los errores.
 */

const CLIENT_CUIT = 30709965812;
const runtime = { config: { verificarFce: false }, cuit: 20111111112, environment: 'testing' as const, pointOfSale: 3 };

/** Lo que se leyo: el comprobante, que no esta en ARCA y no es de web service, o que existe y no se entiende. */
type ReadAssociated =
  | { readonly origin: 'other' | 'unknown'; readonly queryReason?: string }
  | { readonly unreadable: VoucherQueryError }
  | { readonly voucher: IssuedVoucher };

/** La opcion todavia no existe: si se implementa con otro nombre o forma, se cambia solo aca. */
const withRead = (associated: ReadAssociated) => ({ associated }) as Partial<PreviewBillingOptions>;

const issued = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  currency: 'PES',
  date: '20261105',
  documentNumber: CLIENT_CUIT,
  documentTypeCode: 80,
  ivaAmount: 0,
  netAmount: 5000,
  number: 12,
  result: 'A',
  total: 5000,
  ...overrides,
});

function note(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return billingCommandSchema.parse({
    associatedVoucher: { numero: 12, puntoVenta: 3, shortcut: 'fcea' },
    concept: 'servicios',
    documentNumber: CLIENT_CUIT,
    documentType: 'cuit',
    ivaCondition: 'responsable-inscripto',
    ivaRate: '21',
    shortcut: 'ncea',
    totalAmount: 1000,
    ...overrides,
  });
}

const overA = (overrides: Partial<BillingCommandInput> = {}) =>
  note({ associatedVoucher: { numero: 12, puntoVenta: 3, shortcut: 'fa' }, shortcut: 'nca', ...overrides });

/** El asociado que contesta ARCA, para quien consulta. */
type Answer = IssuedVoucher | VoucherQueryError | undefined;

async function run(input: BillingCommandInput, answer: Answer, read?: ReadAssociated) {
  const getVoucher = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });
  const getLastNumber = vi.fn(async () => 0);
  const getSalesPoints = vi.fn(async () => [{ blocked: false, emissionType: 'CAE', number: 9 }]);
  const result = await previewBilling({
    clock: { now: () => new Date('2026-11-18T15:00:00.000Z') },
    gateways: {
      billing: { getQuotation: vi.fn(async () => 1000) },
      fce: { getObligation: vi.fn() },
      fceRegistry: { getVoucherState: vi.fn(async () => 'Aceptado' as const) },
      history: { getLastNumber, getVoucher },
      padron: { getTaxpayer: vi.fn(async () => null) },
      salesPoints: { getSalesPoints },
    },
    plan: { inputIndexes: [1], inputs: [input], invalidItems: [], isBatch: false, total: 1 },
    runtime,
    ...(read ? withRead(read) : {}),
  }).then(
    (items) => ({ items }),
    (error: unknown) => ({ error }),
  );

  return { lookups: [getVoucher, getLastNumber, getSalesPoints].flatMap(({ mock }) => mock.calls).length, result };
}

const missing = { origin: 'other' } as const;
const queryFailed = voucherQueryError({ errors: [{ code: 600, msg: 'x' }], number: 12, pointOfSale: 3 });
const unreadable = unreadableVoucherError({ cae: '76000000000012', number: 12, pointOfSale: 3 });

const read = (voucher: IssuedVoucher) => ({ answer: voucher, read: { voucher } });

const CASES: ReadonlyArray<
  readonly [
    string,
    {
      readonly answer: Answer;
      readonly expected: RegExp;
      readonly input: BillingCommandInput;
      readonly read: ReadAssociated;
    },
  ]
> = [
  ['una FCE sin fecha toma la del asociado', { ...read(issued()), expected: /05\/11\/2026/, input: note() }],
  [
    'una FCE de anulación avisa del Registro',
    { ...read(issued()), expected: /10154/, input: note({ cancellation: true }) },
  ],
  ['el tope de la NC', { ...read(issued({ total: 500 })), expected: /no puede superar el total/, input: overA() }],
  ['el tope de la NC FCE', { ...read(issued({ total: 500 })), expected: /no puede superar el total/, input: note() }],
  [
    'el tope no corre sobre un asociado en otra moneda',
    { ...read(issued({ currency: 'DOL', total: 500 })), expected: /"nca"/, input: overA() },
  ],
  ['una FCE a otro receptor', { ...read(issued({ documentNumber: 20222222223 })), expected: /10183/, input: note() }],
  [
    'una FCE en otra moneda',
    {
      ...read(issued({ currency: '060' })),
      expected: /10181/,
      input: note({ currencyCode: 'USD', exchangeRate: 1000 }),
    },
  ],
  [
    'una FCE con otra fecha del asociado',
    {
      ...read(issued()),
      expected: /10160/,
      input: note({ associatedVoucher: { fecha: '04/11/2026', numero: 12, puntoVenta: 3, shortcut: 'fcea' } }),
    },
  ],
  [
    'el aviso de otro sistema',
    { answer: undefined, expected: /no es de web service.*10211/, input: overA(), read: missing },
  ],
  [
    'el aviso de otro sistema, con un error de ARCA',
    {
      answer: queryFailed,
      expected: /No se pudo consultar la factura A/,
      input: overA(),
      read: { origin: 'other', queryReason: queryFailed.reason },
    },
  ],
  [
    'una FCE de otro sistema sin fecha frena',
    { answer: undefined, expected: /no se puede tomar su fecha/, input: note(), read: missing },
  ],
  [
    'el aviso de uno ilegible',
    { answer: unreadable, expected: /no pudo leer los datos/, input: overA(), read: { unreadable } },
  ],
  [
    'una FCE con el asociado ilegible y sin fecha frena',
    { answer: unreadable, expected: /no se puede tomar su fecha/, input: note(), read: { unreadable } },
  ],
];

function describeResult(result: { readonly error?: unknown; readonly items?: unknown }): string {
  return result.error instanceof Error ? result.error.message : JSON.stringify(result.items);
}

describe('previewBilling con el asociado ya leído', () => {
  it.each(CASES)('consultándolo, %s', async (_name, { answer, expected, input }) => {
    const { lookups, result } = await run(input, answer);

    expect(lookups).toBeGreaterThan(0);
    expect(describeResult(result)).toMatch(expected);
  });

  // Tests primero (REV-53): pasa a it() al implementarlo.
  it.fails.each(CASES)('sin consultar ARCA, %s', async (_name, { answer, input, read: associated }) => {
    const queried = await run(input, answer);
    const { lookups, result } = await run(input, answer, associated);

    expect(result).toEqual(queried.result);
    expect(lookups).toBe(0);
  });
});
