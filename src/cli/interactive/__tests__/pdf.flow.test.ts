import { afterEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import type { ArcliConfig } from '../../../modules/config/config.schemas';
import { BACK } from '../../../modules/interactive/wizard';
import { writeTerminalOutput } from '../../../ui';
import { outputState } from '../../closed-output';
import { writePdfOutcomes } from '../../commands/billing.command.output';
import { attachPdfs } from '../../commands/billing.command.pdf';
import { describeEmittedInThisRun, resetEmittedInThisRun } from '../../emitted-vouchers';
import type { DeliveryInterruption } from '../../interruption';
import { offerPdf } from '../pdf.flow';
import { askText, confirm } from '../prompts';

import { chooseOrTypeInitialTerm, createScript, enterOnChooseOrType } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askText: vi.fn(),
  // Sin respuesta preparada, Enter: lo marcado o escrito, o la primera fila (Omitir).
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => {
    if (script.remaining() > 0) {
      return script.chooseOrTypeStep(...args);
    }

    const [, rows, options] = args;
    const enter = enterOnChooseOrType(rows, options, chooseOrTypeInitialTerm(rows, options));

    return 'value' in enter ? enter.value : Promise.reject(new Error(enter.error));
  },
  confirm: vi.fn(),
  isPromptCancellation: (error: unknown) => error instanceof Error && error.name === 'ExitPromptError',
}));
vi.mock('../../../ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui')>()),
  writeTerminalOutput: vi.fn(),
}));
vi.mock('../../commands/billing.command.pdf', () => ({
  attachPdfs: vi.fn(async ({ results }) => results),
  interruptiblePdfSteps: vi.fn(() => ({})),
}));
vi.mock('../../commands/billing.command.output', () => ({ writePdfOutcomes: vi.fn() }));

const setValue = vi.fn();

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close = vi.fn();
    public setValue = setValue;
  },
}));

const askTextMock = vi.mocked(askText);
const confirmMock = vi.mocked(confirm);
const attachPdfsMock = vi.mocked(attachPdfs);

const CONFIG = {
  cert: {},
  cuit: '20123456786',
  emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
  entornoPorDefecto: 'testing',
  key: {},
  output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
} satisfies ArcliConfig;

const input = billingCommandSchema.parse({
  concept: 'servicios',
  ivaCondition: 'consumidor-final',
  shortcut: 'fc',
  totalAmount: 1000,
});

const result = {
  dryRun: false,
  environment: 'testing',
  payload: {} as never,
  response: { cae: '76123456789012', status: 'aprobado' },
  voucherKind: getVoucherKindByShortcut('fc'),
} as unknown as BillingExecutionResult;

/** Sin señales: las preguntas se hacen como siempre. */
const DELIVERY: DeliveryInterruption = { signal: new AbortController().signal, whileAsking: (ask) => ask() };

afterEach(() => {
  vi.clearAllMocks();
});

