import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgram } from '../program';

// Los comandos de consulta con ARCA mockeado: runtime, cliente y gateways. Verifican el armado de la consulta, la
// salida en texto o JSON y los errores, sin red.
const runtime = {
  certificateNotices: [],
  config: { comprobantesPorLista: undefined as number | undefined },
  environment: 'testing' as const,
  outputJson: false,
  pointOfSale: 3 as number | undefined,
};

vi.mock('../arca-runtime', () => ({ resolveArcaRuntime: () => runtime }));

vi.mock('../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public create(): object {
      return {};
    }
  },
}));

const parameters = {
  getQuotation: vi.fn(),
  getSalesPoints: vi.fn(),
  getServerStatus: vi.fn(),
  listTable: vi.fn(),
};
const history = { getLastNumber: vi.fn(), getVoucher: vi.fn() };
const padron = { getTaxpayer: vi.fn() };
const fce = { getObligation: vi.fn() };

vi.mock('../../services/arca/arca-parameters.gateway', () => ({
  ArcaParametersGateway: class {
    public constructor() {
      return parameters;
    }
  },
}));
vi.mock('../../services/arca/arca-voucher-history.gateway', () => ({
  ArcaVoucherHistoryGateway: class {
    public constructor() {
      return history;
    }
  },
}));
vi.mock('../../services/arca/arca-padron.gateway', () => ({
  ArcaPadronGateway: class {
    public constructor() {
      return padron;
    }
  },
}));
vi.mock('../../services/arca/arca-fce-obligation.gateway', () => ({
  ArcaFceObligationGateway: class {
    public constructor() {
      return fce;
    }
  },
}));

const written: string[] = [];

function output(): string {
  return written.join('');
}

async function run(...args: string[]): Promise<void> {
  await createProgram().parseAsync(['node', 'arcli', ...args]);
}

beforeEach(() => {
  runtime.outputJson = false;
  runtime.pointOfSale = 3;
  runtime.config.comprobantesPorLista = undefined;
  for (const mock of [...Object.values(parameters), ...Object.values(history), padron.getTaxpayer, fce.getObligation]) {
    mock.mockReset();
  }
  written.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));

    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('arcli parametros', () => {
  it('cotizacion: pide la moneda y devuelve el JSON', async () => {
    runtime.outputJson = true;
    parameters.getQuotation.mockResolvedValue({ currency: 'DOL', date: '20261105', rate: 1452.5 });

    await run('parametros', 'cotizacion', 'USD', '--json');

    expect(parameters.getQuotation).toHaveBeenCalledWith('USD');
    expect(JSON.parse(output())).toEqual({ cotizacion: 1452.5, entorno: 'testing', fecha: '20261105', moneda: 'DOL' });
  });

  it('cotizacion sin moneda es un error de entrada, sin consultar', async () => {
    await expect(run('parametros', 'cotizacion')).rejects.toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
    expect(parameters.getQuotation).not.toHaveBeenCalled();
  });

  it('puntos-venta: lista los de ARCA', async () => {
    runtime.outputJson = true;
    parameters.getSalesPoints.mockResolvedValue([{ blocked: false, emissionType: 'CAE - RECE', number: 3 }]);

    await run('parametros', 'puntos-venta', '--json');

    expect(JSON.parse(output())).toMatchObject({ tabla: 'puntos-venta', valores: [{ id: '3' }] });
  });

  it('una tabla en texto', async () => {
    parameters.listTable.mockResolvedValue([{ description: 'Factura A', id: '1' }]);

    await run('parametros', 'comprobantes');

    expect(parameters.listTable).toHaveBeenCalledWith('comprobantes');
    expect(output()).toContain('Factura A');
  });
});

