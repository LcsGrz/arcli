import { Arca, AuthRepository, type Context, FileSystemTicketStorage, MemoryTicketStorage } from '@arcasdk/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArcaClientFactory } from '../arca-client.factory';

/**
 * Donde guarda los tickets de WSAA el cliente de ARCA (REV-48). Ni `Arca` ni `AuthRepository` llegan a la red: son
 * dobles que registran con que se crearon. Los almacenamientos son los del SDK.
 */
vi.mock('@arcasdk/core', async (original) => ({
  ...(await original<typeof import('@arcasdk/core')>()),
  Arca: vi.fn(),
  AuthRepository: vi.fn(),
}));

const CUIT = 20123456786;

let ticketPath = '';
let directory = '';

/** Lo que `createExportGateway` necesita del perfil, sin certificado dedicado ni vencimiento. */
function runtime(): Parameters<ArcaClientFactory['createExportGateway']>[0] {
  return {
    certificateExpiry: undefined,
    config: { cert: { testing: 'cert.pem' }, key: { testing: 'key.pem' } } as Parameters<
      ArcaClientFactory['createExportGateway']
    >[0]['config'],
    context: { cert: 'cert', cuit: CUIT, key: 'key', production: false, ticketPath } as Context,
    environment: 'testing',
  };
}

/** El mismo perfil con certificado dedicado a WSFEX. */
function dedicatedRuntime(): ReturnType<typeof runtime> {
  const cert = join(directory, 'wsfex.crt');
  const key = join(directory, 'wsfex.key');

  writeFileSync(cert, '-----BEGIN CERTIFICATE-----\nWSFEX\n-----END CERTIFICATE-----');
  writeFileSync(key, '-----BEGIN PRIVATE KEY-----\nWSFEX\n-----END PRIVATE KEY-----');

  const base = runtime();

  return { ...base, config: { ...base.config, exportacion: { cert: { testing: cert }, key: { testing: key } } } };
}

/** El `ticketStorage` con que se creo el autenticador de WSFEX. */
function authStorage(): unknown {
  return (vi.mocked(AuthRepository).mock.calls[0]?.[0] as { ticketStorage?: unknown } | undefined)?.ticketStorage;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-ticket-storage-'));
  ticketPath = join(directory, 'tickets');
  vi.mocked(Arca).mockClear();
  vi.mocked(AuthRepository).mockClear();
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('ArcaClientFactory: almacenamiento de tickets', () => {
  it('por defecto, WSFEX guarda los tickets en disco, en el ticketPath del perfil', () => {
    new ArcaClientFactory().createExportGateway(runtime());

    expect(authStorage()).toBeInstanceOf(FileSystemTicketStorage);
    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ ticketPath }));
    expect(vi.mocked(Arca).mock.calls[0]?.[0]).not.toHaveProperty('ticketStorage');
  });

  it('con un ticketStorage propio, lo usan el cliente y WSFEX', () => {
    const ticketStorage = new MemoryTicketStorage({ cuit: CUIT, production: false });
    const factory = new ArcaClientFactory({ ticketStorage });

    factory.create(runtime());
    factory.createExportGateway(runtime());

    expect(Arca).toHaveBeenCalledTimes(2);
    for (const [context] of vi.mocked(Arca).mock.calls) {
      expect(context).toMatchObject({ ticketStorage });
    }
    expect(authStorage()).toBe(ticketStorage);
  });

  it('con certificado dedicado, createExportGateway pasa el ticketStorage al cliente y al autenticador', () => {
    const ticketStorage = new MemoryTicketStorage({ cuit: CUIT, production: false });

    new ArcaClientFactory({ ticketStorage }).createExportGateway(dedicatedRuntime());

    expect(Arca).toHaveBeenCalledWith(
      expect.objectContaining({ cert: expect.stringContaining('WSFEX'), ticketStorage }),
    );
    expect(authStorage()).toBe(ticketStorage);
  });

  it('con certificado dedicado, createForExport pasa el ticketStorage al cliente', () => {
    const ticketStorage = new MemoryTicketStorage({ cuit: CUIT, production: false });

    new ArcaClientFactory({ ticketStorage }).createForExport(dedicatedRuntime());

    expect(Arca).toHaveBeenCalledWith(
      expect.objectContaining({ cert: expect.stringContaining('WSFEX'), ticketStorage }),
    );
  });
});
