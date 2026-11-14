import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { offerPdf } from '../pdf.flow';
import { chooseOne, confirm } from '../prompts';
import { type InteractiveSession, previewAndEmit } from '../session';

vi.mock('../prompts', () => ({ chooseOne: vi.fn(), confirm: vi.fn() }));
vi.mock('../pdf.flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf.flow')>()),
  offerPdf: vi.fn(async () => undefined),
}));

const confirmMock = vi.mocked(confirm);

function createSession(
  environment: 'produccion' | 'testing',
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
    pointOfSale: 3,
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
    const session = createSession('testing', 'nunca');

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
    expect(confirmMock).toHaveBeenLastCalledWith(expect.stringContaining('PRODUCCIÓN'), 'Sí, emitir en producción');
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
