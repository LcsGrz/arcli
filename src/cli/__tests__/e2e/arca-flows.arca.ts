import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToArcaDate, formatDateAsArcaDate, maxArcaDate } from '../../../lib/dates/arca-date';
import { ArcaBillingGateway } from '../../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../../services/arca/arca-client.factory';
import { ArcaContextResolver } from '../../../services/arca/arca-context.resolver';
import type { Arca } from '../../../services/arca/arca-sdk.types';

import { assertArcaTestingReady } from './arca-guard';

/**
 * Flujos completos contra ARCA testing (TEST-11): emiten de verdad con el `arcli` compilado y después leen de ARCA lo
 * que quedó (`consultar`, `ultimos` y, para lo que `consultar` no muestra, `FECompConsultar` crudo) para comparar
 * importes, tipo, asociados, moneda y cotización con lo pedido. Cada corrida emite comprobantes nuevos y toma los números
 * de lo que devuelve ARCA, así que se puede repetir.
 *
 * Solo testing y solo local: el test se niega en el CI y si la config o el contexto no dan `testing`, y cada llamada
 * va con `--testing`. Los comprobantes de testing no tienen validez fiscal.
 *
 * `ARCLI_ARCA_PV` (facturas, notas, FCE y recibos de WSFE) y `ARCLI_ARCA_PV_E` (la E) eligen los puntos de venta: sin
 * la variable, los flujos de ese servicio se saltean, para no emitir en el punto de venta de la config sin querer.
 */
const CLI = resolve('dist/cli/index.js');

/** CUITs de prueba de ARCA testing: un responsable inscripto y uno que recibe FCE (los de `arca-rules.arca.ts`). */
const RECEIVER_CUIT = '30546689979';
const FCE_RECEIVER_CUIT = '30500010912';
const CBU = '0110599520000012345678';

const POINT_OF_SALE = process.env.ARCLI_ARCA_PV?.trim();
const EXPORT_POINT_OF_SALE = process.env.ARCLI_ARCA_PV_E?.trim();

/** Tipos de ARCA de cada atajo que usan estos flujos. */
const ARCA_TYPE = {
  fa: 1,
  fb: 6,
  fc: 11,
  fcea: 201,
  nca: 3,
  ncb: 8,
  ncea: 203,
  nda: 2,
  ndea: 202,
  ra: 4,
  rb: 9,
  rc: 15,
} as const;

type Json = Record<string, unknown>;

interface CliResult {
  readonly code: number | null;
  readonly json: Json;
  readonly stderr: string;
}

interface Amounts {
  readonly exento: number;
  readonly iva: number;
  readonly neto: number;
  readonly noGravado: number;
  readonly total: number;
}

/** Lo que devuelve `consultar` de un comprobante de WSFE. */
interface WsfeVoucher {
  readonly cae: string;
  readonly cotizacion: number;
  readonly fecha: string;
  readonly importes: Amounts;
  readonly moneda: string;
  readonly numero: number;
  readonly numeroDocumento: number;
  readonly resultado: string;
  readonly tipoArca: number;
}

/** Lo que devuelve `consultar` de una E. */
interface ExportVoucher {
  readonly cae: string;
  readonly cliente: string;
  readonly comprobanteAsociado: { atajo: string; numero: number; puntoVenta: number; tipoArca: number } | null;
  readonly cotizacion: number;
  readonly destino: { codigo: number };
  readonly fecha: string;
  readonly moneda: string;
  readonly numero: number;
  readonly resultado: string;
  readonly tipoArca: number;
  readonly tipoExpo: number;
  readonly total: number;
}

/** Lo emitido en la corrida, como `atajo-PV-número`: se imprime al final para anotarlo. */
const emitted: string[] = [];

function arcli(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args, '--testing', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 90_000,
  });
  const output = result.status === 0 || result.status === 2 ? result.stdout : result.stderr || result.stdout;

  return { code: result.status, json: JSON.parse(output) as Json, stderr: result.stderr };
}

const today = formatDateAsArcaDate(new Date());

