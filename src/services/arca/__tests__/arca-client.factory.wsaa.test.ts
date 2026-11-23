import { ArcaServiceNames, type Context, MemoryTicketStorage, SoapClient } from '@arcasdk/core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENSSL_WARM_UP_TIMEOUT_MS } from '../../../lib/security/__tests__/self-signed-certificate';
import { CONFIG_DEFAULTS } from '../../../modules/config/config.schemas';
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

/** WSFE y WSFEX: los dos servicios piden y guardan su ticket. */
async function useBothServices(factory: ArcaClientFactory): Promise<void> {
  await factory.create(runtime()).electronicBillingService.getSalesPoints();

  expect(await factory.createExportGateway(runtime()).getLastVoucherNumber(19, 3)).toBe(41);
  expect(wsfe).toHaveBeenCalledWith(expect.objectContaining({ Auth: expect.objectContaining({ Token: 'TOKEN' }) }));
  expect(wsfex).toHaveBeenCalledWith({ Auth: expect.objectContaining({ Token: 'TOKEN' }) });
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
  login.mockClear();
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
});
