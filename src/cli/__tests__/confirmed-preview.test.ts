import { Separator } from '@inquirer/core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../modules/billing/voucher-kind-map';
import { PdfPlugin } from '../../services/pdf/pdf-plugin';
import { stripAnsi } from '../../ui';
import { EMIT_NOW_LABEL } from '../interactive/emission-prompt';
import { listSelect } from '../interactive/list-select';
import { createProgram } from '../program';

import {
  AFTER_MIDNIGHT,
  answerAssociated,
  approveWsfe,
  BEFORE_MIDNIGHT,
  CLIENT_CUIT,
  CLOCK_CONFIG,
  rejectWsfe,
  sdk,
  setClock,
  useClockFixture,
  wsfeRequests,
} from './clock.fixture';
import { argsForKind } from './voucher-args.fixture';

/**
 * ARQ-21: con la terminal, al confirmar se emite la solicitud que mostró la vista previa más el número, aunque la
 * medianoche de Argentina pase en "¿Emitimos?". Entra por el CLI entero y mira lo que recibe el SDK. La solicitud de
 * la vista previa es la `solicitud` de `--previsualizar --json` antes de la medianoche. El asistente, en
 * `clock.session.characterization.test.ts`.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../spinner', () => ({
  startSpinner: () => null,
  withSpinner: (_text: unknown, run: () => unknown) => run(),
}));
vi.mock('../interactive/list-select', () => ({ listSelect: vi.fn() }));

const profile = useClockFixture();
const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;

const CUIT = ['--cuit', String(CLIENT_CUIT), '--ir-ri'];
const FC = ['fc', '-m', '1000', '--cs', '--cfinal'];
const FCEA = ['fcea', '-m', '5000000', '--cs', ...CUIT, '--cbu', '0110599520000012345678'];
const NCC = ['ncc', '-m', '100', '--cs', '--cfinal'];

/** Config con los datos del emisor y el plugin de PDF falso: devuelve lo que recibe la plantilla. */
function fakePdf() {
  const render = vi.fn(async (_data: unknown) => new Uint8Array());

  vi.spyOn(PdfPlugin.prototype, 'getStatus').mockReturnValue({ installed: true } as never);
  vi.spyOn(PdfPlugin.prototype, 'load').mockReturnValue({ render } as never);
  profile.writeConfig(
    profile.configWith(profile.healthy, {
      ...CLOCK_CONFIG,
      emisor: { domicilio: 'Calle 1', inicioActividades: '20200301', razonSocial: 'Yo' },
      pdfCarpeta: profile.temporaryDirectory('arcli-pdf-'),
    }),
  );
  answerAfterMidnight('Sí, emitir y generar el PDF');

  return render;
}

function setTty(stdin: boolean, stdout: boolean): void {
  process.stdin.isTTY = stdin;
  process.stdout.isTTY = stdout;
}

/** Responde "¿Emitimos?" con `label`, después de que pasa la medianoche. */
function answerAfterMidnight(label: string = EMIT_NOW_LABEL): void {
  vi.mocked(listSelect).mockImplementation(async ({ choices, message }) => {
    expect(message).toMatch(/Emitimos/);
    setClock(AFTER_MIDNIGHT);

    const choice = choices.find(
      (item): item is { name: string; value: unknown } => !Separator.isSeparator(item) && item.name === label,
    );

    return choice?.value as never;
  });
}

async function run(...args: readonly string[]): Promise<void> {
  await createProgram().parseAsync(['node', 'arcli', ...args]);
}

/** En una terminal: vista previa, la medianoche en "¿Emitimos?" y confirmar. */
async function confirmAfterMidnight(args: readonly string[]): Promise<void> {
  setTty(true, true);
  setClock(BEFORE_MIDNIGHT);
  await run(...args);

  expect(listSelect).toHaveBeenCalledTimes(1);
}

type Request = Record<string, unknown>;

/** Las `solicitud` de la vista previa, sin terminal y antes de la medianoche. */
async function previewedRequests(args: readonly string[]): Promise<Request[]> {
  const start = profile.stdout.length;

  setTty(false, false);
  setClock(BEFORE_MIDNIGHT);
  await run(...args, '--previsualizar', '--json');

  const output = JSON.parse(profile.stdout.slice(start)) as { solicitud: Request } | Array<{ solicitud: Request }>;

  return [output].flat().map(({ solicitud }) => solicitud);
}

/** Lo que recibió el SDK, sin los `undefined`, como la `solicitud` del JSON. */
const sentRequests = () => JSON.parse(JSON.stringify(wsfeRequests())) as Request[];

const numbered = (request: Request, number = 42): Request => ({ ...request, CbteDesde: number, CbteHasta: number });

function writeBatch(...items: unknown[]): string {
  const path = join(profile.configDirectory, 'lote.json');

  writeFileSync(path, JSON.stringify(items), 'utf8');

  return path;
}

