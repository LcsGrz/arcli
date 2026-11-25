import { describe, expect, it } from 'vitest';

import { credentialPaths, explicitEnvironment, resolveCuit, resolveEnvironment } from '../arca-profile';
import { MISSING_CUIT_MESSAGE } from '../config.schemas';

describe('resolveEnvironment', () => {
  it.each([
    [{}, 'testing', 'testing'],
    [{}, 'produccion', 'produccion'],
    [{ testing: true }, 'produccion', 'testing'],
    [{ produccion: true }, 'testing', 'produccion'],
    [{ produccion: false, testing: false }, 'produccion', 'produccion'],
  ] as const)('flags %j con %s en la config: %s', (flags, entornoPorDefecto, expected) => {
    expect(resolveEnvironment(flags, { entornoPorDefecto })).toBe(expected);
  });

  it('con los dos flags es un error de entrada', () => {
    expect(() => resolveEnvironment({ produccion: true, testing: true }, { entornoPorDefecto: 'testing' })).toThrow(
      expect.objectContaining({
        code: 'INPUT_VALIDATION_ERROR',
        message: 'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
      }),
    );
  });
});

describe('explicitEnvironment', () => {
  it('sin flags no elige ninguno', () => {
    expect(explicitEnvironment({})).toBeUndefined();
  });
});

describe('resolveCuit', () => {
  it('lo devuelve como numero', () => {
    expect(resolveCuit({ cuit: '20123456786' })).toBe(20123456786);
  });

  it('sin CUIT: error de configuracion', () => {
    expect(() => resolveCuit({})).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR', message: MISSING_CUIT_MESSAGE }),
    );
  });

  it.each(['2012345678', '201234567860', 'abcdefghijk'])('rechaza "%s"', (cuit) => {
    expect(() => resolveCuit({ cuit })).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: `El CUIT "${cuit}" no es válido. Debe tener 11 dígitos.`,
      }),
    );
  });
});

describe('credentialPaths', () => {
  const config = { cert: { testing: 'a.crt' }, key: { testing: 'a.key' } };

  it('devuelve las rutas del entorno', () => {
    expect(credentialPaths(config, 'testing')).toEqual({ certPath: 'a.crt', keyPath: 'a.key' });
  });

  it('no usa las del otro entorno', () => {
    expect(() => credentialPaths(config, 'produccion')).toThrow(
      'Falta la ruta del certificado para producción. Configurala con `arcli config establecer cert.produccion <ruta>`.',
    );
  });

  it('sin la clave, nombra la clave de la config', () => {
    expect(() => credentialPaths({ ...config, key: {} }, 'testing')).toThrow(
      'Falta la ruta de la clave privada para testing. Configurala con `arcli config establecer key.testing <ruta>`.',
    );
  });
});