describe('offerPdf', () => {
  it('does not ask anything when the config says nunca', async () => {
    await offerPdf({ ...CONFIG, pdf: 'nunca' }, input, result, DELIVERY);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(attachPdfsMock).not.toHaveBeenCalled();
  });

  it('with nunca, "Emitir y generar el PDF" generates it without asking whether to', async () => {
    askTextMock.mockResolvedValue('');

    await offerPdf({ ...CONFIG, pdf: 'nunca' }, { ...input, pdf: true }, result, DELIVERY);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: [expect.objectContaining({ pdf: true })] }),
      expect.anything(),
    );
    askTextMock.mockReset();
  });

  it('says the voucher was already issued when Ctrl+C cancels a PDF question', async () => {
    const cancellation = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' });

    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockRejectedValueOnce(cancellation);

    await expect(offerPdf(CONFIG, input, result, DELIVERY)).resolves.toBeUndefined();
    expect(attachPdfsMock).not.toHaveBeenCalled();
    expect(vi.mocked(writeTerminalOutput)).toHaveBeenCalledWith(expect.stringContaining('ya quedó emitido'));
  });

  it.each([
    ['cortado por la salida rota', true, ['No se generó el PDF']],
    ['cancelado con Ctrl+C', false, []],
  ])('%s: el aviso de la salida dice que no se generó solo si nadie lo vio (ERR-18)', async (_name, lost, expected) => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ExitPromptError' }));

    if (lost) {
      outputState.failures.set('stdout', new Error('write'));
    }

    try {
      await offerPdf(CONFIG, input, { ...result, voucherNumber: 42 }, DELIVERY);
      expect(describeEmittedInThisRun()).toEqual(expected.map((text) => expect.stringContaining(text)));
    } finally {
      outputState.failures.clear();
      resetEmittedInThisRun();
    }
  });

  it.each([
    [{ error: { code: 'PDF_PLUGIN_MISSING', message: 'x' } }, 1],
    [{ path: '/x.pdf' }, 0],
  ])('con el resultado %j quedan %i sin PDF (ERR-18)', async (pdf, missing) => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');
    attachPdfsMock.mockResolvedValueOnce([{ ...result, pdf, voucherNumber: 42 }] as never);

    try {
      await offerPdf(CONFIG, input, { ...result, voucherNumber: 42 }, DELIVERY);
      expect(describeEmittedInThisRun()).toHaveLength(missing);
    } finally {
      resetEmittedInThisRun();
    }
  });

  it('stops when the user does not want the PDF', async () => {
    confirmMock.mockResolvedValueOnce(false);

    await offerPdf(CONFIG, input, result, DELIVERY);

    expect(askTextMock).not.toHaveBeenCalled();
    expect(attachPdfsMock).not.toHaveBeenCalled();
  });

  it('keeps the receiver name and address from the padron when the user presses Enter', async () => {
    confirmMock.mockResolvedValueOnce(true);
    // Enter en un prompt con valor por defecto devuelve ese valor.
    askTextMock.mockImplementation(async (_message, options) => options?.defaultValue ?? '');

    await offerPdf(
      CONFIG,
      { ...input, receiverAddress: 'Av. Siempreviva 742', receiverName: 'DARIO SA' },
      result,
      DELIVERY,
    );

    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [expect.objectContaining({ receiverAddress: 'Av. Siempreviva 742', receiverName: 'DARIO SA' })],
      }),
      expect.anything(),
    );
    askTextMock.mockReset();
  });

  it('asks the PDF-only data and generates it', async () => {
    confirmMock.mockResolvedValueOnce(true);
    script = createScript([[/^Condición de venta/, 'Otros medios de pago electrónico']]);
    askTextMock
      .mockResolvedValueOnce('Servicios de octubre')
      .mockResolvedValueOnce('Cliente SA')
      .mockResolvedValueOnce('');

    await offerPdf(CONFIG, input, result, DELIVERY);

    expect(attachPdfsMock).toHaveBeenCalledWith(
      {
        config: CONFIG,
        inputs: [
          expect.objectContaining({
            pdf: true,
            pdfDescription: 'Servicios de octubre',
            receiverAddress: undefined,
            receiverName: 'Cliente SA',
            saleCondition: 'otros-medios-electronicos',
          }),
        ],
        interactive: true,
        results: [result],
      },
      expect.anything(),
    );
    expect(writePdfOutcomes).toHaveBeenCalled();
    expect(script.chooseOrTypeStep).toHaveBeenCalledWith(
      'Condición de venta:',
      expect.arrayContaining([
        expect.objectContaining({ label: 'Tarjeta de Débito', value: 'tarjeta-debito' }),
        expect.objectContaining({ label: 'Otra', value: 'otra' }),
      ]),
      expect.objectContaining({ emptyLabel: 'Omitir', optional: true, previous: undefined }),
    );
  });

  it('marks the sale condition of the config, so Enter keeps it', async () => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');

    await offerPdf({ ...CONFIG, condicionVenta: 'cuenta-corriente' }, input, result, DELIVERY);

    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ condicionVenta: 'cuenta-corriente' }),
        inputs: [expect.objectContaining({ saleCondition: 'cuenta-corriente' })],
      }),
      expect.anything(),
    );
    askTextMock.mockReset();
  });

  it('"Otra" de la lista queda como "otra", sin pedir un texto aparte', async () => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');
    script = createScript([[/^Condición de venta/, 'Otra']]);

    await offerPdf(CONFIG, input, result, DELIVERY);

    expect(attachPdfsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputs: [expect.objectContaining({ saleCondition: 'otra' })] }),
      expect.anything(),
    );
    expect(askTextMock.mock.calls.map(([message]) => message)).not.toContain('Condición de venta:');
    askTextMock.mockReset();
  });

  it('Esc en la condición de venta no genera el PDF y avisa que el comprobante ya quedó emitido', async () => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');
    script = createScript([[/^Condición de venta/, BACK]]);

    await offerPdf(CONFIG, input, result, DELIVERY);

    expect(attachPdfsMock).not.toHaveBeenCalled();
    expect(vi.mocked(writeTerminalOutput)).toHaveBeenCalledWith(expect.stringContaining('no se generó el PDF'));
    // Sin la fila "← Volver": las preguntas anteriores del PDF no vuelven.
    expect(script.chooseOrTypeStep.mock.calls[0]?.[2].backRow).toBe(false);
    askTextMock.mockReset();
  });

  it('asks the missing issuer data once and saves it when the user agrees', async () => {
    // Con `pdf siempre` no se pregunta si generarlo: la unica confirmacion es la de guardar.
    confirmMock.mockResolvedValueOnce(true);
    askTextMock
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Calle 9')
      .mockResolvedValueOnce('1/03/2020');

    await offerPdf({ ...CONFIG, emisor: { razonSocial: 'Ana Gomez' }, pdf: 'siempre' }, input, result, DELIVERY);

    expect(setValue).toHaveBeenCalledWith('emisor.domicilio', 'Calle 9');
    expect(setValue).toHaveBeenCalledWith('emisor.inicioActividades', '1/03/2020');
    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          emisor: { domicilio: 'Calle 9', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
        }),
      }),
      expect.anything(),
    );
  });

  it('skips vouchers without CAE', async () => {
    await offerPdf(CONFIG, input, { ...result, response: { ...result.response, cae: null } }, DELIVERY);

    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('offerPdf: datos que faltan y errores despues de emitir', () => {
  afterEach(() => {
    askTextMock.mockReset();
    confirmMock.mockReset();
    attachPdfsMock.mockImplementation(async ({ results }) => [...results]);
  });

  it('sin CUIT en la config lo pide para el PDF, y "solo esta vez" no lo guarda', async () => {
    // Con `pdf siempre` no se pregunta si generarlo: la unica confirmacion es la de guardar.
    confirmMock.mockResolvedValueOnce(false);
    askTextMock.mockImplementation(async (message, options) => {
      if (/CUIT/.test(message)) {
        expect(options?.validate?.('123')).not.toBe(true);

        return '20123456786';
      }

      return '';
    });

    await offerPdf({ ...CONFIG, cuit: undefined, pdf: 'siempre' } as never, input, result, DELIVERY);

    expect(setValue).not.toHaveBeenCalled();
    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ cuit: '20123456786' }) }),
      expect.anything(),
    );
  });

  it('con "Omitir" ya elegido en la entrada, no propone la condición de la config', async () => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');

    script = createScript([[/^Condición de venta/, '']]);

    await offerPdf({ ...CONFIG, condicionVenta: 'contado' }, { ...input, saleCondition: null }, result, DELIVERY);

    expect(script.chooseOrTypeStep.mock.calls[0]?.[2].previous).toBeUndefined();
    expect(attachPdfsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputs: [expect.objectContaining({ saleCondition: null })] }),
      expect.anything(),
    );
  });

  it('un error al generar el PDF que no es Ctrl+C llega a quien lo pidió', async () => {
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');
    attachPdfsMock.mockRejectedValueOnce(new Error('disco lleno'));

    await expect(offerPdf(CONFIG, input, result, DELIVERY)).rejects.toThrow('disco lleno');
  });

  it('descripción, receptor y domicilio con acentos, emoji y textos largos llegan tal cual', async () => {
    const long = `Servicios de diseño ✏️ y programación — ${'ñ'.repeat(300)}`;

    confirmMock.mockResolvedValueOnce(true);
    askTextMock
      .mockResolvedValueOnce(long)
      .mockResolvedValueOnce("O'Brien & Peña S.R.L. 🏢")
      .mockResolvedValueOnce('Av. Córdoba 1234, 5º "B"');

    await offerPdf(CONFIG, input, result, DELIVERY);

    expect(attachPdfsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [
          expect.objectContaining({
            pdfDescription: long,
            receiverAddress: 'Av. Córdoba 1234, 5º "B"',
            receiverName: "O'Brien & Peña S.R.L. 🏢",
          }),
        ],
      }),
      expect.anything(),
    );
  });
});

