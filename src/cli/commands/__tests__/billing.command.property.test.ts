import Big from 'big.js';
import { Command, CommanderError } from 'commander';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { AppError } from '../../../lib/errors/app-error';
import { hasAtMostDecimals } from '../../../lib/numbers/argentine-amount';
import { prepareBatch } from '../../../modules/billing/billing.batch-run';
import type { BillingDefaults } from '../../../modules/billing/billing.defaults';
import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { getVoucherKindByShortcut, VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';
import { readJsonFile } from '../../../services/files/read-json-file';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';
import { parseBillingCommandPlan, registerBillingOptions } from '../billing.command.parser';

vi.mock('../../../services/files/read-json-file', () => ({ readJsonFile: vi.fn() }));

const EMITTER_CUIT = 20409509763;

const RUNTIME = {
  certificateNotices: [],
  config: { puntoVentaPorDefecto: 3 },
  context: { cert: 'CERT', cuit: EMITTER_CUIT, key: 'KEY', production: false },
  cuit: EMITTER_CUIT,
  environment: 'testing',
  outputJson: false,
  outputRaw: false,
  pointOfSale: 3,
} as unknown as CliArcaRuntime;

const DEFAULTS: BillingDefaults = {
  defaultConcept: 'servicios',
  defaultCurrencyCode: 'PES',
  defaultIvaCondition: 'consumidor-final',
};

const SHORTCUTS = Object.keys(VOUCHER_KIND_MAP) as VoucherShortcut[];

/** Todos los comprobantes, con más peso en los que no necesitan un asociado (las notas sin él son siempre error). */
const shortcutArbitrary = fc.oneof(
  { arbitrary: fc.constantFrom<VoucherShortcut>('fa', 'fb', 'fc', 'ra', 'rb', 'rc'), weight: 3 },
  { arbitrary: fc.constantFrom(...SHORTCUTS), weight: 2 },
);

/** El reloj del CLI va de 2000 a 2099, para cruzar fines de mes, de año y bisiestos. */
const instant = fc.date({
  max: new Date('2099-12-31T23:59:59Z'),
  min: new Date('2000-01-01T00:00:00Z'),
  noInvalidDate: true,
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------------------------
// Generadores: valores bien formados mezclados con texto cualquiera, para que una parte llegue al pedido a ARCA.

const amountText = fc
  .integer({ max: 10_000_000_000, min: 1 })
  .map((cents) => new Big(cents).div(100).toFixed(2).replace('.', ','));
const anyText = fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('', ' ', '0', '-1', '1e3', '1.5', 'NaN'));
const orNoise = <T>(arbitrary: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary, weight: 15 }, { arbitrary: anyText as unknown as fc.Arbitrary<T>, weight: 1 });
const dayWord = fc.oneof(
  fc.constantFrom('hoy', 'ayer'),
  fc.integer({ max: 15, min: 0 }).map((days) => `-${days}`),
  fc.integer({ max: 15, min: 0 }).map((days) => `+${days}`),
  fc.tuple(fc.integer({ max: 31, min: 1 }), fc.integer({ max: 12, min: 1 })).map(([day, month]) => `${day}/${month}`),
);
const rangeWord = fc.oneof(dayWord, fc.constantFrom('mes-actual', 'mes-pasado'));
const rateName = fc.constantFrom('general', 'reducida', 'incrementada', 'cero', '21', '10,5', '27%', '5', '2.5');
const validCuitText = fc.constantFrom('20-11111111-2', '30-71234567-1', '20409509763', '23000000000');

type FlagArgs = string[];

const flag = (name: string, value: fc.Arbitrary<string>) => value.map((text): FlagArgs => [`--${name}=${text}`]);
const toggle = (name: string) => fc.constant<FlagArgs>([`--${name}`]);

const billingFlag = fc.oneof(
  flag('monto', orNoise(amountText)),
  flag('exento', orNoise(amountText)),
  flag('nogravado', orNoise(amountText)),
  flag('alicuota', orNoise(rateName)),
  flag(
    'alicuota',
    fc.tuple(rateName, amountText).map(([rate, amount]) => `${rate}:${amount}`),
  ),
  flag('fecha', orNoise(dayWord)),
  // Las fechas de servicio van de a pares (si no, es siempre el mismo error).
  fc.tuple(orNoise(rangeWord), orNoise(rangeWord)).map(([from, to]): FlagArgs => [`--sd=${from}`, `--sh=${to}`]),
  flag('vto', orNoise(dayWord)),
  flag('concepto', orNoise(fc.constantFrom('productos', 'servicios', 'ps', 'p', 's'))),
  toggle('cs'),
  toggle('cp'),
  toggle('csp'),
  flag('moneda', orNoise(fc.constantFrom('PES', 'ARS', 'USD', 'DOL', 'EUR', '060'))),
  flag('cm', orNoise(amountText)),
  toggle('misma-moneda'),
  flag('cuit', orNoise(validCuitText)),
  flag('dni', orNoise(fc.integer({ max: 99_999_999, min: 1 }).map(String))),
  toggle('cfinal'),
  flag('ir', orNoise(fc.constantFrom('responsable-inscripto', 'consumidor-final', 'responsable-monotributo', 'ri'))),
  toggle('ir-ri'),
  toggle('ir-cf'),
  flag('pv', orNoise(fc.integer({ max: 99_998, min: 1 }).map(String))),
  flag('ac', orNoise(fc.constantFrom(...SHORTCUTS))),
  flag('ar', orNoise(fc.integer({ max: 99_999_999, min: 1 }).map(String))),
  flag('apv', orNoise(fc.integer({ max: 99_998, min: 1 }).map(String))),
  flag('acuit', orNoise(validCuitText)),
  flag('afecha', orNoise(dayWord)),
  flag('pd', orNoise(rangeWord)),
  flag('ph', orNoise(rangeWord)),
  flag('cbu', orNoise(fc.constantFrom('2850590940090418135201', '0170099220000067797370'))),
  flag('alias', orNoise(fc.constantFrom('mi.alias.cbu', 'ab'))),
  flag('transferencia', orNoise(fc.constantFrom('sca', 'adc', 'SCA'))),
  flag('dia', orNoise(fc.integer({ max: 31, min: 1 }).map(String))),
  toggle('anulacion'),
);
// Casi siempre con --monto, que es obligatorio: sin él todo termina en el mismo error.
const billingArgs = fc
  .tuple(fc.option(flag('monto', amountText), { freq: 8, nil: [] }), fc.array(billingFlag, { maxLength: 6 }))
  .map(([amount, groups]) => [...amount, ...groups.flat()]);

// ---------------------------------------------------------------------------------------------------------------

function createCommand(args: readonly string[]): Command {
  const command = new Command();

  command.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  registerBillingOptions(command);
  command.parse(['node', 'test', ...args], { from: 'node' });

  return command;
}

/** Un error que el CLI sabe mostrar como error de entrada: nunca un TypeError o un RangeError sin controlar. */
function isControlledInputError(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    error instanceof CommanderError ||
    (error instanceof AppError && ['BATCH_VALIDATION_ERROR', 'INPUT_VALIDATION_ERROR'].includes(error.code))
  );
}

