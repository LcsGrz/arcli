import type { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareBillingInput } from '../../../modules/billing/billing.prepare';
import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import type { BillingGateway } from '../../../modules/billing/billing.types.internal';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import { ExportService } from '../../../modules/export/export.service';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportVoucherInput,
  type ExportVoucherKind,
} from '../../../modules/export/export.types';
import { buildEquivalentCommand } from '../../../modules/interactive/equivalent-command';
import { buildExportEquivalentCommand } from '../../../modules/interactive/export-equivalent-command';
import { runWizard } from '../../../modules/interactive/wizard';
import type { PadronGateway } from '../../../modules/padron/padron';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { parseBillingCommandPlan } from '../../commands/billing.command.parser';
import { resolveBillingCommandDefaults } from '../../commands/billing.command.shared';
import { parseExportCommandPlan } from '../../commands/export.command.parser';
import { buildInvoiceInput, invoiceSteps } from '../invoice.flow';
import { buildInvoiceInput as buildRepeatInput } from '../invoice.flow';
import { buildNoteInput, noteSteps } from '../note.flow';
import { repeatSteps } from '../repeat.flow';
import type { InteractiveSession } from '../session';

import { captured, parseWithProgram } from './equivalent-command.parse';
import { createScript, type ScriptedAnswer } from './script';

/**
 * Cada flujo del asistente termina mostrando el comando equivalente. Ese comando, pegado en la terminal, tiene que
 * pasar por el parser real y armar la misma solicitud a ARCA que armo el asistente: si no, el comando que se ofrece
 * para automatizar emite otra cosa (o no emite). Se prueba con las comillas de POSIX y de PowerShell.
 */

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
  chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
    script.chooseStepWhileLoading(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
}));

vi.mock('../../commands/export.command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/export.command')>()),
  executeExportCommand: async (command: Command, options: { voucherKind?: ExportVoucherKind } = {}) => {
    captured.push({ command, exportKind: options.voucherKind ?? EXPORT_VOUCHER_KIND });
  },
}));

vi.mock('../../commands/billing.command.shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/billing.command.shared')>()),
  executeBillingCommand: async (command: Command, shortcut: VoucherShortcut) => {
    captured.push({ command, shortcut });
  },
}));

const NOW = new Date('2026-11-18T15:00:00-03:00');

const config = arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 });

const runtime = {
  certificateNotices: [],
  config,
  context: { cert: 'CERT', cuit: 20111111112, key: 'KEY', production: false },
  environment: 'testing',
  outputJson: false,
  outputRaw: false,
  pointOfSale: 3,
} as unknown as ResolvedArcaRuntime;

const padron: PadronGateway = {
  getTaxpayer: async (cuit) => ({
    activities: [],
    address: 'Calle 1',
    cuit,
    ivaCondition: 'responsable-inscripto',
    keyStatus: 'ACTIVO',
    monotributoCategory: null,
    monotributoCategoryLetter: null,
    monotributoCategorySince: null,
    name: 'Cliente SA',
    notices: [],
    personType: 'juridica',
    taxes: [],
  }),
};

const billingGateway: BillingGateway = {
  createVoucher: () => Promise.reject(new Error('no emite')),
  getNextVoucherNumber: () => Promise.reject(new Error('no emite')),
  getQuotation: async () => 1450,
};

function createSession(vouchers: IssuedVoucher[] = []): InteractiveSession {
  const historyGateway: VoucherHistoryGateway = {
    getLastNumber: async () => vouchers.reduce((max, voucher) => Math.max(max, voucher.number), 0),
    getVoucher: async (number) => vouchers.find((voucher) => voucher.number === number),
  };

  return {
    arca: {} as never,
    billingGateway,
    historyGateway,
    runtime: { ...runtime, config: { ...config, consultarPadron: false } } as ResolvedArcaRuntime,
    service: new BillingService(),
  };
}

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261101',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number: 14,
  total: 121,
  ...overrides,
});

/** La solicitud a ARCA que arma una entrada, como `previewAndEmit` y `executeBillingCommand`. */
async function payloadOf(input: BillingCommandInput, withConfig = config) {
  const service = new BillingService();
  const prepared = await prepareBillingInput(service, input, { billing: billingGateway, padron });

  return service.buildVoucherPayload(prepared.input, { ...runtime, config: withConfig } as ResolvedArcaRuntime);
}

