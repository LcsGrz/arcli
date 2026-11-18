import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { ConfigurationError } from '../../../lib/errors/app-error';
import { formatConfig } from '../config.presenter';
import { resolveRowsPerList, ROWS_PER_LIST_DEPRECATION_WARNING } from '../config.schemas';
import { ConfigService, deprecatedConfigKeyWarning, resolveConfigDirectory } from '../config.service';

const temporaryDirectories: string[] = [];

function createService(): ConfigService {
  const cwd = mkdtempSync(join(tmpdir(), 'arcli-config-test-'));

  temporaryDirectories.push(cwd);

  return new ConfigService({
    cwd,
    projectName: 'arcli-test',
  });
}

function writePemFile(directory: string, filename: string, content: string): string {
  const fullPath = join(directory, filename);

  writeFileSync(fullPath, content, 'utf8');

  return fullPath;
}

function certificatePem(label: string): string {
  return `-----BEGIN CERTIFICATE-----
${label}
-----END CERTIFICATE-----`;
}

function privateKeyPem(label: string): string {
  return `-----BEGIN PRIVATE KEY-----
${label}
-----END PRIVATE KEY-----`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('config.service', () => {
  it('initializes config with defaults', () => {
    const service = createService();

    try {
      expect(service.initialize()).toEqual({
        cert: {},
        cotizacionPorDefecto: 1,
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {},
        monedaPorDefecto: 'PES',
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
      });
    } finally {
      service.close();
    }
  });

  it('does not save an invalid value, so the CLI keeps working', () => {
    const service = createService();

    try {
      service.setValue('cuit', '20123456786');

      // Los rechazos de cada clave se prueban en config-value-parser; acá, que pasan por el alias y no se guardan.
      expect(() => service.setValue('cuit', 'abc')).toThrow(/El CUIT "abc" no es válido/);
      expect(() => service.setValue('entorno', 'demo')).toThrow(
        expect.objectContaining({
          message: '`entorno` no acepta "demo". Valores válidos: testing, produccion.',
          suggestion: expect.stringContaining('`arcli config establecer --ayuda`'),
        }),
      );
      expect(() => service.setValue('emisor.condicion', 'x')).toThrow(
        expect.objectContaining({
          code: 'INPUT_VALIDATION_ERROR',
          message: 'La clave `emisor.condicion` no existe.',
        }),
      );
      expect(service.getConfig().cuit).toBe('20123456786');
      expect(service.getConfig().entornoPorDefecto).toBe('testing');
      expect(JSON.parse(readFileSync(service.getPath(), 'utf8')).cuit).toBe('20123456786');
    } finally {
      service.close();
    }
  });

  it('says a saved CBU with a wrong check digit comes from the config, why, and how to change it', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ cbu: '0110599520000012345677', puntoVentaPorDefecto: 3 }));

      expect(() => service.getConfig()).toThrow(
        expect.objectContaining({
          code: 'INPUT_VALIDATION_ERROR',
          issues: [
            {
              label: 'CBU',
              mensaje: 'No coincide el dígito verificador del bloque de la cuenta (los últimos 14 dígitos).',
              ruta: ['cbu'],
            },
          ],
          message:
            'El CBU guardado en la config no es válido: no coincide el dígito verificador del bloque de la cuenta (los últimos 14 dígitos).',
          suggestion: expect.stringContaining('`arcli config establecer cbu <CBU>`'),
        }),
      );
      expect(service.setValue('cbu', '0110599520000012345678').cbu).toBe('0110599520000012345678');
      expect(service.getConfig().puntoVentaPorDefecto).toBe(3);

      writeFileSync(service.getPath(), JSON.stringify({ cbu: '0110599420000012345678' }));

      expect(() => service.getConfig()).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ mensaje: expect.stringMatching(/banco y sucursal/) })],
        }),
      );
      expect(service.unsetValue('cbu').cbu).toBeUndefined();
    } finally {
      service.close();
    }
  });

  it('fixes a config that was already broken by setting or deleting the bad key', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ cuit: 'abc', puntoVentaPorDefecto: 3 }));

      expect(() => service.getConfig()).toThrow(ZodError);
      expect(service.unsetValue('cuit').puntoVentaPorDefecto).toBe(3);

      writeFileSync(service.getPath(), JSON.stringify({ cuit: 'abc' }));

      expect(service.setValue('cuit', '20123456786').cuit).toBe('20123456786');
    } finally {
      service.close();
    }
  });

  it('sets and deletes nested keys', () => {
    const service = createService();

    try {
      service.setValue('emitir', 'si');

      expect(service.getConfig().output.emitirPorDefecto).toBe(true);
      expect(service.unsetValue('emitir').output.emitirPorDefecto).toBe(false);
    } finally {
      service.close();
    }
  });

  it('guarda monotributo.tope como importe en pesos y lo valida', () => {
    const service = createService();

    try {
      expect(service.setValue('monotributo.tope', '30.000.000').monotributo?.tope).toBe(30_000_000);
      expect(service.setValue('monotributo.tope', '1.234,50').monotributo?.tope).toBe(1234.5);
      expect(() => service.setValue('monotributo.tope', '0')).toThrow(
        '`monotributo.tope` no acepta "0": tiene que ser un importe en pesos mayor a cero, por ejemplo 30.000.000.',
      );
      expect(() => service.setValue('monotributo.tope', 'mucho')).toThrow('no acepta "mucho"');
      expect(service.unsetValue('monotributo.tope').monotributo?.tope).toBeUndefined();
    } finally {
      service.close();
    }
  });

  it('stores scalar values with public aliases', () => {
    const service = createService();

    try {
      service.setValue('entorno', 'produccion');
      service.setValue('puntoVenta', '3');
      service.setValue('cuit', '20123456786');
      service.setValue('concepto', 'servicios');
      service.setValue('moneda', 'usd');
      service.setValue('cotizacion', '1.234,5');
      service.setValue('ivaReceptor', 'consumidor-final');
      service.setValue('emitir', 'si');
      service.setValue('json', 'si');
      service.setValue('bruto', 'si');

      expect(service.getConfig()).toEqual({
        cert: {},
        conceptoPorDefecto: 'servicios',
        cotizacionPorDefecto: 1234.5,
        cuit: '20123456786',
        emisor: {},
        entornoPorDefecto: 'produccion',
        ivaReceptorPorDefecto: 'consumidor-final',
        key: {},
        monedaPorDefecto: 'USD',
        output: {
          emitirPorDefecto: true,
          jsonPorDefecto: true,
          brutoPorDefecto: true,
        },
        puntoVentaPorDefecto: 3,
      });
    } finally {
      service.close();
    }
  });

  it('stores nested paths for certificates and keys', () => {
    const service = createService();
    const cwd = temporaryDirectories[temporaryDirectories.length - 1]!;
    const testingCertPath = writePemFile(cwd, 'testing-cert.pem', certificatePem('TESTING-CERT'));
    const productionKeyPath = writePemFile(cwd, 'production-key.pem', privateKeyPem('PRODUCTION-KEY'));

    try {
      service.setValue('cert.testing', testingCertPath);
      service.setValue('key.produccion', productionKeyPath);

      expect(service.getConfig()).toEqual({
        cert: {
          testing: testingCertPath,
        },
        cotizacionPorDefecto: 1,
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {
          produccion: productionKeyPath,
        },
        monedaPorDefecto: 'PES',
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
      });
    } finally {
      service.close();
    }
  });

  it('unsets values and preserves defaults', () => {
    const service = createService();

    try {
      service.setValue('entorno', 'produccion');
      service.unsetValue('entorno');

      expect(service.getConfig().entornoPorDefecto).toBe('testing');
    } finally {
      service.close();
    }
  });

  it('returns the config path', () => {
    const service = createService();

    try {
      expect(service.getPath()).toContain('config.json');
    } finally {
      service.close();
    }
  });

  it('defaults the ticket path to a tickets folder next to the config file', () => {
    const service = createService();

    try {
      expect(service.getDefaultTicketPath()).toBe(join(dirname(service.getPath()), 'tickets'));
      expect(service.resolveTicketPath(service.getConfig())).toBe(service.getDefaultTicketPath());
    } finally {
      service.close();
    }
  });

  it('lets the user override the ticket path', () => {
    const service = createService();

    try {
      const cwd = temporaryDirectories[temporaryDirectories.length - 1]!;
      const customTicketPath = join(cwd, 'tickets-personalizados');

      service.setValue('ticketPath', customTicketPath);

      expect(service.resolveTicketPath(service.getConfig())).toBe(customTicketPath);
    } finally {
      service.close();
    }
  });

  it('reports a corrupt config file as a configuration error with its path, without touching it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'arcli-config-test-'));
    const configPath = join(cwd, 'config.json');
    const corruptContent = '{ "cuit": "20123456786", ';

    temporaryDirectories.push(cwd);
    writeFileSync(configPath, corruptContent, 'utf8');

    let thrown: unknown;

    try {
      new ConfigService({ cwd, projectName: 'arcli-test' }).close();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).message).toMatch(/JSON inválido/);
    expect((thrown as ConfigurationError).details).toEqual({ path: configPath });
    expect((thrown as ConfigurationError).suggestion).toMatch(/arcli config/);
    expect(readFileSync(configPath, 'utf8')).toBe(corruptContent);
  });
});