/**
 * Criterio 9 (TUI-35): la condición de venta es una lista donde también se escribe. Una de la lista va con su clave, un
 * texto libre va tal cual (sin la segunda pregunta de "Otra"), "Omitir" sigue y un texto libre guardado arranca escrito.
 */
describe('offerPdf: la condición de venta de una lista donde también se escribe (TUI-35)', () => {
  /** Genera el PDF con la condición de venta respondida y devuelve la que le llega. */
  async function saleConditionAfter(answer: string, config: ArcliConfig = CONFIG): Promise<unknown> {
    script = createScript([[/^Condición de venta/, answer]]);
    confirmMock.mockResolvedValueOnce(true);
    askTextMock.mockResolvedValue('');

    await offerPdf(config, input, result, DELIVERY);

    expect(script.asked).toEqual(['Condición de venta:']);
    // "Otra" ya no abre una segunda pregunta de texto.
    expect(askTextMock.mock.calls.map(([message]) => message)).not.toContain('Condición de venta:');

    return attachPdfsMock.mock.calls.at(-1)?.[0].inputs[0]?.saleCondition;
  }

  afterEach(() => {
    askTextMock.mockReset();
    confirmMock.mockReset();
  });

  it('elegir una de la lista devuelve su clave', async () => {
    expect(await saleConditionAfter('Tarjeta de Débito')).toBe('tarjeta-debito');
  });

  it('un texto libre escrito va tal cual', async () => {
    expect(await saleConditionAfter('Billetera virtual')).toBe('Billetera virtual');
  });

  it('"Omitir" sigue estando y deja el PDF sin condición de venta', async () => {
    expect(await saleConditionAfter('Omitir', { ...CONFIG, condicionVenta: 'contado' })).toBeNull();
  });

  it('con un texto libre guardado arranca con ese texto: Enter lo deja', async () => {
    expect(await saleConditionAfter('', { ...CONFIG, condicionVenta: 'Billetera virtual' })).toBe('Billetera virtual');
    expect(script.chooseOrTypeStep.mock.calls[0]?.[2].previous).toBe('Billetera virtual');
  });

  it('con una de la lista guardada arranca marcada: Enter la deja', async () => {
    expect(await saleConditionAfter('', { ...CONFIG, condicionVenta: 'cuenta-corriente' })).toBe('cuenta-corriente');
  });
});