/**
 * El comando equivalente del asistente, en las dos shells, arma la misma solicitud que el asistente con la misma
 * config. Devuelve el comando (POSIX) y la entrada que armo el parser, para revisar lo que no va a ARCA (el PDF).
 */
async function expectSameBillingRequest(
  input: BillingCommandInput,
  withConfig = config,
): Promise<{ readonly line: string; readonly parsed: BillingCommandInput }> {
  const expected = await payloadOf(input, withConfig);
  let shown = '';
  let parsed: BillingCommandInput | undefined;

  for (const platform of ['linux', 'win32'] as const) {
    const line = buildEquivalentCommand(input, {
      defaultCurrency: withConfig.monedaPorDefecto,
      environment: 'testing',
      issuerCuit: runtime.context.cuit,
      platform,
    });
    const call = await parseWithProgram(line, platform);

    expect(call.shortcut).toBe(input.shortcut);

    const plan = parseBillingCommandPlan(
      call.command,
      call.shortcut as VoucherShortcut,
      resolveBillingCommandDefaults(withConfig),
    );

    expect(plan.invalidItems).toEqual([]);
    expect(plan.inputs).toHaveLength(1);
    expect(await payloadOf(plan.inputs[0] as BillingCommandInput, withConfig), line).toEqual(expected);

    if (platform === 'linux') {
      shown = line;
      parsed = plan.inputs[0];
    }
  }

  return { line: shown, parsed: parsed as BillingCommandInput };
}

async function invoiceFrom(steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>, receipt = false) {
  script = createScript(steps);

  const session = createSession();
  const state = await runWizard(invoiceSteps(session), {
    advanced: { currencyCode: 'ARS', sameCurrency: false },
    receipt,
  });

  expect(script.remaining()).toBe(0);

  return buildInvoiceInput(state as NonNullable<typeof state>, session);
}

