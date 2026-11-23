import { X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signRequestLikeArca } from '../../modules/certificates/__tests__/fake-arca-ca';
import { createProgram } from '../program';

import { PROFILE_CUIT } from './arca-profile.fixture';
import {
  AFTER_MIDNIGHT,
  answerAssociated,
  approveWsfe,
  BEFORE_MIDNIGHT,
  CLIENT_CUIT,
  CLOCK_CONFIG,
  sdk,
  setClock,
  useClockFixture,
  type WsfeRequest,
  wsfeRequests,
  wsfexRequests,
} from './clock.fixture';

/**
 * Caracterizacion del reloj en los comandos (REV-48, tanda 2): que dia es "hoy" a cada lado de la medianoche de
 * Argentina. Entra por el CLI entero y mira lo que recibe el SDK. El refactor saca el reloj del nucleo y estas
 * aserciones tienen que pasar sin cambios.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);

const profile = useClockFixture();

const CUIT = ['--cuit', String(CLIENT_CUIT), '--ir-ri'];
const FC = ['fc', '-m', '1000', '--cs', '--cfinal'];
const FC_GOODS = ['fc', '-m', '1000', '--cp', '--cfinal'];
const FCEA = ['fcea', '-m', '5000000', '--cs', ...CUIT, '--cbu', '0110599520000012345678'];
const FCEA_GOODS = ['fcea', '-m', '5000000', '--cp', ...CUIT, '--cbu', '0110599520000012345678'];
const NCC_PERIOD = ['ncc', '-m', '100', '--cs', '--cfinal', '--periodo-desde', '01/10/2026'];
const NOTE_OVER_INVOICE = ['-m', '100', '--cs', '--cfinal', '--ac', 'fc', '--apv', '3', '--ar', '12'];
const FE = [
  'fe',
  ...['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212', '-m', '1500'],
  ...['--item', '001|Consultoría|1|1500|unidad', '--moneda', 'PES'],
];
const FE_USD = FE.map((arg) => (arg === 'PES' ? 'USD' : arg));
const FE_LATE_PAYMENT = [...FE, '--fecha-pago', '30/11/2026'];
const NCE = ['nce', '-m', '500', '--ar', '1', '--apv', '3'];

/** Los dos lados de la medianoche, con el dia que es "hoy" en cada uno. */
const SIDES = [
  { instant: BEFORE_MIDNIGHT, today: '20261110', when: 'justo antes' },
  { instant: AFTER_MIDNIGHT, today: '20261111', when: 'justo despues' },
];

async function run(args: readonly string[]): Promise<void> {
  await createProgram().parseAsync(['node', 'arcli', ...args, '--json']);
}

const emit = (args: readonly string[]) => run([...args, '--emitir']);
const preview = (args: readonly string[]) => run([...args, '--previsualizar']);

const twoDigits = (value: number) => String(value).padStart(2, '0');
/** Un dia de noviembre de 2026 como se escribe en un flag, y como lo recibe ARCA. */
const november = (day: number) => `${twoDigits(day)}/11/2026`;
const arcaNovember = (day: number) => `202611${twoDigits(day)}`;

beforeEach(() => {
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
});

