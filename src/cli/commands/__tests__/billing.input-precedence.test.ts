import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { billingJsonInputSchema } from '../../../modules/billing/billing.json-input';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';

import { BILLING_BASE, BILLING_FIELDS, CBU_A, CBU_B, CUIT_A } from './billing-fields.fixtures';
import { billingInput, billingPlan, describePrecedence, type Json, mergeJson } from './input-precedence.fixtures';

/** REV-52, tanda 1: la precedencia de cada dato de A, B, C, FCE, recibos y notas, para la mudanza a `modules`. */

const EMPTY_INPUT = {
  cancellation: false,
  concept: 'servicios',
  currencyCode: 'ARS',
  documentType: 'consumidor-final',
  dryRun: true,
  emit: false,
  ivaCondition: 'consumidor-final',
  modeSource: 'default',
  sameCurrency: false,
  totalAmount: 1000,
};

describe('precedencia en A, B, C, FCE, recibos y notas', () => {
  describePrecedence<VoucherShortcut>({
    base: BILLING_BASE,
    expected: (field) => ({ ...EMPTY_INPUT, shortcut: field.kind ?? 'fb' }),
    fields: BILLING_FIELDS,
    parse: billingInput,
  });

  it('cada clave de `--cargar` está en la tabla', () => {
    const covered = new Set(BILLING_FIELDS.flatMap((field) => field.file.flatMap(([json]) => Object.keys(json))));

    expect([...covered].sort()).toEqual(Object.keys(billingJsonInputSchema.shape).sort());
  });

  it.each([
    ['fa', true],
    ['fcea', true],
    ['rb', true],
    ['nca', true],
    ['fc', false],
    ['fcec', false],
    ['rc', false],
    ['ndc', false],
  ] as const)('%s toma la alícuota de la config: %s', (shortcut, applies) => {
    const written = { args: BILLING_BASE, config: { alicuotaPorDefecto: '10.5' } };

    expect(billingInput(written, shortcut).ivaRate).toBe(applies ? '10.5' : undefined);
    // La escrita va siempre: si la letra no la admite, lo dice la validación.
    expect(billingInput({ ...written, args: [...BILLING_BASE, '--alicuota', '27'] }, shortcut).ivaRate).toBe('27');
    expect(billingInput({ ...written, json: { alicuotaIva: 5 } }, shortcut).ivaRate).toBe('5');
  });

  it.each([
    ['fceb', true],
    ['ncea', false],
    ['ndec', false],
    ['fb', false],
    ['ra', false],
  ] as const)('%s toma el CBU y el alias de la config: %s', (shortcut, applies) => {
    const written = { args: BILLING_BASE, config: { aliasCbu: 'alias.config', cbu: CBU_A } };
    const { cbu, cbuAlias } = billingInput(written, shortcut);

    expect({ cbu, cbuAlias }).toEqual(
      applies ? { cbu: CBU_A, cbuAlias: 'alias.config' } : { cbu: undefined, cbuAlias: undefined },
    );
    // Los escritos van siempre: si el comprobante no los lleva, lo dice la validación.
    expect(
      billingInput({ ...written, args: [...BILLING_BASE, '--cbu', CBU_B, '--alias', 'otro.alias'] }, shortcut),
    ).toMatchObject({ cbu: CBU_B, cbuAlias: 'otro.alias' });
  });

  it('`"previsualizar": false` del archivo no dice nada: decide la config', () => {
    const written = { args: BILLING_BASE, json: { previsualizar: false } };

    expect(billingInput(written)).toMatchObject({ emit: false, modeSource: 'default' });
    expect(billingInput({ ...written, config: { output: { emitirPorDefecto: true } } })).toMatchObject({
      emit: true,
      modeSource: 'default',
    });
  });

  describe('importes con varias alícuotas', () => {
    const ALICUOTAS = [
      { monto: 100.1, tasa: 'general' },
      { monto: 200.2, tasa: 'reducida' },
    ];
    const base = ['--cs', '--ir-cf'];

    it.each<[string, { args?: string[]; json?: Json }, number]>([
      ['los flags, sin monto: suman', { args: ['--alicuota', 'general:50', '--alicuota', '10.5:25'] }, 75],
      ['el archivo, sin monto: suma sin errores de coma flotante', { json: { alicuotas: ALICUOTAS } }, 300.3],
      [
        'el archivo con exento y no gravado: suma todo',
        { json: { alicuotas: ALICUOTAS, importeExento: 10, importeNoGravado: 5 } },
        315.3,
      ],
      [
        'el archivo con `--exento`: suma el del flag, no el del archivo',
        { args: ['--exento', '1'], json: { alicuotas: ALICUOTAS, importeExento: 10 } },
        301.3,
      ],
      [
        'los flags con el exento del archivo: suman los dos',
        { args: ['--alicuota', 'general:50'], json: { alicuotas: ALICUOTAS, importeExento: 10 } },
        60,
      ],
      [
        // Queda así (diseño de REV-52): la validación controla que cierre.
        '`--alicuota TASA:MONTO` con `montoTotal` del archivo: queda el total del archivo',
        { args: ['--alicuota', 'general:50'], json: { montoTotal: 999 } },
        999,
      ],
      ['`--monto` sobre las alícuotas del archivo', { args: ['--monto', '7'], json: { alicuotas: ALICUOTAS } }, 7],
    ])('%s', (_name, { args = [], json }, totalAmount) => {
      expect(billingInput({ args: [...base, ...args], json }).totalAmount).toBe(totalAmount);
    });

    it('`--alicuota TASA` descarta las alícuotas del archivo, y con ellas el total que daban', () => {
      expect(() => billingInput({ args: [...base, '--alicuota', 'reducida'], json: { alicuotas: ALICUOTAS } })).toThrow(
        /totalAmount/,
      );
    });

    it('las alícuotas ganan a `alicuotaIva` del mismo archivo y a la de la config', () => {
      const input = billingInput({
        args: base,
        config: { alicuotaPorDefecto: '27' },
        json: { alicuotaIva: 5, alicuotas: ALICUOTAS },
      });

      expect(input).toMatchObject({ ivaRateAmounts: [{ rate: '21' }, { rate: '10.5' }] });
      expect(input.ivaRate).toBeUndefined();
    });
  });

  describe('comprobante asociado: campo por campo', () => {
    const FILE = { cuit: String(CUIT_A), fecha: '01/09/2026', numero: 5, puntoVenta: 1 };
    const json = { comprobanteAsociado: { ...FILE, atajo: 'fc' } };

    // El cuit ya lo fija billing.command.parser.test.ts.
    // La fecha y el CUIT son del comprobante del archivo: con otro no van (cruce A).
    it.each([
      ['--ar', '6', { cuit: undefined, fecha: undefined, numero: 6, shortcut: 'fc' }],
      ['--apv', '6', { cuit: undefined, fecha: undefined, puntoVenta: 6, shortcut: 'fc' }],
      ['--afecha', '02/09/2026', { fecha: '02/09/2026', shortcut: 'fc' }],
      // El atajo del archivo no se mezcla con el tipo que identifica el flag.
      ['--ac', 'ndc', { cuit: undefined, fecha: undefined, shortcut: 'ndc' }],
      ['--at', '12', { cuit: undefined, fecha: undefined, tipo: 12 }],
    ])('%s cambia solo lo suyo', (flag, value, changes) => {
      expect(billingInput({ args: [...BILLING_BASE, flag, value], json }, 'ncc').associatedVoucher).toEqual({
        ...FILE,
        ...changes,
      });
    });

    it('`--ac` descarta también el `tipo` del archivo', () => {
      const input = billingInput(
        { args: [...BILLING_BASE, '--ac', 'ndc'], json: { comprobanteAsociado: { numero: 5, tipo: 11 } } },
        'ncc',
      );

      expect(input.associatedVoucher).toEqual({ numero: 5, shortcut: 'ndc' });
    });
  });

  it.each([
    ['--periodo-desde', { desde: '01/09/2026' }],
    ['--pd', { desde: '01/09/2026' }],
    ['--periodo-hasta', { hasta: '01/09/2026' }],
    ['--ph', { hasta: '01/09/2026' }],
  ])('%s solo, sin archivo, deja la otra punta vacía (la pide la validación)', (flag, period) => {
    expect(billingInput({ args: [...BILLING_BASE, flag, '01/09/2026'] }, 'ncc').associatedPeriod).toEqual(period);
  });

  it('el IVA sin escribir: con CUIT y el padrón prendido se consulta; con DNI o el padrón apagado, no', () => {
    const base = ['--monto', '1000', '--cs'];
    const config = { ivaReceptorPorDefecto: 'sujeto-exento' };
    const file = { numeroDocumento: CUIT_A, tipoDocumento: 'cuit' };

    expect(billingInput({ args: base, json: file })).toMatchObject({ ivaConditionSource: 'missing' });
    expect(billingInput({ args: base, config, json: file })).toMatchObject({
      ivaCondition: 'sujeto-exento',
      ivaConditionSource: 'default',
    });

    const off = billingInput({ args: base, config: { ...config, consultarPadron: false }, json: file });

    expect(off.ivaCondition).toBe('sujeto-exento');
    expect(off.ivaConditionSource).toBeUndefined();
    expect(() => billingInput({ args: base, json: { numeroDocumento: 30111222, tipoDocumento: 'dni' } })).toThrow(
      /^Falta IVA receptor/,
    );
  });

  // El primero gana al otro sin error: solo `--concepto`, `--iva-receptor` y `--ac`/`--at` son incompatibles.
  it.each<[string[], string[], Json]>([
    [['--punto-venta', '1'], ['--pv', '2'], { pointOfSale: 1 }],
    [['--vencimiento', '01/11/2026'], ['--vto', '02/11/2026'], { paymentDueDate: '01/11/2026' }],
    [['--servicio-desde', '01/09/2026'], ['--sd', '02/09/2026'], { serviceStartDate: '01/09/2026' }],
    [['--servicio-hasta', '01/09/2026'], ['--sh', '02/09/2026'], { serviceEndDate: '01/09/2026' }],
    [['--moneda', 'USD'], ['--mda', 'EUR'], { currencyCode: 'USD' }],
    [['--cotizacion-moneda', '10'], ['--cm', '20'], { exchangeRate: 10 }],
    [['--apv', '1'], ['--asociado-punto-venta', '2'], { associatedVoucher: { puntoVenta: 1 } }],
    [['--periodo-desde', '01/09/2026'], ['--pd', '02/09/2026'], { associatedPeriod: { desde: '01/09/2026' } }],
    [['--periodo-hasta', '01/09/2026'], ['--ph', '02/09/2026'], { associatedPeriod: { hasta: '01/09/2026' } }],
    [['--condicion-venta', 'contado'], ['--cv', 'cheque'], { saleCondition: 'contado' }],
  ])('%j con %j: gana el primero, en cualquier orden', (main, alias, expected) => {
    expect(billingInput({ args: [...BILLING_BASE, ...main, ...alias] }, 'ncc')).toMatchObject(expected);
    expect(billingInput({ args: [...BILLING_BASE, ...alias, ...main] }, 'ncc')).toMatchObject(expected);
  });
});

