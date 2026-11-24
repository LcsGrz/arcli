import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportVoucherKind,
  isExportNote,
} from '../../../modules/export/export.types';

import { CBU_A, CUIT_A, CUIT_B } from './billing-fields.fixtures';
import {
  describePrecedence,
  exportInput,
  exportPlan,
  type FieldCase,
  forms,
  type Json,
  mergeJson,
} from './input-precedence.fixtures';

/** REV-52, tanda 1: la precedencia de cada dato de la factura E y de sus notas, para la mudanza a `modules`. */

const ITEM = { code: undefined, description: 'Del archivo', quantity: 2, unit: undefined, unitPrice: 10 };

/** Los de la E; los de las notas van con su `kind`. */
const FIELDS: ReadonlyArray<FieldCase<ExportVoucherKind>> = [
  {
    file: [
      [{ montoTotal: 250.5 }, { amount: 250.5 }],
      [{ monto: 250.5 }, { amount: 250.5 }],
    ],
    flags: forms(['--monto', '-m'], '1.500,50', 'amount', 1500.5),
    name: 'monto',
  },
  {
    file: [[{ actividad: 620100 }, { activity: 620100 }]],
    flags: [[['--actividad', '620200'], { activity: 620200 }]],
    name: 'actividad',
  },
  {
    file: [[{ cliente: 'Archivo LLC' }, { clientName: 'Archivo LLC' }]],
    flags: [[['--cliente', 'Flag LLC'], { clientName: 'Flag LLC' }]],
    name: 'cliente',
  },
  {
    file: [[{ domicilioCliente: 'Main St 1' }, { clientAddress: 'Main St 1' }]],
    flags: [[['--domicilio-cliente', 'Main St 2'], { clientAddress: 'Main St 2' }]],
    name: 'domicilio del cliente',
  },
  {
    file: [
      [{ paisDestino: 212 }, { destinationCountry: '212' }],
      [{ paisDestino: 'Brasil' }, { destinationCountry: 'Brasil' }],
    ],
    flags: [[['--pais-destino', '203'], { destinationCountry: '203' }]],
    name: 'país de destino',
  },
  {
    file: [[{ idImpositivo: 'A-1' }, { clientTaxId: 'A-1' }]],
    flags: [[['--id-impositivo', 'B-2'], { clientTaxId: 'B-2' }]],
    name: 'ID impositivo',
  },
  {
    file: [[{ cuitPais: 55000002126 }, { clientCountryCuit: 55000002126 }]],
    flags: [[['--cuit-pais', '55000002037'], { clientCountryCuit: 55000002037 }]],
    name: 'CUIT del país',
  },
  {
    file: [[{ tipoExpo: 1 }, { exportType: 1 }]],
    flags: [[['--tipo-expo', '4'], { exportType: 4 }]],
    name: 'tipo de exportación',
  },
  {
    file: [[{ incoterm: 'FOB' }, { incoterm: 'FOB' }]],
    flags: [[['--incoterm', 'CIF'], { incoterm: 'CIF' }]],
    name: 'incoterm',
  },
  {
    file: [[{ descripcionIncoterm: 'Del archivo' }, { incotermDescription: 'Del archivo' }]],
    flags: [[['--incoterms-desc', 'Del flag'], { incotermDescription: 'Del flag' }]],
    name: 'descripción del incoterm',
  },
  {
    file: [[{ idioma: 2 }, { language: 2 }]],
    flags: [[['--idioma', '3'], { language: 3 }]],
    name: 'idioma',
  },
  {
    file: [[{ formaPago: 'Archivo' }, { paymentTerms: 'Archivo' }]],
    flags: [[['--forma-pago', 'Flag'], { paymentTerms: 'Flag' }]],
    name: 'forma de pago',
  },
  {
    // La lista del flag reemplaza a la del archivo: no se suman.
    file: [
      [{ permisos: ['A1', 'A2'] }, { permits: ['A1', 'A2'] }],
      [{ permisos: [] }, { permits: [] }],
    ],
    flags: [[['--permiso', 'B1', '--permiso', 'B2'], { permits: ['B1', 'B2'] }]],
    name: 'permisos',
  },
  {
    file: [
      [{ permisoExistente: true }, { permitsExisting: true }],
      [{ permisoExistente: false }, { permitsExisting: false }],
    ],
    flags: [[['--permiso-existente'], { permitsExisting: true }]],
    name: 'permiso existente',
  },
  {
    file: [[{ items: [{ cantidad: 2, descripcion: 'Del archivo', precioUnitario: 10 }] }, { items: [ITEM] }]],
    flags: [
      [
        ['--item', '001|Del flag|1|1500|unidad'],
        { items: [{ code: '001', description: 'Del flag', quantity: 1, unit: 'unidad', unitPrice: 1500 }] },
      ],
    ],
    name: 'ítems',
  },
  {
    file: [[{ numero: 5 }, { voucherNumber: 5 }]],
    flags: [[['--numero', '6'], { voucherNumber: 6 }]],
    name: 'número',
  },
  {
    file: [[{ idSolicitud: 5 }, { requestId: 5 }]],
    flags: [[['--id-solicitud', '6'], { requestId: 6 }]],
    name: 'ID de la solicitud',
  },
  {
    file: [[{ puntoVenta: 7 }, { pointOfSale: 7 }]],
    flags: forms(['--punto-venta', '--pv'], '9', 'pointOfSale', 9),
    name: 'punto de venta',
  },
  {
    file: [[{ fechaComprobante: '01/10/2026' }, { voucherDate: '01/10/2026' }]],
    flags: forms(['--fecha', '-f'], '02/10/2026', 'voucherDate', '02/10/2026'),
    name: 'fecha del comprobante',
  },
  {
    file: [[{ fechaPago: '01/10/2026' }, { paymentDate: '01/10/2026' }]],
    flags: [[['--fecha-pago', '02/10/2026'], { paymentDate: '02/10/2026' }]],
    name: 'fecha de pago',
  },
  {
    file: [[{ codigoMoneda: 'EUR' }, { currencyCode: 'EUR' }]],
    flags: forms(['--moneda', '--mda'], 'USD', 'currencyCode', 'USD'),
    name: 'moneda',
  },
  {
    // Con la moneda por defecto (DOL) en los dos niveles.
    file: [[{ cotizacionMoneda: 1300 }, { exchangeRate: 1300 }]],
    flags: forms(['--cotizacion-moneda', '--cm'], '1.400,50', 'exchangeRate', 1400.5),
    name: 'cotización',
  },
  {
    file: [
      [{ mismaMoneda: true }, { sameCurrency: true }],
      [{ mismaMoneda: false }, { sameCurrency: false }],
    ],
    flags: [[['--misma-moneda'], { sameCurrency: true }]],
    name: 'misma moneda',
  },
  {
    file: [[{ observaciones: 'Archivo' }, { observations: 'Archivo' }]],
    flags: [[['--observaciones', 'Flag'], { observations: 'Flag' }]],
    name: 'observaciones',
  },
  {
    file: [[{ observacionesComerciales: 'Archivo' }, { commercialObservations: 'Archivo' }]],
    flags: [[['--obs-comerciales', 'Flag'], { commercialObservations: 'Flag' }]],
    name: 'observaciones comerciales',
  },
  {
    file: [[{ descripcion: 'Archivo' }, { description: 'Archivo' }]],
    flags: [[['--descripcion', 'Flag'], { description: 'Flag' }]],
    name: 'descripción',
  },
  {
    file: [
      [{ pdf: true }, { pdf: true }],
      [{ pdf: false }, { pdf: false }],
    ],
    flags: [
      [['--exportar-pdf'], { pdf: true }],
      [['--pdf'], { pdf: true }],
      [['--sin-pdf'], { pdf: false }],
    ],
    name: 'PDF',
  },
  {
    config: [[{ output: { emitirPorDefecto: true } }, { emit: true }]],
    file: [
      [{ emitir: true }, { emit: true, modeSource: 'file' }],
      [{ emitir: false }, { modeSource: 'file' }],
      [{ previsualizar: true }, { modeSource: 'file' }],
    ],
    flags: [
      [['--emitir'], { emit: true, modeSource: 'flags' }],
      [['--previsualizar'], { emit: false, modeSource: 'flags' }],
    ],
    name: 'emitir o previsualizar',
  },
  {
    file: [[{ comprobanteAsociado: { numero: 5 } }, { associatedVoucher: { number: 5 } }]],
    flags: [[['--ar', '6'], { associatedVoucher: { number: 6 } }]],
    kind: EXPORT_CREDIT_NOTE_KIND,
    name: 'asociado: número',
  },
  {
    file: [[{ comprobanteAsociado: { puntoVenta: 5 } }, { associatedVoucher: { pointOfSale: 5 } }]],
    flags: forms(['--apv', '--asociado-punto-venta'], '6', 'associatedVoucher', { pointOfSale: 6 }),
    kind: EXPORT_DEBIT_NOTE_KIND,
    name: 'asociado: punto de venta',
  },
  {
    file: [[{ comprobanteAsociado: { atajo: 'fe' } }, { associatedVoucher: { shortcut: 'fe' } }]],
    flags: [[['--ac', 'nde'], { associatedVoucher: { shortcut: 'nde' } }]],
    kind: EXPORT_CREDIT_NOTE_KIND,
    name: 'asociado: atajo',
  },
  {
    file: [[{ comprobanteAsociado: { tipo: 19 } }, { associatedVoucher: { arcaType: 19 } }]],
    flags: [[['--at', '20'], { associatedVoucher: { arcaType: 20 } }]],
    kind: EXPORT_CREDIT_NOTE_KIND,
    name: 'asociado: tipo',
  },
  {
    file: [[{ comprobanteAsociado: { cuit: String(CUIT_A) } }, { associatedVoucher: { cuit: String(CUIT_A) } }]],
    flags: [[['--acuit', String(CUIT_B)], { associatedVoucher: { cuit: String(CUIT_B) } }]],
    kind: EXPORT_DEBIT_NOTE_KIND,
    name: 'asociado: CUIT',
  },
  {
    // Sin flag: la nota E no tiene `--afecha`.
    file: [[{ comprobanteAsociado: { fecha: '01/09/2026' } }, { associatedVoucher: { date: '01/09/2026' } }]],
    flags: [],
    kind: EXPORT_CREDIT_NOTE_KIND,
    name: 'asociado: fecha',
  },
];

