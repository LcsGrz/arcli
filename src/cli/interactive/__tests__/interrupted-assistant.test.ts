import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import { answerAssociated, CLIENT_CUIT, CLOCK_CONFIG, sdk } from '../../__tests__/clock.fixture';
import { REPEATED_SIGNAL_MS, ResentSignalError } from '../../interruption';

import {
  ctrlCDuring,
  DENIED,
  EXIT,
  MENU,
  plain,
  runMenu,
  signalListeners,
  sinceMenu,
  useAssistantInterruptionFixture,
  WAITING_NOTICE,
  written,
} from './assistant-interruption.fixture';
import {
  EMIT,
  EMIT_WITH_PDF,
  FA_STEPS,
  FC_STEPS,
  FE_STEPS,
  NO_OPTIONALS,
  NOTE_E_STEPS,
  over,
  TO_INVOICE,
} from './one-path.fixture';
import { ctrlC, type Steps } from './one-path.prompts';
import { KEEP_EXPORT_ITEMS } from './script';

/**
 * ARQ-11 PR 5: Ctrl+C en el asistente mientras se emite, en cada familia, desde el menu. Lo que ve la persona (el aviso
 * de espera de los comandos, el CAE, "Cancelado. No se emitió nada.") y lo que recibe ARCA (nada enviado si se corto
 * antes). Las esperas de las consultas, en `assistant-waits.test.ts`.
 */
vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../prompts', async (original) =>
  (await import('./one-path.prompts')).scriptedPrompts(await original<typeof import('../prompts')>()),
);
vi.mock('ora', async () => (await import('./fake-ora')).fakeOra());
vi.mock('../../../services/arca/wsfe-status', async () => ({
  fetchWsfeServerStatus: vi.fn(async () => ({ app: 'OK', auth: 'OK', db: 'OK' })),
}));
vi.mock('../../../services/arca/wsfex-status', async () => ({
  fetchWsfexServerStatus: vi.fn(async () => ({ app: 'OK', auth: 'OK', db: 'OK' })),
}));

const profile = useAssistantInterruptionFixture();

const CANCELLED = 'Cancelado. No se emitió nada.';
const CAE = /76463926585(341|399)/;

interface Family {
  /** Lo que se pregunta despues de emitir, como siempre. */
  readonly after?: Steps;
  /** La llamada que emite. */
  readonly emit: () => typeof sdk.wsfe.createVoucher;
  /** La que pide el numero, antes de enviar. */
  readonly lastNumber: () => typeof sdk.wsfe.getLastVoucher;
  readonly name: string;
  /** En cual llamada a `lastNumber` se pide el numero del que se emite: antes la usa el selector del asociado o de "Repetir". */
  readonly numberCall?: number;
  /** El numero se pide en la vista previa, antes de "¿Emitimos?" (la E); en A, B y C, al emitir. */
  readonly numberInPreview?: boolean;
  readonly prepare?: () => void;
  /** Desde el menu hasta "¿Emitimos?", sin incluirlo. */
  readonly steps: Steps;
  /** Con que se verifica si no se sabe. */
  readonly verify: string;
}

const CBU = '0110599520000012345678';
const wsfe = { emit: () => sdk.wsfe.createVoucher, lastNumber: () => sdk.wsfe.getLastVoucher };
const wsfex = { emit: () => sdk.wsfex.authorize, lastNumber: () => sdk.wsfex.getLastCmp, numberInPreview: true };
const FOR_RI = { DocNro: CLIENT_CUIT, DocTipo: 80, ImpIVA: 21_000, ImpNeto: 100_000, ImpTotal: 121_000 };

