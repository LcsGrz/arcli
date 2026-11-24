import { afterEach, describe, expect, it, vi } from 'vitest';

import { BILLING_BASE } from './billing-fields.fixtures';
import { billingInput, billingPlan, type Json, mergeJson } from './input-precedence.fixtures';

/** REV-52, tanda 1: los datos incompatibles de A, B y C, y qué error sale cuando hay más de uno. */

interface Conflict {
  readonly args?: readonly string[];
  readonly json?: Json;
  readonly message: string;
  readonly name: string;
  /** El dato obligatorio que no va: los otros casos que lo escriben no se pueden combinar con este. */
  readonly without?: 'concept' | 'iva';
  /** El dato obligatorio que escribe el caso. */
  readonly writes?: 'concept' | 'iva';
}

const IR_TWO = 'Usá `--iva-receptor` o `--ir` para indicar IVA receptor, pero no ambos.';
const IR_MIXED = 'Usá `--iva-receptor`, `--ir` o un flag corto `--ir-*`, pero no varios a la vez.';
const IDENTITY = 'Usá solo una identidad de receptor: `--cuit`, `--cuil`, `--dni`, `--consumidor-final` o `--cfinal`.';
const CONCEPTS = 'Usá solo un flag de concepto entre `--cs`, `--cp` o `--csp`.';
const CONCEPT_MIXED = 'Usá `--concepto` o un flag corto de concepto (`--cs`, `--cp`, `--csp`), pero no ambos.';
const MONTH_IN_DAY = (word: string) => `\`${word}\` es un mes y esta fecha es de un día`;

/** En el orden en que se controlan: con dos, sale el de más arriba. */
const CONFLICTS: readonly Conflict[] = [
  { json: { noExiste: 1 }, message: 'En el JSON de `--cargar`:', name: 'una clave desconocida en el archivo' },
  {
    args: ['--ac', 'fb', '--at', '6'],
    message: 'Usá `--ac` o `--at` para identificar el comprobante asociado, pero no ambos a la vez.',
    name: '--ac con --at',
  },
  {
    args: ['--emitir', '--previsualizar'],
    message: 'Usá `--emitir` o `--previsualizar`, pero no ambos a la vez.',
    name: '--emitir con --previsualizar',
  },
  {
    json: { emitir: true, previsualizar: true },
    message: 'En el archivo usá "emitir" o "previsualizar", pero no ambos en true.',
    name: '"emitir" con "previsualizar" en el archivo',
  },
  { args: ['--cs', '--cp'], message: CONCEPTS, name: 'dos conceptos cortos', writes: 'concept' },
  { args: ['--cuit', '20111111112', '--dni', '30111222'], message: IDENTITY, name: 'dos documentos' },
  {
    args: ['--ir-cf', '--ir-ri'],
    message: 'Usá solo un flag de IVA receptor entre las opciones `--ir-*`.',
    name: 'dos IVA cortos',
    writes: 'iva',
  },
  { args: ['--concepto', 's', '--csp'], message: CONCEPT_MIXED, name: '--concepto con uno corto', writes: 'concept' },
  { args: ['--ir', 'cf', '--iva-receptor', 'cf'], message: IR_TWO, name: '--ir con --iva-receptor', writes: 'iva' },
  { args: ['--ir', 'cf', '--ir-ri'], message: IR_MIXED, name: '--ir con uno corto', writes: 'iva' },
  { message: 'Falta el concepto.', name: 'sin concepto', without: 'concept' },
  { message: 'Falta IVA receptor', name: 'sin IVA receptor', without: 'iva' },
  {
    args: ['--moneda', 'USD', '--misma-moneda', '--cm', '10'],
    message: 'Con `--misma-moneda` la cotización se toma de ARCA. Sacá `--cotizacion-moneda` o `--cm`.',
    name: '--misma-moneda con --cm',
  },
  { args: ['--pd', 'pd-malo'], message: 'pd-malo', name: 'periodo desde ilegible' },
  { args: ['--ph', 'ph-malo'], message: 'ph-malo', name: 'periodo hasta ilegible' },
  {
    args: ['--alicuota', 'general', '--alicuota', 'reducida:10'],
    message: 'No mezcles `--alicuota TASA` con `--alicuota TASA:MONTO`: usá una sola forma.',
    name: 'alícuotas mezcladas',
  },
  {
    args: ['--cv', 'contado', '--sin-condicion-venta'],
    message: 'Usá `--condicion-venta`/`--cv` o `--sin-condicion-venta`, pero no ambos a la vez.',
    name: '--cv con --sin-condicion-venta',
  },
  { args: ['--afecha', 'mes-actual'], message: MONTH_IN_DAY('mes-actual'), name: 'fecha del asociado ilegible' },
  { args: ['--fecha', 'mes-pasado'], message: MONTH_IN_DAY('mes-pasado'), name: 'fecha ilegible' },
  { args: ['--vto', 'vto-malo'], message: 'vto-malo', name: 'vencimiento ilegible' },
  {
    args: ['--pdf', '--sin-pdf'],
    message: 'Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.',
    name: '--pdf con --sin-pdf',
  },
  { args: ['--sh', 'sh-malo'], message: 'sh-malo', name: 'servicio hasta ilegible' },
  { args: ['--sd', 'sd-malo'], message: 'sd-malo', name: 'servicio desde ilegible' },
  // Los valores se validan al final y juntos.
  { args: ['--pv', '0'], message: 'pointOfSale', name: 'un valor fuera de rango' },
];

