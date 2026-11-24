import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BillingExecutionResult } from '../../../modules/billing/billing.types.internal';
import { formatBillingOutputs, writeBillingCommandResults, writePdfOutcomes } from '../billing.command.output';

vi.mock('../../../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ui')>();

  return {
    ...actual,
    writeTerminalJson: vi.fn(),
    writeTerminalOutput: vi.fn(),
  };
});

import { stripAnsi, writeTerminalJson, writeTerminalOutput } from '../../../ui';

function createResult(overrides: Partial<BillingExecutionResult> = {}): BillingExecutionResult {
  return {
    dryRun: false,
    environment: 'produccion',
    payload: {
      CbteTipo: 1,
      ImpTotal: 15000,
      PtoVta: 3,
    } as never,
    response: {
      cae: '12345678901234',
      caeVencimiento: '20260331',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: null,
      resultado: 'A',
      suggestions: [],
      status: 'aprobado',
    },
    voucherKind: {
      arcaType: 1,
      displayName: 'Factura A',
      family: 'factura',
      isElectronicCredit: false,
      letter: 'a',
      shortcut: 'fa',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatBillingOutputs', () => {
  it('renders a single result without a batch label', () => {
    const output = formatBillingOutputs([createResult()], { environment: 'produccion', raw: false });

    expect(output).not.toContain('Lote');
  });

  it('labels each result with its position when there is more than one', () => {
    const output = formatBillingOutputs([createResult(), createResult()], {
      environment: 'produccion',
      raw: false,
    });

    expect(output).toContain('Lote 1/2');
    expect(output).toContain('Lote 2/2');
  });
});

describe('writeBillingCommandResults', () => {
  it('writes a single json object, not an array, for a single result', () => {
    writeBillingCommandResults([createResult()], { environment: 'produccion', outputJson: true, raw: false });

    expect(writeTerminalJson).toHaveBeenCalledTimes(1);
    expect(writeTerminalOutput).not.toHaveBeenCalled();

    const [jsonPayload] = vi.mocked(writeTerminalJson).mock.calls[0]!;

    expect(JSON.parse(jsonPayload)).toMatchObject({ cae: '12345678901234' });
    expect(JSON.parse(jsonPayload)).not.toBeInstanceOf(Array);
  });

  it('writes a json array when there is more than one result', () => {
    writeBillingCommandResults([createResult(), createResult()], {
      environment: 'produccion',
      outputJson: true,
      raw: false,
    });

    const [jsonPayload] = vi.mocked(writeTerminalJson).mock.calls[0]!;

    expect(JSON.parse(jsonPayload)).toBeInstanceOf(Array);
    expect(JSON.parse(jsonPayload)).toHaveLength(2);
  });

  it('writes a json array for a one-item batch', () => {
    writeBillingCommandResults([createResult()], {
      batch: true,
      environment: 'produccion',
      outputJson: true,
      raw: false,
    });

    const [jsonPayload] = vi.mocked(writeTerminalJson).mock.calls[0]!;

    expect(JSON.parse(jsonPayload)).toBeInstanceOf(Array);
    expect(JSON.parse(jsonPayload)).toHaveLength(1);
    expect(JSON.parse(jsonPayload)[0]).toMatchObject({ indice: 1 });
  });

  it('writes plain text output instead of json when outputJson is false', () => {
    writeBillingCommandResults([createResult()], { environment: 'produccion', outputJson: false, raw: false });

    expect(writeTerminalOutput).toHaveBeenCalledTimes(1);
    expect(writeTerminalJson).not.toHaveBeenCalled();
  });
});

describe('formatBillingOutputs con un lote de uno', () => {
  it('rotula el resultado como lote aunque sea uno solo, si entro un array en `--cargar`', () => {
    expect(formatBillingOutputs([createResult()], { batch: true, environment: 'produccion', raw: false })).toMatch(
      /^Lote 1\/1\n/,
    );
  });
});

describe('writeBillingCommandResults en texto', () => {
  it('un lote en texto lleva el rotulo de cada resultado', () => {
    writeBillingCommandResults([createResult()], {
      batch: true,
      environment: 'testing',
      outputJson: false,
      raw: false,
    });

    expect(String(vi.mocked(writeTerminalOutput).mock.calls[0]?.[0])).toContain('Lote 1/1');
  });
});

describe('writePdfOutcomes', () => {
  const printed = () =>
    stripAnsi(
      vi
        .mocked(writeTerminalOutput)
        .mock.calls.map(([chunk]) => String(chunk))
        .join('\n'),
    ).replace(/[│┃╏\s]+/g, ' ');

  it('sin PDF ni avisos nuevos no escribe nada', () => {
    const before = [createResult({ warnings: ['Aviso viejo'] })];

    writePdfOutcomes(before, before);

    expect(writeTerminalOutput).not.toHaveBeenCalled();
  });

  it('con un solo comprobante muestra el PDF y solo los avisos que no estaban', () => {
    writePdfOutcomes(
      [createResult({ warnings: ['Aviso viejo'] })],
      [createResult({ pdf: { path: '/tmp/fa-3-1.pdf' }, warnings: ['Aviso viejo', 'Faltan datos del emisor'] })],
    );

    expect(writeTerminalOutput).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('PDF guardado en /tmp/fa-3-1.pdf');
    expect(printed()).toContain('Faltan datos del emisor');
    expect(printed()).not.toContain('Aviso viejo');
    expect(printed()).not.toContain('Lote');
  });

  it('en un lote rotula cada PDF y cada aviso con su posicion, tambien si el PDF fallo', () => {
    writePdfOutcomes(
      [createResult(), createResult()],
      [
        createResult({ pdf: { path: '/tmp/fa-3-1.pdf' } }),
        createResult({
          pdf: { error: { code: 'PDF_PLUGIN_MISSING', message: 'Falta el plugin.', suggestion: 'Instalalo.' } },
          warnings: ['Sin logo'],
        }),
      ],
    );

    expect(printed()).toContain('Lote 1/2: PDF guardado en /tmp/fa-3-1.pdf');
    expect(printed()).toMatch(/Lote 2\/2: PDF no generado/i);
    expect(printed()).toContain('Falta el plugin.');
    expect(printed()).toContain('Lote 2/2: Sin logo');
  });

  it('si antes no habia resultado para esa posicion, todos sus avisos son nuevos', () => {
    writePdfOutcomes([], [createResult({ warnings: ['Nuevo'] })]);

    expect(printed()).toContain('Nuevo');
  });
});
