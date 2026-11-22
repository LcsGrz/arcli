import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToArcaDate, formatDateAsArcaDate, maxArcaDate } from '../../../lib/dates/arca-date';
import {
  BILLING_IVA_RATES,
  conceptCode,
  documentTypeCode,
  ivaConditionCode,
  ivaRateId,
} from '../../../modules/billing/arca-codes';
import { FCE_OPTIONAL_IDS } from '../../../modules/billing/billing.fce';
import { billingDocumentTypeSchema, billingIvaConditionSchema } from '../../../modules/billing/billing.schemas';
import { ARCA_CURRENCIES } from '../../../modules/billing/currency-codes';
import { VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';
import { EXPORT_TEXT_LIMITS } from '../../../modules/export/export.mappers';
import {
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_TOTAL_ONLY_UNIT_CODES,
  EXPORT_TYPE_VALUES,
  EXPORT_VOUCHER_KINDS,
} from '../../../modules/export/export.types';
import { ArcaClientFactory } from '../../../services/arca/arca-client.factory';
import { ArcaContextResolver } from '../../../services/arca/arca-context.resolver';
import type { ArcaExportGateway } from '../../../services/arca/arca-export.gateway';
import type { Arca } from '../../../services/arca/arca-sdk.types';

import { ARCA_CLI, assertArcaTestingReady } from './arca-guard';

/**
 * Canarios de los límites que ARCLI copia de ARCA (TEST-13): si ARCA cambia un tope, una tabla o un rango, algo de acá
 * falla. Completa a `arca-rules.arca.ts`, que prueba el lado de afuera de cada borde (ARCA rechaza con el código del
 * manual); acá va el lado de adentro (ARCLI deja pasar y ARCA aprueba, así que emite) y las tablas que ARCLI tiene
 * copiadas, contra `FEParamGet*` y `FEXGetPARAM_*` completas. Las tablas no emiten nada.
 *
 * Bordes que no se prueban del lado de adentro, porque emitir ahí rompe las corridas siguientes o crea algo que no se
 * borra: fechas futuras (A, B, C y E: ARCA pide que las siguientes de ese tipo tengan esa fecha o una posterior, 10016 y
 * 1535), fechas pasadas de la E y de FCE (los flujos emiten esos tipos con fecha de hoy), el fin de mes de la E (solo a
 * 5 días o menos del fin de mes), el punto de venta 99998 y el número 99999999 (crean un punto de venta o una
 * numeración nuevos).
 *
 * Solo testing y solo local, como los otros `*.arca.ts`: `ARCLI_ARCA_PV` y `ARCLI_ARCA_PV_E` eligen los puntos de venta
 * y sin la variable los casos de ese servicio se saltean.
 */
const POINT_OF_SALE = process.env.ARCLI_ARCA_PV?.trim();
const EXPORT_POINT_OF_SALE = process.env.ARCLI_ARCA_PV_E?.trim();

const FCE_RECEIVER_CUIT = '30500010912';
const CBU = '0110599520000012345678';

type Json = Record<string, unknown>;

interface CliResult {
  readonly code: number | null;
  readonly json: Json;
}

interface ParameterRow {
  readonly id: string;
  readonly vigenteHasta: string | null;
}

/** Lo emitido en la corrida, como `atajo-PV-número`. */
const emitted: string[] = [];

function arcli(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [ARCA_CLI, ...args, '--testing', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 90_000,
  });
  const output = result.status === 0 || result.status === 2 ? result.stdout : result.stderr || result.stdout;

  return { code: result.status, json: JSON.parse(output) as Json };
}

const today = formatDateAsArcaDate(new Date());

function flagDate(arcaDate: string): string {
  return `${Number(arcaDate.slice(6, 8))}/${arcaDate.slice(4, 6)}/${arcaDate.slice(0, 4)}`;
}

