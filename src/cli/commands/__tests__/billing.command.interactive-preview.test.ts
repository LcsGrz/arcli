import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';
import { runInteractiveBillingPreview } from '../billing.command.interactive-preview';

vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

// La pregunta real, espiada: para ver con que Esc la arma el comando.
vi.mock('../../interactive/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../interactive/prompts')>();

  return { ...actual, chooseOne: vi.fn(actual.chooseOne) };
});

vi.mock('../../../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ui')>();

  return {
    ...actual,
    writeTerminalOutput: vi.fn(),
    // La linea "✔ pregunta respuesta" de la confirmacion: sin esto queda impresa en la salida de los tests.
    writeTerminalRaw: vi.fn(),
  };
});

import { writeTerminalOutput } from '../../../ui';
import { listSelect as select } from '../../interactive/list-select';
import { chooseOne } from '../../interactive/prompts';

function createRuntime(overrides: Partial<CliArcaRuntime> = {}): CliArcaRuntime {
  return {
    certificateNotices: [],
    config: {
      cert: {},
      emisor: {},
      entornoPorDefecto: 'testing',
      key: {},
      output: {
        emitirPorDefecto: false,
        brutoPorDefecto: false,
        jsonPorDefecto: false,
      },
      puntoVentaPorDefecto: 3,
    },
    context: {
      cert: 'CERT',
      cuit: 20123456786,
      key: 'KEY',
      production: false,
    },
    cuit: 20123456786,
    environment: 'testing',
    outputJson: false,
    outputRaw: false,
    pointOfSale: 3,
    ...overrides,
  };
}

function createInput(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    cancellation: false,
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: true,
    emit: false,
    exchangeRate: 1,
    ivaCondition: 'consumidor-final',
    sameCurrency: false,
    shortcut: 'fb',
    totalAmount: 1000,
    ...overrides,
  };
}

function previewsOf(inputs: readonly BillingCommandInput[]) {
  const service = new BillingService({ clock: systemClock });

  return inputs.map((input) => service.preview({ input, runtime: createRuntime() }));
}

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

function setTty(isTty: boolean): void {
  process.stdin.isTTY = isTty;
  process.stdout.isTTY = isTty;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.stdin.isTTY = originalStdinIsTty;
  process.stdout.isTTY = originalStdoutIsTty;
});

describe('runInteractiveBillingPreview', () => {
  it('does not prompt when the mode did not come from unqualified defaults', async () => {
    setTty(true);

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'file',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(outcome).toEqual({
      confirmedInteractively: false,
      inputs: [createInput()],
      previewShown: false,
      proceed: true,
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('does not prompt when json output was requested', async () => {
    setTty(true);

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime({ outputJson: true }),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(outcome.proceed).toBe(true);
    expect(outcome.previewShown).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('does not prompt when every input already opted into emission', async () => {
    setTty(true);

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput({ dryRun: false, emit: true })],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput({ dryRun: false, emit: true })]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(outcome.proceed).toBe(true);
    expect(outcome.previewShown).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('does not prompt outside of an interactive terminal', async () => {
    setTty(false);

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(outcome.proceed).toBe(true);
    expect(outcome.previewShown).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('shows a preview and switches inputs to real emission when the user confirms', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue('emitir');

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(writeTerminalOutput).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      confirmedInteractively: true,
      // "Sí, emitir ahora" también decide el PDF: después de emitir no se pregunta.
      inputs: [createInput({ dryRun: false, emit: true, pdf: false })],
      // Lo que se mostró, para emitirlo sin armarlo de nuevo (ARQ-21).
      previews: [expect.objectContaining({ dryRun: true, payload: expect.objectContaining({ CbteTipo: 6 }) })],
      previewShown: true,
      proceed: true,
    });
  });

  it('offers emitting with the PDF and, if chosen, generates it whatever the config says', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue('emitir-con-pdf');

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime({ config: { ...createRuntime().config, pdf: 'nunca' } }),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(vi.mocked(select).mock.lastCall?.[0]).toMatchObject({
      choices: [
        { name: 'Sí, emitir ahora', value: 'emitir' },
        { name: 'Sí, emitir y generar el PDF', value: 'emitir-con-pdf' },
        { name: 'No, dejar sin emitir', value: false },
      ],
      default: 'emitir',
    });
    expect(outcome.inputs).toEqual([createInput({ dryRun: false, emit: true, pdf: true })]);
  });

  it('starts on the PDF option with `pdf siempre`', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue('emitir');

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime({ config: { ...createRuntime().config, pdf: 'siempre' } }),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(vi.mocked(select).mock.lastCall?.[0]).toMatchObject({ default: 'emitir-con-pdf' });
    expect(outcome.inputs[0]?.pdf).toBe(false);
  });

  it('only asks to emit when a flag already decided the PDF, and keeps the flag', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue('emitir');

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput({ pdf: true })],
      modeSource: 'default',
      runtime: createRuntime({ config: { ...createRuntime().config, pdf: 'nunca' } }),
      previews: previewsOf([createInput({ pdf: true })]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(vi.mocked(select).mock.lastCall?.[0]).toMatchObject({
      choices: [
        { name: 'Sí, emitir ahora', value: 'emitir' },
        { name: 'No, dejar sin emitir', value: false },
      ],
    });
    expect(outcome.inputs[0]?.pdf).toBe(true);
  });

  it('keeps the original inputs and stops the flow when the user declines', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue(false);

    const outcome = await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(outcome).toEqual({
      confirmedInteractively: false,
      inputs: [createInput()],
      previewShown: true,
      proceed: false,
    });
    expect(vi.mocked(writeTerminalOutput).mock.lastCall?.[0]).toContain('No se emitió nada.');
  });

  it('names the environment in the question, also for a batch', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue('emitir');

    await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime({ environment: 'produccion' }),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'la factura A',
    });
    await runInteractiveBillingPreview({
      inputs: [createInput(), createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput(), createInput()]),
      useRaw: false,
      voucherLabel: 'este comprobante',
    });

    expect(vi.mocked(select).mock.calls.map(([config]) => config.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('¿Emitimos la factura A en PRODUCCIÓN?'),
        expect.stringContaining('¿Emitimos los 2 comprobantes en testing?'),
      ]),
    );
  });

  // En el asistente Esc vuelve a la ultima pregunta (TUI-15); con flags no hay a donde volver: Esc es no.
  it('arma "¿Emitimos?" con Esc como "no emitir", no como volver', async () => {
    setTty(true);
    vi.mocked(select).mockResolvedValue(false);

    await runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    expect(vi.mocked(chooseOne).mock.lastCall?.[3]).toEqual({ escapeLabel: 'no emitir', escapeValue: false });
  });

  it('treats Esc as declining: there is no question to go back to', async () => {
    setTty(true);
    vi.mocked(select).mockImplementationOnce(
      (_config, context) =>
        new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
          );
        }) as never,
    );

    const run = runInteractiveBillingPreview({
      inputs: [createInput()],
      modeSource: 'default',
      runtime: createRuntime(),
      previews: previewsOf([createInput()]),
      useRaw: false,
      voucherLabel: 'Factura A',
    });

    await vi.waitFor(() => expect(select).toHaveBeenCalled());
    process.stdin.emit('keypress', '', { name: 'escape' });

    expect(await run).toMatchObject({ confirmedInteractively: false, previewShown: true, proceed: false });
  });
});
