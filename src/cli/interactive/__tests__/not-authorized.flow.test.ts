import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.types';
import { checkArcaHealth } from '../../../modules/parameters/health';
import { ArcaExportGateway } from '../../../services/arca/arca-export.gateway';
import { ArcaParametersGateway } from '../../../services/arca/arca-parameters.gateway';
import type { Arca } from '../../../services/arca/arca-sdk.types';
import { stripAnsi } from '../../../ui';
import type { CliArcaRuntime } from '../../arca-runtime';
import { formatCliError } from '../../error-output';
import { pickExportVoucher } from '../invoice-picker';
import type { InteractiveSession } from '../session';
import { runStatusFlow } from '../status.flow';

/** El certificado sin autorizar en el asistente (ERR-7), con los gateways reales y el SDK falso. */
const prompts = vi.hoisted(() => ({ chooseStep: vi.fn() }));

vi.mock('../prompts', () => ({ askTextStep: vi.fn(), chooseStep: prompts.chooseStep, fitPageSize: () => 12 }));

const NOT_AUTHORIZED = new Error('ns1:coe.notAuthorized: Computador no autorizado a acceder al servicio');
const rejected = async () => Promise.reject(NOT_AUTHORIZED);
const getLastCmp = vi.fn();

const arca = {
  electronicBillingService: {
    getQuotation: rejected,
    getSalesPoints: rejected,
    getServerStatus: async () => ({ appServer: 'OK', authServer: 'OK', dbServer: 'OK' }),
  },
  wsfexService: { getLastCmp },
} as unknown as Arca;

const session = {
  arca,
  runtime: { config: {}, environment: 'testing', pointOfSale: 3 } as unknown as CliArcaRuntime,
} as InteractiveSession;

/** Lo que muestra el menú (`interactive-mode`) con el error que le llega. */
async function panelOf(run: Promise<unknown>): Promise<string> {
  const error: unknown = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  return stripAnsi(formatCliError(error, false)).replace(/[│┃║╏\s]+/g, ' ');
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sin autorización, en el asistente', () => {
  it('"Estado de ARCA" dice qué autorizar, en vez de un error inesperado con el texto de WSAA', async () => {
    const panel = await panelOf(runStatusFlow(session));

    expect(panel).toContain('El certificado no está autorizado para facturar (servicio wsfe).');
    expect(panel).toContain('Sugerencia Autorizalo en ARCA');
    expect(panel).not.toMatch(/ERROR INESPERADO|notAuthorized/);
  });

  it('el estado de la barra no cambia: FEDummy no pide autorización', async () => {
    await expect(checkArcaHealth({ gateway: new ArcaParametersGateway(arca), now: Date.now })).resolves.toBe(
      'funcionando',
    );
  });

  it('el selector de la E dice qué autorizar y no pregunta nada', async () => {
    const gateway = new ArcaExportGateway(arca, rejected);
    const panel = await panelOf(
      pickExportVoucher(session, gateway, {
        message: '¿Cuál?',
        pointOfSale: 4,
        voucherKind: EXPORT_VOUCHER_KIND,
      }),
    );

    expect(panel).toContain('El certificado no está autorizado para el servicio wsfex');
    expect(panel).not.toMatch(/ERROR INESPERADO|notAuthorized/);
    expect(getLastCmp).not.toHaveBeenCalled();
    expect(prompts.chooseStep).not.toHaveBeenCalled();
  });
});
