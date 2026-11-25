import { describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import { stripAnsi } from '../../../ui';
import { CLOCK_CONFIG, sdk } from '../../__tests__/clock.fixture';
import { describeEmittedInThisRun } from '../../emitted-vouchers';
import { serializeCliError } from '../../error-output';

import {
  DO_NOT_EMIT,
  EMIT,
  EMIT_WITH_PDF,
  expectFinished,
  FA_STEPS,
  FC_ARGS,
  FC_STEPS,
  FE_ARGS,
  FE_STEPS,
  invoiceFlow,
  NO_OPTIONALS,
  noteFlow,
  over,
  productionInvoiceFlow,
  receiptFlow,
  repeatFlow,
  RI_ARGS,
  runAssistant,
  runCommand,
  TO_INVOICE,
  useOnePathFixture,
} from './one-path.fixture';
import { ctrlC, type Steps } from './one-path.prompts';

/**
 * REV-53: lo que no termina en un comprobante mostrado (errores, Esc, "No", Ctrl+C), el PDF y la confirmacion en
 * produccion, por el comando y por el asistente. La emision normal esta en `one-path.characterization.test.ts`.
 */

const force = vi.hoisted(() => ({ failRecord: false, neverEmit: false }));

vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../../spinner', async (original) => ({
  ...(await original<typeof import('../../spinner')>()),
  startSpinner: () => null,
}));
vi.mock('../prompts', async (original) =>
  (await import('./one-path.prompts')).scriptedPrompts(await original<typeof import('../prompts')>()),
);
vi.mock('../../../modules/billing/billing.emit-decision', async (original) => {
  const actual = await original<typeof import('../../../modules/billing/billing.emit-decision')>();

  return {
    ...actual,
    shouldEmit: (...args: Parameters<typeof actual.shouldEmit>) => !force.neverEmit && actual.shouldEmit(...args),
  };
});
vi.mock('../../emitted-vouchers', async (original) => {
  const actual = await original<typeof import('../../emitted-vouchers')>();
  const failing =
    <T>(record: (result: T) => T) =>
    (result: T): T => {
      if (force.failRecord) {
        throw new Error('no se pudo anotar');
      }

      return record(result);
    };

  return {
    ...actual,
    recordEmission: failing(actual.recordEmission),
    recordExportEmission: failing(actual.recordExportEmission),
  };
});

const profile = useOnePathFixture();

async function forcing<T>(key: keyof typeof force, run: () => Promise<T>): Promise<T> {
  force[key] = true;

  try {
    return await run();
  } finally {
    force[key] = false;
  }
}

interface Family {
  readonly args: readonly string[];
  /** La llamada que emite. */
  readonly emit: typeof sdk.wsfe.createVoucher;
  readonly name: string;
  readonly steps: Steps;
}

const FC: Family = { args: FC_ARGS, emit: sdk.wsfe.createVoucher, name: 'Factura C', steps: FC_STEPS };
const FE: Family = { args: FE_ARGS, emit: sdk.wsfex.authorize, name: 'Factura E', steps: FE_STEPS };
const FAMILIES = [FC, FE];

/** El comando y el asistente, con la misma respuesta a "¿Emitimos?" y lo que sigue. */
async function runBoth(family: Family, ending: Steps, onAsk?: (message: string) => void) {
  const command = await runCommand(family.args, { onAsk, steps: ending.slice(0, 1) });
  const assistant = await runAssistant(invoiceFlow, { onAsk, steps: [...family.steps, ...ending] });

  return { assistant, command };
}

const text = (chunks: readonly string[]) => stripAnsi(chunks.join(''));

describe.each(FAMILIES)('$name: la emisión falla', (family) => {
  it.each<[string, () => void, string]>([
    ['se corta la conexión', () => family.emit.mockRejectedValue(new Error('ECONNRESET')), 'ECONNRESET'],
    ['ARCA contesta vacío', () => family.emit.mockResolvedValue({ cae: '', caeFchVto: '', response: {} }), ''],
  ])('%s: el mismo EMISSION_UNCERTAIN, sin nada anotado ni mostrado', async (_name, prepare, cause) => {
    prepare();

    const { assistant, command } = await runBoth(family, [EMIT]);

    expect(assistant.requests).toHaveLength(1);
    expect(assistant.requests).toEqual(command.requests);
    expect(serializeCliError(assistant.error)).toMatchObject({ codigo: 'EMISSION_UNCERTAIN' });
    expect(serializeCliError(assistant.error)).toEqual(serializeCliError(command.error));
    expect(JSON.stringify(serializeCliError(assistant.error))).toContain(cause);
    expect([assistant.emitted, command.emitted]).toEqual([[], []]);
    expect([assistant.after, command.after]).toEqual([[], []]);
  });
});

