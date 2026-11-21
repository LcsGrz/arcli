import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import { EXPORT_CREDIT_NOTE_KIND } from '../../../modules/export/export.types';
import {
  type ExportOptionalsContext,
  type ExportOptions,
  isCountryCuitMissing,
} from '../../../modules/interactive/export-optionals';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { askCountryCuit, exportOptionalsStep } from '../export-options';

import { createScript, rejecting } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

const OPTIONALS = /opcional/;

const COUNTRY_CUITS = [
  { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
  { countryName: 'ESTADOS UNIDOS - Persona Física', cuit: 55000002118 },
  { countryName: 'BRASIL - Persona Jurídica', cuit: 55000000042 },
];

const US = { code: 212, name: 'ESTADOS UNIDOS' };

type Context = Omit<ExportOptionalsContext, 'languageNames'>;

/** El grupo de opcionales de la E solo, como un asistente de un paso: BACK si se vuelve desde la seleccion. */
async function askExportOptions(initial: ExportOptions, context: Context) {
  const state = await runWizard(
    [
      exportOptionalsStep<{ readonly options: ExportOptions }>({
        context: () => context,
        name: 'opcionales',
        read: (current) => current.options,
        write: (options) => ({ options }),
      }),
    ],
    { options: initial },
  );

  return state ? state.options : BACK;
}

function context(overrides: Partial<Context> = {}): Context {
  return {
    currencyCode: 'DOL',
    defaultLanguage: 'Español',
    exportType: 2,
    languages: async () => [
      { id: 1, name: 'Español' },
      { id: 2, name: 'Inglés' },
    ],
    ...overrides,
    // Las reglas de la E con hoy y la entrada armada solo con lo que escribe cada pregunta, con el tipo del contexto.
    rules: overrides.rules ?? {
      context: { today: formatDateAsArcaDate(new Date()) },
      draft: (patch) => ({ exportType: overrides.exportType ?? 2, ...patch }),
    },
  };
}

function printed(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  );
}

/** Las descripciones de la seleccion de opcionales la vez `call` que se pregunto. */
function optionalDescriptions(call: number): Record<string, string | undefined> {
  const choices = script.chooseManyStep.mock.calls[call]?.[1] ?? [];

  return Object.fromEntries(choices.map((choice) => [choice.name, choice.description]));
}