const item = (extra: Record<string, unknown> = {}) => ({
  concepto: 'servicios',
  ivaReceptor: 'consumidor-final',
  montoTotal: 1000,
  tipoDocumento: 'consumidor-final',
  ...extra,
});

beforeEach(() => {
  vi.mocked(listSelect).mockReset();
  answerAfterMidnight();
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
});

afterEach(() => {
  setTty(...originalTty);
});

describe('un comprobante confirmado pasada la medianoche', () => {
  const otherSystem = () => {
    sdk.wsfe.getSalesPoints.mockResolvedValue({
      resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
    });
    answerAssociated({}, { missing: 15 });
  };

  it.each(Object.values(VOUCHER_KIND_MAP))(
    '$shortcut: el SDK recibe la solicitud de la vista previa más el número',
    async (kind) => {
      const { isElectronicCredit } = kind;

      answerAssociated({
        ...(isElectronicCredit || kind.letter === 'a' ? { DocNro: CLIENT_CUIT, DocTipo: 80 } : {}),
        ImpTotal: 5_000_000,
      });

      const args = argsForKind(kind, CLIENT_CUIT);
      const [previewed] = await previewedRequests(args);

      expect(previewed).toMatchObject({ CbteFch: '20261110', CbteTipo: kind.arcaType });
      await confirmAfterMidnight(args);

      expect(sentRequests()).toEqual([numbered(previewed)]);
    },
  );

  it.each<[string, readonly string[], (() => void)?]>([
    ['Factura C de productos', ['fc', '-m', '1000', '--cp', '--cfinal']],
    ['Factura C con fechas relativas', [...FC, '--sd', 'ayer', '--sh', 'hoy', '--vto', '+2']],
    ['FCE A que vence el día de la vista previa', [...FCEA, '--fecha', '08/11/2026', '--vto', '10/11/2026']],
    ['Nota de crédito C por período', [...NCC, '--pd', '01/11/2026', '--ph', 'hoy']],
    [
      'Nota de crédito C sobre otro sistema',
      [...NCC, '--ac', 'fc', '--apv', '50', '--ar', '15', '--afecha', '10/11/2026'],
      otherSystem,
    ],
    ['en dólares, cotización oficial', [...FC, '--moneda', 'USD']],
    ['en dólares, con `--misma-moneda`', [...FC, '--moneda', 'USD', '--misma-moneda']],
    ['en dólares, con `--misma-moneda` y fecha', [...FC, '--moneda', 'USD', '--misma-moneda', '--fecha', '10/11/2026']],
  ])('%s: el SDK recibe la solicitud de la vista previa más el número', async (_name, args, prepare) => {
    prepare?.();

    const [previewed] = await previewedRequests(args);

    await confirmAfterMidnight(args);

    expect(sentRequests()).toEqual([numbered(previewed)]);
    expect(JSON.stringify(sentRequests())).not.toContain('20261111');
  });

  it('el texto y el PDF dicen la fecha de la vista previa', async () => {
    const render = fakePdf();

    await confirmAfterMidnight([...FC, '--bruto']);

    expect(stripAnsi(profile.stdout)).toMatch(/Fecha del comprobante\s+10\/11\/2026/);
    expect(profile.stdout).not.toMatch(/11\/11\/2026|20261111/);
    expect(render.mock.calls[0]?.[0]).toMatchObject({ cbteFecha: '20261110' });
    expect(JSON.stringify(render.mock.calls[0]?.[0])).not.toContain('20261111');
  });

  it('si ARCA ya no acepta la fecha, sale su rechazo con exit code 2: ni se recalcula ni se reintenta', async () => {
    sdk.wsfe.createVoucher.mockImplementation(rejectWsfe);
    // El 11/11 la ventana de servicios empieza el 01/11.
    await confirmAfterMidnight([...FC, '--fecha', '31/10/2026']);

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261031' })]);
    expect(stripAnsi(profile.stdout)).toMatch(/RECHAZADO[^]*Fecha fuera de rango/);
    expect(process.exitCode).toBe(2);
  });

  it('con "No, dejar sin emitir" no se emite', async () => {
    answerAfterMidnight('No, dejar sin emitir');
    await confirmAfterMidnight(FC);

    expect(wsfeRequests()).toEqual([]);
  });
});

