import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ArcliEnvironment } from '../../config/config.schemas';
import { resolveLocalDataFiles } from '../local-data-files';

const DATA = join('carpeta', 'de', 'datos');
const CUIT = '20111111112';

describe('resolveLocalDataFiles (ARQ-12)', () => {
  it('arma las rutas de comprobantes por entorno y de clientes por CUIT', () => {
    expect(resolveLocalDataFiles(DATA, CUIT, 'testing')).toEqual({
      backups: join(DATA, 'datos', CUIT, 'testing', 'copias'),
      clients: join(DATA, 'datos', CUIT, 'clientes.db'),
      folder: join(DATA, 'datos', CUIT, 'testing'),
      vouchers: join(DATA, 'datos', CUIT, 'testing', 'comprobantes.db'),
    });
  });

  it('produccion va en otra carpeta y comparte la base de clientes', () => {
    const testing = resolveLocalDataFiles(DATA, CUIT, 'testing');
    const production = resolveLocalDataFiles(DATA, CUIT, 'produccion');

    expect(production.vouchers).toBe(join(DATA, 'datos', CUIT, 'produccion', 'comprobantes.db'));
    expect(production.clients).toBe(testing.clients);
  });

  it('el CUIT con guiones queda en 11 dígitos en la ruta', () => {
    expect(resolveLocalDataFiles(DATA, '20-11111111-2', 'testing').folder).toBe(join(DATA, 'datos', CUIT, 'testing'));
  });

  // Un CUIT que no es un CUIT no puede llegar a una ruta: `../x` saldría de la carpeta de datos.
  it.each(['../x', '2011111111', '20111111113', '', '20111111112/..'])('el CUIT %j lanza', (cuit) => {
    expect(() => resolveLocalDataFiles(DATA, cuit, 'testing')).toThrow(/CUIT/);
  });

  it.each(['homologacion', '../testing', '', 'Testing'])('el entorno %j lanza', (environment) => {
    expect(() => resolveLocalDataFiles(DATA, CUIT, environment as ArcliEnvironment)).toThrow(/entorno/);
  });
});
