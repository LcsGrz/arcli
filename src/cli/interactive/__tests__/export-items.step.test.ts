import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportItemInput, ExportUnit } from '../../../modules/export/export.types';
import { fieldLens } from '../../../modules/interactive/steps/lens';
import { BACK, runWizard, type WizardStep } from '../../../modules/interactive/wizard';
import { exportItemsStep } from '../steps/export-items';

import { createScript, editing, type ScriptedAnswer } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
}));

interface State {
  readonly currency?: string;
  readonly items?: readonly ExportItemInput[];
}

const UNITS: ExportUnit[] = [
  { id: 0, name: 'sin unidad' },
  { id: 5, name: 'litros' },
  { id: 7, name: 'unidades' },
  { id: 97, name: 'seña' },
  { id: 99, name: 'bonificación' },
];

const JUICE = { description: 'Jugo', quantity: 100, unit: 5, unitPrice: 2.5 };
const FREIGHT = { description: 'Flete', quantity: 1, unit: 7, unitPrice: 300 };

const ITEMS = /^Ítems de .*: marcá qué modificar/;
const TOTAL = /^Importe total/;

interface Options {
  readonly initial?: readonly ExportItemInput[];
  readonly units?: readonly ExportUnit[];
  readonly validateTotal?: (total: number) => string | true;
  /** Cuantas veces el paso siguiente vuelve antes de terminar (Esc en la pregunta siguiente). */
  readonly backsAfter?: number;
  /** Las monedas que responde el paso anterior, una por vez que se pregunta. */
  readonly currencies?: string[];
}

/** El paso de los ítems entre uno anterior (la moneda, de la que depende) y uno siguiente que puede volver. */
async function run(steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>, options: Options = {}) {
  script = createScript(steps);

  const currencies = [...(options.currencies ?? ['DOL'])];
  let backs = options.backsAfter ?? 0;
  const units = vi.fn(async () => options.units ?? UNITS);
  const wizard: Array<WizardStep<State>> = [
    // Como "Volver" a la moneda: con otra, los ítems se conservan y se avisa (como en la factura E).
    { name: 'moneda', run: async () => ({ currency: currencies.length > 1 ? currencies.shift() : currencies[0] }) },
    exportItemsStep<State>({
      currency: (state) => state.currency ?? 'DOL',
      initial: options.initial ? () => options.initial ?? [] : undefined,
      items: fieldLens('items'),
      units,
      validateTotal: options.validateTotal ? () => options.validateTotal! : undefined,
      voucher: 'la factura de exportación E',
    }),
    {
      name: 'despues',
      run: async () => {
        if (backs > 0) {
          backs -= 1;

          return BACK;
        }

        return {};
      },
    },
  ];
  const state = await runWizard(wizard, {});

  return { items: state ? state.items : BACK, units };
}

/** Las opciones que recibio una pregunta de texto (la vez `call` que se pregunto algo que coincide con `question`). */
function textOptions(question: RegExp, call = 0) {
  return script.askTextStep.mock.calls.filter(([message]) => question.test(message))[call]?.[1];
}

const FIRST_DEFAULTS = [
  [/^Descripción del ítem 1:$/, ''],
  [/^Cantidad/, ''],
  [/^Unidad/, 'unidades'],
] as const;

