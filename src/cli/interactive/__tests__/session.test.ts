import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { BACK } from '../../../modules/interactive/wizard';
import { ArcaFceObligationGateway } from '../../../services/arca/arca-fce-obligation.gateway';
import { systemClock } from '../../../services/time/system-clock';
import { billingAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway } from '../../../testing/arca-gateways';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { outputState } from '../../closed-output';
import { describeEmittedInThisRun, resetEmittedInThisRun } from '../../emitted-vouchers';
import { withOutputGuard } from '../output-guard';
import { offerPdf } from '../pdf.flow';
import { askTextStep, chooseOne, confirm } from '../prompts';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from '../session';

// El comando equivalente sale con las comillas de la shell del SO: POSIX fijo para que el CI en Windows espere lo mismo.
vi.mock('../../../lib/shell/shell-argument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shell/shell-argument')>();

  return { ...actual, formatShellCommand: (args: readonly string[]) => actual.formatShellCommand(args, 'linux') };
});

vi.mock('../prompts', () => ({ askTextStep: vi.fn(), chooseOne: vi.fn(), confirm: vi.fn() }));
vi.mock('../pdf.flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf.flow')>()),
  offerPdf: vi.fn(async () => undefined),
}));

const confirmMock = vi.mocked(confirm);
const chooseOneMock = vi.mocked(chooseOne);
const askTextStepMock = vi.mocked(askTextStep);

function createSession(
  environment: 'produccion' | 'testing',
  pointOfSale: number | null = 3,
  pdf?: 'nunca' | 'preguntar' | 'siempre',
): InteractiveSession & {
  readonly createVoucher: ReturnType<typeof vi.fn>;
} {
  const createVoucher = vi.fn(async () => billingAnswer({ cae: '86400940834693', response: {} }));
  const runtime = {
    config: { cert: {}, entornoPorDefecto: environment, key: {}, output: {}, pdf },
    context: { cuit: 20333333334 },
    cuit: 20333333334,
    environment,
    outputJson: false,
    outputRaw: false,
    pointOfSale: pointOfSale ?? undefined,
  } as unknown as CliArcaRuntime;

  return {
    arca: {} as never,
    billingGateway: fakeBillingGateway({ createVoucher, getNextVoucherNumber: vi.fn(async () => 1) }),
    createVoucher,
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime,
    service: new BillingService({ clock: systemClock }),
  };
}

