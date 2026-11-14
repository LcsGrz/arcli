import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { BACK } from '../../../modules/interactive/wizard';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { offerPdf } from '../pdf.flow';
import { askTextStep, chooseOne, confirm } from '../prompts';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from '../session';

vi.mock('../prompts', () => ({ askTextStep: vi.fn(), chooseOne: vi.fn(), confirm: vi.fn() }));
vi.mock('../pdf.flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf.flow')>()),
  offerPdf: vi.fn(async () => undefined),
}));

const confirmMock = vi.mocked(confirm);
const askTextStepMock = vi.mocked(askTextStep);

function createSession(
  environment: 'produccion' | 'testing',
  pointOfSale: number | null = 3,
  pdf?: 'nunca',
): InteractiveSession & {
  readonly createVoucher: ReturnType<typeof vi.fn>;
} {
  const createVoucher = vi.fn(async () => ({ response: {} }) as never);
  const runtime = {
    config: { cert: {}, entornoPorDefecto: environment, key: {}, output: {}, pdf },
    context: { cuit: 20333333334 },
    environment,
    outputJson: false,
    outputRaw: false,
    pointOfSale: pointOfSale ?? undefined,
  } as unknown as ResolvedArcaRuntime;

  return {
    arca: {} as never,
    billingGateway: { createVoucher, getNextVoucherNumber: vi.fn(async () => 1), getQuotation: vi.fn() },
    createVoucher,
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime,
    service: new BillingService(),
  };
}

const input = billingCommandSchema.parse({
  concept: 'servicios',
  ivaCondition: 'consumidor-final',
  shortcut: 'fc',
  totalAmount: 1000,
});

