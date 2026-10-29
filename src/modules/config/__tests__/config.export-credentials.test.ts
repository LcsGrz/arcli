import { describe, expect, it } from 'vitest';

import { resolveExportCredentials } from '../config.export-credentials';
import { arcliConfigSchema } from '../config.schemas';

const GENERAL = { produccion: '/certs/general.crt', testing: '/certs/general-testing.crt' };
const GENERAL_KEY = { produccion: '/certs/general.key', testing: '/certs/general-testing.key' };

function config(extra: Record<string, unknown> = {}) {
  return arcliConfigSchema.parse({ cert: GENERAL, key: GENERAL_KEY, ...extra });
}

describe('resolveExportCredentials', () => {
  it('usa los certificados de exportacion cuando estan configurados', () => {
    const resolved = resolveExportCredentials(
      config({
        exportacion: {
          cert: { testing: '/certs/expo-testing.crt' },
          key: { testing: '/certs/expo-testing.key' },
        },
      }),
      'testing',
    );

    expect(resolved).toEqual({
      cert: '/certs/expo-testing.crt',
      dedicated: true,
      key: '/certs/expo-testing.key',
    });
  });

  it('cae a los certificados generales si no hay seccion de exportacion', () => {
    expect(resolveExportCredentials(config(), 'testing')).toEqual({
      cert: '/certs/general-testing.crt',
      dedicated: false,
      key: '/certs/general-testing.key',
    });
  });

  it('pide el par completo: un certificado sin su clave no sirve', () => {
    expect(() =>
      resolveExportCredentials(config({ exportacion: { cert: { testing: '/certs/expo-testing.crt' } } }), 'testing'),
    ).toThrow(/certificado y la clave juntos/);
  });

  it('avisa cuando no hay nada configurado para el entorno', () => {
    expect(() => resolveExportCredentials(arcliConfigSchema.parse({}), 'produccion')).toThrow(
      /Falta el certificado de WSFEX/,
    );
  });
});
