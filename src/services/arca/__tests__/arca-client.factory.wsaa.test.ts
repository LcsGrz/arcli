import {
  AccessTicket,
  ArcaServiceNames,
  type Context,
  FileSystemTicketStorage,
  type ITicketStoragePort,
  MemoryTicketStorage,
  SoapClient,
} from '@arcasdk/core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENSSL_WARM_UP_TIMEOUT_MS } from '../../../lib/security/__tests__/self-signed-certificate';
import { CONFIG_DEFAULTS } from '../../../modules/config/config.schemas';
import type { ExportGateway } from '../../../modules/export/export.gateway';
import { ExportService } from '../../../modules/export/export.service';
import { cacheExportTables } from '../../../modules/export/export.table-cache';
import { systemClock } from '../../time/system-clock';
import { ArcaClientFactory } from '../arca-client.factory';

/**
 * Donde quedan los tickets con `Arca`, `AuthRepository` y los almacenamientos verdaderos del SDK (REV-48). Solo se
 * simulan las respuestas SOAP: los clientes son los del WSDL incluido, con un transporte que falla si se usa la red.
 */
const CUIT = 20123456786;
const LOGIN_RESPONSE = `<loginTicketResponse version="1.0"><header><source>CN=wsaa</source><destination>CN=arcli</destination>
<uniqueId>1</uniqueId><generationTime>2026-01-01T00:00:00-03:00</generationTime>
<expirationTime>2999-01-01T00:00:00-03:00</expirationTime></header>
<credentials><token>TOKEN</token><sign>SIGN</sign></credentials></loginTicketResponse>`;

const login = vi.fn(async () => [{ loginCmsReturn: LOGIN_RESPONSE }]);
const wsfex = vi.fn(async (_params: unknown) => [
  { FEXGetLast_CMPResult: { FEXErr: { ErrCode: 0 }, FEXResult_LastCMP: { Cbte_nro: 41 } } },
]);
const wsfe = vi.fn(async (_params: unknown) => [{ FEParamGetPtosVentaResult: {} }]);

/** Las lecturas de WSFEX de una factura E, con una fila cada una; `FEXGetLast_CMP` es `wsfex`. */
const EXPORT_READS: Readonly<Record<string, Record<string, unknown>>> = {
  FEXGetLast_ID: { FEXGetLast_IDResult: { FEXResultGet: { Id: 7 } } },
  FEXGetPARAM_Actividades: {
    FEXGetPARAM_ActividadesResult: {
      FEXResultGet: { ClsFEXResponse_ActividadTipo: [{ Desc: 'SERVICIOS', Id: 620100 }] },
    },
  },
  FEXGetPARAM_DST_CUIT: {
    FEXGetPARAM_DST_CUITResult: {
      FEXResultGet: { ClsFEXResponse_DST_cuit: [{ DST_CUIT: 55000000052, DST_Ds: 'CHILE - Persona Jurídica' }] },
    },
  },
  FEXGetPARAM_DST_pais: {
    FEXGetPARAM_DST_paisResult: { FEXResultGet: { ClsFEXResponse_DST_pais: [{ DST_Codigo: 202, DST_Ds: 'CHILE' }] } },
  },
  FEXGetPARAM_Idiomas: {
    FEXGetPARAM_IdiomasResult: { FEXResultGet: { ClsFEXResponse_Idi: [{ Idi_Ds: 'Español', Idi_Id: 1 }] } },
  },
  FEXGetPARAM_Incoterms: {
    FEXGetPARAM_IncotermsResult: { FEXResultGet: { ClsFEXResponse_Inc: [{ Inc_Ds: 'Free on Board', Inc_Id: 'FOB' }] } },
  },
  FEXGetPARAM_MON: {
    FEXGetPARAM_MONResult: { FEXResultGet: { ClsFEXResponse_Mon: [{ Mon_Ds: 'Dólar', Mon_Id: 'DOL' }] } },
  },
  FEXGetPARAM_MON_CON_COTIZACION: {
    FEXGetPARAM_MON_CON_COTIZACIONResult: {
      FEXResultGet: { ClsFEXResponse_Mon_CON_Cotizacion: [{ Fecha_ctz: '01/01/2026', Mon_ctz: 900.5, Mon_Id: 'DOL' }] },
    },
  },
  FEXGetPARAM_UMed: {
    FEXGetPARAM_UMedResult: { FEXResultGet: { ClsFEXResponse_UMed: [{ Umed_Ds: 'unidades', Umed_Id: 7 }] } },
  },
};
const exportReads = vi.fn((name: string) => EXPORT_READS[name]);

