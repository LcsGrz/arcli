import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArcliConfig } from '../../../modules/config/config.schemas';
import {
  EXPORT_VOUCHER_KIND,
  type ExportExecutionResult,
  type ExportVoucherInput,
} from '../../../modules/export/export.types';
import { exportExportacionPdf } from '../../../services/pdf/pdf-exporter';
import type { PdfPlugin } from '../../../services/pdf/pdf-plugin';
import type { PdfStepDependencies } from '../billing.command.pdf';
import { attachExportPdf } from '../export.command.pdf';

vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../../services/pdf/pdf-exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/pdf/pdf-exporter')>()),
  exportExportacionPdf: vi.fn(async () => '/tmp/factura-e.pdf'),
}));

const COMPLETE_ISSUER = { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' };

const CONFIG = {
  cert: {},
  cuit: '20123456786',
  emisor: {},
  entornoPorDefecto: 'testing',
  key: {},
  output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
  pdf: 'siempre',
} satisfies ArcliConfig;

const RESULT = {
  dryRun: false,
  response: { cae: '76123456789012', status: 'aprobado' },
  voucherKind: EXPORT_VOUCHER_KIND,
} as unknown as ExportExecutionResult;

const INPUT = {} as ExportVoucherInput;

function createDeps(answers: boolean[] = []): PdfStepDependencies {
  return {
    confirm: async () => answers.shift() ?? false,
    createPlugin: () =>
      ({ getStatus: () => ({ installed: true }), load: async () => ({ render: vi.fn() }) }) as unknown as PdfPlugin,
    resolveFolder: () => '/tmp',
  };
}

describe('attachExportPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con flags, sin los datos del emisor, devuelve el error sin preguntar nada', async () => {
    const result = await attachExportPdf(RESULT, { config: CONFIG, input: INPUT, interactive: true }, createDeps());

    expect(result.pdf).toMatchObject({ error: { code: 'PDF_ISSUER_INCOMPLETE' } });
    expect(exportExportacionPdf).not.toHaveBeenCalled();
  });

  it('en el modo interactivo genera el PDF con los datos que se completaron', async () => {
    const completed = { ...CONFIG, emisor: COMPLETE_ISSUER };
    const completeConfig = vi.fn(async () => completed);

    const result = await attachExportPdf(
      RESULT,
      { completeConfig, config: CONFIG, input: INPUT, interactive: true },
      createDeps(),
    );

    expect(completeConfig).toHaveBeenCalledWith(CONFIG);
    expect(result.pdf).toEqual({ path: '/tmp/factura-e.pdf' });
    expect(vi.mocked(exportExportacionPdf).mock.calls[0]?.[0]).toMatchObject({ config: completed });
  });

  it('no pide los datos del emisor si se responde que no al PDF', async () => {
    const completeConfig = vi.fn(async () => CONFIG);

    const result = await attachExportPdf(
      RESULT,
      { completeConfig, config: { ...CONFIG, pdf: 'preguntar' }, input: INPUT, interactive: true },
      createDeps([false]),
    );

    expect(completeConfig).not.toHaveBeenCalled();
    expect(result.pdf).toBeUndefined();
  });

  it('deja pasar la cancelacion mientras se piden los datos, sin generar nada', async () => {
    const cancelled = new Error('cancelado');

    await expect(
      attachExportPdf(
        RESULT,
        { completeConfig: async () => Promise.reject(cancelled), config: CONFIG, input: INPUT, interactive: true },
        createDeps(),
      ),
    ).rejects.toBe(cancelled);
    expect(exportExportacionPdf).not.toHaveBeenCalled();
  });
});
