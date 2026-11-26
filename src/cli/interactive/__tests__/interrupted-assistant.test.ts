import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import { answerAssociated, CLIENT_CUIT, CLOCK_CONFIG, sdk } from '../../__tests__/clock.fixture';
import { REPEATED_SIGNAL_MS } from '../../interruption';

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

  // Tests primero (ARQ-11 PR 5): pasa a it() al implementarlo.
  it.fails(
    'Ctrl+C con el comprobante enviado: avisa que espera, muestra el CAE y sigue como siempre hasta el menú',
    async () => {
      const normal = await runMenu(script(family), { prepare: family.prepare });
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
    },
  );

  // Tests primero (ARQ-11 PR 5): pasa a it() al implementarlo.
  it.fails(
    'dos Ctrl+C con el comprobante enviado: no se sabe, con qué verificarlo, y recién después corta',
    async () => {
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
    },
  );

  // Tests primero (ARQ-11 PR 5): pasa a it() al implementarlo.
  it.fails('Ctrl+C al pedir el número, antes de enviar: no se envía nada y vuelve al menú', async () => {
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
});

const FC = FAMILIES[0] as Family;
const FE = FAMILIES[7] as Family;

describe.each([FC, FE])('$name: eco de npx', (family) => {
  // Tests primero (ARQ-11 PR 5): pasa a it() al implementarlo.
  it.fails('dos Ctrl+C seguidos emitiendo cuentan como uno: avisa una vez, espera y muestra el CAE', async () => {
    const sent = ctrlCDuring(family.emit(), { cancellable: false, gap: REPEATED_SIGNAL_MS / 5, times: 2 });
    const run = await runMenu(script(family), { pending: sent, prepare: family.prepare });

    expect(sent.reached(), 'nunca llegó a emitir').toBe(true);
    expect(plain(sent.whileWaiting())).toContain(WAITING_NOTICE);
    expect(plain(sent.whileWaiting()).split(WAITING_NOTICE)).toHaveLength(2);
    expect(run.error).toBeUndefined();
    expect(plain(run.output)).toMatch(CAE);
    expect(plain(run.output)).not.toContain('Puede haberse emitido igual');
    expect(process.kill).not.toHaveBeenCalled();
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

  // Tests primero (ARQ-11 PR 5): pasa a it() al implementarlo.
  it.fails.each(WITH_PDF)(
    '%s: Ctrl+C mientras se genera deja de generarlo, con el CAE a la vista, y sigue en el menú',
    async (_name, family, questions) => {
      const render = fakePdf();
      const folder = withIssuer();
      const steps: Steps = [...family.steps, EMIT_WITH_PDF, ...questions, EXIT];
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
    },
  );
});