/** `DD/MM/YYYY` en Argentina, de hoy en adelante. */
const argentineDay = (offset: number) =>
  new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
  }).format(Date.now() + offset * 24 * 60 * 60 * 1000);

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
    resetEmittedInThisRun();
    vi.restoreAllMocks();
    confirmMock.mockReset();
    askTextStepMock.mockReset();
    chooseOneMock.mockReset();
    vi.mocked(offerPdf).mockClear();
  });

  it('no emite si el usuario cancela', async () => {
    const session = createSession('testing');

    chooseOneMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(session.createVoucher).not.toHaveBeenCalled();
    expect(offerPdf).not.toHaveBeenCalled();
  });

  it('avisa la fecha futura, una sola vez y como el comando (10016, ARQ-22)', async () => {
    const tomorrow = argentineDay(1);

    chooseOneMock.mockResolvedValueOnce(false);
    await previewAndEmit(
      createSession('testing'),
      {
        ...input,
        associatedVoucher: { fecha: argentineDay(0), numero: 15, puntoVenta: 50, shortcut: 'fc' },
        billingDate: tomorrow,
        shortcut: 'ncc',
      },
      { arcaType: 11, number: 15, origin: 'other', pointOfSale: 50 },
    );

    const output = stripAnsi(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join(''),
    );

    // Como en el comando: primero el asociado.
    expect(output.indexOf('No se encontró la factura C')).toBeGreaterThan(-1);
    expect(output.indexOf('No se encontró la factura C')).toBeLessThan(output.indexOf('es futura'));
    expect(output.match(/error\s+[^\d]*10016/g)).toHaveLength(1);
  });

  it('la vista previa no emite aunque los datos traigan emit true, y si cancela no emite (TEST-15)', async () => {
    const session = createSession('testing');

    chooseOneMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, { ...input, dryRun: false, emit: true });

    expect(chooseOneMock).toHaveBeenCalledTimes(1);
    expect(session.createVoucher).not.toHaveBeenCalled();
  });

  // #11 y #16: lo escrito a mano se ofrece guardar solo si ARCA autorizo el comprobante.
  it('devuelve si ARCA lo autorizo: aprobado con CAE si, rechazado no, sin emitir no', async () => {
    const session = createSession('testing');

    chooseOneMock.mockResolvedValue('emitir');
    session.createVoucher.mockImplementationOnce(async () =>
      billingAnswer({
        cae: '86400940834693',
        caeFchVto: '20261130',
        response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } },
      }),
    );
    await expect(previewAndEmit(session, input)).resolves.toBe(true);
    // Si despues no se puede escribir la salida, el aviso dice que se emitio (ERR-18).
    expect(describeEmittedInThisRun()).toEqual([expect.stringContaining('fc del punto de venta 3, 1.')]);

    session.createVoucher.mockImplementationOnce(async () =>
      billingAnswer({
        cae: '',
        caeFchVto: '',
        response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] } },
      }),
    );
    await expect(previewAndEmit(session, input)).resolves.toBe(false);

    chooseOneMock.mockResolvedValue(false);
    await expect(previewAndEmit(session, input)).resolves.toBe(false);
    expect(describeEmittedInThisRun()).toEqual([expect.stringContaining('fc del punto de venta 3, 1.')]);
  });

  it('con stdout roto después de "¿Emitimos?" no emite (ERR-18)', async () => {
    const session = createSession('testing');

    chooseOneMock.mockImplementationOnce(async () => {
      outputState.failures.set('stdout', new Error('write'));

      return 'emitir';
    });

    try {
      await expect(withOutputGuard(async () => void (await previewAndEmit(session, input)))).rejects.toThrow();
      expect(session.createVoucher).not.toHaveBeenCalled();
    } finally {
      outputState.failures.clear();
    }
  });

  it('emite en testing con una sola confirmacion', async () => {
    const session = createSession('testing');

    chooseOneMock.mockResolvedValueOnce('emitir');
    await previewAndEmit(session, input);

    expect(chooseOneMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(session.createVoucher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'preguntar', 'siempre', 'nunca'] as const)(
    'con `pdf %s` ofrece emitir, emitir con PDF y no emitir, con los mismos botones que el CLI',
    async (pdf) => {
      const session = createSession('testing', 3, pdf);

      chooseOneMock.mockResolvedValueOnce(false);
      await previewAndEmit(session, input);

      expect(chooseOneMock).toHaveBeenCalledWith(
        expect.stringContaining('Emitimos'),
        [
          { name: 'Sí, emitir ahora', value: 'emitir' },
          { name: 'Sí, emitir y generar el PDF', value: 'emitir-con-pdf' },
          { name: 'No, dejar sin emitir', value: false },
        ],
        pdf === 'siempre' ? 'emitir-con-pdf' : 'emitir',
        // Esc vuelve a la ultima pregunta del asistente (TUI-15); "No, dejar sin emitir" sigue siendo no.
        { escapeLabel: 'volver', escapeValue: BACK },
      );
    },
  );

  it('Esc en "¿Emitimos?" devuelve BACK sin emitir ni avisar que no se emitió nada (TUI-15)', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    chooseOneMock.mockResolvedValueOnce(BACK);
    write.mockClear();

    await expect(previewAndEmit(session, input)).resolves.toBe(BACK);
    expect(session.createVoucher).not.toHaveBeenCalled();
    expect(write.mock.calls.join('')).not.toContain('No se emitió nada');
  });

  it('emitir y generar el PDF lo genera aunque la config diga `nunca`', async () => {
    const session = createSession('testing', 3, 'nunca');

    chooseOneMock.mockResolvedValueOnce('emitir-con-pdf');
    await previewAndEmit(session, input);

    expect(session.createVoucher).toHaveBeenCalledTimes(1);
    expect(offerPdf).toHaveBeenCalledWith(
      expect.objectContaining({ pdf: 'nunca' }),
      expect.objectContaining({ pdf: true }),
      expect.anything(),
    );
  });

  it('emitir ahora no genera el PDF ni pregunta después, aunque la config diga `siempre`', async () => {
    const session = createSession('testing', 3, 'siempre');

    chooseOneMock.mockResolvedValueOnce('emitir');
    await previewAndEmit(session, input);

    expect(offerPdf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pdf: false }),
      expect.anything(),
    );
  });

  it('en produccion, emitir con PDF pide la segunda confirmacion y respeta el PDF', async () => {
    const declined = createSession('produccion', 3, 'nunca');

    chooseOneMock.mockResolvedValueOnce('emitir-con-pdf');
    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(declined, input);
    expect(declined.createVoucher).not.toHaveBeenCalled();
    expect(offerPdf).not.toHaveBeenCalled();

    const accepted = createSession('produccion', 3, 'nunca');

    chooseOneMock.mockResolvedValueOnce('emitir-con-pdf');
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

  it('en produccion pide una segunda confirmacion antes de emitir', async () => {
    const declined = createSession('produccion');

    chooseOneMock.mockResolvedValueOnce('emitir');
    confirmMock.mockResolvedValueOnce(false);
    await previewAndEmit(declined, input);
    expect(declined.createVoucher).not.toHaveBeenCalled();

    const accepted = createSession('produccion');

    chooseOneMock.mockResolvedValueOnce('emitir');
    confirmMock.mockResolvedValueOnce(true);
    await previewAndEmit(accepted, input);
    expect(accepted.createVoucher).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenLastCalledWith(
      expect.stringContaining('PRODUCCIÓN'),
      'Sí, emitir en producción',
      'No, dejar sin emitir',
    );
  });

  it('el comando equivalente lleva nombre y domicilio del padrón, porque con --ir el CLI no lo consulta', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    chooseOneMock.mockResolvedValueOnce(false);
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
      "--ir responsable-inscripto --receptor-nombre 'ACME SA' --receptor-domicilio 'Av. Siempre Viva 742'",
    );
  });

  it('un punto de venta escrito en el asistente va en la emisión y en el comando equivalente', async () => {
    askTextStepMock.mockResolvedValueOnce('7');

    const ready = await requirePointOfSale(createSession('testing', null));
    const write = vi.mocked(process.stdout.write);

    expect(ready?.pointOfSale).toBe(7);
    chooseOneMock.mockResolvedValueOnce('emitir');
    await previewAndEmit(ready!.session, input);

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('--consumidor-final --pv 7 --testing');
    expect((ready!.session as ReturnType<typeof createSession>).createVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ PtoVta: 7 }),
    );
  });

  it('muestra el comando equivalente antes de confirmar', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    chooseOneMock.mockResolvedValueOnce(false);
    await previewAndEmit(session, input);

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
      'arcli fc -m 1000 --cs --consumidor-final --testing --emitir',
    );
  });

  it('en dólares avisa la cotización oficial, igual que con flags', async () => {
    const session = createSession('testing');
    const write = vi.mocked(process.stdout.write);

    vi.mocked(session.billingGateway.getQuotation).mockResolvedValueOnce(1415.25);
    chooseOneMock.mockResolvedValueOnce(false);
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

describe('previewAndEmit: cancelar y ARCA que falla en cada momento', () => {
  const cancellation = () => Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' });

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    confirmMock.mockReset();
    chooseOneMock.mockReset();
    vi.mocked(offerPdf).mockClear();
  });

  it('Ctrl+C en "¿Emitimos?" no emite: el error llega al menú, que dice "No se emitió nada"', async () => {
    const session = createSession('testing');

    chooseOneMock.mockRejectedValueOnce(cancellation());

    await expect(previewAndEmit(session, input)).rejects.toMatchObject({ name: 'ExitPromptError' });
    expect(session.createVoucher).not.toHaveBeenCalled();
  });

  it('Ctrl+C en la segunda confirmación de producción tampoco emite', async () => {
    const session = createSession('produccion');

    chooseOneMock.mockResolvedValueOnce('emitir');
    confirmMock.mockRejectedValueOnce(cancellation());

    await expect(previewAndEmit(session, input)).rejects.toMatchObject({ name: 'ExitPromptError' });
    expect(session.createVoucher).not.toHaveBeenCalled();
  });

  it('si ARCA falla al emitir, el error llega al menú y no se ofrece el PDF', async () => {
    const session = createSession('testing', 3, 'siempre');

    session.createVoucher.mockRejectedValueOnce(new Error('ECONNRESET'));
    chooseOneMock.mockResolvedValueOnce('emitir-con-pdf');

    await expect(previewAndEmit(session, input)).rejects.toThrow('ECONNRESET');
    expect(offerPdf).not.toHaveBeenCalled();
  });

  it('si ARCA contesta algo que no se puede leer, el menú recibe "sin confirmar" y no se ofrece el PDF (ERR-16)', async () => {
    const session = createSession('testing');

    session.createVoucher.mockRejectedValueOnce(new TypeError('Cannot read properties of undefined'));
    chooseOneMock.mockResolvedValueOnce('emitir');

    await expect(previewAndEmit(session, input)).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      details: { causa: 'hubo un error inesperado al emitir (Cannot read properties of undefined)' },
      verifyCommand: 'arcli ultimos fc --pv 3 --testing',
    });
    expect(session.createVoucher).toHaveBeenCalledTimes(1);
    expect(offerPdf).not.toHaveBeenCalled();
  });

  it('si ARCA contesta vacío, el menú recibe "sin confirmar" y no se ofrece el PDF (ERR-20)', async () => {
    const session = createSession('testing');

    session.createVoucher.mockImplementationOnce(async () => billingAnswer({ cae: '', caeFchVto: '', response: {} }));
    chooseOneMock.mockResolvedValueOnce('emitir');

    await expect(previewAndEmit(session, input)).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      details: { causa: 'ARCA contestó sin CAE, sin resultado y sin errores' },
      verifyCommand: 'arcli ultimos fc --pv 3 --testing',
    });
    expect(session.createVoucher).toHaveBeenCalledTimes(1);
    expect(offerPdf).not.toHaveBeenCalled();
  });

  it('con CAE y un error: se muestra el CAE, se da por emitido y se ofrece el PDF (ERR-20)', async () => {
    const session = createSession('testing');

    session.createVoucher.mockImplementationOnce(async () =>
      billingAnswer({
        cae: '86400940834693',
        caeFchVto: '20261130',
        response: {
          Errors: { Err: [{ Code: 501, Msg: 'Error interno' }] },
          FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] },
        },
      }),
    );
    chooseOneMock.mockResolvedValueOnce('emitir');

    await expect(previewAndEmit(session, input)).resolves.toBe(true);

    const shown = vi.mocked(process.stdout.write).mock.calls.join('');

    expect(shown).toContain('86400940834693');
    expect(shown).toContain('OBSERVADO');
    expect(shown).toContain('501');
    expect(offerPdf).toHaveBeenCalledTimes(1);
  });

  it('un evento suelto no pierde el CAE: se muestra y se ofrece el PDF (ERR-16)', async () => {
    const session = createSession('testing');

    session.createVoucher.mockImplementationOnce(async () =>
      billingAnswer({
        cae: '86400940834693',
        caeFchVto: '20261130',
        response: { Events: { Evt: { Code: 1, Msg: 'x' } }, FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } },
      }),
    );
    chooseOneMock.mockResolvedValueOnce('emitir');

    await expect(previewAndEmit(session, input)).resolves.toBe(true);
    expect(vi.mocked(process.stdout.write).mock.calls.join('')).toContain('86400940834693');
    expect(offerPdf).toHaveBeenCalledTimes(1);
  });

  it('un CUIT inválido vuelve a la última pregunta sin consultar el padrón (ERR-11)', async () => {
    const getTaxpayerDetails = vi.fn();
    const session = {
      ...createSession('testing'),
      arca: { registerInscriptionProofService: { getTaxpayerDetails } } as never,
    };

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      previewAndEmit(session, {
        ...input,
        documentNumber: 20168598205,
        documentType: 'cuit',
        ivaConditionSource: 'missing',
      }),
    ).resolves.toBe(BACK);
    expect(getTaxpayerDetails).not.toHaveBeenCalled();
    expect(vi.mocked(process.stderr.write).mock.calls.join('')).toContain('20168598205 no es válido');
  });

  it('si ARCA falla al pedir la cotización oficial para la vista previa, no pregunta nada', async () => {
    const session = createSession('testing');

    vi.mocked(session.billingGateway.getQuotation).mockRejectedValueOnce(new Error('ARCA no responde'));

    await expect(previewAndEmit(session, { ...input, currencyCode: 'USD', sameCurrency: true })).rejects.toThrow(
      'ARCA no responde',
    );
    expect(chooseOneMock).not.toHaveBeenCalled();
    expect(session.createVoucher).not.toHaveBeenCalled();
  });

  it('un inválido falla antes de consultar el régimen FCE, y uno válido lleva sus avisos en orden', async () => {
    const session = createSession('testing');
    const runtime = { ...session.runtime, config: { ...session.runtime.config, verificarFce: true } };
    const entry = {
      ...input,
      documentNumber: 30709965812,
      documentType: 'cuit' as const,
      ivaCondition: 'responsable-inscripto' as const,
      shortcut: 'fa' as const,
      totalAmount: 5_000_000,
    };
    const getObligation = vi
      .spyOn(ArcaFceObligationGateway.prototype, 'getObligation')
      .mockResolvedValue({ minimumAmount: 1, obligated: true });
    const write = vi.mocked(process.stdout.write);

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(previewAndEmit({ ...session, runtime }, { ...entry, billingDate: '01/01/2020' })).resolves.toBe(BACK);
    expect(getObligation).not.toHaveBeenCalled();

    chooseOneMock.mockResolvedValueOnce(false);
    await previewAndEmit({ ...session, runtime }, { ...entry, billingDate: argentineDay(1) });

    const shown = write.mock.calls.map(([chunk]) => String(chunk)).join('');

    expect(getObligation).toHaveBeenCalledTimes(1);
    expect(shown.indexOf('es futura')).toBeGreaterThan(-1);
    expect(shown.indexOf('está obligado')).toBeGreaterThan(shown.indexOf('es futura'));
  });
});