/** El comando con los datos incompatibles de `conflicts`, y lo mínimo que no escriben ellos. */
function writtenWith(...conflicts: readonly Conflict[]) {
  const omits = (slot: 'concept' | 'iva') =>
    conflicts.some((conflict) => conflict.without === slot || conflict.writes === slot);
  const files = conflicts.flatMap(({ json }) => (json ? [json] : []));

  return {
    args: [
      '--monto',
      '1000',
      ...(omits('concept') ? [] : ['--cs']),
      ...(omits('iva') ? [] : ['--ir-cf']),
      ...conflicts.flatMap((conflict) => conflict.args ?? []),
    ],
    json: files.length > 0 ? mergeJson(files) : undefined,
  };
}

/** No se pueden escribir juntos, o juntos son otro caso. */
function combines(first: Conflict, second: Conflict): boolean {
  const slots = [first.without, second.without].filter(Boolean);
  // Dos casos de IVA o de concepto repiten flags: cuál sale depende de todos, y su orden ya lo dicen los otros.
  const sameSlot = first.writes !== undefined && first.writes === second.writes;
  // `--emitir` y `--previsualizar` deciden antes de mirar el archivo.
  const bothEmit = [first, second].every((conflict) => /previsualizar/.test(conflict.message));
  const missing = slots.some((slot) => [first.writes, second.writes].includes(slot));

  return !sameSlot && !missing && !bothEmit;
}

describe('datos incompatibles en A, B y C', () => {
  it.each(CONFLICTS)('$name', (conflict) => {
    expect(() => billingInput(writtenWith(conflict), 'ncb')).toThrow(conflict.message);
  });

  it.each(CONFLICTS.slice(0, -1).map((conflict, position) => ({ ...conflict, position })))(
    '$name sale antes que todo lo de más abajo',
    ({ position, ...conflict }) => {
      for (const later of CONFLICTS.slice(position + 1).filter((other) => combines(conflict, other))) {
        expect(() => billingInput(writtenWith(conflict, later), 'ncb'), `con ${later.name}`).toThrow(conflict.message);
      }
    },
  );

  // Las demás formas de escribir lo mismo.
  it.each<[string[], string, Json?]>([
    [['--cs', '--csp'], CONCEPTS],
    [['--cp', '--csp'], CONCEPTS],
    [['--concepto', 's', '--cs'], CONCEPT_MIXED],
    [['--concepto', 's', '--cp'], CONCEPT_MIXED],
    [['--ir', 'cf', '--iva-receptor', 'cf', '--ir-ri'], IR_TWO],
    [['--iva-receptor', 'cf', '--ir-ri'], IR_MIXED],
    [['--cuit', '20111111112', '--cuil', '20111111112'], IDENTITY],
    [['--cuit', '20111111112', '--cfinal'], IDENTITY],
    [['--cuil', '20111111112', '--dni', '30111222'], IDENTITY],
    [['--dni', '30111222', '--consumidor-final'], IDENTITY],
    [['--exportar-pdf', '--sin-pdf'], 'Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.'],
    [
      ['--condicion-venta', 'contado', '--sin-condicion-venta'],
      'Usá `--condicion-venta`/`--cv` o `--sin-condicion-venta`, pero no ambos a la vez.',
    ],
    [
      ['--misma-moneda', '--cotizacion-moneda', '10'],
      'Con `--misma-moneda` la cotización se toma de ARCA. Sacá `--cotizacion-moneda` o `--cm`.',
    ],
    [['--alicuota', 'general', '--alicuota', 'reducida'], 'Para varias alícuotas usá `--alicuota TASA:MONTO`'],
    [['--alicuota', 'general:1.5'], '`--alicuota` "general:1.5": el monto no es válido'],
    [['--alicuota', 'general:1.5', '--alicuota', 'reducida'], 'No mezcles `--alicuota TASA`'],
    // En el archivo, sin ningún flag que elija.
    [
      ['--moneda', 'USD'],
      'Con `"mismaMoneda": true` la cotización se toma de ARCA. Sacá `"cotizacionMoneda"` del JSON de `--cargar`.',
      { codigoMoneda: 'USD', cotizacionMoneda: 10, mismaMoneda: true },
    ],
  ])('%j', (args, message, json) => {
    const base = ['--monto', '1000'];
    // Los faltantes van en la config: no chocan con ningún flag.
    const config = { conceptoPorDefecto: 'servicios', ivaReceptorPorDefecto: 'consumidor-final' };

    expect(() => billingInput({ args: [...base, ...args], config, json })).toThrow(message);
  });

  it('`--emitir` con `--previsualizar` no dice nada del archivo, aunque el archivo también traiga los dos', () => {
    const written = {
      args: [...BILLING_BASE, '--emitir', '--previsualizar'],
      json: { emitir: true, previsualizar: true },
    };

    expect(() => billingInput(written)).toThrow('Usá `--emitir` o `--previsualizar`, pero no ambos a la vez.');
    // Con uno solo, el flag decide y los del archivo no se miran.
    expect(billingInput({ ...written, args: [...BILLING_BASE, '--emitir'] })).toMatchObject({
      emit: true,
      modeSource: 'flags',
    });
  });
});

