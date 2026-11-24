import { describe, expect, it } from 'vitest';

import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';

import { BILLING_BASE, CBU_A, CBU_B, CBU_C, CUIT_A, CUIT_B } from './billing-fields.fixtures';
import { billingInput, billingPlan, type Json, pick, type Written } from './input-precedence.fixtures';

/**
 * REV-52: los cruces entre niveles (datos relacionados que vienen de lugares distintos) en A, B, C y FCE. Un flag que
 * cambia a quién, qué comprobante o qué moneda descarta del archivo los datos que dependían del valor anterior.
 */

interface CrossCase {
  /** Los campos, o el error. */
  readonly approved: Json | RegExp;
  readonly name: string;
  readonly shortcut?: VoucherShortcut;
  readonly written: Written;
}

function describeCross(cross: string, cases: readonly CrossCase[]): void {
  it.each(cases)(`${cross}: $name`, ({ approved, shortcut, written }) => {
    if (approved instanceof RegExp) {
      expect(() => billingInput(written, shortcut)).toThrow(approved);
    } else {
      expect(pick(billingInput(written, shortcut), approved)).toEqual(approved);
    }
  });
}

interface KeptCase {
  readonly expected: Json;
  readonly name: string;
  readonly shortcut?: VoucherShortcut;
  readonly written: Written;
}

/** Lo que el arreglo del cruce no tiene que cambiar: vale hoy y después. */
function describeKept(cross: string, cases: readonly KeptCase[]): void {
  it.each(cases)(`${cross}, no cambia: $name`, ({ expected, shortcut, written }) => {
    expect(pick(billingInput(written, shortcut), expected)).toEqual(expected);
  });
}

const RUNTIME = {
  config: {},
  context: { cert: 'CERT', cuit: 20409509763, key: 'KEY', production: false },
  cuit: 20409509763,
  environment: 'testing',
  pointOfSale: 3,
} as unknown as CliArcaRuntime;

/** La solicitud a ARCA, sin red: para los datos opuestos, que son un error recién al armarla. */
function buildRequest(written: Written, shortcut: VoucherShortcut) {
  const [input] = billingPlan(written, shortcut).inputs;

  return new BillingService({ clock: systemClock }).buildVoucherPayload(input as BillingCommandInput, RUNTIME);
}

const base = BILLING_BASE;