describe('el comando equivalente del asistente pasa por el parser real y arma la misma solicitud', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.mocked(process.stdout.write).mockRestore();
  });

  it('Factura C a consumidor final, de productos', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '1.500,50'],
      [/Agregamos/, []],
    ]);

    expect((await expectSameBillingRequest(input)).line).toMatch(/^arcli fc -m 1500,50/);
  });

  // REV-61: el asistente no guarda numero a consumidor final, pero manda `DocNro` 0 como `--cf`, y con eso la vista
  // previa dice "Receptor: Consumidor final" (billing.display.ts) y no "Número de documento: N/D".
  it('a consumidor final el asistente manda DocNro 0, como el comando equivalente', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '100'],
      [/Agregamos/, []],
    ]);

    expect(await payloadOf(input)).toMatchObject({ DocNro: 0, DocTipo: 99 });
    expect((await expectSameBillingRequest(input)).line).toContain('--consumidor-final');
  });

  it('Factura A a un CUIT, con alícuota, exento, no gravado y fecha del comprobante', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1.165,50'],
      [/Agregamos/, ['Alícuota', 'Importe exento', 'Fecha del comprobante']],
      [/Fecha del comprobante/, '16/11/2026'],
      [/Alícuota/, '10,5%'],
      [/exenta/, '50'],
      [/no gravada/, '10,50'],
    ]);

    await expectSameBillingRequest(input);
  });

  it('Factura B a un DNI, en dólares con la cotización acordada y período de servicio', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura B'],
      [/A quién/, 'Con DNI'],
      [/DNI/, '30123456'],
      [/Condición frente al IVA/, 'Consumidor final'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '100'],
      [/Agregamos/, ['Moneda extranjera', 'Período']],
      [/Moneda del comprobante/, 'Dólares'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.185,50'],
      [/Servicio desde/, '01/10/2026'],
      [/Servicio hasta/, '31/10/2026'],
    ]);

    await expectSameBillingRequest(input);
  });

  it('FCE A con CBU, alias con puntos, transferencia y vencimiento', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura de crédito electrónica A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '5.000.000'],
      [/CBU/, '0110599520000012345678'],
      [/Alias del CBU/, 'mi.alias.cbu'],
      [/Agregamos/, ['Modalidad', 'Vencimiento']],
      [/Vencimiento del pago/, '30/12/2026'],
      [/Modalidad de transferencia/, 'ADC'],
    ]);

    await expectSameBillingRequest(input);
  });

  it('Recibo A a un CUIT', async () => {
    const input = await invoiceFrom(
      [
        [/Qué recibo querés emitir/, 'Recibo A'],
        [/A quién le hacés el recibo/, 'Con CUIT'],
        [/CUIT del receptor/, '30-70996581-2'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '1210'],
        [/Agregamos/, []],
      ],
      true,
    );

    await expectSameBillingRequest(input);
  });

  describe('notas', () => {
    async function noteFrom(
      steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>,
      kind: 'credito' | 'debito',
      vouchers: IssuedVoucher[] = [],
    ) {
      script = createScript(steps);

      const session = createSession(vouchers);
      const state = await runWizard(noteSteps(session, 3), { kind });

      expect(script.remaining()).toBe(0);

      return buildNoteInput(state as NonNullable<typeof state>, session, 3);
    }

    it('NC B por el total de una factura de la lista', async () => {
      const input = await noteFrom(
        [
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura B'],
          [/A qué la asociamos/, 'A una factura'],
          [/Sobre qué factura B/, '00003-00000014'],
          [/Total o parcial/, 'Anular el total'],
          [/Agregamos/, []],
        ],
        'credito',
        [invoice({ exemptAmount: 10, total: 131 })],
      );

      expect((await expectSameBillingRequest(input)).line).toContain('--ar 14');
      // La factura era a consumidor final: la nota copia el receptor y manda `DocNro` 0 (REV-61).
      expect(await payloadOf(input)).toMatchObject({ DocNro: 0, DocTipo: 99 });
    });

    it('ND B en pesos sobre una factura en dólares', async () => {
      const input = await noteFrom(
        [
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura B'],
          [/A qué la asociamos/, 'A una factura'],
          [/Sobre qué factura B/, '00003-00000014'],
          [/En qué moneda va la nota/, 'En pesos'],
          [/Monto de la nota de débito/, '25.000'],
          [/Agregamos/, []],
        ],
        'debito',
        [invoice({ currency: 'DOL', exchangeRate: 1450 })],
      );

      await expectSameBillingRequest(input);
    });

    it('NC A asociada a un período, a un CUIT', async () => {
      const input = await noteFrom(
        [
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura A'],
          [/A qué la asociamos/, 'A un período'],
          [/Período desde/, '01/10/2026'],
          [/Período hasta/, '31/10/2026'],
          [/A quién va la nota/, 'Con CUIT'],
          [/CUIT del receptor/, '30-70996581-2'],
          [/concepto ajusta/, 'Servicios'],
          [/Monto de la nota de crédito/, '1.210'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/^Alícuota de IVA:/, '21%'],
          [/Agregamos/, []],
        ],
        'credito',
      );

      expect((await expectSameBillingRequest(input)).line).toContain('--pd 01/10/2026 --ph 31/10/2026');
    });

    it('NC FCE A de anulación', async () => {
      const input = await noteFrom(
        [
          [/Sobre qué comprobante/, 'Facturas'],
          [/Qué factura\?/, 'Factura de crédito electrónica A'],
          [/Sobre qué factura de crédito electrónica A/, '00003-00000014'],
          [/Total o parcial/, 'Parcial'],
          [/Monto de la nota de crédito/, '60,50'],
          [/Condición frente al IVA/, 'Responsable inscripto'],
          [/rechazó la factura/, 'Sí'],
          [/Agregamos/, []],
        ],
        'credito',
        [invoice({ documentNumber: 30709965812, documentTypeCode: 80 })],
      );

      // En FCE el CUIT del asociado sigue explícito aunque sea el del emisor: ARCA lo exige (10151).
      expect((await expectSameBillingRequest(input)).line).toContain('--acuit 20111111112');
    });

    it('NC C sobre una factura de otro sistema, con su fecha', async () => {
      const arca = {
        electronicBillingService: {
          getSalesPoints: async () => ({ resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] } }),
        },
      };

      script = createScript([
        [/Sobre qué comprobante/, 'Facturas'],
        [/Qué factura\?/, 'Factura C'],
        [/A qué la asociamos/, 'A una factura'],
        [/Sobre qué factura C/, 'Ingresar el número a mano'],
        [/Punto de venta/, '50'],
        [/^Número/, '15'],
        [/^Fecha de la factura C 00050-00000015/, '10/11/2026'],
        [/A quién va la nota/, 'Consumidor final'],
        [/concepto ajusta/, 'Productos'],
        [/Monto de la nota de crédito/, '500'],
        [/Agregamos/, []],
      ]);

      const session = { ...createSession([invoice()]), arca: arca as never };
      const state = await runWizard(noteSteps(session, 3), { kind: 'credito' });

      expect(script.remaining()).toBe(0);
      const input = buildNoteInput(state as NonNullable<typeof state>, session, 3);

      // El asociado es del CUIT emisor: sin `--acuit`, que en una nota común es lo que toma el CLI (REV-59).
      expect((await expectSameBillingRequest(input)).line).toContain('--ac fc --apv 50 --ar 15 --afecha 10/11/2026');
      expect(await payloadOf(input)).toMatchObject({ DocNro: 0, DocTipo: 99 });
    });
  });

  it('el nombre y el domicilio del padrón, con acentos, emoji y comillas, llegan iguales al PDF', async () => {
    const input = await invoiceFrom([
      [/comprobante/, 'Factura A'],
      [/A quién/, 'Con CUIT'],
      [/CUIT del receptor/, '30-70996581-2'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1210'],
      [/Agregamos/, []],
    ]);
    const withReceiver = {
      ...input,
      receiverAddress: 'Av. Córdoba 1234, 5º "B" — C1055AAN',
      receiverName: "O'Brien & Peña S.R.L. 🏢 `$(rm -rf /)`",
    };
    const { parsed } = await expectSameBillingRequest(withReceiver);

    expect(parsed).toMatchObject({
      receiverAddress: withReceiver.receiverAddress,
      receiverName: withReceiver.receiverName,
    });
  });

  it('en pesos con la moneda de la config en dólares, el comando dice --moneda ARS', async () => {
    const inDollars = { ...config, monedaPorDefecto: 'USD' };
    const input = await invoiceFrom([
      [/comprobante/, 'Factura C'],
      [/A quién/, 'Consumidor final'],
      [/Qué estás facturando/, 'Productos'],
      [/Monto total/, '100'],
      [/Agregamos/, ['Moneda extranjera']],
      [/Moneda del comprobante/, 'Pesos'],
    ]);

    expect((await expectSameBillingRequest(input, inDollars)).line).toContain('--moneda ARS');
  });

  it('repetir una Factura C a consumidor final manda DocNro 0, como --cf', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'El mes pasado'],
      [/Agregamos/, []],
    ]);

    const session = createSession([invoice({ ivaAmount: 0, netAmount: 121 })]);
    const state = await runWizard(repeatSteps(session, 3, NOW), {
      advanced: { currencyCode: 'ARS', sameCurrency: false },
    });
    const input = buildRepeatInput(state as NonNullable<typeof state>, session);

    expect((await expectSameBillingRequest(input)).line).toContain('--consumidor-final');
    expect(await payloadOf(input)).toMatchObject({ DocNro: 0, DocTipo: 99 });
  });

  it('repetir una Factura A del mes pasado', async () => {
    script = createScript([
      [/comprobante querés repetir/, 'Factura A'],
      [/Cuál repetimos/, '00003-00000014'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'El mes pasado'],
      [/Agregamos/, []],
    ]);

    const session = createSession([invoice({ documentNumber: 30709965812, documentTypeCode: 80 })]);
    const state = await runWizard(repeatSteps(session, 3, NOW), {
      advanced: { currencyCode: 'ARS', sameCurrency: false },
    });

    await expectSameBillingRequest(buildRepeatInput(state as NonNullable<typeof state>, session));
  });
});