describe.each(SIDES)('$when de la medianoche: hoy es $today', ({ instant, today }) => {
  const day = Number(today.slice(6));

  beforeEach(() => setClock(instant));

  describe('fecha por defecto que recibe ARCA', () => {
    it.each([
      ['Factura A', ['fa', '-m', '12100', '--cs', ...CUIT]],
      ['Factura B', ['fb', '-m', '12100', '--cs', '--cfinal']],
      ['Factura C', FC],
      ['FCE A', FCEA],
      ['Recibo C', ['rc', '-m', '1000', '--cs', '--cfinal']],
      ['Nota de crédito C por período', [...NCC_PERIOD, '--periodo-hasta', '31/10/2026']],
      ['Nota de débito C', ['ndc', ...NOTE_OVER_INVOICE]],
    ])('%s: comprobante, servicio y vencimiento', async (_name, args) => {
      await emit(args);

      expect(wsfeRequests()).toEqual([
        expect.objectContaining({ CbteFch: today, FchServDesde: today, FchServHasta: today, FchVtoPago: today }),
      ]);
    });

    it('Nota de crédito FCE A: comprobante y servicio, sin vencimiento', async () => {
      answerAssociated({ DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5_000_000 });
      await emit(['ncea', '-m', '1000000', '--cs', ...CUIT, '--ac', 'fcea', '--apv', '3', '--ar', '12']);

      expect(wsfeRequests()).toEqual([
        expect.objectContaining({ CbteFch: today, FchServDesde: today, FchServHasta: today }),
      ]);
      expect(wsfeRequests()[0]?.FchVtoPago).toBeUndefined();
    });

    it('Factura E: comprobante y pago', async () => {
      await emit(FE);

      expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: today, Fecha_pago: today })]);
    });

    it('Nota de crédito E', async () => {
      await emit(NCE);

      expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: today })]);
    });
  });

  describe('ventana de la fecha del comprobante', () => {
    const firstServiceDay = day === 10 ? '31/10/2026' : '01/11/2026';
    const beforeFirstServiceDay = day === 10 ? '30/10/2026' : '31/10/2026';

    it.each([
      ['A, B y C de productos', FC_GOODS, november(day - 5), november(day - 6), november(day + 5), november(day + 6)],
      ['A, B y C de servicios', FC, firstServiceDay, beforeFirstServiceDay, november(day + 10), november(day + 11)],
      ['FCE', FCEA_GOODS, november(day - 5), november(day - 6), november(day + 1), november(day + 2)],
      ['Factura E', FE_LATE_PAYMENT, november(day - 5), november(day - 6), november(day + 5), november(day + 6)],
    ])('%s: del %3$s al %5$s, los dos inclusive', async (_name, args, first, beforeFirst, last, afterLast) => {
      for (const valid of [first, last]) {
        await expect(preview([...args, '--fecha', valid]), valid).resolves.toBeUndefined();
      }

      for (const invalid of [beforeFirst, afterLast]) {
        await expect(preview([...args, '--fecha', invalid]), invalid).rejects.toMatchObject({
          code: 'INPUT_VALIDATION_ERROR',
          message: expect.stringMatching(/fuera de/),
        });
      }
    });
  });

  it('período del asociado: puede terminar hoy, no mañana', async () => {
    await emit([...NCC_PERIOD, '--periodo-hasta', november(day)]);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ PeriodoAsoc: { FchDesde: '20261001', FchHasta: today } }),
    ]);
    await expect(emit([...NCC_PERIOD, '--periodo-hasta', november(day + 1)])).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringMatching(new RegExp(`no puede terminar después de la fecha de .*\\(${november(day)}\\)`)),
    });
    expect(wsfeRequests()).toHaveLength(1);
  });

  it('fecha del comprobante asociado: puede ser hoy, no mañana', async () => {
    answerAssociated({ CbteFch: today });
    await expect(preview(['ncc', ...NOTE_OVER_INVOICE, '--afecha', november(day)])).resolves.toBeUndefined();

    answerAssociated({ CbteFch: arcaNovember(day + 1) });
    await expect(preview(['ncc', ...NOTE_OVER_INVOICE, '--afecha', november(day + 1)])).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringMatching(/no puede ser posterior a la de/),
    });
  });

  it('FCE: el vencimiento de pago puede ser hoy, no ayer, aunque el comprobante sea anterior (10164)', async () => {
    const dated = [...FCEA, '--fecha', november(8)];

    await emit([...dated, '--vto', november(day)]);

    expect(wsfeRequests()).toEqual([expect.objectContaining({ CbteFch: '20261108', FchVtoPago: today })]);
    await expect(emit([...dated, '--vto', november(day - 1)])).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringMatching(/vencimiento/),
    });
    expect(wsfeRequests()).toHaveLength(1);
  });

  it('las fechas relativas y `--dia` se completan desde hoy', async () => {
    await emit([...FC, '--fecha=-1', '--vto', '+2']);
    await emit([...FC, '--dia', '10']);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbteFch: arcaNovember(day - 1), FchVtoPago: arcaNovember(day + 2) }),
      expect.objectContaining({ CbteFch: today, FchVtoPago: day === 10 ? '20261110' : '20261210' }),
    ]);
  });

  it('régimen FCE del receptor: se consulta con la fecha de hoy', async () => {
    profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, verificarFce: true }));
    await preview(['fa', '-m', '12100', '--cs', ...CUIT]);

    expect(sdk.wsfecred.consultarMontoObligadoRecepcion.mock.calls).toEqual([
      [expect.objectContaining({ fechaEmision: `2026-11-${day}` })],
    ]);
  });

  it('`--misma-moneda` con fecha del 10/11: cotización de hoy si es hoy; si ya pasó, la del día anterior (10038)', async () => {
    await preview([...FC, '--moneda', 'USD', '--misma-moneda', '--fecha', november(10)]);

    const dated = sdk.generic.call.mock.calls.filter(([, method]) => method === 'FEParamGetCotizacion');

    if (day === 10) {
      expect(dated).toEqual([]);
      expect(sdk.wsfe.getQuotation).toHaveBeenCalledTimes(1);
    } else {
      expect(dated).toEqual([['wsfe', 'FEParamGetCotizacion', { FchCotiz: '20261109', MonId: 'DOL' }]]);
      expect(sdk.wsfe.getQuotation).not.toHaveBeenCalled();
    }
  });

  it('`--misma-moneda` sin fecha: la cotización de hoy', async () => {
    await preview([...FC, '--moneda', 'USD', '--misma-moneda']);

    expect(sdk.wsfe.getQuotation).toHaveBeenCalledTimes(1);
    expect(sdk.generic.call).not.toHaveBeenCalled();
  });

  it('Factura E en dólares: pide la cotización del día anterior a hoy', async () => {
    await preview(FE_USD);

    expect(JSON.stringify(sdk.wsfex.getParamMonConCotizacion.mock.calls)).toContain(arcaNovember(day - 1));
  });
});