it('Factura C: si no se puede pedir el número, el mismo error de ARCA, sin emitir', async () => {
  sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('ARCA no responde'));

  const { assistant, command } = await runBoth(FC, [EMIT]);

  expect(assistant.error).toBeDefined();
  expect(serializeCliError(assistant.error)).toEqual(serializeCliError(command.error));
  expect([assistant.requests, command.requests]).toEqual([[], []]);
});

describe('la vista previa falla: ARCA no tiene la cotización', () => {
  const IN_USD: Steps = [
    [/Agregamos/, ['Moneda']],
    [/Moneda del comprobante/, 'Dólares'],
    [/Cómo te pagan/, 'En dólares'],
  ];
  const inUsd = (steps: Steps): Steps => [...steps.slice(0, -1), ...IN_USD, [/Monto total en USD/, '1000'], ...IN_USD];
  const withoutQuotation = () => {
    let calls = 0;

    // El corte es para que un asistente que insiste sin preguntar no cuelgue el test.
    sdk.wsfe.getQuotation.mockImplementation(async () => {
      calls += 1;

      if (calls > 10) {
        throw new Error('demasiadas consultas de la cotización');
      }

      return { resultGet: { monCotiz: 0, monId: 'DOL' } };
    });
  };
  /** Llega a la vista previa y, si el asistente vuelve a preguntar, corta ahi. */
  const runUntilAskedAgain = (steps: Steps) =>
    runAssistant(invoiceFlow, {
      onAsk: () => {
        if (text([profile.stdout]).includes('Volvemos a la última pregunta')) {
          throw ctrlC();
        }
      },
      prepare: withoutQuotation,
      steps,
    });

  it('Factura A: el comando sale con el error; el asistente lo muestra y vuelve a la última pregunta', async () => {
    const command = await runCommand(['fa', ...FC_ARGS.slice(1, -1), ...RI_ARGS, '--moneda', 'USD', '--misma-moneda'], {
      prepare: withoutQuotation,
      steps: [],
    });
    const shown = profile.stdout.length;
    const assistant = await runUntilAskedAgain(inUsd(FA_STEPS));

    expect(serializeCliError(command.error)).toMatchObject({ codigo: 'ARCA_QUOTATION_ERROR' });
    expect(text([profile.stderr])).toContain('ARCA no devolvió una cotización válida');
    expect(text([profile.stdout.slice(shown)])).toContain('No se emitió nada. Volvemos a la última pregunta');
    expect(assistant.error).toMatchObject({ name: 'ExitPromptError' });
    expect([assistant.requests, command.requests]).toEqual([[], []]);
  });

  // Su ultimo paso consulta la cotizacion para el tope y no pregunta nada: no es una pregunta a la que volver.
  it('Factura C a consumidor final: el asistente también vuelve a preguntar', async () => {
    const assistant = await runUntilAskedAgain(inUsd(FC_STEPS));

    expect(assistant.error).toMatchObject({ name: 'ExitPromptError' });
  });

  const IN_USD_NOTE: Steps = [...IN_USD, [/Monto de la nota de crédito en USD/, '100'], ...IN_USD];
  const CONSUMER_FLOWS: ReadonlyArray<readonly [string, () => Promise<unknown>, Steps]> = [
    ['factura', invoiceFlow, inUsd(FC_STEPS)],
    [
      'recibo',
      receiptFlow,
      inUsd([
        [/Qué recibo/, 'Recibo C'],
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '1000'],
        NO_OPTIONALS,
      ]),
    ],
    [
      'nota por período',
      noteFlow('credito'),
      [
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A un período'],
        [/Período desde/, '01/11/2026'],
        [/Período hasta/, '05/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/Qué concepto ajusta la nota/, 'Servicios'],
        [/Monto de la nota de crédito/, '100'],
        ...IN_USD_NOTE,
      ],
    ],
    [
      'Repetir',
      repeatFlow,
      [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000041'],
        [/Mismo monto/, 'No, ingresar otro monto'],
        [/Monto total/, '1000'],
        [/Período del servicio/, 'Un solo día'],
        ...IN_USD,
        [/Monto total en USD/, '1000'],
        [/Período del servicio/, 'Un solo día'],
        ...IN_USD,
      ],
    ],
  ];

  it.each(CONSUMER_FLOWS)(
    '%s en dólares a consumidor final: vuelve a los opcionales, sin consultar de más',
    async (...args) => {
      const [, flow, steps] = args;
      let askedAgain: string | undefined;
      const assistant = await runAssistant(flow, {
        onAsk: (message) => {
          if (text([profile.stdout]).includes('Volvemos a la última pregunta')) {
            askedAgain = message;
            throw ctrlC();
          }
        },
        prepare: withoutQuotation,
        steps,
      });

      expect(assistant.asked).toHaveLength(steps.length);
      expect(askedAgain).toMatch(/Agregamos/);
      // Una para el tope y una para la vista previa.
      expect(sdk.wsfe.getQuotation).toHaveBeenCalledTimes(2);
    },
  );

  it.each(CONSUMER_FLOWS)('%s: Esc en "¿Emitimos?" vuelve una vez, sin otra vista previa', async (...args) => {
    const [, flow, steps] = args;
    // La consulta del tope falla y la de la vista previa no.
    const prepare = () => {
      sdk.wsfe.getQuotation.mockRejectedValueOnce(new Error('ECONNRESET'));
    };
    const assistant = await runAssistant(flow, {
      prepare,
      steps: [...steps, [/Emitimos/, BACK], ...IN_USD, DO_NOT_EMIT],
    });

    expectFinished(assistant, [...steps, [/Emitimos/, BACK], ...IN_USD, DO_NOT_EMIT]);
    expect(assistant.asked.filter((message) => /Emitimos/.test(message))).toHaveLength(2);
  });
});