describe('previewAndEmit', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    confirmMock.mockReset();
    askTextStepMock.mockReset();
    vi.mocked(chooseOne).mockReset();
    vi.mocked(offerPdf).mockClear();
  });

  it('no emite si el usuario cancela', async () => {
    const session = createSession('testing');

    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(session.createVoucher).not.toHaveBeenCalled();
  });

  it('emite en testing con una sola confirmacion', async () => {
    const session = createSession('testing');

    confirmMock.mockResolvedValueOnce(true);
    await previewAndEmit(session, input);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(session.createVoucher).toHaveBeenCalledTimes(1);
  });

  it('con `pdf nunca` se puede emitir y generar el PDF desde la confirmacion', async () => {
    const session = createSession('testing', 3, 'nunca');

    vi.mocked(chooseOne).mockResolvedValueOnce('emitir-con-pdf');
    await previewAndEmit(session, input);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(session.createVoucher).toHaveBeenCalledTimes(1);
    expect(offerPdf).toHaveBeenCalledWith(
      expect.objectContaining({ pdf: 'nunca' }),
      expect.objectContaining({ pdf: true }),
      expect.anything(),
    );
  });

  it('con `pdf nunca` la opcion del PDF va entre emitir y no emitir, con los mismos botones', async () => {
    const session = createSession('testing', 3, 'nunca');

    vi.mocked(chooseOne).mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(session.createVoucher).not.toHaveBeenCalled();
    expect(chooseOne).toHaveBeenCalledWith(
      expect.stringContaining('Emitimos'),
      [
        expect.objectContaining({ name: 'Sí, emitir ahora', value: 'emitir' }),
        expect.objectContaining({ name: 'Sí, emitir y generar el PDF', value: 'emitir-con-pdf' }),
        expect.objectContaining({ name: 'No, dejar sin emitir', value: false }),
      ],
      undefined,
      { escapeValue: false },
    );
  });

  it('en produccion, emitir con PDF pide la segunda confirmacion y respeta el PDF', async () => {
    const declined = createSession('produccion', 3, 'nunca');

    vi.mocked(chooseOne).mockResolvedValueOnce('emitir-con-pdf');
    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(declined, input);
    expect(declined.createVoucher).not.toHaveBeenCalled();
    expect(offerPdf).not.toHaveBeenCalled();

    const accepted = createSession('produccion', 3, 'nunca');

    vi.mocked(chooseOne).mockResolvedValueOnce('emitir-con-pdf');
    confirmMock.mockResolvedValueOnce(true);
    await previewAndEmit(accepted, input);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('PRODUCCIÓN'),
      'Sí, emitir en producción',
      'No, dejar sin emitir',
    );
    expect(accepted.createVoucher).toHaveBeenCalledTimes(1);
    expect(offerPdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pdf: true }), expect.anything());
  });

  it('sin elegir el PDF, la config decide como siempre', async () => {
    const session = createSession('testing');

    confirmMock.mockResolvedValueOnce(true);
    await previewAndEmit(session, input);

    expect(offerPdf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pdf: undefined }),
      expect.anything(),
    );
  });

  it('en produccion pide una segunda confirmacion antes de emitir', async () => {
    const declined = createSession('produccion');

    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await previewAndEmit(declined, input);
    expect(declined.createVoucher).not.toHaveBeenCalled();

    const accepted = createSession('produccion');

    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await previewAndEmit(accepted, input);
    expect(accepted.createVoucher).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenLastCalledWith(
      expect.stringContaining('PRODUCCIÓN'),
      'Sí, emitir en producción',
      'No, dejar sin emitir',
    );
  });

  it('usa los mismos botones que la pregunta del CLI', async () => {
    const session = createSession('testing');

    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('Emitimos'),
      'Sí, emitir ahora',
      'No, dejar sin emitir',
    );
  });

  it('el comando equivalente lleva nombre y domicilio del padrón, porque con --ir el CLI no lo consulta', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, {
      ...input,
      documentNumber: 30709965812,
      documentType: 'cuit',
      ivaCondition: 'responsable-inscripto',
      ivaConditionSource: 'padron',
      receiverAddress: 'Av. Siempre Viva 742',
      receiverName: 'ACME SA',
    });

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
      '--ir responsable-inscripto --receptor-nombre "ACME SA" --receptor-domicilio "Av. Siempre Viva 742"',
    );
  });

  it('un punto de venta escrito en el asistente va en la emisión y en el comando equivalente', async () => {
    askTextStepMock.mockResolvedValueOnce('7');

    const ready = await requirePointOfSale(createSession('testing', null));
    const write = vi.mocked(process.stdout.write);

    expect(ready?.pointOfSale).toBe(7);
    confirmMock.mockResolvedValueOnce(true);
    await previewAndEmit(ready!.session, input);

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('--consumidor-final --pv 7 --testing');
    expect((ready!.session as ReturnType<typeof createSession>).createVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ PtoVta: 7 }),
    );
  });

  it('muestra el comando equivalente antes de confirmar', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
      'arcli fc -m 1000 --cs --consumidor-final --testing --emitir',
    );
  });

  it('en dólares avisa la cotización oficial, igual que con flags', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    vi.mocked(session.billingGateway.getQuotation).mockResolvedValueOnce(1415.25);
    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, { ...input, currencyCode: 'USD' });

    expect(session.billingGateway.getQuotation).toHaveBeenCalledWith('DOL');
    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('cotización oficial');
  });
});

describe('requirePointOfSale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    askTextStepMock.mockReset();
  });

  it('con punto de venta en la config no pregunta', async () => {
    const session = createSession('testing', 3);

    await expect(requirePointOfSale(session)).resolves.toEqual({ pointOfSale: 3, session });
    expect(askTextStepMock).not.toHaveBeenCalled();
  });

  it('sin punto de venta lo pide; Esc vuelve al menú', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    askTextStepMock.mockResolvedValueOnce(BACK);

    await expect(requirePointOfSale(createSession('testing', null))).resolves.toBeUndefined();
    expect(askTextStepMock).toHaveBeenCalledWith('Punto de venta:', expect.anything());
  });
});
