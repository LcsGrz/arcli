import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

import { formatArcaDateAsArgentineDate } from '../../../lib/dates/arca-date';
import { formatArgentineAmountInput } from '../../../lib/numbers/argentine-amount';

import { ARCA_CLI, assertArcaTestingReady } from './arca-guard';

/**
 * `arcli constatar` contra ARCA testing (SDK-10), con el `arcli` compilado, tu config y tu certificado de testing. Solo
 * consulta: toma con `ultimos` la última factura A propia y la constata en WSCDC, con sus datos (A) y con un importe
 * bien distinto (R 110). No emite nada. Necesita `wscdc` autorizado en WSASS y una factura A emitida en el punto de
 * venta de la config, o en el de `ARCLI_ARCA_PV`.
 */
const POINT_OF_SALE = process.env.ARCLI_ARCA_PV?.trim();

interface CliResult {
  readonly code: number | null;
  readonly json: Record<string, unknown>;
}

function run(args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [ARCA_CLI, ...args, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 90_000,
  });
  const output = result.status === 0 || result.status === 2 ? result.stdout : result.stderr || result.stdout;

  return { code: result.status, json: JSON.parse(output) as Record<string, unknown> };
}

/** Todo lo que va a ARCA, con `--testing`: no puede tocar producción. */
function arcli(...args: string[]): CliResult {
  return run([...args, '--testing']);
}

interface LastInvoice {
  readonly cae: string;
  readonly fecha: string;
  readonly importes: { readonly total: number };
  readonly numero: number;
  readonly numeroDocumento: number;
  readonly tipoDocumento: number;
}

let issuer = '';
let pointOfSale = 0;
let invoice: LastInvoice;

beforeAll(() => {
  assertArcaTestingReady();

  issuer = String(run(['config']).json.cuit);

  const recent = arcli('ultimos', 'fa', '--cantidad', '1', ...(POINT_OF_SALE ? ['--pv', POINT_OF_SALE] : []));

  expect(recent.code, 'ultimos fa').toBe(0);

  const [last] = recent.json.comprobantes as LastInvoice[];

  expect(last, 'hace falta una factura A emitida en ese punto de venta').toBeDefined();

  invoice = last!;
  pointOfSale = recent.json.puntoVenta as number;
});

/** `arcli constatar fa PV-NÚMERO` con los datos de la factura, y el importe que se pida. */
function constatar(total: number): CliResult {
  return arcli(
    'constatar',
    'fa',
    `${pointOfSale}-${invoice.numero}`,
    '--emisor',
    issuer,
    '-f',
    formatArcaDateAsArgentineDate(invoice.fecha),
    '-m',
    formatArgentineAmountInput(total),
    '--cae',
    invoice.cae,
    '--cuit',
    String(invoice.numeroDocumento),
  );
}

describe('ARCA testing: constatar', () => {
  it('la última factura A propia, con sus datos: constatada (A), exit 0', () => {
    expect(invoice.tipoDocumento, 'la factura A va a un CUIT').toBe(80);

    const { code, json } = constatar(invoice.importes.total);

    expect(code).toBe(0);
    expect(json).toMatchObject({
      codigoAutorizacion: invoice.cae,
      constatado: true,
      emisor: issuer,
      entorno: 'testing',
      eventos: [],
      numero: invoice.numero,
      puntoVenta: pointOfSale,
      resultado: 'A',
      tipoArca: 1,
    });
  });

  it('con un importe bien distinto: no constatada (R) con la observación 110, exit 2', () => {
    // Fuera del margen de la observación 110 (hasta $ 1 o 0,01 %).
    const { code, json } = constatar(invoice.importes.total + 1000);

    expect(code).toBe(2);
    expect(json).toMatchObject({ constatado: false, resultado: 'R' });
    expect(json.observaciones).toEqual(expect.arrayContaining([expect.objectContaining({ codigo: 110 })]));
  });
});