describe('un lote confirmado pasada la medianoche', () => {
  it('cada comprobante sale con lo que mostró, en su orden', async () => {
    const args = [
      'fc',
      '--cargar',
      writeBatch(
        item({ montoTotal: 1000 }),
        item({ fechaComprobante: 'ayer', montoTotal: 2000, vencimientoPago: '+5' }),
        item({ montoTotal: 3000, servicioDesde: '01/11/2026', servicioHasta: 'hoy' }),
      ),
    ];
    const previewed = await previewedRequests(args);

    expect(previewed.map(({ ImpTotal }) => ImpTotal)).toEqual([1000, 2000, 3000]);
    await confirmAfterMidnight(args);

    expect(sentRequests()).toEqual(previewed.map((request) => numbered(request)));
  });

  it('con "Sí, emitir y generar el PDF": cada PDF y el texto dicen lo que se emitió', async () => {
    const render = fakePdf();

    sdk.wsfe.getLastVoucher.mockResolvedValueOnce({ cbteNro: 41 }).mockResolvedValueOnce({ cbteNro: 42 });
    await confirmAfterMidnight([
      'fc',
      '--cargar',
      writeBatch(
        item({ montoTotal: 1000 }),
        item({
          fechaComprobante: 'ayer',
          montoTotal: 2000,
          servicioDesde: '01/11/2026',
          servicioHasta: 'hoy',
          vencimientoPago: '+5',
        }),
      ),
    ]);

    const requests = sentRequests();

    expect(requests).toMatchObject([
      { CbteDesde: 42, CbteFch: '20261110', FchServDesde: '20261110', FchVtoPago: '20261110', ImpTotal: 1000 },
      { CbteDesde: 43, CbteFch: '20261109', FchServDesde: '20261101', FchVtoPago: '20261115', ImpTotal: 2000 },
    ]);
    expect(render.mock.calls.map(([data]) => data)).toMatchObject(
      requests.map((request) => ({
        cbteDesde: request.CbteDesde,
        cbteFecha: request.CbteFch,
        fechaServicioDesde: request.FchServDesde,
        fechaServicioHasta: request.FchServHasta,
        fechaVtoPago: request.FchVtoPago,
        importeTotal: request.ImpTotal,
      })),
    );

    // El de cada vista previa y después el de cada emitido.
    const [, first, second, firstEmitted, secondEmitted] = stripAnsi(profile.stdout).split(/Lote [12]\/2\n/);

    expect(first).toMatch(/Fecha del comprobante\s+10\/11\/2026[^]*\$ 1\.000[^]*Vencimiento del pago\s+10\/11\/2026/);
    expect(second).toMatch(/Fecha del comprobante\s+09\/11\/2026[^]*\$ 2\.000[^]*Vencimiento del pago\s+15\/11\/2026/);
    expect(firstEmitted).toMatch(/00003-00000042[^]*\$ 1\.000/);
    expect(secondEmitted).toMatch(/00003-00000043[^]*\$ 2\.000/);
    expect(stripAnsi(profile.stdout)).not.toMatch(/11\/11\/2026/);
  });

  it('notas FCE sin la fecha del asociado: cada una con la del suyo', async () => {
    answerAssociated(
      { DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5_000_000 },
      { byNumber: { 12: { CbteFch: '20261101' }, 13: { CbteFch: '20261105' } } },
    );

    const note = (numero: number) => ({
      comprobanteAsociado: { atajo: 'fcea', numero, puntoVenta: 3 },
      concepto: 'servicios',
      ivaReceptor: 'responsable-inscripto',
      montoTotal: 12100,
      numeroDocumento: CLIENT_CUIT,
      tipoDocumento: 'cuit',
    });
    const args = ['ncea', '--cargar', writeBatch(note(12), note(13))];
    const previewed = await previewedRequests(args);

    await confirmAfterMidnight(args);

    expect(sentRequests()).toEqual(previewed.map((request) => numbered(request)));
    expect(sentRequests()).toMatchObject([
      { CbteFch: '20261110', CbtesAsoc: [{ CbteFch: '20261101', Nro: 12 }] },
      { CbteFch: '20261110', CbtesAsoc: [{ CbteFch: '20261105', Nro: 13 }] },
    ]);
  });

  it('una fecha que salió de la ventana no corta el lote: decide ARCA', async () => {
    sdk.wsfe.createVoucher.mockImplementationOnce(approveWsfe).mockImplementationOnce(rejectWsfe);
    await confirmAfterMidnight([
      'fc',
      '--cargar',
      writeBatch(item(), item({ fechaComprobante: '31/10/2026' }), item({ montoTotal: 3000 })),
    ]);

    expect(wsfeRequests().map(({ CbteFch }) => CbteFch)).toEqual(['20261110', '20261031', '20261110']);
    expect(process.exitCode).toBe(2);
  });
});

it('sin pregunta (`--emitir`), en la terminal, cada comprobante se arma al emitir', async () => {
  setTty(true, true);
  setClock(BEFORE_MIDNIGHT);
  sdk.wsfe.createVoucher.mockImplementationOnce(async (request: never) => {
    setClock(AFTER_MIDNIGHT);

    return approveWsfe(request);
  });
  await run('fc', '--cargar', writeBatch(item(), item()), '--emitir');

  expect(listSelect).not.toHaveBeenCalled();
  expect(wsfeRequests().map(({ CbteFch }) => CbteFch)).toEqual(['20261110', '20261111']);
});