describe.each(FAMILIES)('$name: no se confirma', (family) => {
  it('"No" termina igual en los dos, con el aviso y sin emitir', async () => {
    const { assistant, command } = await runBoth(family, [DO_NOT_EMIT]);

    expectFinished(assistant, [...family.steps, DO_NOT_EMIT]);
    expect(text(assistant.after)).toContain('No se emitió nada.');
    expect(assistant.after).toEqual(command.after);
    expect([assistant.requests, command.requests]).toEqual([[], []]);
  });

  it('Esc: en el comando es no; en el asistente vuelve a la última pregunta, sin aviso', async () => {
    const command = await runCommand(family.args, { steps: [[/Emitimos/, BACK]] });
    const steps: Steps = [...family.steps, [/Emitimos/, BACK], NO_OPTIONALS, DO_NOT_EMIT];
    const assistant = await runAssistant(invoiceFlow, { steps });

    expect(text(command.after)).toContain('No se emitió nada.');
    expectFinished(assistant, steps);
    // Solo el "No" del final avisa: la vuelta, no.
    expect(text([...assistant.before, ...assistant.after]).match(/No se emitió nada\./g)).toHaveLength(1);
    expect([assistant.requests, command.requests]).toEqual([[], []]);
  });

  it('Ctrl+C: el comando sale con EmissionCancelledError y al asistente le llega la cancelación', async () => {
    const { assistant, command } = await runBoth(family, [EMIT], (message) => {
      if (/Emitimos/.test(message)) {
        throw ctrlC();
      }
    });

    expect(command.error).toMatchObject({ name: 'EmissionCancelledError' });
    expect(assistant.error).toMatchObject({ name: 'ExitPromptError' });
    expect([assistant.requests, command.requests]).toEqual([[], []]);
  });
});