describe('precedencia en un lote', () => {
  it('cada comprobante mezcla lo suyo: el flag va en todos y el archivo y la config, en el que corresponde', () => {
    const plan = billingPlan({
      args: ['--cs', '--ir-cf', '--pv', '9'],
      config: { alicuotaPorDefecto: '27' },
      json: [{ alicuotaIva: 5, montoTotal: 1, puntoVenta: 1 }, { montoTotal: 2 }, { descripcion: 'X', montoTotal: 3 }],
    });

    expect(plan).toMatchObject({ inputIndexes: [1, 2, 3], invalidItems: [], isBatch: true, total: 3 });
    expect(plan.inputs).toMatchObject([
      { ivaRate: '5', pointOfSale: 9, totalAmount: 1 },
      { ivaRate: '27', pointOfSale: 9, totalAmount: 2 },
      { ivaRate: '27', pointOfSale: 9, totalAmount: 3 },
    ]);
    expect(plan.inputs.map((input) => input.fromFile)).toEqual([undefined, undefined, ['pdfDescription']]);
  });

  const item = (extra: Json = {}) => ({ montoTotal: 1, ...extra });

  it.each<[string, Json[], string[], string, boolean[]]>([
    ['ningún ítem lo dice', [item(), item({ previsualizar: false })], [], 'default', [false, false]],
    ['un ítem lo dice', [item(), item({ emitir: true })], [], 'file', [false, true]],
    ['un flag', [item({ emitir: true }), item()], ['--previsualizar'], 'flags', [false, false]],
    // El ítem que no se puede leer no opina.
    ['el único que lo dice no se puede leer', [item(), item({ emitir: true, pv: 1 })], [], 'default', [false]],
  ])('quién decidió emitir: %s', (_name, json, args, modeSource, emit) => {
    const plan = billingPlan({ args: ['--cs', '--ir-cf', ...args], json });

    expect(plan.modeSource).toBe(modeSource);
    expect(plan.inputs.map((input) => input.emit)).toEqual(emit);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** Dos datos que en el mismo nivel son incompatibles: con los dos, el error es la respuesta correcta. */
const OPPOSITE = ['cotización', 'misma moneda'];

/** Qué forma de cada nivel se escribe de cada dato (o ninguna). */
const selection = fc.tuple(
  ...BILLING_FIELDS.map((field) => {
    const index = (length: number) => fc.option(fc.nat({ max: length - 1 }), { nil: undefined });

    return fc.record({
      config: field.config ? index(field.config.length) : fc.constant(undefined),
      file: index(field.file.length),
      flag: index(field.flags.length),
    });
  }),
);

describe('precedencia (propiedad)', () => {
  it('un flag escrito nunca queda reemplazado por el archivo ni por la config', () => {
    let replaceable = 0;

    fc.assert(
      fc.property(
        selection,
        fc.constantFrom(...(Object.keys(VOUCHER_KIND_MAP) as VoucherShortcut[])),
        (picks, kind) => {
          const taken = { file: false, flag: false };
          const args: string[] = [];
          // Los obligatorios están siempre, en el archivo.
          const files: Json[] = [{ concepto: 'servicios', ivaReceptor: 'consumidor-final', montoTotal: 1 }];
          // El IVA también en la config: el del archivo puede no valer para el documento de un flag (cruce 3).
          const config: Json = { ivaReceptorPorDefecto: 'consumidor-final' };
          const expected: Array<[string, unknown]> = [];

          BILLING_FIELDS.forEach((field, position) => {
            const levels = picks[position];
            const opposite = OPPOSITE.includes(field.name);
            const flag = opposite && taken.flag ? undefined : levels?.flag;
            const file = opposite && taken.file ? undefined : levels?.file;

            if (flag !== undefined) {
              const [written = [], changes = {}] = field.flags[flag] ?? [];

              args.push(...written);
              expected.push(...Object.entries(changes));
              taken.flag ||= opposite;
              replaceable += file !== undefined || levels?.config !== undefined ? 1 : 0;
            }

            if (file !== undefined) {
              files.push(field.file[file]?.[0] ?? {});
              taken.file ||= opposite;
            }

            Object.assign(config, field.config?.[levels?.config ?? -1]?.[0]);
          });

          const input = billingInput({ args, config, json: mergeJson(files) }, kind);

          for (const [key, value] of expected) {
            expect(input[key], key).toEqual(
              key === 'associatedVoucher' ? expect.objectContaining(value as Json) : value,
            );
          }
        },
      ),
      { numRuns: 300 },
    );

    // Que no pase de casualidad: hubo flags con otro valor en el archivo o en la config.
    expect(replaceable).toBeGreaterThan(0);
  });
});