/** Fecha ARCA como la escribe quien usa el CLI: `D/MM/YYYY`. */
function flagDate(arcaDate: string): string {
  return `${Number(arcaDate.slice(6, 8))}/${arcaDate.slice(4, 6)}/${arcaDate.slice(0, 4)}`;
}

/** Primer y último día del mes anterior al de `arcaDate`, calculados acá y no con el código de ARCLI. */
function previousMonth(arcaDate: string): { readonly from: string; readonly to: string } {
  const year = Number(arcaDate.slice(0, 4));
  const month = Number(arcaDate.slice(4, 6));
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  const format = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '');

  return { from: format(first), to: format(last) };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

/** Aprobado (o observado, que tiene CAE) y con número: lo anota en `emitted`. */
function expectIssued(result: CliResult, label: string): Json {
  expect(result.code, `${label}: ${JSON.stringify(result.json)}`).toBe(0);
  expect(result.json).toMatchObject({
    cae: expect.stringMatching(/^\d{14}$/),
    entorno: 'testing',
    estado: expect.stringMatching(/^(aprobado|observado)$/),
    previsualizacion: false,
  });
  emitted.push(`${String(result.json.atajo)}-${String(result.json.puntoVenta)}-${String(result.json.numero)}`);

  return result.json;
}

beforeAll(() => {
  // Fuera del CI, `dist/` compilado, la config en testing y el certificado de testing: si no, no emite nada.
  assertArcaTestingReady();
});

afterAll(() => {
  if (emitted.length > 0) {
    console.info(`ARCA testing emitió ${emitted.length} comprobante(s): ${emitted.join(', ')}`);
  }
});

