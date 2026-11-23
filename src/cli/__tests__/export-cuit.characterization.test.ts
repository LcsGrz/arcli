import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MISSING_CUIT_MESSAGE } from '../../modules/config/config.schemas';

import { useArcaProfileFixture } from './arca-profile.fixture';

/**
 * Caracterización de ARQ-18: sin CUIT, ninguna E llega a resolver el comprobante. Corta el perfil, antes de mirar los
 * flags y de crear el cliente de ARCA.
 */

const Arca = vi.hoisted(() => vi.fn());

vi.mock('@arcasdk/core', async (original) => ({
  ...(await original<typeof import('@arcasdk/core')>()),
  Arca,
}));

const profile = useArcaProfileFixture();

const INVOICE = ['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212', '-m', '1500'];
const NOTE = ['-m', '500', '--ar', '1', '--pv', '4'];

beforeEach(() => {
  Arca.mockClear();
  profile.writeConfig({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } });
});

describe('E sin CUIT en la config, con --json', () => {
  it.each([
    ['fe', INVOICE],
    ['factura e', INVOICE],
    ['nce', NOTE],
    ['nota-credito e', NOTE],
    ['nde', NOTE],
    ['nota-debito e', NOTE],
    // Con un CUIT del asociado tampoco cambia: no reemplaza al del emisor.
    ['nce', [...NOTE, '--acuit', '20111111112']],
    // Con otro error de entrada (falta `--ar`), primero el CUIT.
    ['nce', ['-m', '500', '--ac', 'fe']],
  ])('arcli %s %j: CONFIGURATION_ERROR sin crear el cliente', async (command, args) => {
    expect(await profile.runJsonError([...command.split(' '), ...args, '--previsualizar'])).toEqual({
      codigo: 'CONFIGURATION_ERROR',
      detalles: null,
      error: MISSING_CUIT_MESSAGE,
      sugerencia: null,
    });
    expect(Arca).not.toHaveBeenCalled();
    expect(profile.stdout).toBe('');
  });
});