const emptyInput = (kind: ExportVoucherKind): Json => ({
  associatedVoucher: isExportNote(kind) ? {} : undefined,
  emit: false,
  modeSource: 'default',
  voucherKind: kind,
});

describe('precedencia en la E', () => {
  describePrecedence<ExportVoucherKind>({
    base: [],
    expected: (field) => emptyInput(field.kind ?? EXPORT_VOUCHER_KIND),
    fields: FIELDS,
    parse: exportInput,
  });

  describe('las mismas reglas en la nota de crédito E', () => {
    // Los que la nota no tiene como flag: del archivo sí se leen.
    const onlyInvoice = ['permiso existente', 'fecha de pago', 'misma moneda'];

    describePrecedence<ExportVoucherKind>({
      base: [],
      expected: () => emptyInput(EXPORT_CREDIT_NOTE_KIND),
      fields: FIELDS.filter((field) => !field.kind).map((field) => ({
        ...field,
        flags: onlyInvoice.includes(field.name) ? [] : field.flags,
        kind: EXPORT_CREDIT_NOTE_KIND,
      })),
      parse: exportInput,
    });
  });

  it('de la config solo toma si emite: ni moneda, ni cotización, ni lo de A, B y C', () => {
    const config = {
      aliasCbu: 'alias.config',
      alicuotaPorDefecto: '27',
      cbu: CBU_A,
      conceptoPorDefecto: 'productos',
      cotizacionPorDefecto: 1200,
      ivaReceptorPorDefecto: 'sujeto-exento',
      monedaPorDefecto: 'EUR',
      pdf: 'siempre',
      puntoVentaPorDefecto: 8,
    };

    for (const kind of [EXPORT_VOUCHER_KIND, EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND]) {
      expect(exportInput({ config }, kind)).toEqual(emptyInput(kind));
    }
  });

  it('en la nota, cada dato del asociado sale de su nivel', () => {
    const json = { comprobanteAsociado: { atajo: 'fe', fecha: '01/09/2026', numero: 5, puntoVenta: 1 } };

    expect(exportInput({ args: ['--ar', '6'], json }, EXPORT_CREDIT_NOTE_KIND).associatedVoucher).toEqual({
      date: '01/09/2026',
      number: 6,
      pointOfSale: 1,
      shortcut: 'fe',
    });
  });

  it('`arcli nota-credito e` saltea los flags de A, B y C que comparten nombre: gana el archivo', () => {
    const { input } = exportPlan(
      {
        args: ['--misma-moneda', '--afecha', '05/09/2026', '--ar', '6'],
        json: { comprobanteAsociado: { fecha: '01/09/2026' }, mismaMoneda: false },
      },
      EXPORT_CREDIT_NOTE_KIND,
      { family: true },
    );

    expect(input.sameCurrency).toBe(false);
    expect(input.associatedVoucher).toEqual({ date: '01/09/2026', number: 6 });
  });

  it('`arcli factura e` saltea el asociado de A, B y C', () => {
    const { input } = exportPlan(
      { args: ['--ac', 'fa', '--ar', '6', '--apv', '1', '--misma-moneda'] },
      EXPORT_VOUCHER_KIND,
      { family: true },
    );

    expect(input.associatedVoucher).toBeUndefined();
    expect(input.sameCurrency).toBe(true);
  });

  it.each<[string[], string[], Json]>([
    [['--punto-venta', '1'], ['--pv', '2'], { pointOfSale: 1 }],
    [['--moneda', 'USD'], ['--mda', 'EUR'], { currencyCode: 'USD' }],
    [['--cotizacion-moneda', '10'], ['--cm', '20'], { exchangeRate: 10 }],
    [['--apv', '1'], ['--asociado-punto-venta', '2'], { associatedVoucher: { pointOfSale: 1 } }],
  ])('%j con %j: gana el primero, en cualquier orden', (main, alias, expected) => {
    expect(exportInput({ args: [...main, ...alias] }, EXPORT_CREDIT_NOTE_KIND)).toMatchObject(expected);
    expect(exportInput({ args: [...alias, ...main] }, EXPORT_CREDIT_NOTE_KIND)).toMatchObject(expected);
  });
});