describe('exportOptionalsStep', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('sin marcar nada devuelve lo que habia, sin preguntar nada mas', async () => {
    script = createScript([[OPTIONALS, []]]);

    expect(await askExportOptions({ observations: 'previa' }, context())).toEqual({ observations: 'previa' });
  });

  it('"Volver" en la seleccion vuelve al paso anterior', async () => {
    script = createScript([[OPTIONALS, BACK]]);

    expect(await askExportOptions({}, context())).toBe(BACK);
  });

  it('solo ofrece CUIT del país e incoterm cuando el contexto los tiene; la cotización (NAV-9) y los ítems (NAV-10) ya no son opcionales', async () => {
    script = createScript([[OPTIONALS, []]]);
    await askExportOptions({}, context());
    expect(Object.keys(optionalDescriptions(0))).toEqual(['Fecha del comprobante', 'Idioma', 'Observaciones']);

    script = createScript([[OPTIONALS, []]]);
    await askExportOptions(
      {},
      context({
        countryCuit: { country: US, countryCuits: COUNTRY_CUITS },
        incoterm: { code: 'FOB', description: 'Free on board' },
      }),
    );
    expect(optionalDescriptions(0)).toEqual({
      'CUIT del país': 'el de la tabla de ARCA',
      'Descripción del incoterm': 'Free on board',
      'Fecha del comprobante': 'hoy',
      Idioma: 'Español',
      Observaciones: 'sin observaciones',
    });
  });

  it('idioma: arranca en el de por defecto y despues muestra el elegido por nombre', async () => {
    script = createScript([
      [OPTIONALS, ['Idioma', 'Observaciones']],
      [/Idioma/, 'Inglés'],
      [/^Observaciones \(/, 'Pago a 30 días'],
      [/comerciales/, BACK],
      [/^Observaciones \(/, BACK],
      [/Idioma/, BACK],
      [OPTIONALS, ['Idioma']],
      [/Idioma/, 'Inglés'],
    ]);

    expect(await askExportOptions({}, context())).toEqual({ language: 2 });
    expect(script.chooseStep.mock.calls[0]?.[2]).toBe(1);
    // Al volver, lo ya respondido (el idioma) se ve en la lista y arranca marcado en la pregunta.
    expect(optionalDescriptions(1).Idioma).toBe('Inglés');
    expect(script.chooseStep.mock.calls[1]?.[2]).toBe(2);
    expect(script.chooseStep.mock.calls[2]?.[2]).toBe(2);
    // REV-60: volver desde las comerciales vuelve a las observaciones, con lo escrito.
    expect(script.askTextStep.mock.calls[2]?.[1]).toMatchObject({ previousAnswer: 'Pago a 30 días' });
  });

  it('observaciones: vacias quedan sin informar; las dos se describen juntas', async () => {
    script = createScript([
      [OPTIONALS, ['Observaciones']],
      [/^Observaciones \(/, rejecting('Una', ['x'.repeat(1001), /caracteres/])],
      [/comerciales/, 'Otra'],
    ]);

    const filled = await askExportOptions({}, context());

    expect(filled).toEqual({ commercialObservations: 'Otra', observations: 'Una' });

    script = createScript([
      [OPTIONALS, ['Observaciones']],
      [/^Observaciones \(/, '  '],
      [/comerciales/, ''],
    ]);

    expect(await askExportOptions(filled as Exclude<typeof filled, typeof BACK>, context())).toEqual({
      commercialObservations: undefined,
      observations: undefined,
    });
    expect(optionalDescriptions(0).Observaciones).toBe('con observaciones y comerciales');
  });

  it('descripción del incoterm: la de ARCA queda sin informar; otra se guarda', async () => {
    const incoterm = { code: 'FOB', description: 'Free on board' };

    script = createScript([
      [OPTIONALS, ['Descripción del incoterm']],
      [/incoterm FOB/, rejecting('FOB Buenos Aires', ['x'.repeat(21), /error 1642/])],
    ]);
    expect(await askExportOptions({}, context({ incoterm }))).toEqual({ incotermDescription: 'FOB Buenos Aires' });

    script = createScript([
      [OPTIONALS, ['Descripción del incoterm']],
      [/incoterm FOB/, 'Free on board'],
    ]);
    expect(await askExportOptions({ incotermDescription: 'Otra' }, context({ incoterm }))).toEqual({
      incotermDescription: undefined,
    });
    // La respuesta arranca con la ya cargada, no con la de ARCA.
    expect(script.askTextStep.mock.calls[0]?.[1]).toMatchObject({ defaultValue: 'Otra' });
    expect(optionalDescriptions(0)['Descripción del incoterm']).toBe('Otra');
  });

  describe('fecha del comprobante', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('acepta lo mismo que `--fecha` (hasta 5 días antes o después), la guarda completa y la muestra en la lista', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      script = createScript([
        [OPTIONALS, ['Fecha del comprobante']],
        [
          /Fecha del comprobante/,
          rejecting(
            '16/11',
            ['12/11/2026', /del 13\/11\/2026 al 23\/11\/2026.*error 1500/],
            ['24/11/2026', /error 1500/],
            ['31/11/2026', /Fecha inválida/],
            ['hola', /Fecha inválida/],
          ),
        ],
      ]);

      const answered = await askExportOptions({}, context());

      expect(answered).toEqual({ voucherDate: '16/11/2026' });

      script = createScript([[OPTIONALS, []]]);
      await askExportOptions(answered as Exclude<typeof answered, typeof BACK>, context());
      expect(optionalDescriptions(0)['Fecha del comprobante']).toBe('16/11/2026');
    });

    // REV-60: volver desde la pregunta siguiente vuelve a la fecha, escrita con lo respondido.
    it('volver desde el idioma vuelve a la fecha, con la fecha escrita', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      script = createScript([
        [OPTIONALS, ['Fecha del comprobante', 'Idioma']],
        [/Fecha del comprobante/, '16/11'],
        [/Idioma/, BACK],
        [/Fecha del comprobante/, '17/11/2026'],
        [/Idioma/, 'Inglés'],
      ]);

      expect(await askExportOptions({}, context())).toEqual({ language: 2, voucherDate: '17/11/2026' });
      expect(script.askTextStep.mock.calls[1]?.[1]).toMatchObject({ previousAnswer: '16/11/2026' });
      expect(script.chooseManyStep).toHaveBeenCalledTimes(1);
    });

    it('en servicios no pasa del fin de mes; en bienes sí', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));
      script = createScript([
        [OPTIONALS, ['Fecha del comprobante']],
        [/Fecha del comprobante/, rejecting('30/11/2026', ['01/12/2026', /al 30\/11\/2026.*fin de mes.*error 1500/])],
      ]);

      expect(await askExportOptions({}, context({ exportType: 2 }))).toEqual({ voucherDate: '30/11/2026' });

      script = createScript([
        [OPTIONALS, ['Fecha del comprobante']],
        [/Fecha del comprobante/, '03/12/2026'],
      ]);

      expect(await askExportOptions({}, context({ exportType: 1 }))).toEqual({ voucherDate: '03/12/2026' });
    });

    it('suma las reglas del flujo (en las notas, el asociado) a la ventana de ARCA', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
      script = createScript([
        [OPTIONALS, ['Fecha del comprobante']],
        [
          /Fecha del comprobante/,
          rejecting('18/11/2026', [
            '16/11/2026',
            /^La fecha de la nota de crédito de exportación E \(16\/11\/2026\) no puede ser anterior a la de la factura de exportación E 00003-00000001 \(17\/11\/2026\)\.$/,
          ]),
        ],
      ]);

      expect(
        await askExportOptions(
          {},
          context({
            rules: {
              context: {
                associated: { date: '20261117', label: 'la factura de exportación E 00003-00000001' },
                today: '20261118',
              },
              draft: (patch) => ({ voucherKind: EXPORT_CREDIT_NOTE_KIND, ...patch }),
            },
          }),
        ),
      ).toEqual({
        voucherDate: '18/11/2026',
      });
    });

    it('volver desde la fecha vuelve a la selección', async () => {
      script = createScript([
        [OPTIONALS, ['Fecha del comprobante']],
        [/Fecha del comprobante/, BACK],
        [OPTIONALS, []],
      ]);

      expect(await askExportOptions({}, context())).toEqual({});
    });
  });

  describe('CUIT del país', () => {
    const countryCuit = { country: US, countryCuits: COUNTRY_CUITS };

    it('se escribe el número, y uno de otro país o que no existe se rechaza', async () => {
      script = createScript([
        [OPTIONALS, ['CUIT del país']],
        [
          /CUIT del país del cliente.*ESTADOS UNIDOS/,
          rejecting(
            '55000002118',
            ['', /Escribí el CUIT/],
            ['55000000042', /corresponde a "BRASIL"/],
            ['123', /no existe en la tabla/],
            ['japon', /no tiene "japon"/],
          ),
        ],
      ]);

      expect(await askExportOptions({}, context({ countryCuit }))).toEqual({ clientCountryCuit: 55000002118 });
    });

    it('se busca por nombre (sin tildes ni mayúsculas) y se elige de la lista', async () => {
      script = createScript([
        [OPTIONALS, ['CUIT del país']],
        [/CUIT del país del cliente/, 'estados unidos'],
        [/CUIT del país:/, 'Física'],
      ]);

      expect(await askExportOptions({}, context({ countryCuit }))).toEqual({ clientCountryCuit: 55000002118 });
      expect(script.chooseStep.mock.calls[0]?.[1]).toEqual([
        {
          description: '55000002126',
          keywords: '55000002126',
          name: 'ESTADOS UNIDOS - Persona Jurídica',
          value: 55000002126,
        },
        {
          description: '55000002118',
          keywords: '55000002118',
          name: 'ESTADOS UNIDOS - Persona Física',
          value: 55000002118,
        },
      ]);
    });

    it('elegir de la lista uno de otro país avisa y vuelve a preguntar; volver desde la lista tambien', async () => {
      script = createScript([
        [OPTIONALS, ['CUIT del país']],
        [/CUIT del país del cliente/, 'bras'],
        [/CUIT del país:/, 'BRASIL'],
        [/CUIT del país del cliente/, 'unidos'],
        [/CUIT del país:/, BACK],
        [/CUIT del país del cliente/, '55000002126'],
      ]);

      expect(await askExportOptions({}, context({ countryCuit }))).toEqual({ clientCountryCuit: 55000002126 });
      expect(printed()).toContain('corresponde a "BRASIL"');
    });

    it('volver desde el texto vuelve a la seleccion', async () => {
      script = createScript([
        [OPTIONALS, ['CUIT del país']],
        [/CUIT del país del cliente/, BACK],
        [OPTIONALS, []],
      ]);

      expect(await askExportOptions({}, context({ countryCuit }))).toEqual({});
    });

    // REV-74, #10: volver al CUIT desde la pregunta siguiente lo muestra escrito.
    it('volver desde las observaciones vuelve al CUIT, escrito', async () => {
      script = createScript([
        [OPTIONALS, ['CUIT del país', 'Observaciones']],
        [/CUIT del país del cliente/, '55000002118'],
        [/^Observaciones \(/, BACK],
        [/CUIT del país del cliente/, '55000002118'],
        [/^Observaciones \(/, ''],
        [/comerciales/, ''],
      ]);

      expect(await askExportOptions({}, context({ countryCuit }))).toMatchObject({ clientCountryCuit: 55000002118 });
      expect(script.askTextStep.mock.calls[2]?.[1]).toMatchObject({ previousAnswer: '55000002118' });
    });
  });
});

describe('askCountryCuit opcional', () => {
  const countryCuit = { country: { code: 999, name: 'ATLANTIDA' }, countryCuits: COUNTRY_CUITS };

  it('Enter lo deja sin CUIT, para ir con el ID impositivo', async () => {
    script = createScript([[/CUIT/, '']]);

    expect(await askCountryCuit(countryCuit, 'CUIT:', { optional: true })).toBeUndefined();
    expect(isCountryCuitMissing(countryCuit)).toBe(true);
    expect(isCountryCuitMissing({ ...countryCuit, country: US })).toBe(false);
  });
});