describe('cruce 1: la cotización del archivo con otra moneda en el flag', () => {
  const rate = { cotizacionMoneda: 1400 };
  const kept = { exchangeRate: 1400, exchangeRateSource: undefined, fromFile: ['exchangeRate'] };
  const dropped = { exchangeRate: undefined, exchangeRateSource: undefined, fromFile: undefined };

  describeCross('cruce 1', [
    {
      approved: { ...dropped, currencyCode: 'EUR' },
      name: '--moneda EUR sobre USD del archivo',
      written: { args: [...base, '--moneda', 'EUR'], json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      approved: { ...dropped, currencyCode: '060' },
      name: '--mda 060 sobre DOL del archivo',
      shortcut: 'fa',
      written: { args: [...base, '--mda', '060'], json: { ...rate, codigoMoneda: 'DOL' } },
    },
    {
      approved: dropped,
      name: '--moneda ARS sobre USD del archivo',
      shortcut: 'fc',
      written: { args: [...base, '--moneda', 'ARS'], json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      approved: dropped,
      name: 'sin `codigoMoneda`, la del archivo es la de la config: --moneda USD sobre EUR',
      shortcut: 'fcea',
      written: { args: [...base, '--moneda', 'USD'], config: { monedaPorDefecto: 'EUR' }, json: rate },
    },
    {
      approved: dropped,
      name: 'va la oficial aunque la config tenga cotización para esa moneda',
      written: {
        args: [...base, '--moneda', 'EUR'],
        config: { cotizacionPorDefecto: 999, monedaPorDefecto: '060' },
        json: { ...rate, codigoMoneda: 'USD' },
      },
    },
  ]);

  const batch = () =>
    billingPlan({
      args: ['--cs', '--ir-cf', '--moneda', 'EUR'],
      json: [
        { ...rate, codigoMoneda: 'USD', montoTotal: 1 },
        { ...rate, codigoMoneda: 'EUR', montoTotal: 2 },
      ],
    }).inputs.map(({ exchangeRate }) => exchangeRate);

  it('cruce 1: en un lote, la descarta solo el que está en otra moneda', () => {
    expect(batch()).toEqual([undefined, 1400]);
  });

  describeKept('cruce 1', [
    {
      expected: kept,
      name: 'sin `codigoMoneda` ni moneda extranjera en la config, nada contradice a la cotización',
      shortcut: 'ncb',
      written: { args: [...base, '--moneda', 'USD'], json: rate },
    },
    {
      expected: kept,
      name: 'lo mismo con pesos en la config',
      written: { args: [...base, '--moneda', 'USD'], config: { monedaPorDefecto: 'PES' }, json: rate },
    },
    {
      expected: { exchangeRate: 999, exchangeRateSource: 'config' },
      name: 'sin cotización en el archivo, la de la config sigue como siempre',
      written: {
        args: [...base, '--moneda', 'EUR'],
        config: { cotizacionPorDefecto: 999 },
        json: { codigoMoneda: 'USD' },
      },
    },
    {
      expected: kept,
      name: 'USD y DOL son la misma moneda',
      written: { args: [...base, '--moneda', 'USD'], json: { ...rate, codigoMoneda: 'DOL' } },
    },
    {
      expected: kept,
      name: 'USD y DOL, en minúscula y al revés',
      written: { args: [...base, '--moneda', 'dol'], json: { ...rate, codigoMoneda: 'usd' } },
    },
    {
      expected: kept,
      name: 'sin `codigoMoneda`, con la misma de la config',
      written: { args: [...base, '--moneda', 'EUR'], config: { monedaPorDefecto: '060' }, json: rate },
    },
    {
      expected: { ...kept, currencyCode: 'USD' },
      name: 'la moneda de la config no contradice al archivo',
      written: { args: base, config: { monedaPorDefecto: 'EUR' }, json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      expected: { exchangeRate: 1500, fromFile: undefined },
      name: 'con --cm va la del flag',
      written: { args: [...base, '--moneda', 'EUR', '--cm', '1500'], json: { ...rate, codigoMoneda: 'USD' } },
    },
    {
      expected: { currencyCode: 'EUR', exchangeRate: undefined, sameCurrency: true },
      name: '`mismaMoneda` del archivo se conserva con otra moneda',
      written: { args: [...base, '--moneda', 'EUR'], json: { codigoMoneda: 'USD', mismaMoneda: true } },
    },
  ]);

  it.each(['DOL', 'EUR'])('no cambia: `mismaMoneda` con `cotizacionMoneda` en el archivo es un error (%s)', (code) => {
    expect(() =>
      billingInput({
        args: [...base, '--moneda', code],
        json: { ...rate, codigoMoneda: 'USD', mismaMoneda: true },
      }),
    ).toThrow('Con `"mismaMoneda": true` la cotización se toma de ARCA.');
  });
});

describe('cruce 2: el alias de la config con otro CBU', () => {
  const config = { aliasCbu: 'alias.config', cbu: CBU_A };
  const onlyAlias = { aliasCbu: 'alias.config' };

  describeCross('cruce 2', [
    {
      approved: { cbu: CBU_B, cbuAlias: undefined },
      name: '--cbu de otra cuenta',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', CBU_B], config },
    },
    {
      approved: { cbu: CBU_B, cbuAlias: undefined },
      name: '`cbu` del archivo de otra cuenta',
      shortcut: 'fceb',
      written: { args: base, config, json: { cbu: CBU_B } },
    },
    {
      approved: { cbu: CBU_B, cbuAlias: undefined },
      name: 'alias en la config sin CBU, con --cbu',
      shortcut: 'fcec',
      written: { args: [...base, '--cbu', CBU_B], config: onlyAlias },
    },
    {
      approved: { cbu: CBU_B, cbuAlias: undefined },
      name: 'alias en la config sin CBU, con `cbu` del archivo',
      shortcut: 'fcea',
      written: { args: base, config: onlyAlias, json: { cbu: CBU_B } },
    },
    {
      approved: { cbu: CBU_B, cbuAlias: undefined },
      name: 'el alias del archivo con un --cbu distinto del suyo',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', CBU_B], json: { aliasCbu: 'alias.archivo', cbu: CBU_C } },
    },
    {
      approved: { cbu: CBU_A, cbuAlias: 'alias.config' },
      name: 'el --cbu es el de la config: va su alias y no el del archivo, que es de otra cuenta',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', CBU_A], config, json: { aliasCbu: 'alias.archivo', cbu: CBU_C } },
    },
  ]);

  describeKept('cruce 2', [
    {
      expected: { cbu: CBU_A, cbuAlias: 'alias.config' },
      name: '--cbu igual al de la config, con espacios',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', ` ${CBU_A} `], config },
    },
    {
      expected: { cbu: CBU_A, cbuAlias: 'alias.config' },
      name: '`cbu` del archivo igual al de la config',
      shortcut: 'fcea',
      written: { args: base, config, json: { cbu: CBU_A } },
    },
    {
      expected: { cbu: CBU_B, cbuAlias: 'alias.flag' },
      name: '--alias va siempre, también con el CBU del archivo',
      shortcut: 'fcea',
      written: {
        args: [...base, '--alias', 'alias.flag'],
        config,
        json: { aliasCbu: 'alias.archivo', cbu: CBU_B },
      },
    },
    {
      expected: { cbu: CBU_B, cbuAlias: 'alias.archivo' },
      name: 'el alias del archivo va con su CBU',
      shortcut: 'fcea',
      written: { args: base, config, json: { aliasCbu: 'alias.archivo', cbu: CBU_B } },
    },
    {
      expected: { cbu: CBU_B, cbuAlias: 'alias.archivo' },
      name: 'el alias del archivo va con un --cbu igual al suyo',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', CBU_B], config, json: { aliasCbu: 'alias.archivo', cbu: CBU_B } },
    },
    {
      expected: { cbu: CBU_A, cbuAlias: 'alias.archivo' },
      name: 'el alias del archivo, sin CBU, va con el de la config',
      shortcut: 'fcea',
      written: { args: base, config, json: { aliasCbu: 'alias.archivo' } },
    },
    {
      expected: { cbu: CBU_B, cbuAlias: 'alias.archivo' },
      name: 'el alias del archivo, sin CBU, va con el --cbu',
      shortcut: 'fcea',
      written: { args: [...base, '--cbu', CBU_B], config, json: { aliasCbu: 'alias.archivo' } },
    },
  ]);
});

describe('cruce 3: los datos del receptor del archivo con otro documento en el flag', () => {
  const amount = ['--monto', '1000', '--cs'];
  const receiver = {
    ivaReceptor: 'responsable-inscripto',
    receptorDomicilio: 'Calle 1',
    receptorNombre: 'Archivo SA',
  };
  const file = { ...receiver, numeroDocumento: CUIT_A, tipoDocumento: 'cuit' };
  const kept = {
    fromFile: ['receiverAddress', 'receiverName'],
    ivaCondition: 'responsable-inscripto',
    ivaConditionSource: undefined,
    receiverAddress: 'Calle 1',
    receiverName: 'Archivo SA',
  };
  const dropped = { fromFile: undefined, receiverAddress: undefined, receiverName: undefined };
  const exempt = { ivaReceptorPorDefecto: 'sujeto-exento' };

  describeCross('cruce 3', [
    {
      approved: { ...dropped, ivaConditionSource: 'missing' },
      name: 'el archivo trae solo el número, y es otro',
      written: { args: [...amount, '--cuit', String(CUIT_B)], json: { ...receiver, numeroDocumento: CUIT_A } },
    },
    {
      approved: { ...dropped, ivaConditionSource: 'missing' },
      name: 'el archivo trae solo el tipo, y es otro',
      written: { args: [...amount, '--cuit', String(CUIT_B)], json: { ...receiver, tipoDocumento: 'dni' } },
    },
    {
      approved: { ...dropped, documentNumber: CUIT_B, ivaConditionSource: 'missing' },
      name: 'otro --cuit: el IVA sale del padrón',
      shortcut: 'fa',
      written: { args: [...amount, '--cuit', String(CUIT_B)], json: file },
    },
    {
      approved: { ...dropped, ivaCondition: 'sujeto-exento', ivaConditionSource: 'default' },
      name: 'otro --cuit con IVA en la config: el de la config, que el padrón puede corregir',
      written: { args: [...amount, '--cuit', String(CUIT_B)], config: exempt, json: file },
    },
    {
      approved: { ...dropped, ivaCondition: 'sujeto-exento', ivaConditionSource: undefined },
      name: 'otro --cuit con el padrón apagado: el IVA de la config',
      written: {
        args: [...amount, '--cuit', String(CUIT_B)],
        config: { ...exempt, consultarPadron: false },
        json: file,
      },
    },
    {
      approved: /^Falta IVA receptor/,
      name: 'otro --cuit con el padrón apagado y sin config: falta el IVA',
      written: { args: [...amount, '--cuit', String(CUIT_B)], config: { consultarPadron: false }, json: file },
    },
    {
      approved: /^Falta IVA receptor/,
      name: '--dni: falta el IVA',
      shortcut: 'fc',
      written: { args: [...amount, '--dni', '30111222'], json: file },
    },
    {
      approved: { ...dropped, ivaCondition: 'consumidor-final', ivaConditionSource: undefined },
      name: '--cfinal: es consumidor final',
      shortcut: 'rb',
      written: { args: [...amount, '--cfinal'], json: file },
    },
    {
      approved: /^Falta IVA receptor/,
      name: 'el mismo número con otro tipo (--cuil)',
      written: { args: [...amount, '--cuil', String(CUIT_A)], json: file },
    },
    {
      approved: { ...dropped, ivaConditionSource: 'missing' },
      name: '--cuit sobre un consumidor final del archivo',
      shortcut: 'ncb',
      written: {
        args: [...amount, '--cuit', String(CUIT_B)],
        json: { ...receiver, numeroDocumento: 0, tipoDocumento: 'consumidor-final' },
      },
    },
    {
      approved: { ...dropped, ivaCondition: 'sujeto-exento', ivaConditionSource: undefined },
      name: 'con --ir va el del flag, y el nombre y el domicilio del archivo no',
      written: { args: [...amount, '--cuit', String(CUIT_B), '--ir', 'sujeto-exento'], json: file },
    },
    {
      approved: { fromFile: undefined, receiverAddress: undefined, receiverName: 'Flag SA' },
      name: 'con --receptor-nombre, el domicilio del archivo tampoco va',
      written: { args: [...amount, '--cuit', String(CUIT_B), '--receptor-nombre', 'Flag SA'], json: file },
    },
  ]);

  describeKept('cruce 3', [
    {
      expected: { ...kept, documentNumber: CUIT_A },
      name: 'el mismo tipo, con mayúsculas y espacios',
      written: { args: [...amount, '--cuit', String(CUIT_A)], json: { ...file, tipoDocumento: ' CUIT ' } },
    },
    {
      expected: { ...kept, documentNumber: 0 },
      name: '--cfinal sobre un consumidor final sin número',
      written: { args: [...amount, '--cfinal'], json: { ...receiver, tipoDocumento: 'consumidor-final' } },
    },
    {
      expected: { ...kept, documentNumber: CUIT_B },
      name: 'el archivo trae solo el tipo, que es el mismo',
      written: { args: [...amount, '--cuit', String(CUIT_B)], json: { ...receiver, tipoDocumento: 'cuit' } },
    },
    {
      expected: { ...kept, documentNumber: CUIT_A },
      name: 'el archivo trae solo el número, que es el mismo',
      written: { args: [...amount, '--cuit', String(CUIT_A)], json: { ...receiver, numeroDocumento: CUIT_A } },
    },
    {
      expected: { ...kept, documentNumber: CUIT_A },
      name: 'el mismo documento, con guiones',
      written: { args: [...amount, '--cuit', '20-11111111-2'], json: file },
    },
    {
      expected: { ...kept, documentNumber: 0, documentType: 'consumidor-final' },
      name: 'el mismo consumidor final',
      written: {
        args: [...amount, '--cfinal'],
        json: { ...receiver, numeroDocumento: 0, tipoDocumento: 'consumidor-final' },
      },
    },
    {
      expected: { ...kept, documentNumber: CUIT_B, documentType: 'cuit' },
      name: 'un archivo sin documento no contradice nada',
      written: { args: [...amount, '--cuit', String(CUIT_B)], json: receiver },
    },
    {
      expected: { ...kept, documentType: 'consumidor-final' },
      name: '--cfinal con un archivo sin documento: va el IVA del archivo',
      written: { args: [...amount, '--cfinal'], json: receiver },
    },
    {
      expected: { ...kept, documentNumber: CUIT_A },
      name: 'sin flag de documento',
      written: { args: [...amount, '--fecha', '01/10/2026'], json: file },
    },
  ]);

  it('cruce 3: en un lote, solo conserva los datos el que es del mismo documento', () => {
    const other = { numeroDocumento: CUIT_B, tipoDocumento: 'cuit' };
    const plan = billingPlan({
      args: ['--cuit', String(CUIT_B), '--cs'],
      json: [
        { ...file, montoTotal: 1 },
        { ...file, ...other, montoTotal: 2 },
      ],
    });

    expect(plan.inputs.map(({ receiverName }) => receiverName)).toEqual([undefined, 'Archivo SA']);
  });
});

const VOUCHER_FILE = { comprobanteAsociado: { atajo: 'fb', numero: 5, puntoVenta: 1 } };
const VOUCHER = { numero: 5, puntoVenta: 1, shortcut: 'fb' };
const VOUCHER_FLAGS = ['--ac', 'fb', '--ar', '5', '--apv', '1'];
const PERIOD_FILE = { periodoAsociado: { desde: '01/09/2026', hasta: '30/09/2026' } };
const PERIOD = { desde: '01/09/2026', hasta: '30/09/2026' };
const PERIOD_FLAGS = ['--pd', '01/09/2026', '--ph', '30/09/2026'];

describe('cruce 4: comprobante y período asociado en niveles distintos', () => {
  describeCross('cruce 4', [
    ...[
      ['--ac', 'fb'],
      ['--at', '6'],
      ['--ar', '5'],
      ['--apv', '1'],
    ].map((flag) => ({
      approved: { associatedPeriod: undefined },
      name: `${flag[0]} solo`,
      shortcut: 'ncb' as const,
      written: { args: [...base, ...flag], json: PERIOD_FILE },
    })),
    {
      approved: { associatedPeriod: undefined, associatedVoucher: { ...VOUCHER, numero: 9 } },
      name: '--ar sobre un archivo con los dos: gana el comprobante',
      shortcut: 'ncb',
      written: { args: [...base, '--ar', '9'], json: { ...VOUCHER_FILE, ...PERIOD_FILE } },
    },
    {
      approved: { associatedPeriod: { ...PERIOD, hasta: '15/09/2026' }, associatedVoucher: undefined },
      name: '--ph sobre un archivo con los dos: gana el período',
      shortcut: 'ncb',
      written: { args: [...base, '--ph', '15/09/2026'], json: { ...VOUCHER_FILE, ...PERIOD_FILE } },
    },
    {
      approved: { associatedPeriod: undefined, associatedVoucher: VOUCHER },
      name: '--ac, --ar y --apv con `periodoAsociado` del archivo',
      shortcut: 'ncb',
      written: { args: [...base, ...VOUCHER_FLAGS], json: PERIOD_FILE },
    },
    {
      approved: { associatedPeriod: PERIOD, associatedVoucher: undefined },
      name: '--pd y --ph con `comprobanteAsociado` del archivo',
      shortcut: 'ndb',
      written: { args: [...base, ...PERIOD_FLAGS], json: VOUCHER_FILE },
    },
  ]);

  it.each([
    ['en los flags', { args: [...base, ...VOUCHER_FLAGS, ...PERIOD_FLAGS] }],
    ['en el archivo', { args: base, json: { ...VOUCHER_FILE, ...PERIOD_FILE } }],
    [
      'en el archivo, con --afecha',
      { args: [...base, '--afecha', '01/09/2026'], json: { ...VOUCHER_FILE, ...PERIOD_FILE } },
    ],
    ['(--acuit solo y el período del archivo)', { args: [...base, '--acuit', String(CUIT_A)], json: PERIOD_FILE }],
  ])('no cambia: los dos %s son un error', (_name, written: Written) => {
    expect(() => buildRequest(written, 'ncb')).toThrow(
      'Usá un comprobante asociado (`--ac`/`--at`) o un período asociado (`--periodo-desde`/`--periodo-hasta`), pero no ambos.',
    );
  });
});

describe('cruce 5: `--vto` y `dia` en niveles distintos', () => {
  describeCross('cruce 5', [
    {
      approved: { dueDay: undefined, fromFile: undefined, paymentDueDate: '30/11/2026' },
      name: '--vto sobre un archivo con los dos',
      written: { args: [...base, '--vto', '30/11/2026'], json: { dia: 10, vencimientoPago: '01/11/2026' } },
    },
    {
      approved: { dueDay: 12, fromFile: undefined, paymentDueDate: undefined },
      name: '--dia sobre un archivo con los dos',
      written: { args: [...base, '--dia', '12'], json: { dia: 10, vencimientoPago: '01/11/2026' } },
    },
    {
      approved: { dueDay: undefined, fromFile: undefined, paymentDueDate: '30/11/2026' },
      name: '--vto con `dia` del archivo',
      written: { args: [...base, '--vto', '30/11/2026'], json: { dia: 10 } },
    },
    {
      approved: { dueDay: undefined, fromFile: undefined, paymentDueDate: '30/11/2026' },
      name: '--vencimiento con `dia` del archivo, en una FCE',
      shortcut: 'fcea',
      written: { args: [...base, '--vencimiento', '30/11/2026'], json: { dia: 10 } },
    },
    {
      approved: { dueDay: 10, paymentDueDate: undefined },
      name: '--dia con `vencimientoPago` del archivo',
      shortcut: 'fc',
      written: { args: [...base, '--dia', '10'], json: { vencimientoPago: '30/11/2026' } },
    },
  ]);

  it.each([
    ['en los flags', { args: [...base, '--vto', '30/11/2026', '--dia', '10'] }],
    ['en el archivo', { args: base, json: { dia: 10, vencimientoPago: '30/11/2026' } }],
  ])('no cambia: los dos %s son un error', (_name, written: Written) => {
    expect(() => buildRequest(written, 'fb')).toThrow('dejá solo `--vencimiento` o `--vto`.');
  });
});

describe('cruce 6: una sola punta del período en el flag', () => {
  describeCross('cruce 6', [
    {
      approved: { associatedPeriod: { desde: '15/09/2026', hasta: '30/09/2026' } },
      name: '--periodo-desde con el período entero en el archivo',
      shortcut: 'ncc',
      written: { args: [...base, '--periodo-desde', '15/09/2026'], json: PERIOD_FILE },
    },
    {
      approved: { associatedPeriod: { desde: '01/09/2026', hasta: '15/09/2026' } },
      name: '--ph con el período entero en el archivo',
      shortcut: 'nda',
      written: { args: [...base, '--ph', '15/09/2026'], json: PERIOD_FILE },
    },
    {
      approved: { associatedPeriod: { desde: '01/09/2026', hasta: '15/09/2026' } },
      name: '--pd con solo `hasta` en el archivo',
      shortcut: 'ncb',
      written: { args: [...base, '--pd', '01/09/2026'], json: { periodoAsociado: { hasta: '15/09/2026' } } },
    },
  ]);
});

describe('cruce A: un flag que apunta a otro comprobante asociado', () => {
  const own = { cuit: String(CUIT_A), fecha: '01/09/2026' };
  const file = { atajo: 'fb', numero: 1, puntoVenta: 2 };
  const json = { comprobanteAsociado: { ...file, ...own } };

  it.each<[string, string[], Json]>([
    ['otro tipo con --ac', ['--ac', 'ndb'], { numero: 1, puntoVenta: 2, shortcut: 'ndb' }],
    ['otro tipo con --at', ['--at', '7'], { numero: 1, puntoVenta: 2, tipo: 7 }],
    ['un atajo que no existe', ['--ac', 'zz'], { numero: 1, puntoVenta: 2, shortcut: 'zz' }],
    ['otro número', ['--ar', '9'], { numero: 9, puntoVenta: 2, shortcut: 'fb' }],
    ['otro punto de venta', ['--apv', '4'], { numero: 1, puntoVenta: 4, shortcut: 'fb' }],
    [
      'otro número con su fecha: no va el CUIT',
      ['--ar', '9', '--afecha', '05/09/2026'],
      { fecha: '05/09/2026', numero: 9, puntoVenta: 2, shortcut: 'fb' },
    ],
  ])('%s descarta la fecha y el CUIT del archivo', (_name, args, expected) => {
    expect(billingInput({ args: [...base, ...args], json }, 'ncb').associatedVoucher).toEqual(expected);
  });

  it.each<[string, string[], Json]>([
    [
      'los mismos valores',
      ['--ac', 'fb', '--ar', '1', '--apv', '2'],
      { ...own, numero: 1, puntoVenta: 2, shortcut: 'fb' },
    ],
    ['el mismo tipo, por su código', ['--at', '6'], { ...own, numero: 1, puntoVenta: 2, tipo: 6 }],
    ['la fecha', ['--afecha', '05/09/2026'], { ...own, fecha: '05/09/2026', numero: 1, puntoVenta: 2, shortcut: 'fb' }],
  ])('%s no descarta nada', (_name, args, expected) => {
    expect(billingInput({ args: [...base, ...args], json }, 'ncb').associatedVoucher).toEqual(expected);
  });

  it('lo que el archivo no trae no contradice nada', () => {
    const written = { args: [...base, '--ac', 'fb', '--ar', '9'], json: { comprobanteAsociado: own } };

    expect(billingInput(written, 'ncb').associatedVoucher).toEqual({ ...own, numero: 9, shortcut: 'fb' });
  });
});

describe('cruces que quedan así (decidido)', () => {
  it.each([
    ['--ar', '0'],
    ['--apv', '0'],
    ['--afecha', ''],
  ])(
    'B (decidido: queda así): %s %j solo se ignora y queda el del archivo (con otro flag del asociado es un error)',
    (flag, value) => {
      const json = { comprobanteAsociado: { fecha: '01/09/2026', numero: 5, puntoVenta: 1 } };
      const input = billingInput({ args: [...base, flag, value], json }, 'ncb');

      expect(input.associatedVoucher).toEqual(json.comprobanteAsociado);
    },
  );

  it('B (decidido: queda así): con otro flag del asociado, `--ar 0` sí se lee y es un error', () => {
    expect(() => billingInput({ args: [...base, '--ar', '0', '--apv', '2'], json: VOUCHER_FILE }, 'ncb')).toThrow(
      /too_small/,
    );
  });

  it('`--pd ""` con `--ph` no pierde el `desde` del archivo', () => {
    expect(
      billingInput({ args: [...base, '--pd', '', '--ph', '15/09/2026'], json: PERIOD_FILE }, 'ncb').associatedPeriod,
    ).toEqual({ ...PERIOD, hasta: '15/09/2026' });
  });

  it('`--moneda ""` no descarta la cotización del archivo: es el error de siempre', () => {
    expect(() =>
      billingInput({ args: [...base, '--moneda', ''], json: { codigoMoneda: 'USD', cotizacionMoneda: 1400 } }),
    ).toThrow(/currencyCode/);
  });

  it('B (decidido: queda así): `--pd ""` se ignora y queda el período del archivo', () => {
    expect(billingInput({ args: [...base, '--pd', ''], json: PERIOD_FILE }, 'ncb').associatedPeriod).toEqual(PERIOD);
  });

  it('C (decidido: queda así): `--cp` con fechas de servicio en el archivo es el error de productos: no gana el flag', () => {
    const written = {
      args: ['--monto', '1000', '--ir-cf', '--cp'],
      json: { concepto: 'servicios', servicioDesde: '01/09/2026', servicioHasta: '30/09/2026' },
    };

    expect(() => buildRequest(written, 'fb')).toThrow('El concepto "productos" no usa fechas de servicio.');
  });
});