describe('filasPorLista y la clave deprecada comprobantesPorLista', () => {
  function readStoredFile(service: ConfigService): Record<string, unknown> {
    return JSON.parse(readFileSync(service.getPath(), 'utf8')) as Record<string, unknown>;
  }

  it('lee comprobantesPorLista si es la unica que esta en el archivo', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ comprobantesPorLista: 8 }));

      expect(resolveRowsPerList(service.getConfig())).toBe(8);
    } finally {
      service.close();
    }
  });

  it('con las dos en el archivo gana filasPorLista', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ comprobantesPorLista: 8, filasPorLista: 20 }));

      expect(resolveRowsPerList(service.getConfig())).toBe(20);
    } finally {
      service.close();
    }
  });

  it('sin ninguna, usa 15', () => {
    const service = createService();

    try {
      expect(resolveRowsPerList(service.getConfig())).toBe(15);
    } finally {
      service.close();
    }
  });

  it('establecer comprobantesPorLista guarda filasPorLista y saca la vieja del archivo', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ comprobantesPorLista: 8 }));

      const config = service.setValue(' comprobantesPorLista ', '25');

      expect(config.filasPorLista).toBe(25);
      expect(config.comprobantesPorLista).toBeUndefined();
      expect(readStoredFile(service)).toMatchObject({ filasPorLista: 25 });
      expect(readStoredFile(service)).not.toHaveProperty('comprobantesPorLista');
    } finally {
      service.close();
    }
  });

  it('establecer comprobantesPorLista valida el rango como filasPorLista', () => {
    const service = createService();

    try {
      expect(() => service.setValue('comprobantesPorLista', '99')).toThrow(/entre 1 y 50/);
    } finally {
      service.close();
    }
  });

  it('establecer filasPorLista tambien saca la vieja, para que no vuelva al borrar la nueva', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ comprobantesPorLista: 8 }));
      service.setValue('filasPorLista', '30');

      expect(readStoredFile(service)).not.toHaveProperty('comprobantesPorLista');
      expect(resolveRowsPerList(service.unsetValue('filasPorLista'))).toBe(15);
    } finally {
      service.close();
    }
  });

  it('eliminar cualquiera de las dos borra las dos', () => {
    const service = createService();

    try {
      writeFileSync(service.getPath(), JSON.stringify({ comprobantesPorLista: 8, filasPorLista: 20 }));
      service.unsetValue('comprobantesPorLista');

      expect(readStoredFile(service)).not.toHaveProperty('comprobantesPorLista');
      expect(readStoredFile(service)).not.toHaveProperty('filasPorLista');
    } finally {
      service.close();
    }
  });

  it('solo la clave deprecada trae aviso', () => {
    expect(deprecatedConfigKeyWarning(' comprobantesPorLista')).toBe(ROWS_PER_LIST_DEPRECATION_WARNING);
    expect(deprecatedConfigKeyWarning('filasPorLista')).toBeUndefined();
    expect(deprecatedConfigKeyWarning('toString')).toBeUndefined();
  });
});