describe('exportItemsStep (NAV-10)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('1: el primer ítem se pregunta siempre, con "Según detalle", 1 y unidades: con solo el precio queda el renglón por el total', async () => {
    const { items } = await run([
      ...FIRST_DEFAULTS,
      [/^(?:Importe|Precio unitario) en USD:$/, '1.500'],
      [/^Descripción del ítem 2 \(Enter para terminar\):$/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 1500 }]);
    expect(textOptions(/ítem 1/)).toMatchObject({ defaultValue: 'Según detalle' });
    expect(textOptions(/Cantidad/)).toMatchObject({ defaultValue: '1' });
    // El precio no tiene valor por defecto.
    expect(textOptions(/^(?:Importe|Precio)/)?.defaultValue).toBeUndefined();
  });

  it('con cantidad 1 la pregunta es «Importe» y con otra, «Precio unitario»; también al modificar en el editor', async () => {
    await run([
      ...FIRST_DEFAULTS,
      [/^Importe en USD:$/, '1.500'],
      [/ítem 2/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^Precio unitario en USD:$/, '2,50'],
      [/ítem 3/, ''],
      [TOTAL, 'Modificar los ítems'],
      [ITEMS, editing({ edit: ['Según detalle', 'Jugo'] })],
      [/ítem 1/, ''],
      [/^Cantidad/, '2'],
      [/^Unidad/, ''],
      [/^Precio unitario en USD:$/, '750'],
      [/ítem 2/, ''],
      [/^Cantidad/, '1'],
      [/^Unidad/, ''],
      [/^Importe en USD:$/, '250'],
      [TOTAL, 'Confirmar'],
    ]);

    expect(script.asked.filter((message) => /^(Importe|Precio unitario) en/.test(message))).toEqual([
      'Importe en USD:',
      'Precio unitario en USD:',
      'Precio unitario en USD:',
      'Importe en USD:',
    ]);
  });

  it('1: la unidad sale de una lista con filtro, sin 0, 97 ni 99, que busca por nombre o por código y arranca en unidades', async () => {
    await run([...FIRST_DEFAULTS, [/^(?:Importe|Precio)/, '10'], [/ítem 2/, ''], [TOTAL, 'Confirmar']]);

    const [message, rows, options] = script.chooseFromFilterList.mock.calls[0] ?? [];

    expect(message).toBe('Unidad:');
    expect(rows).toEqual([
      { keywords: '5', label: 'litros', value: 5 },
      { keywords: '7', label: 'unidades', value: 7 },
    ]);
    expect(options).toMatchObject({ defaultValue: 7 });
  });

  it('1: del segundo en adelante, sin valores por defecto, y Enter en la descripción termina', async () => {
    const { items } = await run([
      [/^Descripción del ítem 1:$/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, '2,50'],
      [/^Descripción del ítem 2 \(Enter para terminar\):$/, 'Flete'],
      [/^Cantidad/, rejectingEmpty('1')],
      [/^Unidad/, 'unidades'],
      [/^(?:Importe|Precio)/, '300'],
      [/^Descripción del ítem 3 \(Enter para terminar\):$/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([JUICE, FREIGHT]);
    expect(textOptions(/ítem 2/)?.defaultValue).toBeUndefined();
    expect(textOptions(/Cantidad/, 1)?.defaultValue).toBeUndefined();
  });

  it('1: cantidad y precio como `--item` (hasta seis decimales, mayores a 0), y la descripción sin "|"', async () => {
    const { items } = await run([
      [/ítem 1/, { answer: 'Jugo', rejected: [['Jugo | naranja', /"\|"/]] }],
      [/^Cantidad/, { answer: '0,125', rejected: [['0', /mayor a 0/]] }],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, { answer: '1.000,123456', rejected: [['1,1234567', /formato/]] }],
      [/ítem 2/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Jugo', quantity: 0.125, unit: 5, unitPrice: 1000.123456 }]);
  });

  it('1: sin unidades elegibles en ARCA, va la de por defecto sin preguntar; Esc en el precio vuelve a la cantidad', async () => {
    const { items } = await run(
      [
        [/ítem 1/, 'Servicio'],
        [/^Cantidad/, '2'],
        [/^(?:Importe|Precio)/, BACK],
        [/^Cantidad/, '3'],
        [/^(?:Importe|Precio)/, '500'],
        [/ítem 2/, ''],
        [TOTAL, 'Confirmar'],
      ],
      { units: [{ id: 99, name: 'bonificación' }] },
    );

    expect(items).toEqual([{ description: 'Servicio', quantity: 3, unit: 7, unitPrice: 500 }]);
    expect(script.chooseFromFilterList).not.toHaveBeenCalled();
  });

  it('1: Esc vuelve a la pregunta anterior del ítem con lo escrito, y desde la descripción del primero, al paso anterior', async () => {
    const { items } = await run([
      [/ítem 1/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, BACK],
      [/^Cantidad/, BACK],
      [/ítem 1/, BACK],
      // El paso anterior (la moneda) se vuelve a responder igual: el ítem arranca como la primera vez.
      [/ítem 1/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, '2,50'],
      [/ítem 2/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([JUICE]);
    expect(textOptions(/^Cantidad/, 1)?.previousAnswer).toBe('100');
    expect(textOptions(/ítem 1/, 1)?.previousAnswer).toBe('Jugo');
  });

  it('2 y 3: no hay pregunta del monto; el total es la suma, y se confirma o se modifican los ítems', async () => {
    await run([
      [/ítem 1/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, '2,50'],
      [/ítem 2/, 'Flete'],
      [/^Cantidad/, '1'],
      [/^Unidad/, 'unidades'],
      [/^(?:Importe|Precio)/, '300'],
      [/ítem 3/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(script.asked.some((message) => /Monto/.test(message))).toBe(false);

    const [message, choices, selected] = script.chooseStep.mock.calls[0] ?? [];

    expect(message).toBe('Importe total de la factura de exportación E: 550 USD (2 ítems)');
    expect(choices?.map((choice) => ('name' in choice ? choice.name : ''))).toEqual([
      'Confirmar',
      'Modificar los ítems',
    ]);
    expect(selected).toBe('confirmar');
  });

  it('4: el editor modifica (arrancando con sus valores), borra y agrega en un paso, y vuelve al total', async () => {
    const { items } = await run([
      [/ítem 1/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, '2,50'],
      [/ítem 2/, 'Flete'],
      [/^Cantidad/, '1'],
      [/^Unidad/, 'unidades'],
      [/^(?:Importe|Precio)/, '300'],
      [/ítem 3/, ''],
      [TOTAL, 'Modificar los ítems'],
      [ITEMS, editing({ add: true, edit: ['Jugo'], remove: ['Flete'] })],
      [/^Descripción del ítem 1:$/, 'Jugo concentrado'],
      [/^Cantidad/, '80'],
      [/^Unidad/, 'litros'],
      [/^(?:Importe|Precio)/, '3'],
      [/^Descripción del ítem 2 \(Enter para terminar\):$/, 'Seguro'],
      [/^Cantidad/, '1'],
      [/^Unidad/, 'unidades'],
      [/^(?:Importe|Precio)/, '60'],
      [/ítem 3/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([
      { description: 'Jugo concentrado', quantity: 80, unit: 5, unitPrice: 3 },
      { description: 'Seguro', quantity: 1, unit: 7, unitPrice: 60 },
    ]);

    // El modificado arranca con lo que tenía.
    expect(textOptions(/^Descripción del ítem 1:$/, 1)?.previousAnswer).toBe('Jugo');
    expect(textOptions(/^Cantidad/, 2)?.previousAnswer).toBe('100');
    expect(textOptions(/^(?:Importe|Precio)/, 2)?.previousAnswer).toBe('2,50');
    expect(script.chooseFromFilterList.mock.calls[2]?.[2]).toMatchObject({ defaultValue: 5 });

    // El editor muestra cada ítem con su unidad, precio y total, y no deja borrar el último.
    const [, rows, options] = script.editRowsStep.mock.calls[0] ?? [];

    expect(rows).toEqual([
      { detail: '100 litros x 2,50 USD', title: 'Jugo', total: '250 USD' },
      { detail: '1 unidades x 300 USD', title: 'Flete', total: '300 USD' },
    ]);
    expect(options).toMatchObject({ addLabel: '+ Agregar ítem', minRows: 1 });
    expect(options?.minRowsNotice).toMatch(/al menos un ítem/);
    expect(script.chooseStep.mock.calls[1]?.[0]).toBe(
      'Importe total de la factura de exportación E: 300 USD (2 ítems)',
    );
  });

  it('4: el editor no deja borrar el último ítem', async () => {
    await expect(
      run([
        ...FIRST_DEFAULTS,
        [/^(?:Importe|Precio)/, '10'],
        [/ítem 2/, ''],
        [TOTAL, 'Modificar los ítems'],
        [ITEMS, editing({ remove: ['Según detalle'] })],
      ]),
    ).rejects.toThrow(/no deja borrar/);
  });

  it('4: Esc en el editor vuelve al total si se llegó desde ahí; Esc en un ítem que se modifica deja todo como estaba', async () => {
    const { items } = await run([
      ...FIRST_DEFAULTS,
      [/^(?:Importe|Precio)/, '10'],
      [/ítem 2/, ''],
      [TOTAL, 'Modificar los ítems'],
      [ITEMS, BACK],
      [TOTAL, 'Modificar los ítems'],
      [ITEMS, editing({ edit: ['Según detalle'], remove: [] })],
      [/ítem 1/, 'Otro'],
      [/^Cantidad/, BACK],
      [/ítem 1/, BACK],
      [ITEMS, editing({})],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 10 }]);
  });

  it('5: al volver con ítems cargados se muestra el editor (no "¿Qué hacemos con los ítems ya cargados?"), y Esc ahí vuelve al paso anterior', async () => {
    const { items } = await run(
      [
        ...FIRST_DEFAULTS,
        [/^(?:Importe|Precio)/, '10'],
        [/ítem 2/, ''],
        [TOTAL, 'Confirmar'],
        // El paso siguiente vuelve: arranca en el editor con lo cargado.
        [ITEMS, BACK],
        // Desde el paso anterior (la misma moneda), de nuevo al editor.
        [ITEMS, editing({})],
        [TOTAL, 'Confirmar'],
      ],
      { backsAfter: 1 },
    );

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 10 }]);
    expect(script.asked.some((message) => /ya cargados/.test(message))).toBe(false);
  });

  it('7: Volver lleva a la pregunta anterior: de la descripción del ítem 2 al importe del 1, que arranca escrito', async () => {
    const { items } = await run([
      ...FIRST_DEFAULTS,
      [/^Importe en USD/, '10'],
      [/ítem 2/, BACK],
      [/^Importe en USD/, BACK],
      [/^Unidad/, ''],
      [/^Importe en USD/, '12'],
      [/ítem 2/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 12 }]);
    expect(textOptions(/^Importe/, 1)?.previousAnswer).toBe('10');
    expect(script.chooseFromFilterList.mock.calls[1]?.[2]).toMatchObject({ defaultValue: 7 });
  });

  it('7: desde el total de la primera carga, Volver va al último ítem; nada se pierde', async () => {
    const { items } = await run([
      [/ítem 1/, 'Jugo'],
      [/^Cantidad/, '100'],
      [/^Unidad/, 'litros'],
      [/^Precio unitario/, '2,50'],
      [/ítem 2/, 'Flete'],
      [/^Cantidad/, '1'],
      [/^Unidad/, 'unidades'],
      [/^Importe/, '300'],
      [/ítem 3/, ''],
      [TOTAL, BACK],
      // El importe del ítem 2, con lo que tenía; desde su descripción, al ítem 1.
      [/^Importe en USD/, BACK],
      [/^Unidad/, BACK],
      [/^Cantidad/, BACK],
      [/^Descripción del ítem 2:$/, BACK],
      [/^Precio unitario/, '3'],
      [/^Descripción del ítem 2:$/, ''],
      [/^Cantidad/, ''],
      [/^Unidad/, ''],
      [/^Importe/, ''],
      [/ítem 3/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ ...JUICE, unitPrice: 3 }, FREIGHT]);
  });

  it('7: desde el primer dato del ítem 1 sale al paso anterior, y al volver arranca en el editor con lo cargado', async () => {
    const { items } = await run([
      ...FIRST_DEFAULTS,
      [/^Importe/, '10'],
      [/ítem 2/, BACK],
      [/^Importe/, BACK],
      [/^Unidad/, BACK],
      [/^Cantidad/, BACK],
      [/ítem 1/, BACK],
      [ITEMS, editing({})],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 10 }]);
  });

  it('1: Enter vacío en "Descripción del ítem N (Enter para terminar)" termina, aunque antes se hubiera escrito algo', async () => {
    const { items } = await run([
      ...FIRST_DEFAULTS,
      [/^Importe/, '10'],
      [/ítem 2/, 'Flete'],
      [/^Cantidad/, BACK],
      [/ítem 2/, ''],
      [TOTAL, 'Confirmar'],
    ]);

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 10 }]);
    // Arranca vacía: con lo escrito, Enter no podría terminar.
    expect(textOptions(/ítem 2/, 1)?.previousAnswer).toBeUndefined();
  });

  it('9: con otra moneda los ítems se conservan, con un aviso para revisar los importes', async () => {
    const write = vi.mocked(process.stdout.write);
    const { items } = await run(
      [
        ...FIRST_DEFAULTS,
        [/^Importe en USD/, '10'],
        [/ítem 2/, ''],
        [TOTAL, 'Confirmar'],
        // Del paso siguiente al editor, y de ahí a la moneda, que ahora es pesos.
        [ITEMS, BACK],
        [ITEMS, editing({ edit: ['Según detalle'] })],
        [/ítem 1/, ''],
        [/^Cantidad/, ''],
        [/^Unidad/, ''],
        [/^Importe:$/, '15.000'],
        [/^Importe total de la factura de exportación E: \$ 15\.000/, 'Confirmar'],
      ],
      { backsAfter: 1, currencies: ['DOL', 'PES'] },
    );
    const printed = write.mock.calls.map(([chunk]) => String(chunk)).join('');

    expect(items).toEqual([{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 15000 }]);
    expect(printed).toContain('Cambiaste la moneda a pesos: revisá los importes de los ítems.');
  });

  it('9: con la misma moneda (por ejemplo, otro "¿Te pagan en dólares?") no avisa nada', async () => {
    const write = vi.mocked(process.stdout.write);

    await run(
      [
        ...FIRST_DEFAULTS,
        [/^Importe/, '10'],
        [/ítem 2/, ''],
        [TOTAL, 'Confirmar'],
        [ITEMS, BACK],
        [ITEMS, editing({})],
        [TOTAL, 'Confirmar'],
      ],
      { backsAfter: 1 },
    );

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('Cambiaste la moneda');
  });

  it('3: modificar un ítem copiado sin tabla de unidades mantiene la que tenía', async () => {
    const { items } = await run(
      [
        [ITEMS, editing({ edit: ['Jugo'] })],
        [/ítem 1/, ''],
        [/^Cantidad/, ''],
        [/^Precio unitario/, '3'],
        [TOTAL, 'Confirmar'],
      ],
      { initial: [JUICE], units: [] },
    );

    expect(items).toEqual([{ ...JUICE, unitPrice: 3 }]);
  });

  it('7: con ítems copiados (Repetir, notas) arranca en el editor; Enter sin marcas va al total', async () => {
    const { items } = await run(
      [
        [ITEMS, editing({})],
        [TOTAL, 'Confirmar'],
      ],
      { initial: [JUICE, FREIGHT] },
    );

    expect(items).toEqual([JUICE, FREIGHT]);
    expect(script.asked.some((message) => /Descripción del ítem 1/.test(message))).toBe(false);
  });

  it('7: modificar un ítem copiado conserva su código', async () => {
    const { items } = await run(
      [
        [ITEMS, editing({ edit: ['Jugo'] })],
        [/ítem 1/, ''],
        [/^Cantidad/, ''],
        [/^Unidad/, 'litros'],
        [/^(?:Importe|Precio)/, '3'],
        [TOTAL, 'Confirmar'],
      ],
      { initial: [{ ...JUICE, code: 'J-1' }] },
    );

    expect(items).toEqual([{ code: 'J-1', description: 'Jugo', quantity: 100, unit: 5, unitPrice: 3 }]);
  });

  it('un total que no se puede confirmar (el tope de una NC) deja solo modificar, con el motivo', async () => {
    const { items } = await run(
      [
        [ITEMS, editing({})],
        [TOTAL, 'Modificar los ítems'],
        [ITEMS, editing({ edit: ['Flete'] })],
        [/ítem 1/, ''],
        [/^Cantidad/, ''],
        [/^Unidad/, 'unidades'],
        [/^(?:Importe|Precio)/, '200'],
        [TOTAL, 'Confirmar'],
      ],
      { initial: [{ ...FREIGHT, unitPrice: 600 }], validateTotal: (total) => (total <= 500 ? true : 'Tope 500.') },
    );

    expect(items).toEqual([{ ...FREIGHT, unitPrice: 200 }]);

    const [first, second] = script.chooseStep.mock.calls;

    expect(first?.[1]?.[0]).toMatchObject({ disabled: 'Tope 500.', name: 'Confirmar' });
    expect(first?.[2]).toBe('modificar');
    expect(second?.[1]?.[0]).toMatchObject({ disabled: false, name: 'Confirmar' });
    expect(second?.[2]).toBe('confirmar');
  });

  it('la tabla de unidades se consulta una vez por flujo', async () => {
    const { units } = await run(
      [
        ...FIRST_DEFAULTS,
        [/^(?:Importe|Precio)/, '10'],
        [/ítem 2/, ''],
        [TOTAL, 'Confirmar'],
        [ITEMS, editing({})],
        [TOTAL, 'Confirmar'],
      ],
      { backsAfter: 1 },
    );

    expect(units).toHaveBeenCalledTimes(1);
  });
});

/** La cantidad del segundo ítem no tiene valor por defecto: vacía, se rechaza. */
function rejectingEmpty(answer: string) {
  return { answer, rejected: [['', /formato/]] as const };
}