describe('arcli estado', () => {
  it('si ARCA no responde es ARCA_UNAVAILABLE', async () => {
    parameters.getServerStatus.mockRejectedValue(new Error('socket hang up'));

    await expect(run('estado')).rejects.toMatchObject({
      code: 'ARCA_UNAVAILABLE',
      message: 'ARCA no respondió: socket hang up',
    });
  });

  it('con --json devuelve listo y el punto de venta', async () => {
    runtime.outputJson = true;
    parameters.getServerStatus.mockResolvedValue({ app: 'OK', auth: 'OK', db: 'OK' });
    parameters.getSalesPoints.mockResolvedValue([]);

    await run('estado', '--json');

    expect(JSON.parse(output())).toMatchObject({ entorno: 'testing', puntoVenta: { numero: 3 } });
  });
});

describe('arcli ultimos y consultar', () => {
  it('ultimos usa comprobantesPorLista de la config', async () => {
    runtime.outputJson = true;
    runtime.config.comprobantesPorLista = 2;
    history.getLastNumber.mockResolvedValue(10);
    history.getVoucher.mockImplementation(async (number: number) => ({
      date: '20261105',
      documentNumber: 0,
      documentTypeCode: 99,
      ivaAmount: 0,
      netAmount: 100,
      number,
      total: 100,
    }));

    await run('ultimos', 'fc', '--json');

    expect(history.getLastNumber).toHaveBeenCalledWith(3, 11);
    expect(JSON.parse(output()).comprobantes).toHaveLength(2);
  });

  it('ultimos sin punto de venta es un error de entrada, sin consultar', async () => {
    runtime.pointOfSale = undefined;

    await expect(run('ultimos', 'fc')).rejects.toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
    expect(history.getLastNumber).not.toHaveBeenCalled();
  });

  it('un tipo que no existe es un error de entrada', async () => {
    await expect(run('ultimos', 'xx')).rejects.toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
  });

  it('consultar uno que no existe es VOUCHER_NOT_FOUND', async () => {
    history.getVoucher.mockResolvedValue(undefined);

    await expect(run('consultar', 'fb', '14', '--pv', '5')).rejects.toMatchObject({ code: 'VOUCHER_NOT_FOUND' });
    expect(history.getVoucher).toHaveBeenCalledWith(14, 5, 6);
  });

  it('consultar en texto', async () => {
    history.getVoucher.mockResolvedValue({
      cae: '75123456789012',
      date: '20261105',
      documentNumber: 0,
      documentTypeCode: 99,
      ivaAmount: 0,
      netAmount: 100,
      number: 14,
      total: 100,
    });

    await run('consultar', 'fc', '14');

    expect(output()).toContain('75123456789012');
  });
});

describe('arcli padron', () => {
  it('un CUIT que no figura es TAXPAYER_NOT_FOUND, con la sugerencia de testing', async () => {
    padron.getTaxpayer.mockResolvedValue(null);

    await expect(run('padron', '20111111112')).rejects.toMatchObject({
      code: 'TAXPAYER_NOT_FOUND',
      suggestion: expect.stringContaining('testing'),
    });
  });

  it('con --json devuelve el contribuyente', async () => {
    runtime.outputJson = true;
    padron.getTaxpayer.mockResolvedValue({
      activities: [],
      cuit: 20111111112,
      ivaCondition: 'responsable-monotributo',
      name: 'ANA GOMEZ',
      taxes: [],
    });

    await run('padron', '20-11111111-2', '--json');

    expect(padron.getTaxpayer).toHaveBeenCalledWith(20111111112);
    expect(JSON.parse(output())).toMatchObject({ condicionIva: 'responsable-monotributo', entorno: 'testing' });
  });
});

describe('arcli fce-obligado', () => {
  it('consulta con la fecha de --fecha y devuelve el JSON', async () => {
    runtime.outputJson = true;
    fce.getObligation.mockResolvedValue({ minimumAmount: 3958316, obligated: true });

    await run('fce-obligado', '30546689979', '--fecha', '01/11/2026', '--json');

    expect(fce.getObligation).toHaveBeenCalledWith(30546689979, '20261101');
    expect(JSON.parse(output())).toMatchObject({ obligado: true });
  });

  it('un error de ARCA sale tal cual', async () => {
    fce.getObligation.mockRejectedValue(new Error('socket hang up'));

    await expect(run('fce-obligado', '30546689979')).rejects.toThrow('socket hang up');
  });
});