describe('Esc en "¿Emitimos?", cambiar un dato y emitir', () => {
  const NCC_STEPS: Steps = [
    ...over('Factura C', TO_INVOICE),
    [/Total o parcial/, 'Parcial'],
    [/Monto de la nota de crédito/, '100'],
    NO_OPTIONALS,
  ];

  it.each<[string, () => Promise<unknown>, Steps, Steps[number], object]>([
    ['Factura C', invoiceFlow, FC_STEPS, [/Monto total/, '2500'], { ImpTotal: 2500 }],
    ['Nota de crédito C', noteFlow('credito'), NCC_STEPS, [/Monto de la nota/, '250'], { ImpTotal: 250 }],
    ['Factura E', invoiceFlow, FE_STEPS, [/Fecha de pago/, '20/11/2026'], { Fecha_pago: '20261120' }],
  ])('%s: una sola solicitud, con el dato nuevo', async (_name, flow, first, changed, expected) => {
    const steps: Steps = [...first, [/Emitimos/, BACK], [/Agregamos/, BACK], changed, NO_OPTIONALS, EMIT];
    const assistant = await runAssistant(flow, { steps });

    expectFinished(assistant, steps);
    expect(assistant.requests).toEqual([expect.objectContaining(expected)]);
    expect(assistant.emitted).toHaveLength(1);
  });
});

describe.each(FAMILIES)('$name: lo emitido', (family) => {
  it('queda anotado antes de mostrar el CAE, por los dos caminos', async () => {
    const recorded: string[][] = [];
    const write = vi.mocked(process.stdout.write);
    const original = write.getMockImplementation();

    write.mockImplementation((...args) => {
      if (/7646392658\d{4}/.test(String(args[0]))) {
        recorded.push(describeEmittedInThisRun());
      }

      return original?.(...args) ?? true;
    });
    await runBoth(family, [EMIT]);

    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toHaveLength(1);
    expect(recorded[1]).toEqual(recorded[0]);
  });
});

describe('"Sí, emitir y generar el PDF"', () => {
  function fakePdf() {
    const render = vi.fn(async (_data: unknown) => new Uint8Array());

    vi.spyOn(PdfPlugin.prototype, 'getStatus').mockReturnValue({ installed: true } as never);
    vi.spyOn(PdfPlugin.prototype, 'load').mockReturnValue({ render } as never);

    return render;
  }
  const withIssuer = (issuer: object = { domicilio: 'Calle 1', inicioActividades: '20200301', razonSocial: 'Yo' }) =>
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        ...CLOCK_CONFIG,
        emisor: issuer,
        pdfCarpeta: profile.temporaryDirectory('arcli-pdf-'),
      }),
    );
  const PDF_QUESTIONS: Steps = [
    [/Descripción/, ''],
    [/Nombre o razón social/, ''],
    [/Domicilio del receptor/, ''],
    [/Condición de venta/, 'Omitir'],
  ];

  // La E no pregunta descripción ni receptor.
  it.each([
    [FC, PDF_QUESTIONS],
    [FE, [] as Steps],
  ])('$name: el mismo PDF por los dos caminos', async (family, questions) => {
    const render = fakePdf();

    withIssuer();

    const { assistant, command } = await runBoth(family, [EMIT_WITH_PDF, ...questions]);

    expectFinished(command, [EMIT_WITH_PDF]);
    expectFinished(assistant, [...family.steps, EMIT_WITH_PDF, ...questions]);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]?.[0]).toEqual(render.mock.calls[0]?.[0]);
    expect(assistant.emitted).toEqual(command.emitted);
    expect(assistant.after[0]).toBe(command.after[0]);
    expect(assistant.after).toHaveLength(command.after.length);
  });

  it.each([
    [FC, /Descripción/],
    [FE, /domicilio|Domicilio/],
  ])('$name: Ctrl+C mientras se piden los datos del PDF dice que ya quedó emitido', async (family, question) => {
    const render = fakePdf();

    withIssuer({ razonSocial: 'Yo' });

    let confirmed = false;
    const assistant = await runAssistant(invoiceFlow, {
      onAsk: (message) => {
        if (confirmed && question.test(message)) {
          throw ctrlC();
        }

        confirmed ||= /Emitimos/.test(message);
      },
      steps: [...family.steps, EMIT_WITH_PDF],
    });

    expect(assistant.error).toBeUndefined();
    expect(assistant.requests).toHaveLength(1);
    expect(assistant.emitted).toHaveLength(1);
    expect(text(assistant.after)).toContain('El comprobante ya quedó emitido; no se generó el PDF.');
    expect(text(assistant.after)).not.toContain('No se emitió nada');
    expect(render).not.toHaveBeenCalled();
  });

  const FAILING_PDF = [
    { family: FC, missing: 'No se generó el PDF: fc del punto de venta 3, 42.', questions: PDF_QUESTIONS },
    { family: FE, missing: 'No se generó el PDF: fe del punto de venta 3, 8.', questions: [] as Steps },
  ];
  const failPdf = async ({ family, questions }: (typeof FAILING_PDF)[number]) => {
    fakePdf().mockRejectedValue(new Error('sin Chrome'));
    withIssuer();

    return runBoth(family, [EMIT_WITH_PDF, ...questions]);
  };

  it.each(FAILING_PDF)('$family.name: si el PDF falla, el asistente lo anota una sola vez', async (failing) => {
    const { assistant } = await failPdf(failing);

    expect(assistant.emitted).toEqual([expect.stringContaining('Se emitió'), failing.missing]);
  });

  it.each(FAILING_PDF)('$family.name: si el PDF falla, el comando lo anota como el asistente', async (failing) => {
    const { assistant, command } = await failPdf(failing);

    expect(command.emitted).toEqual(assistant.emitted);
  });
});

