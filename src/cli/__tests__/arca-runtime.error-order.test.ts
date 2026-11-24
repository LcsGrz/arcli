import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MISSING_CUIT_MESSAGE } from '../../modules/config/config.schemas';
import { resolveArcaRuntime } from '../arca-runtime';

import { PROFILE_CUIT, useArcaProfileFixture } from './arca-profile.fixture';

const profile = useArcaProfileFixture();

/** Con mas de un problema en la config, cual se informa. */
describe('orden de los errores del perfil', () => {
  it('sin CUIT y sin certificado: primero el CUIT', () => {
    profile.writeConfig({});

    expect(() => resolveArcaRuntime({})).toThrow(MISSING_CUIT_MESSAGE);
  });

  it('el certificado y la clave no existen: primero el certificado', () => {
    profile.writeConfig({
      cert: { testing: join(profile.configDirectory, 'no-existe.crt') },
      cuit: PROFILE_CUIT,
      key: { testing: join(profile.configDirectory, 'no-existe.key') },
    });

    expect(() => resolveArcaRuntime({})).toThrow(/^La ruta del certificado no existe/);
  });

  it('el certificado no es un certificado y la clave no existe: primero la clave', () => {
    profile.writeConfig({
      cert: { testing: profile.healthy.keyPath },
      cuit: PROFILE_CUIT,
      key: { testing: join(profile.configDirectory, 'no-existe.key') },
    });

    expect(() => resolveArcaRuntime({})).toThrow(/^La ruta de la clave privada no existe/);
  });

  it('config invalida y los dos flags de entorno: primero la config', () => {
    profile.writeConfig({ cuit: '123' });

    expect(() => resolveArcaRuntime({ produccion: true, testing: true })).toThrow(/el CUIT debe tener 11 dígitos/);
  });
});