describe('precedencia en la E (propiedad)', () => {
  const selection = fc.tuple(
    ...FIELDS.map((field) => {
      const index = (length: number) =>
        length === 0 ? fc.constant(undefined) : fc.option(fc.nat({ max: length - 1 }), { nil: undefined });

      return fc.record({ file: index(field.file.length), flag: index(field.flags.length) });
    }),
  );
  const onlyInvoice = ['permiso existente', 'fecha de pago', 'misma moneda'];

  it('un flag escrito nunca queda reemplazado por el archivo ni por la config', () => {
    let replaceable = 0;

    fc.assert(
      fc.property(
        selection,
        fc.constantFrom(EXPORT_VOUCHER_KIND, EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND),
        fc.boolean(),
        (picks, kind, emitirPorDefecto) => {
          const args: string[] = [];
          const files: Json[] = [];
          const expected: Array<[string, unknown]> = [];

          FIELDS.forEach((field, position) => {
            const { file, flag } = picks[position] ?? {};
            const isNoteField = field.name.startsWith('asociado');

            // El asociado es de las notas, y hay flags que son solo de la factura.
            if (isNoteField && !isExportNote(kind)) {
              return;
            }

            if (flag !== undefined && !(isExportNote(kind) && onlyInvoice.includes(field.name))) {
              const [written = [], changes = {}] = field.flags[flag] ?? [];

              args.push(...written);
              expected.push(...Object.entries(changes));
              replaceable += file === undefined ? 0 : 1;
            }

            // `--cm` y `--misma-moneda` juntos no son un error en la E: cada flag queda.
            if (file !== undefined) {
              files.push(field.file[file]?.[0] ?? {});
            }
          });

          const input = exportInput({ args, config: { output: { emitirPorDefecto } }, json: mergeJson(files) }, kind);

          for (const [key, value] of expected) {
            expect(input[key], key).toEqual(
              key === 'associatedVoucher' ? expect.objectContaining(value as Json) : value,
            );
          }
        },
      ),
      { numRuns: 200 },
    );

    expect(replaceable).toBeGreaterThan(0);
  });
});

