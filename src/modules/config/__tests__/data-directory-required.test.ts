import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openConfigFileStore } from '../../../services/files/conf-config-store';
import { nodeLocalFiles } from '../../../services/files/local-files';
import { FileMonotributoStore } from '../../../services/files/monotributo-file-store';
import { checkForUpdate } from '../../update-check/update-check.service';
import { ConfigService } from '../config.service';

/**
 * Quien abre datos dice la carpeta: sin ella falla, aunque se salteen los tipos y `ARCLI_CONFIG_DIR` este definida (el
 * nucleo no la lee). Nunca cae en la carpeta de quien lo corre, que es como se piso una config real.
 */
const skippingTypes = (value: unknown) => value as string;
const homeEntries = () => readdirSync(process.env.HOME ?? '', { recursive: true }).sort();
const originalIsTty = process.stderr.isTTY;

beforeEach(() => {
  vi.stubEnv('CI', '');
  vi.stubEnv('NO_UPDATE_NOTIFIER', '');
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: originalIsTty });
});

describe.each([
  ['sin definir', undefined],
  ['vacía', ''],
  ['en blanco', '  '],
])('con la carpeta %s', (_name, value) => {
  it('ConfigService falla sin escribir nada', () => {
    const before = homeEntries();

    expect(() =>
      new ConfigService({ files: nodeLocalFiles, store: openConfigFileStore(skippingTypes(value)) }).close(),
    ).toThrow(/carpeta de datos/);
    expect(homeEntries()).toEqual(before);
  });

  it('el store del monotributo falla sin escribir nada', () => {
    const before = homeEntries();

    expect(() => new FileMonotributoStore(skippingTypes(value))).toThrow(/carpeta de datos/);
    expect(homeEntries()).toEqual(before);
  });

  it('el caché de la versión falla sin consultar npm ni escribir nada', async () => {
    const before = homeEntries();
    const request = vi.fn();

    await expect(checkForUpdate('0.1.0', { cwd: skippingTypes(value), request })).rejects.toThrow(/carpeta de datos/);
    expect(request).not.toHaveBeenCalled();
    expect(homeEntries()).toEqual(before);
  });
});
