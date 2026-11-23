import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import { BILLING_IVA_RATES, ivaConditionCode, ivaRateId } from '../../../modules/billing/arca-codes';
import { listAllowedIvaConditions } from '../../../modules/billing/billing.iva-receptor';
import type { BillingIvaCondition } from '../../../modules/billing/billing.schemas';
import type { VoucherLetter } from '../../../modules/billing/billing.types';
import { mapExportResponse } from '../../../modules/export/export.response';
import type { ExportVoucherPayload } from '../../../modules/export/export.types';
import { ArcaBillingGateway } from '../../../services/arca/arca-billing.gateway';
import { ArcaClientFactory } from '../../../services/arca/arca-client.factory';
import type { ArcaExportGateway } from '../../../services/arca/arca-export.gateway';
import type { IVoucher } from '../../../services/arca/arca-sdk.types';
import { loadArcaRuntime } from '../../arca-runtime';

import { assertArcaTestingReady } from './arca-guard';

/**
 * Las reglas que ARCLI copia de ARCA, contra ARCA testing (TEST-8; ver "De dónde sale cada regla" en
 * docs/validation-rules.md). ARCLI corta el caso límite antes de llamar a ARCA, así que cada caso:
 *
 * 1. arma la solicitud de un comprobante válido con el `arcli` compilado (`--previsualizar --json`, campo `solicitud`);
 * 2. si hay un comando equivalente, comprueba que ARCLI lo bloquea (`INPUT_VALIDATION_ERROR`);
 * 3. cambia en la solicitud solo el dato de la regla y la manda a ARCA testing con el SDK, sin la validación local;
 * 4. espera el rechazo con el código del manual. Si ARCA la aprueba, la regla local quedó más estricta que ARCA y el
 *    test falla con el CAE de lo que se emitió.
 *
 * Solo testing: el contexto se arma con `testing` y el test se niega si da producción. Puede emitir comprobantes de
 * prueba (los que ARCA aprueba), sin validez fiscal. Como `arca-testing.arca.ts`, necesita `yarn build` antes.
 */
const CLI = resolve('dist/cli/index.js');

/** CUITs de prueba de ARCA testing: uno con padrón completo (RI) y uno que recibe FCE. */
const RECEIVER_CUIT = '30546689979';
/** El CUIT genérico de un receptor No Categorizado (10067). */
const UNCATEGORIZED_CUIT = '23000000000';
const FCE_RECEIVER_CUIT = '30500010912';
const CBU = '0110599520000012345678';

/** Punto de venta de exportación (WSFEX) de tu testing. Sin la variable, los casos de la E se saltean. */
const EXPORT_POINT_OF_SALE = process.env.ARCLI_ARCA_PV_E?.trim();
/** Punto de venta de WSFE para los casos de A, B, C y FCE. Sin la variable, el de la config. */
const POINT_OF_SALE = process.env.ARCLI_ARCA_PV?.trim();
const pointOfSaleFlags = (): string[] => (POINT_OF_SALE ? ['--pv', POINT_OF_SALE] : []);
/**
 * `args` con el punto de venta de `ARCLI_ARCA_PV` si no traen uno: los casos de la E llevan el de `ARCLI_ARCA_PV_E` y
 * con las dos variables el último `--pv` pisaba al de la E.
 */
const withPointOfSale = (args: readonly string[]): string[] =>
  args.includes('--pv') ? [...args] : [...args, ...pointOfSaleFlags()];

type Request = Record<string, unknown>;

interface ArcaOutcome {
  readonly approved: boolean;
  readonly cae: string | null;
  readonly codes: readonly number[];
  readonly messages: readonly string[];
  readonly number: number;
}

interface CliResult {
  readonly code: number | null;
  readonly json: Record<string, unknown>;
}

/** Lo que ARCA aprobó durante la corrida: se imprime al final para anotarlo. */
const emitted: string[] = [];

function arcli(...args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args, '--testing', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 90_000,
  });
  const output = result.status === 0 ? result.stdout : result.stderr || result.stdout;

  return { code: result.status, json: JSON.parse(output) as Record<string, unknown> };
}

const today = formatDateAsArcaDate(new Date());