interface Conflict {
  readonly args?: readonly string[];
  readonly json?: Json;
  readonly message: string;
  readonly name: string;
}

/** En el orden en que se controlan: con dos, sale el de más arriba. */
const CONFLICTS: readonly Conflict[] = [
  { json: { noExiste: 1 }, message: 'En el JSON de `--cargar`: ', name: 'una clave desconocida en el archivo' },
  {
    json: { monto: 1, montoTotal: 1 },
    message: 'En el JSON de `--cargar`: usá "montoTotal" o "monto", no las dos.',
    name: '"monto" con "montoTotal"',
  },
  {
    args: ['--emitir', '--previsualizar'],
    message: 'Usá `--emitir` o `--previsualizar`, no los dos.',
    name: '--emitir con --previsualizar',
  },
  {
    json: { emitir: true, previsualizar: true },
    message: 'En el archivo usá "emitir" o "previsualizar", pero no ambos en true.',
    name: '"emitir" con "previsualizar"',
  },
  {
    args: ['--pdf', '--sin-pdf'],
    message: 'Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.',
    name: '--pdf con --sin-pdf',
  },
  {
    json: { comprobanteAsociado: {} },
    message: 'La factura E no lleva comprobante asociado',
    name: '"comprobanteAsociado" en la factura',
  },
  { args: ['--fecha-pago', 'mes-pasado'], message: '`mes-pasado` es un mes', name: 'fecha de pago ilegible' },
  { args: ['--fecha', 'mes-actual'], message: '`mes-actual` es un mes', name: 'fecha ilegible' },
];