describe('el comando equivalente de la E con textos raros pasa por el parser real', () => {
  const exportGateway: ExportGateway = {
    authorize: () => Promise.reject(new Error('no emite')),
    checkPermit: async () => 'OK',
    getActivities: async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
    getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
    getDestinationCountries: async () => [
      { code: 203, name: 'BRASIL' },
      { code: 212, name: 'ESTADOS UNIDOS' },
    ],
    getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
    getIncoterms: async () => [{ code: 'FOB', name: 'FOB' }],
    getLanguages: async () => [{ id: 1, name: 'Español' }],
    getLastRequestId: async () => 0,
    getLastVoucherNumber: async () => 0,
    getQuotations: async () => [{ code: 'DOL', date: '20261118', rate: 1450 }],
    getUnits: async () => [
      { id: 1, name: 'kilogramos' },
      { id: 7, name: 'unidades' },
    ],
    getVoucher: async (query) => ({
      activities: [620100],
      arcaType: query.arcaType,
      clientAddress: '123 Main St',
      clientCountryCuit: 55000002126,
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      date: '20261101',
      destinationCountry: 212,
      exchangeRate: 1400,
      exportType: 2,
      number: query.number,
      pointOfSale: query.pointOfSale,
      result: 'A',
      total: 1500,
    }),
  };

  const exportRuntime = {
    config: arcliConfigSchema.parse({
      cuit: '20111111112',
      exportacion: { actividad: 620100 },
      puntoVentaPorDefecto: 3,
    }),
    environment: 'testing' as const,
  };

  async function expectSameExportRequest(input: ExportVoucherInput): Promise<void> {
    const service = new ExportService();
    const expected = await service.resolve(input, exportGateway, exportRuntime, NOW);

    for (const platform of ['linux', 'win32'] as const) {
      const line = buildExportEquivalentCommand(input, { activity: 620100, environment: 'testing', platform });
      const call = await parseWithProgram(line, platform);

      expect(call.exportKind?.shortcut).toBe((input.voucherKind ?? EXPORT_VOUCHER_KIND).shortcut);

      const plan = parseExportCommandPlan(call.command, { voucherKind: call.exportKind });
      const resolved = await service.resolve(plan.input, exportGateway, exportRuntime, NOW);

      expect(resolved.payload, line).toEqual(expected.payload);
    }
  }

  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.mocked(process.stdout.write).mockRestore();
  });

  it('cliente con acentos, ñ, apóstrofes, comillas y símbolos de shell', async () => {
    await expectSameExportRequest({
      amount: 1500,
      clientAddress: `Rua São João 1º, "Edifício D'Ávila" $HOME & ; | > \`ls\``,
      clientName: "O'Brien & Peña ‘Ltda’ — Ñandú",
      clientTaxId: '12-3456789',
      currencyCode: 'DOL',
      description: 'Consultoría de software: diseño, análisis y 100% remoto (¡urgente!)',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 2,
      sameCurrency: true,
    });
  });

  it('ítems con descripciones raras, decimales y unidades', async () => {
    await expectSameExportRequest({
      amount: 1500.75,
      clientAddress: '123 Main St',
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 1,
      incoterm: 'FOB',
      incotermDescription: 'FOB Bs. As.',
      items: [
        { description: "Café 'de especialidad' 500 g", quantity: 2.5, unit: 1, unitPrice: 400.3 },
        { description: 'Flete "puerta a puerta"', quantity: 1, unitPrice: 500 },
      ],
      observations: 'Línea con acentos: ñ, ü, ç',
      permits: ['26001EC01000123A'],
      permitsExisting: true,
    });
  });

  it('la fecha del comprobante elegida en los opcionales va con `--fecha` (EXPO-11)', async () => {
    const input: ExportVoucherInput = {
      amount: 1500,
      clientAddress: '123 Main St',
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 2,
      sameCurrency: true,
      voucherDate: '16/11/2026',
    };

    expect(buildExportEquivalentCommand(input, { activity: 620100, environment: 'testing' })).toContain(
      '--fecha 16/11/2026',
    );
    await expectSameExportRequest(input);
    await expectSameExportRequest({
      amount: 500,
      associatedVoucher: { number: 1, pointOfSale: 4 },
      emit: false,
      voucherDate: '17/11/2026',
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    });
  });

  it('una fecha de pago anterior a hoy pero no a la del comprobante va con `--fecha-pago` y el servicio la acepta (EXPO-12)', async () => {
    const input: ExportVoucherInput = {
      amount: 1500,
      clientAddress: '123 Main St',
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 2,
      paymentDate: '17/11/2026',
      sameCurrency: true,
      voucherDate: '16/11/2026',
    };

    expect(buildExportEquivalentCommand(input, { activity: 620100, environment: 'testing' })).toContain(
      '--fecha-pago 17/11/2026',
    );
    await expectSameExportRequest(input);
  });

  it('una NC E sobre la factura, con su asociado', async () => {
    await expectSameExportRequest({
      amount: 500,
      associatedVoucher: { number: 1, pointOfSale: 4 },
      emit: false,
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    });
  });
});