let pemDirectory = '';
let directory = '';
let ticketPath = '';

function runtime(): Parameters<ArcaClientFactory['createExportGateway']>[0] {
  const cert = readFileSync(join(pemDirectory, 'cert.pem'), 'utf8');
  const key = readFileSync(join(pemDirectory, 'key.pem'), 'utf8');

  return {
    certificateExpiry: undefined,
    config: { ...CONFIG_DEFAULTS, cert: { testing: 'cert.pem' }, key: { testing: 'key.pem' } },
    context: { cert, cuit: CUIT, key, production: false, ticketPath } satisfies Context,
    environment: 'testing',
  };
}

/** Una factura E que consulta todo WSFEX. */
function resolveInvoice(gateway: ExportGateway) {
  return new ExportService({ clock: systemClock }).resolve(
    {
      activity: 620100,
      amount: 1500,
      clientAddress: 'Alameda 100',
      clientName: 'ACME LTDA',
      destinationCountry: '202',
      emit: false,
      exportType: 1,
      incoterm: 'FOB',
      pointOfSale: 3,
    },
    gateway,
    { config: CONFIG_DEFAULTS, cuit: CUIT, environment: 'testing' },
  );
}

/** Lo unico que ARCLI le suma a un pedido: la señal de su plazo (`soap-deadline.ts`). */
const withDeadline = { signal: expect.any(AbortSignal) as AbortSignal };

/** WSFE y WSFEX: los dos servicios piden y guardan su ticket. */
async function useBothServices(factory: ArcaClientFactory): Promise<void> {
  await factory.create(runtime()).electronicBillingService.getSalesPoints();

  expect(await factory.createExportGateway(runtime()).getLastVoucherNumber(19, 3)).toBe(41);
  expect(wsfe).toHaveBeenCalledWith(
    expect.objectContaining({ Auth: expect.objectContaining({ Token: 'TOKEN' }) }),
    withDeadline,
  );
  expect(wsfex).toHaveBeenCalledWith({ Auth: expect.objectContaining({ Token: 'TOKEN' }) }, withDeadline);
  // Uno por servicio: el ticket de WSFEX del autenticador lo reusa el cliente.
  expect(login).toHaveBeenCalledTimes(2);
}

beforeAll(() => {
  pemDirectory = mkdtempSync(join(tmpdir(), 'arcli-wsaa-pem-'));
  // RSA: el SDK no firma el pedido a WSAA con claves EC.
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '10', '-subj', '/CN=arcli-test'],
      ...['-keyout', join(pemDirectory, 'key.pem'), '-out', join(pemDirectory, 'cert.pem')],
    ],
    { stdio: 'ignore' },
  );
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(() => rmSync(pemDirectory, { force: true, recursive: true }));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-wsaa-'));
  ticketPath = join(directory, 'tickets');
  exportReads.mockClear();
  login.mockReset();
  login.mockImplementation(async () => [{ loginCmsReturn: LOGIN_RESPONSE }]);
  wsfe.mockClear();
  wsfex.mockClear();

  const createClient = SoapClient.prototype.createClient;

  vi.spyOn(SoapClient.prototype, 'createClient').mockImplementation(async function (
    this: SoapClient,
    name: Parameters<typeof createClient>[0],
    options: Parameters<typeof createClient>[1],
  ) {
    return createClient.call(this, name, {
      ...options,
      httpClient: {
        request: () => {
          throw new Error('El test no puede usar la red.');
        },
      } as never,
    });
  });

  const setEndpoint = SoapClient.prototype.setEndpoint;

  // Despues de `setEndpoint`, que vuelve a armar los metodos del WSDL.
  vi.spyOn(SoapClient.prototype, 'setEndpoint').mockImplementation(function (this: SoapClient, client, endpoint) {
    setEndpoint.call(this, client, endpoint);
    Object.assign(client, { FEParamGetPtosVentaAsync: wsfe, FEXGetLast_CMPAsync: wsfex, loginCmsAsync: login });
    Object.assign(
      client,
      Object.fromEntries(Object.keys(EXPORT_READS).map((name) => [`${name}Async`, async () => [exportReads(name)]])),
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { force: true, recursive: true });
});

