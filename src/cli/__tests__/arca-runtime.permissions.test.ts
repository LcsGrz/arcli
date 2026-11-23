import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { arcliConfigSchema } from '../../modules/config/config.schemas';
import { loadArcaRuntime } from '../arca-runtime';
import { buildRuntimeChecks } from '../commands/config.command';

import { PROFILE_CUIT, useArcaProfileFixture } from './arca-profile.fixture';

const profile = useArcaProfileFixture();

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

/** La carpeta de la config y la de tickets, abiertas como las dejaba una version vieja. */
function openFolders(): readonly string[] {
  const folders = [profile.configDirectory, join(profile.configDirectory, 'tickets')];

  mkdirSync(folders[1] as string);
  folders.forEach((folder) => chmodSync(folder, 0o755));

  return folders;
}

describe.skipIf(process.platform === 'win32')('permisos de las carpetas del perfil', () => {
  it('config revisar tambien las deja en 0700', () => {
    const config = profile.configWith(profile.healthy);

    profile.writeConfig(config);
    const folders = openFolders();

    expect(buildRuntimeChecks(arcliConfigSchema.parse(config))[0]).toEqual({ environment: 'testing' });
    expect(folders.map(mode)).toEqual([0o700, 0o700]);
  });

  it.each([
    ['sin CUIT', () => ({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } })],
    ['sin la clave', () => ({ cert: { testing: profile.healthy.certPath }, cuit: PROFILE_CUIT })],
  ])('con la config incompleta (%s) corta antes, sin tocarlas', (_case, config) => {
    profile.writeConfig(config());
    const folders = openFolders();

    expect(() => loadArcaRuntime({})).toThrow();
    expect(folders.map(mode)).toEqual([0o755, 0o755]);
  });
});