const isArcaDate = (value: unknown): boolean => {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
    return false;
  }

  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6))));

  return date.toISOString().slice(0, 10).replace(/-/g, '') === value;
};

const hasCents = (value: unknown) => typeof value === 'number' && value >= 0 && hasAtMostDecimals(value, 2);

/** El pedido que va a FECAESolicitar: formato y cuentas que ARCA controla. */
function expectValidArcaRequest(payload: ReturnType<BillingService['buildVoucherPayload']>, shortcut: VoucherShortcut) {
  const kind = getVoucherKindByShortcut(shortcut);
  const record = payload as unknown as Record<string, unknown>;

  expect(payload.CbteTipo).toBe(kind?.arcaType);
  expect(payload.CantReg).toBe(1);
  expect(Number.isInteger(payload.PtoVta) && payload.PtoVta > 0).toBe(true);
  expect([1, 2, 3]).toContain(payload.Concepto);
  expect([80, 86, 96, 99]).toContain(payload.DocTipo);
  expect(payload.MonId).toMatch(/^[A-Z0-9]{3}$/);
  expect(payload.MonCotiz).toBeGreaterThan(0);

  // Fechas AAAAMMDD reales; con servicios van las tres y en orden (10032, 10036).
  expect(isArcaDate(payload.CbteFch)).toBe(true);

  for (const key of ['FchServDesde', 'FchServHasta', 'FchVtoPago']) {
    if (record[key] !== undefined) {
      expect(isArcaDate(record[key])).toBe(true);
    }
  }

  if (payload.Concepto === 1) {
    expect(record.FchServDesde ?? record.FchServHasta).toBeUndefined();
  } else {
    expect(isArcaDate(record.FchServDesde) && isArcaDate(record.FchServHasta)).toBe(true);
    expect(String(record.FchServDesde) <= String(record.FchServHasta)).toBe(true);
  }

  if (record.FchVtoPago !== undefined) {
    expect(String(record.FchVtoPago) >= payload.CbteFch).toBe(true);
  }

  // Importes con 2 decimales y un total que es la suma exacta de sus partes (10048).
  for (const key of ['ImpIVA', 'ImpNeto', 'ImpOpEx', 'ImpTotConc', 'ImpTotal', 'ImpTrib']) {
    expect(hasCents(record[key])).toBe(true);
  }

  expect(payload.ImpTotal).toBeGreaterThan(0);
  expect(
    new Big(payload.ImpTotConc)
      .plus(payload.ImpOpEx)
      .plus(payload.ImpNeto)
      .plus(payload.ImpIVA)
      .plus(payload.ImpTrib)
      .eq(payload.ImpTotal),
  ).toBe(true);

  const iva = (record.Iva ?? []) as Array<{ BaseImp: number; Importe: number }>;

  if (kind?.letter === 'c') {
    expect(record.Iva).toBeUndefined();
    expect(payload.ImpIVA + payload.ImpOpEx + payload.ImpTotConc).toBe(0);
  } else if (payload.ImpNeto > 0) {
    expect(iva.length).toBeGreaterThan(0);
    expect(iva.reduce((sum, item) => sum.plus(item.BaseImp), new Big(0)).eq(payload.ImpNeto)).toBe(true);
    expect(iva.reduce((sum, item) => sum.plus(item.Importe), new Big(0)).eq(payload.ImpIVA)).toBe(true);
  }
}

