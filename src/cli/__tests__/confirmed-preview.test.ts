import { Separator } from '@inquirer/core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const fceAssociated = () => answerAssociated({ DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5_000_000 });
  const otherSystem = () => {
    sdk.wsfe.getSalesPoints.mockResolvedValue({
      resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
    });
    answerAssociated({}, { missing: 15 });
  };

  it.each<[string, readonly string[], (() => void)?]>([
    ['Factura A', ['fa', '-m', '12100', '--cs', ...CUIT]],
    ['Factura B', ['fb', '-m', '12100', '--cs', '--cfinal']],
    ['Factura C', FC],
    ['Factura C de productos', ['fc', '-m', '1000', '--cp', '--cfinal']],
    ['Factura C con fechas relativas', [...FC, '--sd', 'ayer', '--sh', 'hoy', '--vto', '+2']],
    ['FCE A', FCEA],
    ['FCE A que vence el día de la vista previa', [...FCEA, '--fecha', '08/11/2026', '--vto', '10/11/2026']],
    ['Recibo A', ['ra', '-m', '12100', '--cs', ...CUIT]],
    ['Recibo C', ['rc', '-m', '1000', '--cs', '--cfinal']],
    ['Nota de crédito C por período', [...NCC, '--pd', '01/11/2026', '--ph', 'hoy']],
    ['Nota de débito C', ['ndc', ...NCC.slice(1), '--ac', 'fc', '--apv', '3', '--ar', '12']],
    [
      'Nota de crédito C sobre otro sistema',
      [...NCC, '--ac', 'fc', '--apv', '50', '--ar', '15', '--afecha', '10/11/2026'],
      otherSystem,
    ],
    [
      'Nota de crédito FCE A',
      ['ncea', '-m', '1000000', '--cs', ...CUIT, '--ac', 'fcea', '--apv', '3', '--ar', '12'],
      fceAssociated,
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