/** Monto en el formato de los flags: coma decimal y sin separador de miles. */
function flagAmount(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function expectIssued(result: CliResult, label: string): Json {
  expect(result.code, `${label}: ${JSON.stringify(result.json)}`).toBe(0);
  expect(result.json, label).toMatchObject({
    cae: expect.stringMatching(/^\d{14}$/),
    entorno: 'testing',
    estado: expect.stringMatching(/^(aprobado|observado)$/),
  });
  emitted.push(`${String(result.json.atajo)}-${String(result.json.puntoVenta)}-${String(result.json.numero)}`);

  return result.json;
}

/** Ids vigentes de una tabla de `arcli parametros`. */
function parameterIds(table: string): string[] {
  const { code, json } = arcli('parametros', table);

  expect(code, JSON.stringify(json)).toBe(0);

  return (json.valores as ParameterRow[])
    .filter((row) => !row.vigenteHasta || row.vigenteHasta >= today)
    .map((row) => row.id);
}

/** Lo que sobra y lo que falta de un lado y del otro, para el mensaje del test. */
function difference(
  local: readonly string[],
  arca: readonly string[],
): { faltanEnArca: string[]; faltanEnArcli: string[] } {
  return {
    faltanEnArca: local.filter((id) => !arca.includes(id)).sort(),
    faltanEnArcli: arca.filter((id) => !local.includes(id)).sort(),
  };
}

const noDifference = { faltanEnArca: [], faltanEnArcli: [] };

/** Ids de una tabla de WSFEX (`FEXGetPARAM_*`), leídos de la primera lista de `FEXResultGet` y su campo `*_Id`. */
function wsfexIds(result: unknown): string[] {
  const response = Object.values(result as Json)[0] as
    { FEXErr?: { ErrCode?: number }; FEXResultGet?: Json } | undefined;
  const rows = Object.values(response?.FEXResultGet ?? {})[0];
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as Json[];

  return list.flatMap((row) => {
    const key = Object.keys(row).find((name) => /_Id$/i.test(name));

    return key ? [String(row[key]).trim()] : [];
  });
}

beforeAll(() => {
  assertArcaTestingReady();
});

afterAll(() => {
  if (emitted.length > 0) {
    console.info(`ARCA testing emitió ${emitted.length} comprobante(s): ${emitted.join(', ')}`);
  }
});

describe.skipIf(Boolean(process.env.CI))('Tablas copiadas de ARCA contra las de testing', () => {
  let exportArca: Arca;
  let exportGateway: ArcaExportGateway;

  beforeAll(() => {
    const runtime = new ArcaContextResolver({ options: { testing: true } }).resolve();

    if (runtime.environment !== 'testing' || runtime.context.production !== false) {
      throw new Error('Los canarios contra ARCA corren solo en testing.');
    }

    const factory = new ArcaClientFactory();

    exportArca = factory.createForExport(runtime);
    exportGateway = factory.createExportGateway(runtime);
  });

  /**
   * Lo que ARCA acepta aunque su tabla no lo liste: el código 22 de anulación de las NC y ND FCE no está en
   * `FEParamGetTiposOpcional` de testing, pero ARCA aprueba las notas FCE con él (`arca-flows.arca.ts`, 19/11/2026).
   */
  const OPTIONALS_NOT_IN_TABLE: readonly string[] = [FCE_OPTIONAL_IDS.cancellation];

  it('monedas: ARCA_CURRENCIES es FEParamGetTiposMonedas', () => {
    const local = ARCA_CURRENCIES.map((currency) => currency.arca);

    expect(difference(local, parameterIds('monedas'))).toEqual(noDifference);
  });

  it('alícuotas: las de ARCLI son FEParamGetTiposIva', () => {
    const local = BILLING_IVA_RATES.map((rate) => String(ivaRateId(rate)));

    expect(difference(local, parameterIds('alicuotas'))).toEqual(noDifference);
  });

  it('condición IVA del receptor: las de ARCLI son FEParamGetCondicionIvaReceptor', () => {
    const local = billingIvaConditionSchema.options.map((condition) => String(ivaConditionCode(condition)));

    expect(difference(local, parameterIds('iva-receptor'))).toEqual(noDifference);
  });

  it('conceptos: los de ARCLI son FEParamGetTiposConcepto', () => {
    const local = (['productos', 'servicios', 'productos-servicios'] as const).map((concept) =>
      String(conceptCode(concept)),
    );

    expect(difference(local, parameterIds('conceptos'))).toEqual(noDifference);
  });

  it('documentos: los de ARCLI están en FEParamGetTiposDoc', () => {
    const local = billingDocumentTypeSchema.options.map((type) => String(documentTypeCode(type)));

    expect(difference(local, parameterIds('documentos')).faltanEnArca).toEqual([]);
  });

  it('comprobantes: los tipos de A, B, C, FCE y recibos de ARCLI están en FEParamGetTiposCbte', () => {
    const local = [...new Set(Object.values(VOUCHER_KIND_MAP).map((kind) => String(kind.arcaType)))];

    expect(difference(local, parameterIds('comprobantes')).faltanEnArca).toEqual([]);
  });

  it('opcionales: los de FCE están en FEParamGetTiposOpcional', () => {
    const local = Object.values(FCE_OPTIONAL_IDS).filter((id) => !OPTIONALS_NOT_IN_TABLE.includes(id));
    const arca = parameterIds('opcionales');

    expect(difference(local, arca).faltanEnArca).toEqual([]);
    // Si ARCA lo suma a la tabla, se saca de la lista de arriba.
    expect(arca.filter((id) => OPTIONALS_NOT_IN_TABLE.includes(id))).toEqual([]);
  });

  it('tipos de exportación: EXPORT_TYPE_VALUES es FEXGetPARAM_Tipo_Expo', async () => {
    const arca = wsfexIds(await exportArca.wsfexService.getParamTipoExpo({} as never));

    expect(difference(EXPORT_TYPE_VALUES.map(String), arca)).toEqual(noDifference);
  });

  it('comprobantes E: 19, 20 y 21 están en FEXGetPARAM_Cbte_Tipo', async () => {
    const arca = wsfexIds(await exportArca.wsfexService.getParamCbteTipo({} as never));

    expect(
      difference(
        EXPORT_VOUCHER_KINDS.map((kind) => String(kind.arcaType)),
        arca,
      ).faltanEnArca,
    ).toEqual([]);
  });

  it('unidades: la de por defecto y las de solo importe están en FEXGetPARAM_UMed', async () => {
    const arca = (await exportGateway.getUnits()).map((unit) => String(unit.id));
    const local = [DEFAULT_EXPORT_UNIT_CODE, ...EXPORT_TOTAL_ONLY_UNIT_CODES].map(String);

    expect(difference(local, arca).faltanEnArca).toEqual([]);
  });

  it('idiomas: el de por defecto está en FEXGetPARAM_Idiomas', async () => {
    const arca = (await exportGateway.getLanguages()).map((language) => String(language.id));

    expect(arca).toContain(String(DEFAULT_EXPORT_LANGUAGE));
  });

  it('monedas E: DOL y PES están en FEXGetPARAM_MON', async () => {
    const arca = (await exportGateway.getCurrencies()).map((currency) => currency.code);

    expect(arca).toEqual(expect.arrayContaining(['DOL', 'PES']));
  });
});

describe.skipIf(Boolean(process.env.CI) || !POINT_OF_SALE)('Bordes de WSFE del lado de adentro (ARCLI_ARCA_PV)', () => {
  const pv = POINT_OF_SALE ?? '';

  function emit(...args: string[]): Json {
    return expectIssued(arcli(...args, '--pv', pv, '--emitir'), args.slice(0, 3).join(' '));
  }

  function consult(shortcut: string, number: unknown): Json {
    const { code, json } = arcli('consultar', shortcut, String(number), '--pv', pv);

    expect(code, JSON.stringify(json)).toBe(0);

    return json;
  }

  function lastDate(shortcut: string): string | undefined {
    const { json } = arcli('ultimos', shortcut, '--pv', pv, '--cantidad', '1');

    return (json.comprobantes as Array<{ fecha: string }> | undefined)?.[0]?.fecha;
  }

  it('consumidor final sin identificar por $ 9.999.999,99 (el tope es $ 10.000.000, RG 5700)', () => {
    const issued = emit('fb', '-m', '9999999,99', '--cs', '--cfinal');

    expect(consult('fb', issued.numero)).toMatchObject({
      importes: expect.objectContaining({ total: 9_999_999.99 }),
      numeroDocumento: 0,
      tipoDocumento: 99,
    });
  });

  describe('cotización entre el 2 % y el 500 % de la oficial (10119)', () => {
    let official = 0;

    beforeAll(() => {
      const { code, json } = arcli('parametros', 'cotizacion', 'USD');

      expect(code, JSON.stringify(json)).toBe(0);
      official = Number(json.cotizacion);
    });

    for (const ratio of [4.99, 0.021]) {
      it(`${ratio * 100} % de la oficial`, () => {
        const rate = Math.floor(official * ratio * 100) / 100;
        const issued = emit('fc', '-m', '1', '--cs', '--cfinal', '--mda', 'USD', '--cm', flagAmount(rate));

        expect(consult('fc', issued.numero)).toMatchObject({ cotizacion: rate, moneda: 'DOL' });
      });
    }
  });

  for (const alias of ['arcli1', 'arcli.testing.alias1']) {
    it(`factura FCE con un alias de ${alias.length} caracteres (10166)`, () => {
      const issued = emit(
        'fcea',
        '-m',
        '5000000',
        '--cp',
        '--cuit',
        FCE_RECEIVER_CUIT,
        '--ir-ri',
        '--cbu',
        CBU,
        '--alias',
        alias,
      );

      expect(issued.solicitud).toMatchObject({
        Opcionales: expect.arrayContaining([{ Id: FCE_OPTIONAL_IDS.cbuAlias, Valor: alias }]),
      });
    });
  }

  for (const edge of [
    { concept: '--cp', days: 5, shortcut: 'ncc' },
    { concept: '--cs', days: 10, shortcut: 'ndc' },
  ] as const) {
    it(`${edge.shortcut} ${edge.concept === '--cp' ? 'de productos' : 'de servicios'} con fecha de hoy − ${edge.days} (10016)`, (context) => {
      // Un tipo que los flujos no emiten y una fecha fija hacia atrás: la corrida siguiente nunca es anterior (10016).
      const date = addDaysToArcaDate(today, -edge.days);
      const previous = lastDate(edge.shortcut);

      if (previous && previous > date) {
        context.skip(
          `Ya hay un ${edge.shortcut} con fecha ${previous}, posterior a ${date}: ARCA lo rechazaría por orden.`,
        );

        return;
      }

      const day = `-${edge.days}`;
      const issued = emit(edge.shortcut, '-m', '1', edge.concept, '--cfinal', '--fecha', day, '--pd', day, '--ph', day);

      expect(consult(edge.shortcut, issued.numero)).toMatchObject({ fecha: date });
    });
  }
});

describe.skipIf(Boolean(process.env.CI) || !EXPORT_POINT_OF_SALE)(
  'Bordes de la E del lado de adentro (ARCLI_ARCA_PV_E)',
  () => {
    const pv = EXPORT_POINT_OF_SALE ?? '';

    it('textos en su largo máximo (1651, 1661, 1665, 1770, 1642, forma de pago e ID impositivo)', () => {
      // La fecha de la E: hoy o la de la última, si es futura (1535).
      const last = (
        arcli('ultimos', 'fe', '--pv', pv, '--cantidad', '1').json.comprobantes as Array<{ fecha: string }>
      )[0];
      const date = maxArcaDate(today, last?.fecha ?? today);
      const text = (limit: { readonly max: number }, letter: string) => letter.repeat(limit.max);
      const issued = expectIssued(
        arcli(
          'fe',
          '-m',
          '100',
          '--pais-destino',
          '212',
          '--tipo-expo',
          '1',
          '--incoterm',
          'FOB',
          '--incoterms-desc',
          text(EXPORT_TEXT_LIMITS.incotermDescription, 'I'),
          '--cliente',
          text(EXPORT_TEXT_LIMITS.clientName, 'C'),
          '--domicilio-cliente',
          text(EXPORT_TEXT_LIMITS.clientAddress, 'D'),
          '--observaciones',
          text(EXPORT_TEXT_LIMITS.observations, 'O'),
          '--obs-comerciales',
          text(EXPORT_TEXT_LIMITS.commercialObservations, 'M'),
          '--descripcion',
          text(EXPORT_TEXT_LIMITS.description, 'P'),
          '--forma-pago',
          text(EXPORT_TEXT_LIMITS.paymentTerms, 'F'),
          '--id-impositivo',
          text(EXPORT_TEXT_LIMITS.clientTaxId, '1'),
          '--pv',
          pv,
          '--fecha',
          flagDate(date),
          '--emitir',
        ),
        'fe con textos al máximo',
      );
      const { code, json } = arcli('consultar', 'fe', String(issued.numero), '--pv', pv);

      expect(code, JSON.stringify(json)).toBe(0);
      expect(json).toMatchObject({
        cliente: text(EXPORT_TEXT_LIMITS.clientName, 'C'),
        domicilioCliente: text(EXPORT_TEXT_LIMITS.clientAddress, 'D'),
        idImpositivo: text(EXPORT_TEXT_LIMITS.clientTaxId, '1'),
      });
    });
  },
);