describe('el asistente emite por los casos de uso de modules', () => {
  /** Un error, sin nada mostrado como emitido, ni anotado, ni PDF. */
  const expectNothingEmitted = (assistant: Awaited<ReturnType<typeof runAssistant>>) => {
    expect(assistant.error).toBeInstanceOf(Error);
    expect(String(assistant.error)).toContain('no pide emitir');
    expect(assistant.requests).toEqual([]);
    expect(assistant.emitted).toEqual([]);
    expect(assistant.after).toEqual([]);
  };

  it('Factura E: si la entrada no pide emitir, no llega a ARCA', async () => {
    const assistant = await forcing('neverEmit', () =>
      runAssistant(invoiceFlow, { steps: [...FE_STEPS, EMIT_WITH_PDF] }),
    );

    expectNothingEmitted(assistant);
  });

  it('Factura C: si la entrada no pide emitir, no llega a ARCA', async () => {
    const assistant = await forcing('neverEmit', () =>
      runAssistant(invoiceFlow, { steps: [...FC_STEPS, EMIT_WITH_PDF] }),
    );

    expectNothingEmitted(assistant);
  });

  it.each(FAMILIES)('$name: en el comando, si no se puede anotar lo emitido, igual se muestra', async ({ args }) => {
    const command = await forcing('failRecord', () => runCommand(args, { steps: [EMIT] }));

    expect(command.error).toBeUndefined();
    expect(text(command.after)).toMatch(/7646392658\d{4}/);
  });

  it.each(FAMILIES)('$name: si no se puede anotar lo emitido, igual se muestra', async ({ steps }) => {
    const assistant = await forcing('failRecord', () => runAssistant(invoiceFlow, { steps: [...steps, EMIT] }));

    expect(text(assistant.after)).toMatch(/7646392658\d{4}/);
  });
});

describe('producción', () => {
  it.each(FAMILIES)('$name: la pregunta dice PRODUCCIÓN y con "No" no se emite', async ({ steps }) => {
    const assistant = await runAssistant(productionInvoiceFlow, { steps: [...steps, DO_NOT_EMIT] });

    expectFinished(assistant, [...steps, DO_NOT_EMIT]);
    expect(assistant.asked.at(-1)).toContain('en PRODUCCIÓN');
    expect(assistant.requests).toEqual([]);
  });

  it.each(FAMILIES)('$name: el comando emite con una sola confirmación', async ({ args }) => {
    const command = await runCommand([...args, '--produccion'], { steps: [EMIT] });

    expectFinished(command, [EMIT]);
    expect(command.asked).toEqual([expect.stringContaining('en PRODUCCIÓN')]);
    expect(command.requests).toHaveLength(1);
  });

  it.each(FAMILIES)('$name: el asistente emite con una sola confirmación', async ({ steps }) => {
    const assistant = await runAssistant(productionInvoiceFlow, { steps: [...steps, EMIT] });

    expect(assistant.asked.slice(steps.length)).toEqual([expect.stringContaining('en PRODUCCIÓN')]);
    expect(assistant.requests).toHaveLength(1);
  });
});