describe.skipIf(Boolean(process.env.CI) || !POINT_OF_SALE)('Flujos de WSFE contra testing (ARCLI_ARCA_PV)', () => {
  const pv = POINT_OF_SALE ?? '';
  let arca: Arca;
  let billing: ArcaBillingGateway;
  let issuerCuit: number;

  beforeAll(() => {
    const runtime = new ArcaContextResolver({ options: { testing: true } }).resolve();

    if (runtime.environment !== 'testing' || runtime.context.production !== false) {
      throw new Error('Los flujos contra ARCA corren solo en testing.');
    }

    arca = new ArcaClientFactory().create(runtime);
    billing = new ArcaBillingGateway(arca);
    issuerCuit = Number(runtime.context.cuit);
  });

  /** Emite con `--emitir` en el punto de venta de `ARCLI_ARCA_PV`. */
  function emit(...args: string[]): Json {
    return expectIssued(arcli(...args, '--pv', pv, '--emitir'), args.join(' '));
  }

  function consult(shortcut: string, number: unknown): WsfeVoucher {
    const { code, json } = arcli('consultar', shortcut, String(number), '--pv', pv);

    expect(code, JSON.stringify(json)).toBe(0);

    return json as unknown as WsfeVoucher;
  }

  /** El último del tipo en el punto de venta, o `undefined` si no hay. */
  function last(shortcut: string): { fecha: string; numero: number } | undefined {
    const { code, json } = arcli('ultimos', shortcut, '--pv', pv, '--cantidad', '1');

    expect(code, JSON.stringify(json)).toBe(0);

    return (json.comprobantes as Array<{ fecha: string; numero: number }>)[0];
  }

  /**
   * `FECompConsultar` crudo: `consultar` (y el SDK, en `getVoucherInfo`) no devuelve los comprobantes asociados, el
   * período de servicio, el vencimiento ni `CanMisMonExt`.
   */
  async function rawVoucher(shortcut: keyof typeof ARCA_TYPE, number: unknown): Promise<Json> {
    const response = (await arca.genericService.call('wsfe', 'FECompConsultar', {
      FeCompConsReq: { CbteNro: Number(number), CbteTipo: ARCA_TYPE[shortcut], PtoVta: Number(pv) },
    })) as { FECompConsultarResult?: { ResultGet?: Json } };
    const voucher = response.FECompConsultarResult?.ResultGet;

    if (!voucher) {
      throw new Error(`FECompConsultar no devolvió ${shortcut} ${String(number)}: ${JSON.stringify(response)}`);
    }

    return voucher;
  }

  function associatedOf(raw: Json): Array<{ Cuit: number; Nro: number; PtoVta: number; Tipo: number }> {
    return asArray((raw.CbtesAsoc as { CbteAsoc?: Json | Json[] } | undefined)?.CbteAsoc).map((entry) => ({
      Cuit: Number(entry.Cuit),
      Nro: Number(entry.Nro),
      PtoVta: Number(entry.PtoVta),
      Tipo: Number(entry.Tipo),
    }));
  }

  /** Lo que `consultar` devuelve tiene que ser lo que se emitió: CAE, tipo, importes, moneda y cotización. */
  function expectStored(stored: WsfeVoucher, issued: Json, amounts: Partial<Amounts>): void {
    const request = issued.solicitud as Json;

    expect(stored).toMatchObject({
      cae: issued.cae,
      cotizacion: Number(request.MonCotiz),
      fecha: request.CbteFch,
      moneda: request.MonId,
      numero: issued.numero,
      resultado: 'A',
      tipoArca: issued.tipoArca,
    });
    expect(stored.importes).toMatchObject(amounts);
    expect(stored.importes).toMatchObject({
      exento: Number(request.ImpOpEx),
      iva: Number(request.ImpIVA),
      neto: Number(request.ImpNeto),
      noGravado: Number(request.ImpTotConc),
      total: Number(request.ImpTotal),
    });
  }

  // Primero: con `--fecha` pasada, ARCA pide que no haya del mismo tipo con fecha posterior (10016).
  it('--misma-moneda con fecha pasada: dólares a la cotización del día hábil anterior', async (context) => {
    const candidates: ReadonlyArray<readonly string[]> = [
      ['fc', '-m', '1', '--cs', '--cfinal'],
      ['fb', '-m', '1', '--cs', '--cfinal'],
      ['rc', '-m', '1', '--cs', '--cfinal'],
      ['rb', '-m', '1', '--cs', '--cfinal'],
      ['fa', '-m', '1,21', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri'],
      ['ra', '-m', '1,21', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri'],
    ];
    const pick = candidates
      .map((args) => ({ args, previous: last(args[0] as string)?.fecha }))
      .find(({ previous }) => !previous || previous < today);

    if (!pick) {
      context.skip('Todos los candidatos ya tienen un comprobante de hoy en este punto de venta: probá mañana.');

      return;
    }

    const date = maxArcaDate(addDaysToArcaDate(today, -3), pick.previous ?? '00000000');
    const shortcut = pick.args[0] as keyof typeof ARCA_TYPE;
    const issued = emit(...pick.args, '--mda', 'USD', '--misma-moneda', '--fecha', flagDate(date));
    const request = issued.solicitud as Json;
    const expectedRate = await billing.getQuotation('DOL', addDaysToArcaDate(date, -1));

    expect(request).toMatchObject({ CanMisMonExt: 'S', CbteFch: date, MonCotiz: expectedRate, MonId: 'DOL' });
    expect(expectedRate).toBeGreaterThan(1);
    expectStored(consult(shortcut, issued.numero), issued, {});
    expect(await rawVoucher(shortcut, issued.numero)).toMatchObject({ CanMisMonExt: 'S', MonId: 'DOL' });
  });

  it('factura A, NC A parcial y ND A sobre la misma factura', async () => {
    const invoice = emit('fa', '-m', '1210', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri');

    expectStored(consult('fa', invoice.numero), invoice, { iva: 210, neto: 1000, total: 1210 });

    const association = ['--ac', 'fa', '--ar', String(invoice.numero), '--apv', pv];
    const credit = emit('nca', '-m', '121', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri', ...association);
    const debit = emit('nda', '-m', '242', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri', ...association);

    expectStored(consult('nca', credit.numero), credit, { iva: 21, neto: 100, total: 121 });
    expectStored(consult('nda', debit.numero), debit, { iva: 42, neto: 200, total: 242 });

    const expected = [{ Cuit: issuerCuit, Nro: invoice.numero, PtoVta: Number(pv), Tipo: ARCA_TYPE.fa }];

    expect(associatedOf(await rawVoucher('nca', credit.numero))).toEqual(expected);
    expect(associatedOf(await rawVoucher('nda', debit.numero))).toEqual(expected);
  });

  it('NC B por el total de la factura B', async () => {
    const invoice = emit('fb', '-m', '1000', '--cs', '--cfinal');
    const stored = consult('fb', invoice.numero);

    expectStored(stored, invoice, { total: 1000 });

    const credit = emit(
      'ncb',
      '-m',
      '1000',
      '--cs',
      '--cfinal',
      '--ac',
      'fb',
      '--ar',
      String(invoice.numero),
      '--apv',
      pv,
    );

    // La NC total repite los importes de la factura: mismo neto e IVA, no solo el total.
    expectStored(consult('ncb', credit.numero), credit, stored.importes);
    expect(associatedOf(await rawVoucher('ncb', credit.numero))).toEqual([
      { Cuit: issuerCuit, Nro: invoice.numero, PtoVta: Number(pv), Tipo: ARCA_TYPE.fb },
    ]);

    // Y ARCLI corta una segunda NC que pasa el total.
    const over = arcli(
      'ncb',
      '-m',
      '1000,01',
      '--cs',
      '--cfinal',
      '--ac',
      'fb',
      '--ar',
      String(invoice.numero),
      '--apv',
      pv,
      '--pv',
      pv,
      '--previsualizar',
    );

    expect(over.code).toBe(1);
    expect(over.json.codigo).toBe('INPUT_VALIDATION_ERROR');
  });

  it('FCE A con su NC y su ND', async () => {
    const invoice = emit('fcea', '-m', '5000000', '--cp', '--cuit', FCE_RECEIVER_CUIT, '--ir-ri', '--cbu', CBU);

    expectStored(consult('fcea', invoice.numero), invoice, { total: 5_000_000 });
    expect(await rawVoucher('fcea', invoice.numero)).toMatchObject({
      Opcionales: { Opcional: expect.arrayContaining([expect.objectContaining({ Id: '2101', Valor: CBU })]) },
    });

    const note = ['-m', '100', '--cp', '--cuit', FCE_RECEIVER_CUIT, '--ir-ri', '--ac', 'fcea'];
    const association = ['--ar', String(invoice.numero), '--apv', pv];
    const credit = emit('ncea', ...note, ...association);
    const debit = emit('ndea', ...note, ...association);

    expectStored(consult('ncea', credit.numero), credit, { total: 100 });
    expectStored(consult('ndea', debit.numero), debit, { total: 100 });

    for (const [shortcut, number] of [
      ['ncea', credit.numero],
      ['ndea', debit.numero],
    ] as const) {
      expect(associatedOf(await rawVoucher(shortcut, number)), shortcut).toEqual([
        { Cuit: issuerCuit, Nro: invoice.numero, PtoVta: Number(pv), Tipo: ARCA_TYPE.fcea },
      ]);
    }
  });

  it('recibos A, B y C', () => {
    const receiptA = emit('ra', '-m', '1210', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri');
    const receiptB = emit('rb', '-m', '1000', '--cs', '--cfinal');
    const receiptC = emit('rc', '-m', '100', '--cs', '--cfinal');

    expectStored(consult('ra', receiptA.numero), receiptA, { iva: 210, neto: 1000, total: 1210 });
    expectStored(consult('rb', receiptB.numero), receiptB, { total: 1000 });
    expectStored(consult('rc', receiptC.numero), receiptC, { iva: 0, neto: 100, total: 100 });
    expect([receiptA.tipoArca, receiptB.tipoArca, receiptC.tipoArca]).toEqual([
      ARCA_TYPE.ra,
      ARCA_TYPE.rb,
      ARCA_TYPE.rc,
    ]);
  });

  it('--cargar: un JSON de ejemplo y un lote', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'arcli-arca-'));

    try {
      // El ejemplo de llms.txt ("Forma del JSON de --cargar"), con este punto de venta, emitir y sin PDF.
      const single = join(folder, 'comprobante.json');

      writeFileSync(
        single,
        JSON.stringify({
          codigoMoneda: 'ARS',
          concepto: 'servicios',
          condicionVenta: 'contado',
          cotizacionMoneda: 1,
          descripcion: 'Servicios del mes',
          emitir: true,
          ivaReceptor: 'consumidor-final',
          montoTotal: 1000,
          numeroDocumento: 0,
          pdf: false,
          puntoVenta: Number(pv),
          receptorDomicilio: 'Calle 1',
          receptorNombre: 'Cliente SA',
          tipoDocumento: 'consumidor-final',
          vencimientoPago: '+10',
        }),
      );

      const issued = expectIssued(arcli('fc', '--cargar', single), 'fc --cargar');

      expectStored(consult('fc', issued.numero), issued, { total: 1000 });
      expect(await rawVoucher('fc', issued.numero)).toMatchObject({
        DocTipo: 99,
        FchVtoPago: addDaysToArcaDate(today, 10),
      });

      const batch = join(folder, 'lote.json');
      const base = { concepto: 'servicios', emitir: true, ivaReceptor: 'consumidor-final', puntoVenta: Number(pv) };

      writeFileSync(
        batch,
        JSON.stringify([
          { ...base, montoTotal: 10 },
          { ...base, montoTotal: 20 },
        ]),
      );

      const result = spawnSync(process.execPath, [CLI, 'fc', '--cargar', batch, '--testing', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
        timeout: 90_000,
      });

      expect(result.status, result.stderr).toBe(0);

      const items = JSON.parse(result.stdout) as Json[];

      expect(items.map((item) => item.indice)).toEqual([1, 2]);

      for (const [index, item] of items.entries()) {
        expectIssued({ code: 0, json: item, stderr: '' }, `lote ${index + 1}`);
        expectStored(consult('fc', item.numero), item, { total: [10, 20][index] });
      }

      expect(Number(items[1]?.numero)).toBe(Number(items[0]?.numero) + 1);
    } finally {
      rmSync(folder, { force: true, recursive: true });
    }
  });

  it('fechas relativas: --sd mes-pasado --sh mes-pasado --vto +10', async () => {
    const issued = emit(
      'fc',
      '-m',
      '1',
      '--cs',
      '--cfinal',
      '--sd',
      'mes-pasado',
      '--sh',
      'mes-pasado',
      '--vto',
      '+10',
    );
    const period = previousMonth(today);

    expect(issued.solicitud).toMatchObject({
      FchServDesde: period.from,
      FchServHasta: period.to,
      FchVtoPago: addDaysToArcaDate(today, 10),
    });
    expectStored(consult('fc', issued.numero), issued, { total: 1 });
    expect(await rawVoucher('fc', issued.numero)).toMatchObject({
      Concepto: 2,
      FchServDesde: period.from,
      FchServHasta: period.to,
      FchVtoPago: addDaysToArcaDate(today, 10),
    });
  });

  it('PDF de una factura emitida, si el plugin está instalado', (context) => {
    const plugin = arcli('pdf', 'estado');

    if (plugin.json.instalado !== true) {
      context.skip('El plugin de PDF no está instalado (`arcli pdf instalar`).');

      return;
    }

    const issued = emit('fc', '-m', '1', '--cs', '--cfinal', '--pdf');
    const pdf = issued.pdf as { error?: { codigo: string }; ruta?: string } | undefined;
    const issuer = (arcli('config').json.emisor ?? {}) as Json;
    const issuerComplete = Boolean(issuer.razonSocial && issuer.domicilio && issuer.inicioActividades);

    if (!issuerComplete) {
      // Sin los datos del emisor no hay PDF, pero el comprobante está emitido y el exit code sigue en 0.
      expect(pdf?.error?.codigo).toBe('PDF_ISSUER_INCOMPLETE');

      return;
    }

    expect(pdf?.ruta, JSON.stringify(pdf)).toEqual(expect.stringMatching(/\.pdf$/));
    expect(
      readFileSync(pdf?.ruta ?? '')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });
});

describe.skipIf(Boolean(process.env.CI) || !EXPORT_POINT_OF_SALE)(
  'Flujos de la E contra testing (ARCLI_ARCA_PV_E)',
  () => {
    const pv = EXPORT_POINT_OF_SALE ?? '';
    const client = ['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'];
    let date: string | undefined;

    /**
     * La fecha de las E de esta corrida: hoy, o la más nueva de las últimas factura, NC y ND E si es futura. Después de
     * una E con fecha futura, ARCA rechaza las anteriores de ese tipo con 1535.
     */
    function exportDate(): string {
      date ??= maxArcaDate(
        today,
        ...['fe', 'nce', 'nde'].map((shortcut) => {
          const { json } = arcli('ultimos', shortcut, '--pv', pv, '--cantidad', '1');

          return (json.comprobantes as Array<{ fecha: string }> | undefined)?.[0]?.fecha ?? today;
        }),
      );

      return date;
    }

    function emit(...args: string[]): Json {
      return expectIssued(
        arcli(...args, '--pv', pv, '--fecha', flagDate(exportDate()), '--emitir'),
        args.slice(0, 1).join(' '),
      );
    }

    function consult(shortcut: string, number: unknown): ExportVoucher {
      const { code, json } = arcli('consultar', shortcut, String(number), '--pv', pv);

      expect(code, JSON.stringify(json)).toBe(0);

      return json as unknown as ExportVoucher;
    }

    /** `consultar` tiene que devolver lo que se mandó en `solicitud` (el `Cmp` de WSFEX). */
    function expectStored(stored: ExportVoucher, issued: Json, total: number): void {
      const request = issued.solicitud as Json;

      expect(stored).toMatchObject({
        cae: issued.cae,
        cliente: request.Cliente,
        cotizacion: Number(request.Moneda_ctz),
        destino: { codigo: Number(request.Dst_cmp) },
        fecha: request.Fecha_cbte,
        moneda: request.Moneda_Id,
        numero: issued.numero,
        resultado: 'A',
        tipoArca: issued.tipoArca,
        tipoExpo: Number(request.Tipo_expo),
        total,
      });
      expect(Number(request.Imp_total)).toBe(total);
    }

    for (const kind of [
      { args: ['--actividad', '620100'], label: 'servicios', tipoExpo: 2 },
      { args: ['--tipo-expo', '1', '--incoterm', 'FOB'], label: 'bienes', tipoExpo: 1 },
    ] as const) {
      it(`E de ${kind.label} con su NC y su ND`, () => {
        const invoice = emit('fe', '-m', '100', ...client, ...kind.args);
        const storedInvoice = consult('fe', invoice.numero);

        expectStored(storedInvoice, invoice, 100);
        expect(storedInvoice).toMatchObject({ comprobanteAsociado: null, moneda: 'DOL', tipoExpo: kind.tipoExpo });
        expect(storedInvoice.cotizacion).toBeGreaterThan(1);

        const association = ['--ar', String(invoice.numero), '--apv', pv];
        const credit = emit('nce', '-m', '10', ...association);
        const debit = emit('nde', '-m', '5', ...association);

        for (const [shortcut, note, total] of [
          ['nce', credit, 10],
          ['nde', debit, 5],
        ] as const) {
          const stored = consult(shortcut, note.numero);

          expectStored(stored, note, total);
          // La nota toma del asociado cliente, destino, tipo, moneda y cotización.
          expect(stored, shortcut).toMatchObject({
            cliente: storedInvoice.cliente,
            comprobanteAsociado: { atajo: 'fe', numero: invoice.numero, puntoVenta: Number(pv), tipoArca: 19 },
            cotizacion: storedInvoice.cotizacion,
            destino: storedInvoice.destino,
            moneda: storedInvoice.moneda,
            tipoExpo: kind.tipoExpo,
          });
        }
      });
    }
  },
);
