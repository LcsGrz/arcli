import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { BillingService } from '../../modules/billing/billing.service';
import { arcliConfigSchema } from '../../modules/config/config.schemas';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult } from '../../modules/export/export.types';
import { systemClock } from '../../services/time/system-clock';
import { fakeBillingGateway } from '../../testing/arca-gateways';
import type { CliArcaRuntime } from '../arca-runtime';
import { executeBillingCommand, registerBillingCommandOptions } from '../commands/billing.command.shared';
import { attachExportPdf } from '../commands/export.command.pdf';
import { listSelect } from '../interactive/list-select';
import { previewAndEmit } from '../interactive/session';

/** Los spinners de consultar antes de la vista previa y de generar el PDF: cuándo arrancan y que no quedan girando. */
const log = vi.hoisted(() => [] as string[]);

vi.mock('../spinner', () => ({
  startSpinner: (text: string) => {
    log.push(`gira: ${text}`);

    return { stop: () => log.push('para') };
  },
}));
vi.mock('../interactive/list-select', () => ({ listSelect: vi.fn() }));

const QUERYING = ['gira: Consultando ARCA...', 'para'];
const originalTty = [process.stdin.isTTY, process.stdout.isTTY] as const;

const runtime = (outputJson = false) =>
  ({
    certificateNotices: [],
    config: arcliConfigSchema.parse({
      consultarPadron: false,
      cuit: '20111111112',
      puntoVentaPorDefecto: 3,
      verificarFce: false,
    }),
    cuit: 20111111112,
    environment: 'testing',
    outputJson,
    outputRaw: false,
    pointOfSale: 3,
  }) as unknown as CliArcaRuntime;

/** Una cotización que tarda, como una consulta real. */
const billing = (failure?: Error) =>
  fakeBillingGateway({
    getQuotation: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));

      if (failure) {
        throw failure;
      }

      return 1000;
    },
  });

async function runCommand(
  args: readonly string[],
  options: { readonly failure?: Error; readonly json?: boolean } = {},
): Promise<void> {
  const command = new Command('fc');

  registerBillingCommandOptions(command);
  command.parse(['node', 'fc', '-m', '1000', '--cs', '--cfinal', ...args]);

  await executeBillingCommand(
    command,
    'fc',
    {},
    {
      createGateways: () => ({
        billing: billing(options.failure),
        fce: {} as never,
        fceRegistry: {} as never,
        history: {} as never,
        padron: {} as never,
      }),
      resolveRuntime: () => runtime(options.json),
    },
  );
}

const DOLLARS = ['--moneda', 'USD'];
const session = (failure?: Error) => ({
  arca: {} as never,
  billingGateway: billing(failure),
  historyGateway: {} as never,
  runtime: runtime(),
  service: new BillingService({ clock: systemClock }),
});
const entry = (currencyCode: string) =>
  billingCommandSchema.parse({
    concept: 'servicios',
    currencyCode,
    exchangeRate: currencyCode === 'PES' ? 1 : undefined,
    ivaCondition: 'consumidor-final',
    shortcut: 'fc',
    totalAmount: 1000,
  });

beforeEach(() => {
  log.length = 0;
  [process.stdin.isTTY, process.stdout.isTTY] = [true, true];
  vi.spyOn(process.stdout, 'write').mockImplementation(() => {
    if (log.at(-1) !== 'salida') {
      log.push('salida');
    }

    return true;
  });
  vi.mocked(listSelect).mockImplementation(async () => {
    log.push('pregunta');

    return false as never;
  });
});

afterEach(() => {
  [process.stdin.isTTY, process.stdout.isTTY] = originalTty;
  vi.restoreAllMocks();
});

describe('consultar antes de la vista previa', () => {
  it('en un comando, para antes de mostrar y de preguntar', async () => {
    await runCommand(DOLLARS);

    expect(log).toEqual([...QUERYING, 'salida', 'pregunta', 'salida']);
  });

  it('en el asistente, para antes de mostrar y de preguntar', async () => {
    await previewAndEmit(session(), entry('USD'));

    expect(log).toEqual([...QUERYING, 'salida', 'pregunta', 'salida']);
  });

  it('si la consulta falla, para antes del error', async () => {
    const failure = new Error('ARCA no responde');

    await expect(runCommand(DOLLARS, { failure })).rejects.toBe(failure);
    expect(log).toEqual(QUERYING);

    log.length = 0;
    await expect(previewAndEmit(session(failure), entry('USD'))).rejects.toBe(failure);
    expect(log).toEqual(QUERYING);
  });

  it('con --json no hay spinner', async () => {
    await runCommand(DOLLARS, { json: true });

    expect(log).toEqual(['salida']);
  });

  it('sin consultas a ARCA no parpadea', async () => {
    await runCommand([]);
    await previewAndEmit(session(), entry('PES'));
    // Lo que hubiera quedado programado.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(log.filter((event) => event.startsWith('gira'))).toEqual([]);
  });
});

describe('"Generando PDF..." de la E', () => {
  it('arranca después de preguntar, instalar y cargar el plugin', async () => {
    const result = {
      dryRun: false,
      response: { cae: '75123456789012', status: 'aprobado' },
      voucherKind: EXPORT_VOUCHER_KIND,
    } as unknown as ExportExecutionResult;

    await attachExportPdf(
      result,
      {
        config: arcliConfigSchema.parse({
          cuit: '20111111112',
          emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
        }),
        input: { pdf: true } as never,
        interactive: true,
      },
      {
        confirm: async () => {
          log.push('pregunta');

          return true;
        },
        createPlugin: () =>
          ({
            getStatus: () => ({ installed: false }),
            install: async () => log.push('instala'),
            load: () => {
              log.push('carga');

              // Falla: el test no escribe archivos, y el spinner para igual.
              return { render: () => Promise.reject(new Error('boom')) };
            },
          }) as never,
        resolveFolder: () => '/no-existe',
      },
    );

    expect(log).toEqual([
      'pregunta',
      'gira: Instalando el plugin de PDF...',
      'instala',
      'para',
      'carga',
      'gira: Generando PDF...',
      'para',
    ]);
  });
});