describe('datos incompatibles en un lote', () => {
  const item = { montoTotal: 1 };

  // Hoy los flags se miran en cada comprobante: el error es del lote (BATCH_*), no del comando.
  it.each(CONFLICTS.filter(({ args, writes }) => args && !writes))(
    '$name es un error de cada comprobante, no del comando',
    (conflict) => {
      const plan = billingPlan({ args: writtenWith(conflict).args, json: [item, item] }, 'ncb');

      expect(plan.inputs).toEqual([]);
      expect(plan.invalidItems.map(({ code, index }) => ({ code, index }))).toEqual([
        { code: 'INPUT_VALIDATION_ERROR', index: 1 },
        { code: 'INPUT_VALIDATION_ERROR', index: 2 },
      ]);
    },
  );

  it('junta los errores en el orden del archivo: primero la forma del ítem, después los flags', () => {
    const plan = billingPlan({
      args: ['--cs', '--ir-cf', '--cuit', '20111111112', '--dni', '30111222'],
      json: [item, { ...item, noExiste: 1 }, 5, item],
    });

    expect(plan).toMatchObject({ inputIndexes: [], inputs: [], isBatch: true, modeSource: 'default', total: 4 });
    expect(plan.invalidItems.map(({ index, message }) => [index, message])).toEqual([
      [1, IDENTITY],
      [2, expect.stringContaining('"noExiste"')],
      [3, expect.stringMatching(/^En el JSON de `--cargar`:/)],
      [4, IDENTITY],
    ]);
  });

  it('los índices son los del archivo aunque falle uno del medio', () => {
    const plan = billingPlan({
      args: ['--cs', '--ir-cf'],
      json: [item, { ...item, emitir: true, previsualizar: true }, { montoTotal: 3 }],
    });

    expect(plan.inputIndexes).toEqual([1, 3]);
    expect(plan.inputs.map(({ totalAmount }) => totalAmount)).toEqual([1, 3]);
    expect(plan.invalidItems).toMatchObject([{ index: 2 }]);
  });

  it('una clave del archivo que falla suelta corta el comando; en un lote de uno, no', () => {
    const json = { ...item, noExiste: 1 };

    expect(() => billingPlan({ args: BILLING_BASE, json })).toThrow('"noExiste"');
    expect(billingPlan({ args: BILLING_BASE, json: [json] }).invalidItems).toMatchObject([{ index: 1 }]);
  });
});

describe('"hoy" al armar la entrada', () => {
  const REAL_DATE = Date;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** El reloj cruza la medianoche de Argentina entre la primera lectura y las que siguen. */
  function crossMidnight(): void {
    const instants = ['2026-11-10T23:59:59-03:00'];

    vi.stubGlobal(
      'Date',
      class extends REAL_DATE {
        constructor(...args: [] | [number | string]) {
          super(args.length > 0 ? (args[0] as number) : (instants.shift() ?? '2026-11-11T00:00:01-03:00'));
        }
      },
    );
  }

  it('en un comprobante se lee una sola vez: sus fechas son del mismo "hoy"', () => {
    crossMidnight();

    expect(
      billingInput({
        args: ['--monto', '1', '--ir-cf', '--cs', '--fecha', 'hoy', '--sd', 'hoy', '--vto', 'hoy'],
        json: { servicioHasta: 'hoy' },
      }),
    ).toMatchObject({
      billingDate: '10/11/2026',
      paymentDueDate: '10/11/2026',
      serviceEndDate: '10/11/2026',
      serviceStartDate: '10/11/2026',
    });
  });

  it('un lote que cruza la medianoche toma el mismo "hoy" en todos', () => {
    crossMidnight();

    const plan = billingPlan({
      args: ['--cs', '--ir-cf', '--fecha', 'hoy'],
      json: [{ montoTotal: 1 }, { montoTotal: 2 }, { montoTotal: 3 }],
    });

    expect(plan.inputs.map(({ billingDate }) => billingDate)).toEqual(['10/11/2026', '10/11/2026', '10/11/2026']);
  });
});