function shift(arcaDate: string, days: number): string {
  const time = Date.UTC(Number(arcaDate.slice(0, 4)), Number(arcaDate.slice(4, 6)) - 1, Number(arcaDate.slice(6, 8)));

  return new Date(time + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Fecha ARCA como la escribe quien usa el CLI: `D/MM/YYYY`. */
function flagDate(arcaDate: string): string {
  return `${Number(arcaDate.slice(6, 8))}/${arcaDate.slice(4, 6)}/${arcaDate.slice(0, 4)}`;
}

const previews = new Map<string, Request>();

/** La solicitud que ARCLI armaría para estos flags, de una vista previa del CLI compilado. */
function previewRequest(args: readonly string[]): Request {
  const key = args.join(' ');
  const cached = previews.get(key);

  if (!cached) {
    const { code, json } = arcli(...withPointOfSale(args), '--previsualizar');

    if (code !== 0 || !json.solicitud) {
      throw new Error(`La vista previa base \`arcli ${key}\` falló: ${JSON.stringify(json)}`);
    }

    previews.set(key, json.solicitud as Request);
  }

  return structuredClone(previews.get(key) as Request);
}

function expectCliBlocks(args: readonly string[]): void {
  const { code, json } = arcli(...withPointOfSale(args), '--previsualizar');

  expect(code, `\`arcli ${args.join(' ')}\` tendría que cortar antes de ARCA`).not.toBe(0);
  expect(json.codigo).toBe('INPUT_VALIDATION_ERROR');
}

function expectRejected(outcome: ArcaOutcome, codes: readonly number[], target: string): void {
  if (outcome.approved) {
    throw new Error(
      `ARCA aprobó ${target} (número ${outcome.number}, CAE ${outcome.cae ?? '-'}, observaciones ${outcome.codes.join(', ') || 'ninguna'}): la regla local quedó más estricta que ARCA. Revisala en docs/validation-rules.md.`,
    );
  }

  if (codes.length > 0 && !codes.some((code) => outcome.codes.includes(code))) {
    throw new Error(
      `ARCA rechazó ${target} con ${outcome.codes.join(', ') || 'sin código'} y no con ${codes.join(' o ')}: revisá el código en docs/validation-rules.md. ${outcome.messages.join(' | ')}`,
    );
  }
}

/** Los `Code` de un bloque de errores u observaciones de WSFE, venga como objeto o como lista. */
function readCodes(block: unknown, key: 'Err' | 'Obs'): Array<{ code: number; message: string }> {
  const entries = (block as Record<string, unknown> | undefined)?.[key];
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];

  return list.map((entry: { Code?: number | string; Msg?: string }) => ({
    code: Number(entry.Code),
    message: String(entry.Msg ?? ''),
  }));
}

describe.skipIf(Boolean(process.env.CI))('Reglas copiadas de ARCA contra testing', () => {
  let billing: ArcaBillingGateway;
  let exportGateway: ArcaExportGateway;

  async function sendWsfe(request: Request): Promise<ArcaOutcome> {
    const pointOfSale = Number(request.PtoVta);
    const voucherType = Number(request.CbteTipo);
    const number = await billing.getNextVoucherNumber(pointOfSale, voucherType);
    const voucher = { ...request, CantReg: 1, CbteDesde: number, CbteHasta: number } as unknown as IVoucher;
    const { cae, response } = await billing.createVoucher(voucher);
    const result = response as unknown as Record<string, unknown>;
    const detail = (result.FeDetResp as { FECAEDetResponse?: Array<Record<string, unknown>> } | undefined)
      ?.FECAEDetResponse?.[0];
    const entries = [...readCodes(result.Errors, 'Err'), ...readCodes(detail?.Observaciones, 'Obs')];
    const approved = detail?.Resultado === 'A';

    if (approved) {
      emitted.push(`tipo ${voucherType}, PV ${pointOfSale}, número ${number}, CAE ${cae}`);
    }

    return {
      approved,
      cae: cae || null,
      codes: entries.map((entry) => entry.code),
      messages: entries.map((entry) => `${entry.code}: ${entry.message}`),
      number,
    };
  }

  /** Con `keepNumber` va el `Cbte_nro` de la solicitud (para probar su tope) en lugar del siguiente de ARCA. */
  async function sendWsfex(request: Request, options: { readonly keepNumber?: boolean } = {}): Promise<ArcaOutcome> {
    const payload = request as unknown as ExportVoucherPayload & Request;
    const number = options.keepNumber
      ? Number(payload.Cbte_nro)
      : (await exportGateway.getLastVoucherNumber(Number(payload.Cbte_Tipo), Number(payload.Punto_vta))) + 1;
    const id = (await exportGateway.getLastRequestId()) + 1;
    const response = mapExportResponse(await exportGateway.authorize({ ...payload, Cbte_nro: number, Id: id }));
    const approved = response.resultado === 'A' && response.errors.length === 0;

    if (approved) {
      emitted.push(
        `tipo ${String(payload.Cbte_Tipo)}, PV ${String(payload.Punto_vta)}, número ${number}, CAE ${response.cae}`,
      );
    }

    return {
      approved,
      cae: response.cae,
      codes: response.errors.map((error) => error.code ?? 0),
      messages: [...response.errors.map((error) => `${error.code}: ${error.message}`), ...response.observaciones],
      number,
    };
  }

  beforeAll(() => {
    // Fuera del CI, `dist/` compilado, la config en testing y el certificado de testing: si no, no manda nada.
    assertArcaTestingReady();

    const runtime = loadArcaRuntime({ testing: true });

    if (runtime.environment !== 'testing' || runtime.context.production !== false) {
      throw new Error('Las reglas contra ARCA corren solo en testing.');
    }

    const factory = new ArcaClientFactory();

    billing = new ArcaBillingGateway(factory.create(runtime));
    exportGateway = factory.createExportGateway(runtime);
  });

  afterAll(() => {
    if (emitted.length > 0) {
      console.info(`ARCA testing aprobó ${emitted.length} comprobante(s):\n${emitted.join('\n')}`);
    }
  });

  /** El último comprobante de un tipo en el punto de venta de la config, para asociarlo. */
  function lastVoucher(shortcut: string, ...extra: string[]): { fecha: string; numero: number; total: number } {
    const { code, json } = arcli(
      'ultimos',
      shortcut,
      '--cantidad',
      '1',
      ...(extra.length > 0 ? extra : pointOfSaleFlags()),
    );
    const [last] = (json.comprobantes ?? []) as Array<{ fecha: string; importes?: { total: number }; numero: number }>;

    if (code !== 0 || !last) {
      throw new Error(`No hay ${shortcut} en testing para asociar: emití uno antes.`);
    }

    return { fecha: last.fecha, numero: last.numero, total: last.importes?.total ?? 0 };
  }

  /**
   * Lo que ARCA acepta aunque su tabla no lo diga: la respuesta de testing marca consumidor final (5) como "C/49", sin
   * la B, pero la tabla del manual (WSFEv1 v4.7, p. 203) lo marca en B, C y 49 y ARCA aprueba la factura B a
   * consumidor final (visto en testing el 18/11/2026). La diferencia es de testing, no de ARCLI.
   */
  const KNOWN_TABLE_GAPS: Readonly<Record<VoucherLetter, readonly number[]>> = {
    a: [],
    b: [ivaConditionCode('consumidor-final')],
    c: [],
  };

  describe('consultar en vez de copiar: las tablas locales contra las de ARCA', () => {
    it('IVA receptor por letra (10243) es la de FEParamGetCondicionIvaReceptor', () => {
      const { code, json } = arcli('parametros', 'iva-receptor');

      expect(code).toBe(0);

      const rows = json.valores as Array<{ detalle: string | null; id: string; vigenteHasta: string | null }>;

      for (const letter of ['a', 'b', 'c'] as const satisfies readonly VoucherLetter[]) {
        const fromArca = rows
          .filter(
            (row) => !row.vigenteHasta && (row.detalle ?? '').toUpperCase().split('/').includes(letter.toUpperCase()),
          )
          .map((row) => Number(row.id))
          .concat(KNOWN_TABLE_GAPS[letter])
          .sort((left, right) => left - right);
        const local = listAllowedIvaConditions(letter)
          .map((condition: BillingIvaCondition) => ivaConditionCode(condition))
          .sort((left, right) => left - right);

        expect(local, `letra ${letter.toUpperCase()}`).toEqual(fromArca);
      }
    });

    it('las alícuotas de ARCLI están en FEParamGetTiposIva con el mismo id', () => {
      const { code, json } = arcli('parametros', 'alicuotas');

      expect(code).toBe(0);

      const rows = json.valores as Array<{ descripcion: string; id: string }>;

      for (const rate of BILLING_IVA_RATES) {
        expect(rows, `${rate}%`).toEqual(
          expect.arrayContaining([expect.objectContaining({ descripcion: `${rate}%`, id: String(ivaRateId(rate)) })]),
        );
      }
    });
  });

  describe('WSFEv1 v4.7: facturas, notas y recibos A, B y C, y FCE', () => {
    const fcServices = ['fc', '-m', '1', '--cs', '--cfinal'];
    const fcProducts = ['fc', '-m', '1', '--cp', '--cfinal'];
    const fa = ['fa', '-m', '1210', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri'];
    const fcea = ['fcea', '-m', '5000000', '--cp', '--cuit', FCE_RECEIVER_CUIT, '--ir-ri', '--cbu', CBU];
    const period = ['--periodo-desde', flagDate(shift(today, -30)), '--periodo-hasta', flagDate(today)];

    function setOptional(request: Request, id: string, value: string): void {
      const optionals = ((request.Opcionales as Array<{ Id: string; Valor: string }> | undefined) ?? []).filter(
        (optional) => optional.Id !== id,
      );

      request.Opcionales = [...optionals, { Id: id, Valor: value }];
    }

    function removeOptional(request: Request, id: string): void {
      request.Opcionales = (request.Opcionales as Array<{ Id: string }>).filter((optional) => optional.Id !== id);
    }

    function associated(request: Request): Record<string, unknown> {
      return (request.CbtesAsoc as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    }

    interface WsfeCase {
      /** `TESTING LAXO:` ARCA testing no aplica el control y aprueba: el caso queda salteado, con lo que se vio. */
      readonly testingLax?: string;
      /** `BUG:` una diferencia de ARCLI (código, docs o validación) con ARCA, anotada y sin arreglar: el caso se saltea. */
      readonly bug?: string;
      readonly base: () => readonly string[];
      readonly blockedBy?: () => readonly string[];
      readonly codes: readonly number[];
      readonly mutate: (request: Request) => void;
      readonly rule: string;
    }

    let emitter: Record<string, unknown> | undefined;
    /** La cotización oficial del dólar, para las notas FCE en otra moneda. */
    let officialDollar = 0;

    beforeAll(async () => {
      officialDollar = await billing.getQuotation('DOL');
    });
    /** CUIT y punto de venta de la config, para los flags del asociado. */
    const config = (): Record<string, unknown> => (emitter ??= arcli('config').json);

    const ncaOverFa = (): string[] => {
      const invoice = lastVoucher('fa');
      const json = config();

      return [
        'nca',
        '-m',
        '100',
        '--cs',
        '--cuit',
        RECEIVER_CUIT,
        '--ir-ri',
        '--ac',
        'fa',
        '--ar',
        String(invoice.numero),
        '--apv',
        POINT_OF_SALE ?? String(json.puntoVenta),
        '--acuit',
        String(json.cuit),
      ];
    };
    const nceaOverFcea = (): string[] => [
      'ncea',
      '-m',
      '100',
      '--cp',
      '--cuit',
      FCE_RECEIVER_CUIT,
      '--ir-ri',
      '--apv',
      POINT_OF_SALE ?? String(config().puntoVenta),
      '--ac',
      'fcea',
      '--ar',
      String(lastVoucher('fcea').numero),
    ];

    const cases: readonly WsfeCase[] = [
      // Fecha del comprobante
      {
        base: () => fcProducts,
        blockedBy: () => [...fcProducts, '--fecha', flagDate(shift(today, -6))],
        codes: [10016],
        mutate: (request) => (request.CbteFch = shift(today, -6)),
        rule: 'productos con fecha de hoy − 6',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--fecha', flagDate(shift(today, -11))],
        codes: [10016],
        mutate: (request) => {
          request.CbteFch = shift(today, -11);
          request.FchServDesde = shift(today, -11);
          request.FchServHasta = shift(today, -11);
          request.FchVtoPago = shift(today, -11);
        },
        rule: 'servicios con fecha de hoy − 11',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--fecha', flagDate(shift(today, 2))],
        codes: [10016],
        mutate: (request) => {
          request.CbteFch = shift(today, 2);
          request.FchVtoPago = shift(today, 2);
        },
        rule: 'FCE con fecha de hoy + 2',
      },
      // Concepto y fechas de servicio
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--vencimiento', flagDate(shift(today, -1))],
        codes: [10036],
        mutate: (request) => (request.FchVtoPago = shift(today, -1)),
        rule: 'vencimiento de pago anterior a la fecha',
      },
      {
        base: () => fcServices,
        blockedBy: () => [
          ...fcServices,
          '--servicio-desde',
          flagDate(today),
          '--servicio-hasta',
          flagDate(shift(today, -1)),
        ],
        codes: [10032],
        mutate: (request) => (request.FchServHasta = shift(today, -1)),
        rule: 'inicio del servicio posterior al fin',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--servicio-desde', flagDate(today)],
        codes: [10033, 10049],
        mutate: (request) => delete request.FchServHasta,
        rule: 'servicio sin fecha de fin',
      },
      {
        base: () => fcProducts,
        blockedBy: () => [...fcProducts, '--servicio-desde', flagDate(today), '--servicio-hasta', flagDate(today)],
        codes: [10049],
        mutate: (request) => {
          request.FchServDesde = today;
          request.FchServHasta = today;
          request.FchVtoPago = today;
        },
        rule: 'productos con fechas de servicio',
      },
      {
        base: () => fcProducts,
        blockedBy: () => [...fcProducts, '--vencimiento', flagDate(today)],
        codes: [10049],
        mutate: (request) => (request.FchVtoPago = today),
        rule: 'productos (no FCE) con vencimiento de pago',
      },
      {
        base: () => fcea,
        codes: [10163],
        mutate: (request) => delete request.FchVtoPago,
        rule: 'factura FCE sin vencimiento de pago',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--vencimiento', flagDate(shift(today, -1))],
        codes: [10164],
        mutate: (request) => (request.FchVtoPago = shift(today, -1)),
        rule: 'factura FCE con vencimiento anterior a hoy',
      },
      // Receptor
      {
        base: () => ['fb', '-m', '1000', '--cs', '--cfinal'],
        codes: [10015],
        mutate: (request) => (request.DocNro = 12_345_678),
        rule: 'consumidor final con documento distinto de 0',
      },
      {
        base: () => ['fb', '-m', '10000000', '--cs', '--dni', '12345678', '--ir-cf'],
        blockedBy: () => ['fb', '-m', '10000000', '--cs', '--cfinal'],
        codes: [10015],
        mutate: (request) => {
          request.DocTipo = 99;
          request.DocNro = 0;
        },
        rule: 'consumidor final sin identificar desde $ 10.000.000 (RG 5700)',
      },
      {
        base: () => fa,
        blockedBy: () => ['fa', '-m', '1210', '--cs', '--cuit', RECEIVER_CUIT, '--ir-cf'],
        codes: [10243],
        mutate: (request) => (request.CondicionIVAReceptorId = ivaConditionCode('consumidor-final')),
        rule: 'factura A con IVA receptor consumidor final',
      },
      {
        base: () => ['fb', '-m', '1000', '--cs', '--cuit', RECEIVER_CUIT, '--ir-se'],
        blockedBy: () => ['fb', '-m', '1000', '--cs', '--cuit', RECEIVER_CUIT, '--ir-ri'],
        codes: [10243],
        mutate: (request) => (request.CondicionIVAReceptorId = ivaConditionCode('responsable-inscripto')),
        rule: 'factura B con IVA receptor responsable inscripto',
      },
      {
        base: () => fa,
        blockedBy: () => ['fa', '-m', '1210', '--cs', '--dni', '12345678', '--ir-ri'],
        // Testing también devuelve la 10015 ("documento del receptor").
        codes: [10013],
        mutate: (request) => {
          request.DocTipo = 96;
          request.DocNro = 12_345_678;
        },
        rule: 'factura A con DNI',
      },
      {
        base: () => fcea,
        blockedBy: () => ['fceb', '-m', '5000000', '--cp', '--dni', '12345678', '--ir-cf', '--cbu', CBU],
        // Una FCE A con DNI choca también con la 10013; la B a DNI necesitaría un receptor obligado que sea exento.
        codes: [10015, 10013],
        mutate: (request) => {
          request.DocTipo = 96;
          request.DocNro = 12_345_678;
        },
        rule: 'FCE con DNI',
      },
      {
        base: () => fa,
        blockedBy: () => ['fa', '-m', '1210', '--cs', '--cuit', String(config().cuit), '--ir-ri'],
        codes: [10069],
        mutate: (request) => (request.DocNro = Number(config().cuit)),
        rule: 'receptor igual al emisor',
      },
      {
        base: () => ['fb', '-m', '1000', '--cs', '--cuit', RECEIVER_CUIT, '--ir-se'],
        blockedBy: () => ['fb', '-m', '1000', '--cs', '--cuit', UNCATEGORIZED_CUIT, '--ir-snc'],
        codes: [10067],
        mutate: (request) => {
          request.DocNro = Number(UNCATEGORIZED_CUIT);
          request.CondicionIVAReceptorId = ivaConditionCode('sujeto-no-categorizado');
        },
        rule: 'factura B a un No Categorizado con IVA y sin el tributo 13',
      },
      // Comprobantes y período asociados
      {
        base: () => ncaOverFa(),
        blockedBy: () => ncaOverFa().map((arg, index, all) => (all[index - 1] === '--ac' ? 'fb' : arg)),
        codes: [10040],
        mutate: (request) => (associated(request).Tipo = 6),
        rule: 'NC A asociada a una factura B',
      },
      {
        base: () => ncaOverFa(),
        blockedBy: () => [...ncaOverFa(), ...period],
        codes: [10197],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: shift(today, -30), FchHasta: today }),
        rule: 'nota con comprobante y período asociados a la vez',
      },
      {
        base: () => fcServices,
        codes: [10198],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: shift(today, -30), FchHasta: today }),
        rule: 'factura con período asociado',
      },
      {
        base: () => ['ncc', '-m', '1', '--cs', '--cfinal', ...period],
        blockedBy: () => [
          'ncc',
          '-m',
          '1',
          '--cs',
          '--cfinal',
          '--periodo-desde',
          flagDate(today),
          '--periodo-hasta',
          flagDate(shift(today, -30)),
        ],
        codes: [10207],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: today, FchHasta: shift(today, -30) }),
        rule: 'período asociado con el inicio posterior al fin',
      },
      {
        base: () => ['ncc', '-m', '1', '--cs', '--cfinal', ...period],
        blockedBy: () => [
          'ncc',
          '-m',
          '1',
          '--cs',
          '--cfinal',
          '--periodo-desde',
          '31/12/2005',
          '--periodo-hasta',
          flagDate(today),
        ],
        codes: [10206],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: '20051231', FchHasta: today }),
        rule: 'período asociado anterior a 2006',
      },
      {
        base: () => ['ncc', '-m', '1', '--cs', '--cfinal', ...period],
        blockedBy: () => [
          'ncc',
          '-m',
          '1',
          '--cs',
          '--cfinal',
          '--periodo-desde',
          flagDate(shift(today, -30)),
          '--periodo-hasta',
          flagDate(shift(today, 1)),
        ],
        codes: [10208],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: shift(today, -30), FchHasta: shift(today, 1) }),
        rule: 'período asociado que termina después de la nota',
      },
      // NC y ND FCE
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea().slice(0, -4), '--ac', 'fa', '--ar', String(lastVoucher('fa').numero)],
        codes: [10156, 10157],
        mutate: (request) => {
          associated(request).Tipo = 1;
          associated(request).Nro = lastVoucher('fa').numero;
          associated(request).CbteFch = lastVoucher('fa').fecha;
        },
        rule: 'NC FCE sin anulación asociada a una factura común',
      },
      {
        base: () => nceaOverFcea(),
        codes: [10173, 10162, 10170],
        mutate: (request) => delete request.Opcionales,
        rule: 'NC FCE sin el código de anulación',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea(), '--cbu', CBU],
        codes: [10172],
        mutate: (request) => setOptional(request, '2101', CBU),
        rule: 'NC FCE con CBU',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea(), '--vencimiento', flagDate(today)],
        codes: [10175],
        mutate: (request) => (request.FchVtoPago = today),
        rule: 'NC FCE sin anulación con vencimiento de pago',
      },
      {
        base: () => nceaOverFcea(),
        codes: [10158],
        mutate: (request) => delete associated(request).CbteFch,
        rule: 'NC FCE sin la fecha del asociado',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea(), '--afecha', flagDate(shift(today, 1))],
        // El asociado existe con su fecha real: ARCA ve primero que no coincide (10160) y corta ahí.
        codes: [10159, 10160],
        mutate: (request) => (associated(request).CbteFch = shift(today, 1)),
        rule: 'NC FCE con el asociado posterior a la nota',
      },
      {
        base: () => nceaOverFcea(),
        codes: [10155],
        mutate: (request) => (associated(request).Cuit = RECEIVER_CUIT),
        rule: 'NC FCE asociada a un comprobante de otro CUIT',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea(), '--moneda', 'USD'],
        codes: [10181],
        mutate: (request) => {
          request.MonId = 'DOL';
          request.MonCotiz = officialDollar;
        },
        rule: 'NC FCE en otra moneda que su asociado (ni la misma ni pesos)',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => nceaOverFcea().map((arg, index, all) => (all[index - 1] === '--cuit' ? RECEIVER_CUIT : arg)),
        codes: [10183],
        mutate: (request) => (request.DocNro = Number(RECEIVER_CUIT)),
        rule: 'NC FCE a otro receptor que el de su asociado',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => [...nceaOverFcea(), '--afecha', flagDate(shift(lastVoucher('fcea').fecha, -1))],
        codes: [10160],
        mutate: (request) => (associated(request).CbteFch = shift(lastVoucher('fcea').fecha, -1)),
        rule: 'NC FCE con una fecha del asociado anterior a la real',
      },
      {
        base: () => nceaOverFcea(),
        blockedBy: () => ['ncea', '-m', '100', '--cp', '--cuit', FCE_RECEIVER_CUIT, '--ir-ri', ...period],
        codes: [10196],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: shift(today, -30), FchHasta: today }),
        rule: 'NC FCE con período asociado',
      },
      // Opcionales de FCE
      {
        base: () => fcea,
        blockedBy: () => fcea.slice(0, -2),
        codes: [10168],
        mutate: (request) => removeOptional(request, '2101'),
        rule: 'factura FCE sin CBU',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea.slice(0, -1), CBU.slice(0, 21)],
        codes: [10165],
        mutate: (request) => setOptional(request, '2101', CBU.slice(0, 21)),
        rule: 'factura FCE con un CBU de 21 dígitos',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--alias', 'abcde'],
        codes: [10166],
        mutate: (request) => setOptional(request, '2102', 'abcde'),
        rule: 'factura FCE con un alias de 5 caracteres',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--transferencia', 'XYZ'],
        codes: [10215, 10216],
        mutate: (request) => setOptional(request, '27', 'XYZ'),
        rule: 'factura FCE con una transferencia que no es SCA ni ADC',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--anulacion'],
        codes: [10171],
        mutate: (request) => setOptional(request, '22', 'N'),
        rule: 'factura FCE con código de anulación',
      },
      {
        base: () => fa,
        blockedBy: () => [...fa, '--cbu', CBU],
        codes: [10169],
        mutate: (request) => setOptional(request, '2101', CBU),
        rule: 'factura común con CBU',
      },
      // Moneda
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--cm', '2'],
        codes: [10039],
        mutate: (request) => (request.MonCotiz = 2),
        rule: 'pesos con cotización distinta de 1',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--misma-moneda'],
        codes: [10241],
        mutate: (request) => (request.CanMisMonExt = 'S'),
        rule: 'pesos con pago en la misma moneda',
      },
      {
        base: () => [...fcServices, '--moneda', 'USD'],
        blockedBy: () => [...fcServices, '--moneda', 'USD', '--cm', '1'],
        codes: [10119],
        mutate: (request) => (request.MonCotiz = 1),
        rule: 'dólares con cotización 1',
      },
      {
        base: () => [...fcServices, '--moneda', 'USD', '--misma-moneda'],
        // TESTING LAXO: el 19/11/2026 ARCA testing aprobó la Factura C 9-17 en dólares con misma moneda y 1,5 veces la
        // oficial, sin observaciones. Es testing, no ARCLI: la regla (10038/10240) sigue.
        testingLax: 'ARCA testing aprobó misma moneda con 1,5 veces la cotización oficial (fc 9-17, 19/11/2026).',
        // ARCA testing tolera hasta 1 de diferencia con la oficial y rechaza con 10240, no con 10038.
        codes: [10038, 10240],
        mutate: (request) => (request.MonCotiz = Math.round(Number(request.MonCotiz) * 150) / 100),
        rule: 'misma moneda con una cotización distinta de la oficial',
      },
      // Con fecha pasada ARCLI pide la cotización del día hábil anterior (FchCotiz, REGLAS-2), pero ARCA testing no
      // controla la 10038 en una fecha pasada: aprobó un recibo B con 1,5 veces la cotización de ese día (18/11/2026).
      // No hay caso que mandar.
      {
        base: () => [...fcServices, '--moneda', 'USD'],
        blockedBy: () => [...fcServices, '--moneda', 'USD', '--cm', '99999999'],
        // El manual dice "superior en un 400 %": ARCA testing rechaza desde 5 veces la oficial.
        codes: [10119],
        mutate: (request) => (request.MonCotiz = Math.round(Number(request.MonCotiz) * 501) / 100),
        rule: 'cotización mayor al 500 % de la oficial',
      },
      {
        base: () => [...fcServices, '--moneda', 'USD'],
        blockedBy: () => [...fcServices, '--moneda', 'USD', '--cm', '2'],
        codes: [10119],
        mutate: (request) => (request.MonCotiz = Math.round(Number(request.MonCotiz) * 1.9) / 100),
        rule: 'cotización menor al 2 % de la oficial',
      },
      // Importes
      {
        base: () => fa,
        codes: [10048],
        mutate: (request) => (request.ImpTotal = Number(request.ImpTotal) + 1),
        rule: 'total distinto de la suma de sus partes',
      },
      {
        base: () => fa,
        codes: [10070, 10018],
        mutate: (request) => {
          request.ImpNeto = 1210;
          request.ImpIVA = 0;
          delete request.Iva;
        },
        rule: 'neto gravado sin el detalle de IVA',
      },
      {
        base: () => fa,
        codes: [10061, 10051],
        mutate: (request) => ((request.Iva as Array<Record<string, number>>)[0]!.BaseImp = 999),
        rule: 'base imponible distinta del neto',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--exento', '1'],
        codes: [10044],
        mutate: (request) => {
          request.ImpOpEx = request.ImpTotal;
          request.ImpNeto = 0;
        },
        rule: 'letra C con importe exento',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--nogravado', '1'],
        codes: [10043],
        mutate: (request) => {
          request.ImpTotConc = request.ImpTotal;
          request.ImpNeto = 0;
        },
        rule: 'letra C con importe no gravado',
      },
      // TEST-13: bordes que faltaban. Del lado de afuera: ARCA tiene que rechazar con el código del manual.
      {
        base: () => fcProducts,
        blockedBy: () => [...fcProducts, '--fecha', flagDate(shift(today, 6))],
        codes: [10016],
        mutate: (request) => (request.CbteFch = shift(today, 6)),
        rule: 'productos con fecha de hoy + 6',
      },
      {
        base: () => fcServices,
        blockedBy: () => [...fcServices, '--fecha', flagDate(shift(today, 11))],
        codes: [10016],
        mutate: (request) => {
          request.CbteFch = shift(today, 11);
          request.FchServDesde = shift(today, 11);
          request.FchServHasta = shift(today, 11);
          request.FchVtoPago = shift(today, 11);
        },
        rule: 'servicios con fecha de hoy + 11',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--fecha', flagDate(shift(today, -6))],
        codes: [10016],
        mutate: (request) => (request.CbteFch = shift(today, -6)),
        rule: 'FCE con fecha de hoy − 6',
      },
      {
        base: () => fcServices,
        codes: [10031, 10033],
        mutate: (request) => delete request.FchServDesde,
        rule: 'servicio sin fecha de inicio',
      },
      {
        // ARCLI suma los montos de una alícuota repetida: no hay flag que la mande dos veces.
        base: () => fa,
        codes: [10022],
        mutate: (request) =>
          (request.Iva = [
            { BaseImp: 500, Id: 5, Importe: 105 },
            { BaseImp: 500, Id: 5, Importe: 105 },
          ]),
        rule: 'la misma alícuota dos veces en Iva',
      },
      {
        base: () => fa,
        blockedBy: () => [...fa, '--exento', '1000', '--nogravado', '1000'],
        codes: [10045],
        mutate: (request) => {
          request.ImpOpEx = 1000;
          request.ImpTotConc = 1000;
          request.ImpNeto = -790;
          request.ImpIVA = 0;
          delete request.Iva;
        },
        rule: 'exento y no gravado mayores que el total (neto negativo)',
      },
      {
        base: () => ncaOverFa(),
        codes: [10057],
        mutate: (request) => delete associated(request).Tipo,
        rule: 'asociado sin tipo',
      },
      {
        base: () => ncaOverFa(),
        codes: [10058],
        mutate: (request) => delete associated(request).PtoVta,
        rule: 'asociado sin punto de venta',
      },
      {
        base: () => ncaOverFa(),
        codes: [10059],
        mutate: (request) => delete associated(request).Nro,
        rule: 'asociado sin número',
      },
      {
        base: () => nceaOverFcea(),
        codes: [10151],
        mutate: (request) => delete associated(request).Cuit,
        rule: 'NC FCE sin el CUIT del asociado',
      },
      {
        base: () => ['ncc', '-m', '1', '--cs', '--cfinal', ...period],
        codes: [10199, 10203],
        mutate: (request) => (request.PeriodoAsoc = { FchDesde: shift(today, -30) }),
        rule: 'período asociado con una sola fecha',
      },
      {
        base: () => fcea,
        blockedBy: () => [...fcea, '--alias', 'a'.repeat(21)],
        codes: [10166],
        mutate: (request) => setOptional(request, '2102', 'a'.repeat(21)),
        rule: 'factura FCE con un alias de 21 caracteres',
      },
    ];

    for (const testCase of cases) {
      const label = testCase.codes.length > 0 ? testCase.codes.join('/') : 'sin código';

      it.skipIf(Boolean(testCase.testingLax ?? testCase.bug))(`${label}: ${testCase.rule}`, async () => {
        if (testCase.blockedBy) {
          expectCliBlocks(testCase.blockedBy());
        }

        const request = previewRequest(testCase.base());

        testCase.mutate(request);
        expectRejected(await sendWsfe(request), testCase.codes, testCase.rule);
      });
    }
  });

  describe.skipIf(!EXPORT_POINT_OF_SALE)('WSFEX v3.1.0: factura y notas E (ARCLI_ARCA_PV_E)', () => {
    const pv = EXPORT_POINT_OF_SALE ?? '';
    const client = ['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--actividad', '620100', '--pv', pv];
    const servicesArgs = ['fe', '-m', '100', '--pais-destino', '212', ...client];
    const goodsArgs = ['fe', '-m', '100', '--pais-destino', '212', '--tipo-expo', '1', '--incoterm', 'FOB', ...client];

    let nextInvoiceDate: string | undefined;

    /**
     * La fecha de la próxima factura E del punto de venta: hoy, o la de la última si es futura. Después de una E con
     * fecha futura ARCA rechaza las anteriores con 1535, que taparía el código de cada caso.
     */
    function invoiceDate(): string {
      nextInvoiceDate ??= [today, lastVoucher('fe', '--pv', pv).fecha].sort().at(-1) as string;

      return nextInvoiceDate;
    }

    /** `args` con `flag` en `value`: reemplaza el valor si el flag ya está, si no lo agrega. */
    function withFlag(args: readonly string[], flag: string, value: string): string[] {
      const index = args.indexOf(flag);

      return index === -1 ? [...args, flag, value] : [...args.slice(0, index + 1), value, ...args.slice(index + 2)];
    }

    const services = (): string[] => withFlag(servicesArgs, '--fecha', flagDate(invoiceDate()));
    const goods = (): string[] => withFlag(goodsArgs, '--fecha', flagDate(invoiceDate()));

    function firstItem(request: Request): Record<string, unknown> {
      return (request.Items as { Item: Array<Record<string, unknown>> }).Item[0] as Record<string, unknown>;
    }

    interface LastVoucher {
      readonly fecha: string;
      readonly numero: number;
    }

    const lastByType = new Map<string, LastVoucher>();

    /** El último comprobante E (`fe`, `nce`, `nde`) de ese tipo de exportación a otro país, para asociar las notas. */
    function lastOfType(shortcut: 'fe' | 'nce' | 'nde', exportType: 1 | 2): LastVoucher {
      const key = `${shortcut}-${exportType}`;
      const cached = lastByType.get(key);

      if (cached) {
        return cached;
      }

      const { json } = arcli('ultimos', shortcut, '--pv', pv, '--cantidad', '20');
      const vouchers = (json.comprobantes ?? []) as Array<{
        destino?: { codigo?: number };
        fecha: string;
        numero: number;
        tipoExpo: number;
      }>;
      const voucher = vouchers.find((entry) => entry.tipoExpo === exportType && entry.destino?.codigo !== 200);

      if (!voucher) {
        throw new Error(`No hay ${shortcut} de tipo ${exportType} en testing para asociar: emití uno antes.`);
      }

      lastByType.set(key, voucher);

      return voucher;
    }

    const lastInvoice = (exportType: 1 | 2): LastVoucher => lastOfType('fe', exportType);
    const lastServicesInvoice = (): LastVoucher => lastInvoice(2);

    const latest = (...dates: string[]): string => [...dates].sort().at(-1) as string;

    /** La fecha de una nota: no anterior a la del asociado ni a la de la última nota de ese tipo (2052 y 1535). */
    function noteDate(shortcut: 'nce' | 'nde', associatedDate: string): string {
      return latest(today, associatedDate, lastVoucher(shortcut, '--pv', pv).fecha);
    }

    /** Una nota sobre `associated` (por defecto, la última factura E de servicios), con su `--fecha`. */
    function noteOn(
      shortcut: 'nce' | 'nde',
      associatedVoucher: LastVoucher = lastServicesInvoice(),
      ...extra: string[]
    ): string[] {
      return [
        shortcut,
        '-m',
        '1',
        '--ar',
        String(associatedVoucher.numero),
        '--pv',
        pv,
        ...extra,
        '--fecha',
        flagDate(noteDate(shortcut, associatedVoucher.fecha)),
      ];
    }

    const note = (shortcut: 'nce' | 'nde'): string[] => noteOn(shortcut);

    function associated(request: Request): Record<string, unknown> {
      return (request.Cmps_asoc as { Cmp_asoc: Array<Record<string, unknown>> }).Cmp_asoc[0] as Record<string, unknown>;
    }

    interface WsfexCase {
      /** `TESTING LAXO:` ARCA testing no aplica el control y aprueba: el caso queda salteado, con lo que se vio. */
      readonly testingLax?: string;
      /** `BUG:` una diferencia de ARCLI (código, docs o validación) con ARCA, anotada y sin arreglar: el caso se saltea. */
      readonly bug?: string;
      readonly base: () => readonly string[];
      readonly blockedBy?: () => readonly string[];
      readonly codes: readonly number[];
      /** Manda el `Cbte_nro` de la solicitud, no el siguiente de ARCA. */
      readonly keepNumber?: boolean;
      readonly mutate: (request: Request) => void;
      readonly rule: string;
    }

    const cases: readonly WsfexCase[] = [
      {
        // ARCLI no corta: saca la fecha de pago de la factura de bienes y lo avisa.
        base: goods,
        codes: [1673],
        mutate: (request) => (request.Fecha_pago = today),
        rule: 'factura de bienes con fecha de pago',
      },
      {
        base: services,
        codes: [1550],
        mutate: (request) => (request.Permiso_existente = 'N'),
        rule: 'factura de servicios con Permiso_existente N',
      },
      {
        base: goods,
        blockedBy: () => [...goods(), '--permiso', '26001EC01000012X'],
        codes: [1720],
        mutate: (request) => (request.Permisos = { Permiso: [{ Dst_merc: 212, Id_permiso: '26001EC01000012X' }] }),
        rule: 'permisos con Permiso_existente N',
      },
      {
        base: services,
        // Sin el bloque, ARCA aprueba (REGLAS-11): lo que rechaza es el bloque vacío.
        codes: [2100],
        mutate: (request) => (request.Actividades = {}),
        rule: 'bloque Actividades vacío',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--actividad', '999999'),
        codes: [2105],
        mutate: (request) => (request.Actividades = { Actividad: [{ Id: 999_999 }] }),
        rule: 'actividad fuera de la tabla de WSFEX',
      },
      {
        base: services,
        codes: [1820, 1755],
        mutate: (request) => (request.Cmps_asoc = {}),
        rule: 'factura con Cmps_asoc vacío',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--acuit', RECEIVER_CUIT],
        codes: [2031],
        mutate: (request) => (associated(request).Cbte_cuit = Number(RECEIVER_CUIT)),
        rule: 'nota con el asociado de otro CUIT',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--fecha-pago', flagDate(today)],
        codes: [1673],
        mutate: (request) => (request.Fecha_pago = today),
        rule: 'nota con fecha de pago',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--permiso-existente'],
        codes: [1550],
        mutate: (request) => (request.Permiso_existente = 'N'),
        rule: 'nota con Permiso_existente',
      },
      {
        base: () => note('nce'),
        blockedBy: () => noteOn('nce', lastOfType('nce', 2), '--ac', 'nce'),
        codes: [2045],
        mutate: (request) => {
          associated(request).Cbte_tipo = 21;
          associated(request).Cbte_nro = lastOfType('nce', 2).numero;
        },
        rule: 'NC de servicios sobre otra NC',
      },
      {
        base: () => note('nde'),
        blockedBy: () => noteOn('nde', lastOfType('nde', 2), '--ac', 'nde'),
        codes: [2041],
        mutate: (request) => {
          associated(request).Cbte_tipo = 20;
          associated(request).Cbte_nro = lastOfType('nde', 2).numero;
        },
        rule: 'ND de servicios sobre otra ND',
      },
      {
        base: () => note('nde'),
        blockedBy: () => noteOn('nde', lastOfType('nce', 2), '--ac', 'nce'),
        codes: [2042],
        mutate: (request) => {
          associated(request).Cbte_tipo = 21;
          associated(request).Cbte_nro = lastOfType('nce', 2).numero;
        },
        rule: 'ND de servicios sobre una NC',
      },
      {
        base: () => noteOn('nce', lastInvoice(1)),
        blockedBy: () => noteOn('nce', lastInvoice(1), '--tipo-expo', '2'),
        codes: [2049],
        mutate: (request) => {
          request.Tipo_expo = 2;
          delete request.Permisos;
          request.Incoterms = '';
          request.Incoterms_Ds = '';
        },
        rule: 'nota de servicios sobre una factura de bienes',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--pais-destino', '203'],
        codes: [2050],
        mutate: (request) => (request.Dst_cmp = 203),
        rule: 'nota de servicios con otro destino',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--moneda', 'EUR'],
        codes: [2051],
        mutate: (request) => (request.Moneda_Id = '060'),
        rule: 'nota de servicios en otra moneda',
      },
      {
        base: () => note('nce'),
        blockedBy: () => [...note('nce'), '--cotizacion-moneda', '2000'],
        codes: [2053],
        mutate: (request) => (request.Moneda_ctz = Number(request.Moneda_ctz) + 1),
        rule: 'nota de servicios con otra cotización',
      },
      {
        base: () => note('nce'),
        blockedBy: () => withFlag(note('nce'), '--fecha', flagDate(shift(lastServicesInvoice().fecha, -1))),
        // El caso aislado necesita un asociado posterior a la última nota; si no, ARCA corta antes con 1535.
        codes: [2052, 1535],
        mutate: (request) => (request.Fecha_cbte = shift(lastServicesInvoice().fecha, -1)),
        rule: 'nota de servicios anterior al asociado',
      },
      {
        base: () => note('nce'),
        blockedBy: () => ['nce', '-m', '1', '--pv', pv],
        codes: [2047],
        mutate: (request) => delete request.Cmps_asoc,
        rule: 'nota de servicios sin asociado',
      },
      {
        base: services,
        blockedBy: () => withFlag(servicesArgs, '--fecha', flagDate(shift(today, -6))),
        codes: [1500],
        mutate: (request) => {
          request.Fecha_cbte = shift(today, -6);
          request.Fecha_pago = shift(today, -6);
        },
        rule: 'fecha de más de 5 días atrás',
      },
      {
        base: services,
        blockedBy: () => withFlag(servicesArgs, '--fecha', flagDate(shift(today, 6))),
        codes: [1500],
        mutate: (request) => {
          request.Fecha_cbte = shift(today, 6);
          request.Fecha_pago = shift(today, 6);
        },
        rule: 'fecha de más de 5 días adelante',
      },
      {
        base: goods,
        blockedBy: () => withFlag(goods(), '--incoterm', ''),
        codes: [1640],
        mutate: (request) => {
          request.Incoterms = '';
          request.Incoterms_Ds = '';
        },
        rule: 'factura de bienes sin incoterm',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--incoterms-desc', 'Puerto'],
        codes: [1641],
        mutate: (request) => (request.Incoterms_Ds = 'Puerto'),
        rule: 'descripción del incoterm sin incoterm',
      },
      {
        base: goods,
        blockedBy: () => [...goods(), '--incoterms-desc', 'x'.repeat(21)],
        codes: [1642],
        mutate: (request) => (request.Incoterms_Ds = 'x'.repeat(21)),
        rule: 'descripción del incoterm de más de 20 caracteres',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--fecha-pago', flagDate(shift(invoiceDate(), -1))],
        codes: [1674],
        mutate: (request) => (request.Fecha_pago = shift(String(request.Fecha_cbte), -1)),
        rule: 'fecha de pago anterior a la del comprobante',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--cotizacion-moneda', '2'],
        codes: [2053],
        mutate: (request) => (request.Moneda_ctz = Number(request.Moneda_ctz) + 1),
        rule: 'factura de servicios con otra cotización',
      },
      {
        base: () => [...goods(), '--misma-moneda'],
        // TESTING LAXO: el 19/11/2026 ARCA testing aprobó la E de bienes 4-30 con `CanMisMonExt` S y la cotización
        // oficial + 2, sin error 1604. Es testing, no ARCLI: la regla sigue.
        testingLax: 'ARCA testing aprobó misma moneda con la cotización oficial + 2 (fe 4-30, 19/11/2026).',
        blockedBy: () => [...goods(), '--misma-moneda', '--cotizacion-moneda', '2'],
        codes: [1604],
        mutate: (request) => (request.Moneda_ctz = Number(request.Moneda_ctz) + 2),
        rule: 'pago en la misma moneda con otra cotización',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--item', 'Descuento|1|100|99'],
        codes: [1775],
        mutate: (request) => (firstItem(request).Pro_umed = 99),
        rule: 'ítem con unidad 99 y cantidad y precio',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--pv', '99999'),
        codes: [1510],
        keepNumber: true,
        mutate: (request) => (request.Punto_vta = 99_999),
        rule: 'punto de venta mayor a 99998',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--numero', '100000000'],
        codes: [1520],
        keepNumber: true,
        mutate: (request) => (request.Cbte_nro = 100_000_000),
        rule: 'número mayor a 99999999',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--cliente', 'A'.repeat(201)),
        codes: [1651],
        mutate: (request) => (request.Cliente = 'A'.repeat(201)),
        rule: 'cliente de más de 200 caracteres',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--domicilio-cliente', 'A'.repeat(301)),
        codes: [1661],
        mutate: (request) => (request.Domicilio_cliente = 'A'.repeat(301)),
        rule: 'domicilio de más de 300 caracteres',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--observaciones', 'A'.repeat(1001)],
        codes: [1665],
        mutate: (request) => (request.Obs = 'A'.repeat(1001)),
        rule: 'observaciones de más de 1000 caracteres',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--descripcion', 'A'.repeat(4001)],
        codes: [1770],
        mutate: (request) => (firstItem(request).Pro_ds = 'A'.repeat(4001)),
        rule: 'descripción de ítem de más de 4000 caracteres',
      },
      // TEST-13: bordes que faltaban.
      {
        base: services,
        blockedBy: () => withFlag(services(), '--tipo-expo', '3'),
        codes: [1540],
        mutate: (request) => (request.Tipo_expo = 3),
        rule: 'tipo de exportación 3',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--cliente', ' '),
        // El manual dice 1650, pero ARCA testing rechaza el vacío con 1651 ("Campo obligatorio de hasta 200 posiciones").
        codes: [1651],
        mutate: (request) => (request.Cliente = ''),
        rule: 'cliente vacío',
      },
      {
        base: services,
        blockedBy: () => withFlag(services(), '--domicilio-cliente', ' '),
        // El manual dice 1660, pero ARCA testing rechaza el vacío con 1661 ("Campo obligatorio de hasta 300 posiciones").
        codes: [1661],
        mutate: (request) => (request.Domicilio_cliente = ''),
        rule: 'domicilio vacío',
      },
      {
        base: services,
        codes: [1560],
        mutate: (request) => (request.Dst_cmp = 0),
        rule: 'país de destino 0',
      },
      {
        // 1590: "Campo Moneda_id invalido". ARCLI la busca en la tabla de WSFEX y la corta como error de entrada.
        base: services,
        blockedBy: () => [...services(), '--moneda', 'XYZ'],
        codes: [1590],
        mutate: (request) => (request.Moneda_Id = 'XYZ'),
        rule: 'moneda fuera de la tabla',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--idioma', '9'],
        codes: [1630],
        mutate: (request) => (request.Idioma_cbte = 9),
        rule: 'idioma fuera de la tabla',
      },
      {
        base: () => note('nce'),
        codes: [2048],
        mutate: (request) => (associated(request).Cbte_nro = 99_999_999),
        rule: 'nota de servicios con un asociado que no existe',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--obs-comerciales', 'A'.repeat(4001)],
        codes: [1665],
        mutate: (request) => (request.Obs_comerciales = 'A'.repeat(4001)),
        rule: 'observaciones comerciales de más de 4000 caracteres',
      },
      {
        // El manual da el largo (C50) sin código de control: cualquier rechazo sirve.
        // TESTING LAXO: el 19/11/2026 ARCA testing aprobó la E 4-34 con una forma de pago de 51 caracteres. ARCLI sigue
        // cortando en 50, el largo del manual.
        testingLax: 'ARCA testing aprobó una forma de pago de 51 caracteres (fe 4-34, 19/11/2026).',
        base: services,
        blockedBy: () => [...services(), '--forma-pago', 'A'.repeat(51)],
        codes: [],
        mutate: (request) => (request.Forma_pago = 'A'.repeat(51)),
        rule: 'forma de pago de más de 50 caracteres',
      },
      {
        base: services,
        blockedBy: () => [...services(), '--id-impositivo', 'A'.repeat(51)],
        codes: [],
        mutate: (request) => (request.Id_impositivo = 'A'.repeat(51)),
        rule: 'ID impositivo de más de 50 caracteres',
      },
    ];

    for (const testCase of cases) {
      const label = testCase.codes.length > 0 ? testCase.codes.join('/') : 'sin código';

      it.skipIf(Boolean(testCase.testingLax ?? testCase.bug))(`${label}: ${testCase.rule}`, async () => {
        if (testCase.blockedBy) {
          expectCliBlocks(testCase.blockedBy());
        }

        const request = previewRequest(testCase.base());

        testCase.mutate(request);
        expectRejected(await sendWsfex(request, { keepNumber: testCase.keepNumber }), testCase.codes, testCase.rule);
      });
    }
  });
});