describe('ArcaClientFactory: tickets de WSAA con el SDK verdadero', () => {
  it('por defecto los guarda en ticketPath', async () => {
    await useBothServices(new ArcaClientFactory());

    expect(readdirSync(ticketPath).sort()).toEqual([`TA-${CUIT}-wsfe.json`, `TA-${CUIT}-wsfex.json`]);
  });

  it('con MemoryTicketStorage quedan en el storage y no se escribe nada en ticketPath', async () => {
    const ticketStorage = new MemoryTicketStorage({ cuit: CUIT, production: false });

    try {
      await useBothServices(new ArcaClientFactory({ ticketStorage }));

      expect((await ticketStorage.get(ArcaServiceNames.WSFE))?.getToken()).toBe('TOKEN');
      expect((await ticketStorage.get(ArcaServiceNames.WSFEX))?.getToken()).toBe('TOKEN');
      expect(existsSync(ticketPath)).toBe(false);
    } finally {
      // El almacen del SDK es estatico: lo que quede lo ven los otros tests del archivo.
      await ticketStorage.delete(ArcaServiceNames.WSFE);
      await ticketStorage.delete(ArcaServiceNames.WSFEX);
    }
  });

  it('una factura E entera pide un solo ticket, aunque consulte todo WSFEX (ARQ8-6)', async () => {
    const { payload } = await resolveInvoice(new ArcaClientFactory().createExportGateway(runtime()));

    expect(payload).toMatchObject({ Cbte_nro: 42, Cuit_pais_cliente: 55000000052, Id: 8, Moneda_ctz: 900.5 });
    expect(exportReads.mock.calls.flat().toSorted()).toEqual(Object.keys(EXPORT_READS).toSorted());
    expect(login).toHaveBeenCalledTimes(1);
  });
});

it('con handleTicket nadie guarda el ticket: una lectura no hace un login de más', async () => {
  const profile = runtime();
  const context = { ...profile.context, handleTicket: true };

  await new ArcaClientFactory().createExportGateway({ ...profile, context }).getUnits();

  expect(login).toHaveBeenCalledTimes(1);
});

describe.each<[string, boolean, () => ITicketStoragePort]>([
  ['en ticketPath', false, () => new FileSystemTicketStorage({ cuit: CUIT, production: false, ticketPath })],
  ['en un storage propio', true, () => new MemoryTicketStorage({ cuit: CUIT, production: false })],
])('el ticket %s vence con los países ya en memoria (ARQ8-6)', (_name, own, createStorage) => {
  let storage: ITicketStoragePort;
  let gateway: ExportGateway;

  /** Los países leídos con un ticket que después vence, como en el asistente. */
  beforeEach(async () => {
    storage = createStorage();
    gateway = cacheExportTables(
      new ArcaClientFactory(own ? { ticketStorage: storage } : {}).createExportGateway(runtime()),
    );
    await gateway.getDestinationCountries();

    const ticket = await storage.get(ArcaServiceNames.WSFEX);
    const [header, times] = ticket!.getHeaders();

    await storage.save(
      AccessTicket.create({
        credentials: ticket!.getCredentials(),
        header: [header, { ...times, expirationtime: '2000-01-01T00:00:00-03:00' }],
      }),
      ArcaServiceNames.WSFEX,
    );
    login.mockClear();
  });

  afterEach(async () => {
    await storage.delete(ArcaServiceNames.WSFEX);
  });

  const delayed = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('las tablas que van a la vez esperan un solo login', async () => {
    login.mockImplementation(async () => {
      await delayed();

      return [{ loginCmsReturn: LOGIN_RESPONSE }];
    });

    expect((await resolveInvoice(gateway)).payload).toMatchObject({ Cbte_nro: 42, Id: 8 });
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('si falla, corta con su error sin otro login, y el intento siguiente vuelve a pedirlo', async () => {
    const error = new Error('ns1:coe.alreadyAuthenticated: El CEE ya posee un TA valido');

    login.mockImplementationOnce(async () => {
      await delayed();

      throw error;
    });

    await expect(resolveInvoice(gateway)).rejects.toBe(error);
    await delayed();
    expect(login).toHaveBeenCalledTimes(1);
    expect((await resolveInvoice(gateway)).payload).toMatchObject({ Cbte_nro: 42 });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('sin la relación con wsfex, el mismo aviso', async () => {
    login.mockImplementationOnce(async () => {
      throw new Error('ns1:coe.notAuthorized: Computador no autorizado a acceder al servicio');
    });

    await expect(resolveInvoice(gateway)).rejects.toMatchObject({ code: 'WSFEX_SERVICE_NOT_AUTHORIZED' });
    expect(login).toHaveBeenCalledTimes(1);
  });
});