describe('datos incompatibles en la E', () => {
  const run = (...conflicts: readonly Conflict[]) => {
    const files = conflicts.flatMap(({ json }) => (json ? [json] : []));

    return exportInput({
      args: conflicts.flatMap(({ args }) => args ?? []),
      json: files.length > 0 ? mergeJson(files) : undefined,
    });
  };

  it.each(CONFLICTS)('$name', (conflict) => {
    expect(() => run(conflict)).toThrow(conflict.message);
  });

  it.each(CONFLICTS.slice(0, -1).map((conflict, position) => ({ ...conflict, position })))(
    '$name sale antes que todo lo de más abajo',
    ({ position, ...conflict }) => {
      for (const later of CONFLICTS.slice(position + 1)) {
        // `--emitir` con el archivo también: los flags se miran primero.
        expect(() => run(conflict, later), `con ${later.name}`).toThrow(conflict.message);
      }
    },
  );

  it('en la nota, la fecha del asociado se lee antes que la del comprobante', () => {
    const json = { comprobanteAsociado: { fecha: 'mes-pasado' }, fechaPago: 'mes-actual' };

    expect(() => exportInput({ args: ['--fecha', 'mes-actual'], json }, EXPORT_CREDIT_NOTE_KIND)).toThrow(
      '`mes-pasado` es un mes',
    );
  });

  it('un lote no se acepta, aunque tenga un solo comprobante', () => {
    expect(() => exportInput({ json: [{ montoTotal: 1 }] })).toThrow('no un array.');
  });

  it('los avisos: el de "monto" va antes que el de la descripción con ítems', () => {
    const { warnings } = exportPlan({
      args: ['--descripcion', 'Flag'],
      json: { items: [{ cantidad: 1, descripcion: 'X', precioUnitario: 1 }], monto: 1 },
    });

    expect(warnings).toEqual([
      expect.stringContaining('"monto"'),
      '`--descripcion` se usa solo cuando no hay "items": el detalle del comprobante sale de los ítems.',
    ]);
  });
});

describe('"hoy" al armar la E', () => {
  const REAL_DATE = Date;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('se lee una sola vez: las fechas son del mismo "hoy" aunque cruce la medianoche', () => {
    const instants = ['2026-11-10T23:59:59-03:00'];

    vi.stubGlobal(
      'Date',
      class extends REAL_DATE {
        constructor(...args: [] | [number | string]) {
          super(args.length > 0 ? (args[0] as number) : (instants.shift() ?? '2026-11-11T00:00:01-03:00'));
        }
      },
    );

    expect(exportInput({ args: ['--fecha', 'hoy'], json: { fechaPago: 'hoy' } })).toMatchObject({
      paymentDate: '10/11/2026',
      voucherDate: '10/11/2026',
    });
  });
});