interface Outcome {
  readonly payload?: ReturnType<BillingService['buildVoucherPayload']>;
  readonly totalAmount?: number;
}

/** Del comando al pedido a ARCA, sin red. Devuelve el pedido o nada si la entrada se rechazó como corresponde. */
function runToPayload(args: readonly string[], shortcut: VoucherShortcut, now: Date): Outcome {
  vi.setSystemTime(now);

  try {
    const plan = parseBillingCommandPlan(createCommand(args), shortcut, DEFAULTS);

    // Un lote con algun item invalido no llega a ARCA: `prepareBatch` lo rechaza entero. Si no, va el primero.
    if (plan.invalidItems.length > 0) {
      return {};
    }

    const [input] = plan.inputs;
    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(input, RUNTIME);

    return { payload, totalAmount: input.totalAmount };
  } catch (error) {
    if (!isControlledInputError(error)) {
      throw error;
    }

    return {};
  }
}

describe('billing por flags (propiedades)', () => {
  it('cualquier combinación de flags da un pedido a ARCA válido o un error de entrada', () => {
    let reached = 0;

    fc.assert(
      fc.property(shortcutArbitrary, billingArgs, instant, (shortcut, args, now) => {
        // La A va a un responsable inscripto identificado; si los flags generados traen otro receptor, es un error.
        const receiver = getVoucherKindByShortcut(shortcut)?.letter === 'a' ? ['--cuit=30-71234567-1', '--ir-ri'] : [];
        const outcome = runToPayload([...receiver, ...args], shortcut, now);

        if (outcome.payload) {
          reached += 1;
          expectValidArcaRequest(outcome.payload, shortcut);
          expect(outcome.payload.ImpTotal).toBe(outcome.totalAmount);
        }
      }),
      { numRuns: 400 },
    );

    // Que no pase de casualidad: una parte de las entradas tiene que llegar a armar el pedido.
    expect(reached).toBeGreaterThan(0);
  });

  it('un --monto válido en A, B y C se manda tal cual como ImpTotal, con cualquier fecha relativa', () => {
    const simpleShortcut = fc.constantFrom<VoucherShortcut>('fa', 'fb', 'fc', 'ra', 'rb', 'rc');
    const productsOrServices = fc.constantFrom(['--cp'], ['--cs'], ['--csp']);
    // Hasta $ 1.000.000: con más, un consumidor final tiene que identificarse.
    const smallAmountText = fc
      .integer({ max: 100_000_000, min: 1 })
      .map((cents) => new Big(cents).div(100).toFixed(2).replace('.', ','));

    fc.assert(
      fc.property(
        simpleShortcut,
        smallAmountText,
        productsOrServices,
        fc.option(rateName, { nil: undefined }),
        fc.option(fc.constantFrom('mes-actual', 'mes-pasado', 'hoy', 'ayer', '-3'), { nil: undefined }),
        instant,
        (shortcut, amount, concept, rate, from, now) => {
          const letter = getVoucherKindByShortcut(shortcut)?.letter;
          const isC = letter === 'c';
          const args = [
            `--monto=${amount}`,
            // La A va a un responsable inscripto identificado.
            ...(letter === 'a' ? ['--cuit=30-71234567-1', '--ir-ri'] : []),
            ...concept,
            ...(rate && !isC ? [`--alicuota=${rate}`] : []),
            ...(from && concept[0] !== '--cp' ? [`--sd=${from}`, '--sh=hoy'] : []),
          ];
          const outcome = runToPayload(args, shortcut, now);

          expect(outcome.payload).toBeDefined();
          expectValidArcaRequest(outcome.payload as NonNullable<Outcome['payload']>, shortcut);
          expect(outcome.payload?.ImpTotal).toBe(Number(amount.replace(',', '.')));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('una nota con su factura asociada lleva el asociado tal cual, con una fecha que no es posterior a la nota', () => {
    const note = fc.constantFrom<VoucherShortcut>('nca', 'ncb', 'ncc', 'nda', 'ndb', 'ndc');

    fc.assert(
      fc.property(
        note,
        fc.integer({ max: 99_999_999, min: 1 }),
        fc.integer({ max: 99_998, min: 1 }),
        fc.option(fc.integer({ max: 9, min: 0 }), { nil: undefined }),
        fc.constantFrom(['--cp'], ['--cs']),
        instant,
        (shortcut, number, pointOfSale, daysAgo, concept, now) => {
          const kind = getVoucherKindByShortcut(shortcut);
          const invoice = `f${kind?.letter}` as VoucherShortcut;
          const args = [
            '--monto=1.000,50',
            ...concept,
            ...(kind?.letter === 'a' ? ['--cuit=30-71234567-1', '--ir-ri'] : []),
            `--ac=${invoice}`,
            `--ar=${number}`,
            `--apv=${pointOfSale}`,
            ...(daysAgo === undefined ? [] : [`--afecha=-${daysAgo}`]),
          ];
          const outcome = runToPayload(args, shortcut, now);

          expect(outcome.payload).toBeDefined();

          const payload = outcome.payload as NonNullable<Outcome['payload']>;
          const [associated] = payload.CbtesAsoc ?? [];

          expectValidArcaRequest(payload, shortcut);
          expect(associated).toMatchObject({
            Cuit: String(EMITTER_CUIT),
            Nro: number,
            PtoVta: pointOfSale,
            Tipo: getVoucherKindByShortcut(invoice)?.arcaType,
          });

          if (daysAgo !== undefined) {
            expect(isArcaDate(associated?.CbteFch)).toBe(true);
            expect(String(associated?.CbteFch) <= payload.CbteFch).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  // WSFEv1 tipa PtoVta como Int (5), de 1 a 99.998 (10004); CbteDesde y el Nro del asociado como Long (8), hasta
  // 99.999.999 (10008, 10059), e ImpTotal como Double (13+2). Lo que no entra en el campo es un error de entrada antes
  // de la vista previa, igual que en la E (1510 y 1520).
  const rejectsOutOfField = (shortcut: VoucherShortcut, args: (value: number) => string[], min: number) =>
    fc.assert(
      fc.property(fc.integer({ max: Number.MAX_SAFE_INTEGER, min }), instant, (value, now) => {
        expect(runToPayload(args(value), shortcut, now).payload).toBeUndefined();
      }),
      { numRuns: 30 },
    );

  // Con DNI: sin documento lo frena otra regla (consumidor final sin identificar), no el tope.
  it('un --monto de más de 13 enteros es un error de entrada', () => {
    rejectsOutOfField('fb', (value) => ['--cp', '--dni=12345678', `--monto=${value}`], 10_000_000_000_000);
  });

  it('un --pv de más de 5 dígitos es un error de entrada', () => {
    rejectsOutOfField('fb', (value) => ['--cp', '--monto=100', `--pv=${value}`], 100_000);
  });

  it('un --ar de más de 8 dígitos es un error de entrada', () => {
    rejectsOutOfField('ncb', (value) => ['--cp', '--monto=100', '--ac=fb', '--apv=1', `--ar=${value}`], 100_000_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// `--cargar`: el JSON se arma con las claves reales, con valores bien formados o de cualquier tipo.

const anyJson = fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.constantFrom(null, true, 0, -1, 1.005, '', []));
const orAnyJson = <T>(arbitrary: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary, weight: 20 }, { arbitrary: anyJson as unknown as fc.Arbitrary<T>, weight: 1 });
const jsonAmount = fc.integer({ max: 10_000_000_000, min: -100 }).map((cents) => new Big(cents).div(100).toNumber());

const billingJson = fc.record(
  {
    alicuotaIva: orAnyJson(fc.oneof(rateName, fc.constantFrom(21, 10.5, 0))),
    alicuotas: orAnyJson(
      fc.array(fc.record({ monto: orAnyJson(jsonAmount), tasa: orAnyJson(rateName) }), { maxLength: 4, minLength: 1 }),
    ),
    anulacion: orAnyJson(fc.boolean()),
    cbu: orAnyJson(fc.constantFrom('2850590940090418135201', '0170099220000067797370')),
    codigoMoneda: orAnyJson(fc.constantFrom('PES', 'USD', 'DOL', 'EUR')),
    comprobanteAsociado: orAnyJson(
      fc.record(
        {
          atajo: orAnyJson(fc.constantFrom(...SHORTCUTS)),
          cuit: orAnyJson(validCuitText),
          fecha: orAnyJson(dayWord),
          numero: orAnyJson(fc.integer({ max: 1000, min: -1 })),
          puntoVenta: orAnyJson(fc.integer({ max: 1000, min: -1 })),
        },
        { requiredKeys: [] },
      ),
    ),
    concepto: orAnyJson(fc.constantFrom('productos', 'servicios', 'productos-servicios', 'xx')),
    cotizacionMoneda: orAnyJson(jsonAmount),
    dia: orAnyJson(fc.integer({ max: 40, min: -1 })),
    fechaComprobante: orAnyJson(dayWord),
    importeExento: orAnyJson(jsonAmount),
    importeNoGravado: orAnyJson(jsonAmount),
    ivaReceptor: orAnyJson(fc.constantFrom('consumidor-final', 'responsable-inscripto', 'responsable-monotributo')),
    mismaMoneda: orAnyJson(fc.boolean()),
    montoTotal: orAnyJson(fc.oneof(jsonAmount, fc.double())),
    numeroDocumento: orAnyJson(fc.oneof(fc.constantFrom(0, 20111111112, 30712345671), fc.integer())),
    periodoAsociado: orAnyJson(
      fc.record({ desde: orAnyJson(rangeWord), hasta: orAnyJson(rangeWord) }, { requiredKeys: [] }),
    ),
    puntoVenta: orAnyJson(fc.integer({ max: 100_000, min: -1 })),
    servicioDesde: orAnyJson(rangeWord),
    servicioHasta: orAnyJson(rangeWord),
    tipoDocumento: orAnyJson(fc.constantFrom('cuit', 'dni', 'consumidor-final', 'cuil')),
    transferencia: orAnyJson(fc.constantFrom('sca', 'adc')),
    vencimientoPago: orAnyJson(dayWord),
  },
  { requiredKeys: [] },
);

/**
 * Un comprobante B o C a consumidor final que pasa, con hasta 3 claves más de `billingJson`: con todas juntas casi
 * siempre choca alguna regla y nada llega al pedido.
 */
const billingJsonNearValid = fc
  .tuple(
    fc.record({
      concepto: fc.constantFrom('productos', 'servicios', 'productos-servicios'),
      ivaReceptor: fc.constant('consumidor-final'),
      montoTotal: fc.integer({ max: 100_000_000, min: 1 }).map((cents) => new Big(cents).div(100).toNumber()),
    }),
    billingJson,
    fc.integer({ max: 3, min: 0 }),
  )
  .map(([core, extra, count]) => ({ ...core, ...Object.fromEntries(Object.entries(extra).slice(0, count)) }));

describe('billing por --cargar (propiedades)', () => {
  it('cualquier JSON da un pedido a ARCA válido o un error de entrada', () => {
    let reached = 0;

    fc.assert(
      fc.property(
        shortcutArbitrary,
        fc.oneof(
          { arbitrary: billingJsonNearValid, weight: 4 },
          { arbitrary: billingJson, weight: 2 },
          { arbitrary: fc.anything({ maxDepth: 2 }), weight: 1 },
        ),
        instant,
        (shortcut, json, now) => {
          vi.mocked(readJsonFile).mockReturnValue(json);

          const outcome = runToPayload(['--cargar=comprobante.json'], shortcut, now);

          if (outcome.payload) {
            reached += 1;
            expectValidArcaRequest(outcome.payload, shortcut);
            expect(outcome.payload.ImpTotal).toBe(outcome.totalAmount);
          }
        },
      ),
      { numRuns: 400 },
    );

    expect(reached).toBeGreaterThan(0);
  });

  it('un lote de JSON cualquiera da un plan o un error de entrada, nunca una excepción', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(billingJson, fc.anything({ maxDepth: 1 })), { maxLength: 4 }),
        instant,
        async (items, now) => {
          vi.mocked(readJsonFile).mockReturnValue(items);
          vi.setSystemTime(now);

          let plan: ReturnType<typeof parseBillingCommandPlan>;

          try {
            plan = parseBillingCommandPlan(createCommand(['--cargar=lote.json']), 'fb', DEFAULTS);
          } catch (error) {
            expect(isControlledInputError(error)).toBe(true);

            return;
          }

          // Cada item queda como comprobante o como error con su indice: ninguno se pierde.
          expect(plan.inputs.length + plan.invalidItems.length).toBe(plan.total);

          // Como el comando antes de emitir: un lote con errores sale como `BatchValidationError`, que es de entrada.
          try {
            await prepareBatch({ inputs: plan.inputs, plan, resolve: async (input) => input });
          } catch (error) {
            expect(isControlledInputError(error)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