// El mas cercano a hoy: el 12/06/2027, `10/6` es de 2027; leido en noviembre de 2026 seria de 2026.
describe('fechas sin año: el más cercano a hoy', () => {
  beforeEach(() => setClock(new Date('2027-06-12T12:00:00-03:00')));

  it('fecha de A, B y C, y período del asociado', async () => {
    await emit([...FC, '--fecha', '10/6']);
    await emit(['ncc', '-m', '100', '--cs', '--cfinal', '--periodo-desde', '1/6', '--periodo-hasta', '10/6']);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbteFch: '20270610' }),
      expect.objectContaining({ PeriodoAsoc: { FchDesde: '20270601', FchHasta: '20270610' } }),
    ]);
  });

  it('fecha del comprobante asociado', async () => {
    answerAssociated({ CbteFch: '20270610' });
    await emit(['ncc', ...NOTE_OVER_INVOICE, '--afecha', '10/6']);

    expect(wsfeRequests()).toEqual([
      expect.objectContaining({ CbtesAsoc: [expect.objectContaining({ CbteFch: '20270610' })] }),
    ]);
  });

  it('período y fecha del asociado de mañana: se rechazan', async () => {
    await expect(
      emit(['ncc', '-m', '100', '--cs', '--cfinal', '--periodo-desde', '1/6', '--periodo-hasta', '13/6']),
    ).rejects.toMatchObject({ message: expect.stringMatching(/no puede terminar después de la fecha/) });

    answerAssociated({ CbteFch: '20270613' });
    await expect(emit(['ncc', ...NOTE_OVER_INVOICE, '--afecha', '13/6'])).rejects.toMatchObject({
      message: expect.stringMatching(/no puede ser posterior a la de/),
    });
    expect(wsfeRequests()).toEqual([]);
  });

  it('fechas de la E', async () => {
    await emit([...FE, '--fecha', '10/6', '--fecha-pago', '11/6']);

    expect(wsfexRequests()).toEqual([expect.objectContaining({ Fecha_cbte: '20270610', Fecha_pago: '20270611' })]);
  });
});