const FAMILIES: readonly Family[] = [
  {
    ...wsfe,
    name: 'Factura C',
    steps: [[MENU, 'Emitir factura'], ...FC_STEPS],
    verify: 'arcli ultimos fc --pv 3 --testing',
  },
  {
    ...wsfe,
    name: 'Factura A',
    steps: [[MENU, 'Emitir factura'], ...FA_STEPS],
    verify: 'arcli ultimos fa --pv 3 --testing',
  },
  {
    ...wsfe,
    after: [[/Guardamos el CBU/, 'No']],
    name: 'FCE A',
    steps: [
      [MENU, 'Emitir factura'],
      [/comprobante/, 'Factura de crédito electrónica A'],
      ...FA_STEPS.slice(1, 5),
      [/Monto total/, '5000000'],
      [/^CBU/, CBU],
      [/Alias del CBU/, ''],
      NO_OPTIONALS,
    ],
    verify: 'arcli ultimos fcea --pv 3 --testing',
  },
  {
    ...wsfe,
    name: 'Recibo C',
    steps: [
      [MENU, 'Emitir recibo'],
      [/Qué recibo/, 'Recibo C'],
      [/A quién le hacés el recibo/, 'Consumidor final'],
      [/Qué estás cobrando/, 'Servicios'],
      [/Monto total/, '1000'],
      NO_OPTIONALS,
    ],
    verify: 'arcli ultimos rc --pv 3 --testing',
  },
  {
    ...wsfe,
    name: 'Nota de crédito C',
    numberCall: 2,
    steps: [
      [MENU, 'Emitir nota de crédito'],
      ...over('Factura C', TO_INVOICE),
      [/Total o parcial/, 'Anular el total'],
      NO_OPTIONALS,
    ],
    verify: 'arcli ultimos ncc --pv 3 --testing',
  },
  {
    ...wsfe,
    name: 'Nota de débito A',
    numberCall: 2,
    prepare: () => answerAssociated(FOR_RI),
    steps: [
      [MENU, 'Emitir nota de débito'],
      ...over('Factura A', TO_INVOICE),
      [/Monto de la nota de débito/, '1210'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      NO_OPTIONALS,
    ],
    verify: 'arcli ultimos nda --pv 3 --testing',
  },
  {
    ...wsfe,
    name: 'Repetir una factura C',
    numberCall: 2,
    steps: [
      [MENU, 'Repetir un comprobante anterior'],
      [/Qué comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000041'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      NO_OPTIONALS,
    ],
    verify: 'arcli ultimos fc --pv 3 --testing',
  },
  {
    ...wsfex,
    name: 'Factura E',
    steps: [[MENU, 'Emitir factura'], ...FE_STEPS],
    verify: 'arcli consultar fe 8 --pv 3 --testing',
  },
  {
    ...wsfex,
    name: 'Nota de crédito E',
    steps: [[MENU, 'Emitir nota de crédito'], ...NOTE_E_STEPS],
    verify: 'arcli consultar nce 8 --pv 3 --testing',
  },
  {
    ...wsfex,
    name: 'Nota de débito E',
    steps: [[MENU, 'Emitir nota de débito'], ...NOTE_E_STEPS],
    verify: 'arcli consultar nde 8 --pv 3 --testing',
  },
  {
    ...wsfex,
    name: 'Repetir una factura E',
    numberCall: 2,
    steps: [
      [MENU, 'Repetir un comprobante anterior'],
      [/Qué comprobante querés repetir/, 'Factura de exportación E'],
      [/Cuál repetimos/, '00003-00000001'],
      ...KEEP_EXPORT_ITEMS,
      [/Fecha de pago/, ''],
      NO_OPTIONALS,
    ],
    verify: 'arcli consultar fe 8 --pv 3 --testing',
  },
];

/** El guion entero: hasta "¿Emitimos?", lo que sigue como siempre y "Salir". */
const script = (family: Family, emit: Steps[number] = EMIT): Steps => [
  ...family.steps,
  emit,
  ...(family.after ?? []),
  EXIT,
];

describe.each(FAMILIES)('$name', (family) => {
  it('sin señales: el guion entero, con su CAE', async () => {
    const run = await runMenu(script(family), { prepare: family.prepare });

    expect(run.error).toBeUndefined();
    expect(run.asked).toHaveLength(script(family).length);
    expect(plain(run.output)).toMatch(CAE);
    expect(family.lastNumber()).toHaveBeenCalledTimes(family.numberCall ?? 1);
  });

  it('Ctrl+C con el comprobante enviado: avisa que espera, muestra el CAE y sigue como siempre hasta el menú', async () => {
    const normal = await runMenu(script(family), { prepare: family.prepare });
    const listeners = signalListeners();
    const sent = ctrlCDuring(family.emit(), { cancellable: false });
    const run = await runMenu(script(family), { pending: sent, prepare: family.prepare });

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(plain(sent.whileWaiting())).toContain(WAITING_NOTICE);
    expect(sent.spinningAfterSignals()).toEqual([]);
    expect(run.error).toBeUndefined();
    expect(family.emit()).toHaveBeenCalledOnce();
    expect(plain(run.output)).toMatch(CAE);
    expect(run.emitted).toHaveLength(1);
    expect(plain(run.output)).not.toMatch(DENIED);
    // Lo de siempre despues de emitir ("¿Guardamos…?", el menu), sin nada de mas.
    expect(run.asked).toEqual(normal.asked);
    expect(process.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
  });

  it('dos Ctrl+C con el comprobante enviado: no se sabe, con qué verificarlo, y recién después corta', async () => {
    let atKill: { readonly answered: boolean; readonly written: string } | undefined;
    const sent = ctrlCDuring(family.emit(), { cancellable: false, times: 2 });

    vi.mocked(process.kill).mockImplementation(() => {
      atKill ??= { answered: sent.answered(), written: written() };

      return true;
    });

    // Cortado el proceso, ya no se pregunta nada.
    const run = await runMenu(script(family), {
      onAsk: () => {
        if (atKill !== undefined) {
          throw ctrlC();
        }
      },
      pending: sent,
      prepare: family.prepare,
    });
    const beforeCut = plain(atKill?.written ?? run.output);

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(beforeCut).toContain('Puede haberse emitido igual');
    expect(beforeCut).toContain(family.verify);
    expect(beforeCut).not.toMatch(DENIED);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
    expect(atKill?.answered, 'esperó a ARCA').toBe(false);
    // Lo que ARCA conteste despues no se muestra: ni el CAE ni que no se emitio.
    expect(plain(run.output + run.late)).not.toMatch(CAE);
    expect(plain(run.output + run.late)).not.toMatch(DENIED);
  });

  it('Ctrl+C al pedir el número, antes de enviar: no se envía nada y vuelve al menú', async () => {
    const listeners = signalListeners();
    const number = ctrlCDuring(family.lastNumber(), { call: family.numberCall });
    const steps: Steps = [...family.steps, ...(family.numberInPreview ? [] : [EMIT]), EXIT];
    const run = await runMenu(steps, { pending: number, prepare: family.prepare });

    expect(number.reached(), 'nunca pidió el número').toBe(true);
    expect(run.menus[1]?.answered, 'esperó a ARCA antes de volver al menú').toBe(false);
    expect(plain(sinceMenu(run, 1))).toContain(CANCELLED);
    expect(run.error).toBeUndefined();
    expect(run.asked).toHaveLength(steps.length);
    expect(run.late).toBe('');
    // Ni siquiera despues de que ARCA dio el numero.
    expect(family.emit()).not.toHaveBeenCalled();
    expect(run.emitted).toEqual([]);
    expect(process.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
  });

  it('el número llega después de Ctrl+C (una consulta que no se corta): igual no se envía nada', async () => {
    const number = ctrlCDuring(family.lastNumber(), { call: family.numberCall, cancellable: false });
    const steps: Steps = [...family.steps, ...(family.numberInPreview ? [] : [EMIT]), EXIT];
    const run = await runMenu(steps, { pending: number, prepare: family.prepare });

    // El numero llego recien al terminar (`runMenu` lo libera): nadie lo esperaba.
    expect(number.reached(), 'nunca pidió el número').toBe(true);
    expect(run.menus[1]?.answered, 'esperó a ARCA antes de volver al menú').toBe(false);
    expect(number.answered()).toBe(true);
    expect(plain(sinceMenu(run, 1))).toContain(CANCELLED);
    expect(family.emit()).not.toHaveBeenCalled();
    expect(run.emitted).toEqual([]);
    expect(run.late).toBe('');
  });
});

const FC = FAMILIES[0] as Family;
const FE = FAMILIES[7] as Family;

describe.each([FC, FE])('$name: eco de npx', (family) => {
  it('dos Ctrl+C seguidos emitiendo cuentan como uno: avisa una vez, espera y muestra el CAE', async () => {
    const listeners = signalListeners();
    const sent = ctrlCDuring(family.emit(), { cancellable: false, gap: REPEATED_SIGNAL_MS / 5, times: 2 });
    const run = await runMenu(script(family), { pending: sent, prepare: family.prepare });

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(plain(sent.whileWaiting())).toContain(WAITING_NOTICE);
    expect(plain(sent.whileWaiting()).split(WAITING_NOTICE)).toHaveLength(2);
    expect(run.error).toBeUndefined();
    expect(plain(run.output)).toMatch(CAE);
    expect(plain(run.output)).not.toContain('Puede haberse emitido igual');
    expect(process.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
  });

  it('ARCA contesta dentro del eco: la pregunta que sigue conserva sus listeners (signal-exit de @inquirer)', async () => {
    const listeners = signalListeners();
    const promptListener = vi.fn();
    let signalAt = 0;
    let menuAt = 0;
    const sent = ctrlCDuring(family.emit(), {
      cancellable: false,
      onReach: () => {
        signalAt = performance.now();
      },
    });
    let atMenu: ReturnType<typeof signalListeners> | undefined;
    const running = runMenu(script(family), {
      onAsk: (message) => {
        // La pregunta que se abre despues de emitir agrega el suyo, como el prompt real.
        if (MENU.test(message) && sent.answered() && !atMenu) {
          menuAt = performance.now();
          process.on('SIGINT', promptListener);
          atMenu = signalListeners();
        }
      },
      pending: sent,
      prepare: family.prepare,
    });

    await vi.waitFor(() => expect(sent.reached()).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    sent.release();

    const run = await running;

    expect(run.error).toBeUndefined();
    expect(atMenu, 'nunca volvió al menú').toBeDefined();
    // El menu se abrio dentro del eco, con el listener propio todavia puesto: es el caso que hay que probar.
    expect(menuAt - signalAt, 'el menú se abrió después del eco').toBeLessThan(REPEATED_SIGNAL_MS);
    expect(
      atMenu?.SIGINT.some((listener) => !listeners.SIGINT.includes(listener) && listener !== promptListener),
      'el listener propio ya no estaba',
    ).toBe(true);
    // Pasado el eco, el de la pregunta sigue: nadie lo aparto.
    await new Promise((resolve) => setTimeout(resolve, REPEATED_SIGNAL_MS + 50));
    expect(process.rawListeners('SIGINT')).toContain(promptListener);
    process.off('SIGINT', promptListener);
    await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
  });
});

// En A, B y C el numero se pide al emitir. En la E va en la vista previa, una espera que no ataja SIGTERM.
describe('Factura C: SIGTERM antes de enviar', () => {
  const family = FC;

  it('antes de enviar: no vuelve al menú, se reenvía como en los comandos y no se envía nada', async () => {
    const number = ctrlCDuring(family.lastNumber(), { call: family.numberCall, signal: 'SIGTERM' });
    const steps: Steps = [...family.steps, ...(family.numberInPreview ? [] : [EMIT]), EXIT];
    let killed = false;

    vi.mocked(process.kill).mockImplementation(() => {
      killed = true;

      return true;
    });

    const run = await runMenu(steps, {
      onAsk: () => {
        if (killed) {
          throw ctrlC();
        }
      },
      pending: number,
      prepare: family.prepare,
    });

    expect(number.reached(), 'nunca pidió el número').toBe(true);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
    expect(run.error).toBeInstanceOf(ResentSignalError);
    expect(run.menus).toHaveLength(1);
    expect(plain(run.output)).not.toContain('Cancelado');
    expect(family.emit()).not.toHaveBeenCalled();
  });
});

describe.each([FC, FE])('$name: SIGTERM corta como siempre', (family) => {
  it('con el comprobante enviado: espera, muestra el CAE y después termina, sin volver al menú', async () => {
    const sent = ctrlCDuring(family.emit(), { cancellable: false, signal: 'SIGTERM' });
    let atKill: { readonly answered: boolean; readonly written: string } | undefined;

    vi.mocked(process.kill).mockImplementation(() => {
      atKill ??= { answered: sent.answered(), written: written() };

      return true;
    });

    const run = await runMenu(script(family), {
      onAsk: () => {
        if (atKill !== undefined) {
          throw ctrlC();
        }
      },
      pending: sent,
      prepare: family.prepare,
    });

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(plain(sent.whileWaiting())).toContain('Esperamos a que ARCA conteste');
    expect(atKill?.answered, 'cortó sin esperar a ARCA').toBe(true);
    expect(plain(atKill?.written ?? '')).toMatch(CAE);
    expect(run.emitted).toHaveLength(1);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGTERM');
    expect(run.error).toBeInstanceOf(ResentSignalError);
    expect(run.menus).toHaveLength(1);
  });
});

describe('Consultas → "Datos de un CUIT" → emitirle una factura', () => {
  const TAXPAYER = {
    datosGenerales: {
      apellido: 'VICTORIA CAROLINA',
      domicilioFiscal: { codPostal: '1030', descripcionProvincia: 'CABA', direccion: 'LARREA 1' },
      nombre: 'DARIO',
    },
    datosRegimenGeneral: { impuesto: [{ descripcionImpuesto: 'IVA', estadoImpuesto: 'AC', idImpuesto: 30 }] },
    tipoPersona: 'FISICA',
  };
  const TO_EMISSION: Steps = [
    [MENU, 'Consultas'],
    [/Qué querés consultar/, 'Datos de un CUIT'],
    [/CUIT a consultar/, String(CLIENT_CUIT)],
    [/Le emitimos una factura/, 'Emitir una factura a este CUIT'],
    [/comprobante/, 'Factura A'],
    [/Qué estás facturando/, 'Servicios'],
    [/Monto total/, '1000'],
    NO_OPTIONALS,
  ];
  const prepare = () => sdk.padron.getTaxpayerDetails.mockResolvedValue(TAXPAYER);

  it('dos Ctrl+C con el comprobante enviado: no se sabe, y corta sin un error de más', async () => {
    let atKill: string | undefined;
    const sent = ctrlCDuring(sdk.wsfe.createVoucher, { cancellable: false, times: 2 });

    vi.mocked(process.kill).mockImplementation(() => {
      atKill ??= written();

      return true;
    });

    const run = await runMenu([...TO_EMISSION, EMIT, EXIT], {
      onAsk: () => {
        if (atKill !== undefined) {
          throw ctrlC();
        }
      },
      pending: sent,
      prepare,
    });

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(plain(atKill ?? '')).toContain('Puede haberse emitido igual');
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, 'SIGINT');
    expect(run.error).toBeInstanceOf(ResentSignalError);
    // Despues de cortar no se escribe nada: ni el panel de un error inesperado ni el menu de Consultas.
    expect(plain(written().slice(atKill?.length ?? 0)).trim()).toBe('');
    expect(plain(run.output)).not.toContain('Cortado por');
    expect(run.menus).toHaveLength(1);
  });

  it('Ctrl+C antes de enviar: "Cancelado. No se emitió nada." y vuelve al menú', async () => {
    const number = ctrlCDuring(sdk.wsfe.getLastVoucher);
    const run = await runMenu([...TO_EMISSION, EMIT, EXIT], { pending: number, prepare });

    expect(number.reached(), 'nunca pidió el número').toBe(true);
    expect(plain(sinceMenu(run, 1))).toContain(CANCELLED);
    expect(run.error).toBeUndefined();
    expect(run.menus).toHaveLength(2);
    expect(sdk.wsfe.createVoucher).not.toHaveBeenCalled();
  });
});

describe('el PDF', () => {
  const PDF_QUESTIONS: Steps = [
    [/Descripción/, ''],
    [/Nombre o razón social/, ''],
    [/Domicilio del receptor/, ''],
    [/Condición de venta/, 'Omitir'],
  ];
  // La E no pregunta los datos del PDF.
  const WITH_PDF: ReadonlyArray<readonly [string, Family, Steps]> = [
    [FC.name, FC, PDF_QUESTIONS],
    [FE.name, FE, []],
  ];

  function fakePdf() {
    const render = vi.fn(async (_data: unknown) => new Uint8Array([37, 80, 68, 70]));

    vi.spyOn(PdfPlugin.prototype, 'getStatus').mockReturnValue({ installed: true } as never);
    vi.spyOn(PdfPlugin.prototype, 'load').mockReturnValue({ render } as never);

    return render;
  }

  /** La config con lo que pide el PDF; devuelve la carpeta de los PDF. */
  function withIssuer(): string {
    const folder = profile.temporaryDirectory('arcli-pdf-');

    profile.writeConfig(
      profile.configWith(profile.healthy, {
        ...CLOCK_CONFIG,
        emisor: { domicilio: 'Calle 1', inicioActividades: '20200301', razonSocial: 'Yo' },
        pdfCarpeta: folder,
      }),
    );

    return folder;
  }

  it.each(WITH_PDF)('%s: sin señales, se genera', async (_name, family, questions) => {
    const render = fakePdf();
    const folder = withIssuer();
    const run = await runMenu([...family.steps, EMIT_WITH_PDF, ...questions, EXIT]);

    expect(run.error).toBeUndefined();
    expect(render).toHaveBeenCalledOnce();
    expect(readdirSync(folder)).toHaveLength(1);
  });

  it.each(WITH_PDF)(
    '%s: Ctrl+C mientras se genera deja de generarlo, con el CAE a la vista, y sigue en el menú',
    async (_name, family, questions) => {
      const render = fakePdf();
      const folder = withIssuer();
      const steps: Steps = [...family.steps, EMIT_WITH_PDF, ...questions, EXIT];
      const listeners = signalListeners();
      const generating = ctrlCDuring(render, { cancellable: false });
      const run = await runMenu(steps, { pending: generating });

      expect(generating.reached(), 'nunca llegó a generar el PDF').toBe(true);
      expect(plain(run.output)).toContain('Se cortó antes de generar el PDF.');
      expect(plain(run.output)).toMatch(CAE);
      expect(run.error).toBeUndefined();
      expect(run.asked).toHaveLength(steps.length);
      expect(run.menus[1]?.answered, 'esperó al plugin antes de volver al menú').toBe(false);
      expect(plain(run.output)).not.toMatch(DENIED);
      expect(process.kill).not.toHaveBeenCalled();
      // Lo que el plugin termine despues no se guarda ni se escribe.
      expect(run.late).toBe('');
      expect(readdirSync(folder)).toEqual([]);
      await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
    },
  );
});