describe('config escrita por una versión anterior', () => {
  /**
   * Un config.json como lo dejaba la 2.0: los nombres guardados (`puntoVentaPorDefecto`, `output.emitirPorDefecto`…)
   * no son las claves públicas, todavía no existían `output.brutoPorDefecto` ni `filasPorLista`, y tiene la
   * `cotizacion` deprecada con un valor propio y `comprobantesPorLista`.
   */
  const OLD_CONFIG = {
    alicuotaPorDefecto: '21',
    cbu: '0110599520000012345678',
    comprobantesPorLista: 8,
    conceptoPorDefecto: 'servicios',
    cotizacionPorDefecto: 1350.5,
    cuit: '20123456786',
    entornoPorDefecto: 'produccion',
    ivaReceptorPorDefecto: 'consumidor-final',
    monedaPorDefecto: 'dol',
    output: { emitirPorDefecto: true, jsonPorDefecto: false },
    puntoVentaPorDefecto: 3,
  };

  function serviceWithOldConfig(): ConfigService {
    const service = createService();

    writeFileSync(service.getPath(), JSON.stringify(OLD_CONFIG));

    return service;
  }

  it('se lee con los defaults de las claves nuevas', () => {
    const service = serviceWithOldConfig();

    try {
      const config = service.getConfig();

      expect(config).toMatchObject({
        alicuotaPorDefecto: '21',
        cotizacionPorDefecto: 1350.5,
        entornoPorDefecto: 'produccion',
        monedaPorDefecto: 'DOL',
        output: { brutoPorDefecto: false, emitirPorDefecto: true, jsonPorDefecto: false },
        puntoVentaPorDefecto: 3,
      });
      expect(resolveRowsPerList(config)).toBe(8);
    } finally {
      service.close();
    }
  });

  it('config --json la muestra con las claves públicas actuales', () => {
    const service = serviceWithOldConfig();

    try {
      const config = service.getConfig();
      const snapshot = JSON.parse(formatConfig(config, service.resolvePaths(config))) as Record<string, unknown>;

      expect(snapshot).toMatchObject({
        alicuota: '21',
        bruto: false,
        comprobantesPorLista: 8,
        concepto: 'servicios',
        cotizacion: 1350.5,
        emitir: true,
        entorno: 'produccion',
        filasPorLista: 8,
        ivaReceptor: 'consumidor-final',
        moneda: 'DOL',
        puntoVenta: 3,
      });
    } finally {
      service.close();
    }
  });

  it('establecer y eliminar por la clave pública tocan el nombre guardado y dejan el resto', () => {
    const service = serviceWithOldConfig();

    try {
      expect(service.setValue('cotizacion', '1400').cotizacionPorDefecto).toBe(1400);
      expect(service.setValue('puntoVenta', '5').puntoVentaPorDefecto).toBe(5);

      service.unsetValue('cotizacion');

      // Eliminar vuelve al default (1), que es "sin cotización propia": la factura usa la oficial de ARCA.
      const config = service.getConfig();

      expect(config.cotizacionPorDefecto).toBe(1);
      expect(config).toMatchObject({ comprobantesPorLista: 8, cuit: '20123456786', puntoVentaPorDefecto: 5 });

      const stored = JSON.parse(readFileSync(service.getPath(), 'utf8')) as Record<string, unknown>;

      expect(stored).not.toHaveProperty('cotizacion');
      expect(stored).not.toHaveProperty('puntoVenta');
    } finally {
      service.close();
    }
  });

  it('initialize no pisa los valores viejos con los defaults', () => {
    const service = serviceWithOldConfig();

    try {
      service.initialize();

      expect(JSON.parse(readFileSync(service.getPath(), 'utf8'))).toMatchObject({
        comprobantesPorLista: 8,
        cotizacionPorDefecto: 1350.5,
        output: { brutoPorDefecto: false, emitirPorDefecto: true },
      });
    } finally {
      service.close();
    }
  });
});

describe('ARCLI_CONFIG_DIR', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('usa esa carpeta para el config.json y sus carpetas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-config-dir-'));

    vi.stubEnv('ARCLI_CONFIG_DIR', ` ${directory} `);

    const service = new ConfigService();

    try {
      expect(resolveConfigDirectory()).toBe(directory);
      expect(service.getPath()).toBe(join(directory, 'config.json'));
    } finally {
      service.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('vacia o sin definir, usa la carpeta de siempre', () => {
    vi.stubEnv('ARCLI_CONFIG_DIR', '  ');

    expect(resolveConfigDirectory()).toBeUndefined();
  });
});