describe('lote que cruza la medianoche', () => {
  const item = (extra: Record<string, unknown> = {}) => ({
    concepto: 'servicios',
    emitir: true,
    ivaReceptor: 'consumidor-final',
    montoTotal: 1000,
    tipoDocumento: 'consumidor-final',
    ...extra,
  });

  function writeBatch(...items: unknown[]): string {
    const path = join(profile.configDirectory, 'lote.json');

    writeFileSync(path, JSON.stringify(items), 'utf8');

    return path;
  }

  beforeEach(() => {
    setClock(BEFORE_MIDNIGHT);
    // La medianoche llega mientras ARCA autoriza el primero.
    sdk.wsfe.createVoucher.mockImplementationOnce(async (request: WsfeRequest) => {
      setClock(AFTER_MIDNIGHT);

      return approveWsfe(request);
    });
  });

  it('cada comprobante lleva la fecha del momento en que se procesa', async () => {
    await run(['fc', '--cargar', writeBatch(item(), item(), item())]);

    expect(wsfeRequests().map(({ CbteFch, FchServDesde, FchVtoPago }) => [CbteFch, FchServDesde, FchVtoPago])).toEqual([
      ['20261110', '20261110', '20261110'],
      ['20261111', '20261111', '20261111'],
      ['20261111', '20261111', '20261111'],
    ]);
  });

  it('se valida de nuevo al procesarlo: una fecha que salió de la ventana corta el lote', async () => {
    await expect(
      run(['fc', '--cargar', writeBatch(item(), item({ fechaComprobante: '31/10/2026' }))]),
    ).rejects.toMatchObject({ code: 'BATCH_EMISSION_ERROR' });

    expect(wsfeRequests()).toHaveLength(1);
  });
});

describe('certificado importar', () => {
  const EXPIRES_AT = new Date('2026-12-01T12:00:00Z');

  /** Un certificado del CUIT de prueba, sobre el pedido recien generado, que vence en `EXPIRES_AT`. */
  async function writeCertificate(): Promise<string> {
    setClock(BEFORE_MIDNIGHT);
    profile.writeConfig({ ...CLOCK_CONFIG, cuit: PROFILE_CUIT });
    await run(['certificado', 'generar', '--testing']);

    const { csr } = JSON.parse(profile.stdout) as { csr: string };
    const path = join(profile.configDirectory, 'nuevo.crt');

    writeFileSync(path, signRequestLikeArca(csr, { notAfter: EXPIRES_AT }), 'utf8');

    return path;
  }

  it('un segundo antes de vencer se importa; en el instante en que vence, no', async () => {
    const path = await writeCertificate();

    setClock(EXPIRES_AT);
    await expect(run(['certificado', 'importar', path])).rejects.toMatchObject({ code: 'CERTIFICATE_EXPIRED' });

    setClock(new Date(EXPIRES_AT.getTime() - 1000));
    await expect(run(['certificado', 'importar', path])).resolves.toBeUndefined();
  });
});

describe('config revisar', () => {
  it.each([
    ['un segundo antes de vencer', -1000, false],
    ['un segundo después', 1000, true],
  ])('%s el certificado', async (_name, offset, expired) => {
    const expiresAt = new Date(new X509Certificate(profile.expiring.pem).validTo).getTime();

    profile.writeConfig(profile.configWith(profile.expiring, CLOCK_CONFIG));
    setClock(new Date(expiresAt + offset));
    await run(['config', 'revisar']);

    expect(profile.stdout.includes('venció')).toBe(expired);
  });
});
