import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ConfigService } from '../../modules/config/config.service';

import { useArcaProfileFixture } from './arca-profile.fixture';

/**
 * Los textos de una entrada que no pasa el esquema (ERR-9, H10), por el comando o la config de verdad: si falta, si
 * es de otro tipo o si es el largo. La forma de `detalles` es contrato y no cambia.
 */

const profile = useArcaProfileFixture();
const FC = ['fc', '--cs', '--cfinal', '--monto', '1000', '--pv', '3', '--previsualizar'];

beforeEach(() => profile.writeConfig(profile.configWith(profile.healthy)));

async function detailsOf(argv: readonly string[], config?: Record<string, unknown>): Promise<unknown> {
  if (config) {
    profile.writeConfig(profile.configWith(profile.healthy, config));
  }

  const error = await profile.runJsonError(argv);

  expect(Object.keys(error).sort()).toEqual(['codigo', 'detalles', 'error', 'sugerencia']);
  expect(error.codigo).toBe('INPUT_VALIDATION_ERROR');

  return error.detalles;
}

describe('un dato que falta, en los flags', () => {
  it('sigue diciendo que falta', async () => {
    expect(await detailsOf(['fc', '--cs', '--cfinal', '--previsualizar'])).toEqual([
      { mensaje: 'Falta el dato: monto.', ruta: ['montoTotal'] },
    ]);
  });
});

describe('config.json editado a mano: el tipo equivocado no es "falta"', () => {
  it.each([
    [{ puntoVentaPorDefecto: 'a' }, '`puntoVentaPorDefecto` tiene que ser un número.', ['puntoVentaPorDefecto']],
    [{ puntoVentaPorDefecto: 1.5 }, '`puntoVentaPorDefecto` tiene que ser un entero.', ['puntoVentaPorDefecto']],
    [{ puntoVentaPorDefecto: null }, '`puntoVentaPorDefecto` tiene que ser un número.', ['puntoVentaPorDefecto']],
    [{ verificarFce: 'si' }, '`verificarFce` tiene que ser true o false.', ['verificarFce']],
    [{ emisor: 'Empresa' }, '`emisor` tiene que ser un objeto.', ['emisor']],
    [{ emisor: { domicilio: 3 } }, '`emisor.domicilio` tiene que ser un texto.', ['emisor', 'domicilio']],
    [{ cbu: 110599520 }, 'CBU tiene que ser un texto.', ['cbu']],
  ])('%j', async (config, mensaje, ruta) => {
    expect(await detailsOf(['config'], config)).toEqual([{ mensaje, ruta }]);
  });
});

describe('largos y rangos', () => {
  it.each([
    [{ monedaPorDefecto: 'XX' }, '`monedaPorDefecto` tiene que tener 3 caracteres.'],
    [{ monedaPorDefecto: 'XXXX' }, '`monedaPorDefecto` tiene que tener 3 caracteres.'],
    [{ ticketPath: ' ' }, '`ticketPath` tiene que tener al menos 1 carácter.'],
    [{ filasPorLista: 0 }, '`filasPorLista` debe ser 1 o más.'],
    [{ filasPorLista: 100_000 }, expect.stringMatching(/^`filasPorLista` debe ser \d+ o menos\.$/) as string],
    [{ cotizacionPorDefecto: 0 }, '`cotizacionPorDefecto` debe ser mayor a 0.'],
  ])('config.json: %j', async (config, mensaje) => {
    expect(await detailsOf(['config'], config)).toEqual([{ mensaje, ruta: Object.keys(config) }]);
  });

  it.each([
    [['--receptor-nombre', 'x'.repeat(201)], 'Nombre del receptor tiene que tener hasta 200 caracteres.'],
    [['--receptor-domicilio', 'x'.repeat(201)], 'Domicilio del receptor tiene que tener hasta 200 caracteres.'],
    [['--descripcion', 'x'.repeat(201)], 'Descripción tiene que tener hasta 200 caracteres.'],
    [['--condicion-venta', 'x'.repeat(101)], 'Condición de venta tiene que tener hasta 100 caracteres.'],
    [['--dia', '32'], 'Día de vencimiento debe ser 31 o menos.'],
    [['--dia', '0'], 'Día de vencimiento debe ser 1 o más.'],
  ])('flags: %j', async (flags, mensaje) => {
    expect(await detailsOf([...FC, ...flags])).toEqual([expect.objectContaining({ mensaje })]);
  });

  it('config establecer', async () => {
    expect(await detailsOf(['config', 'establecer', 'moneda', 'XX'])).toEqual([
      { mensaje: '`monedaPorDefecto` tiene que tener 3 caracteres.', ruta: ['monedaPorDefecto'] },
    ]);
  });
});

describe('sin ruta', () => {
  it.each([
    ['entorno', 'x', 'El valor no está entre los soportados. Valores válidos: testing, produccion.'],
    ['condicionVenta', ' ', 'El valor tiene que tener al menos 1 carácter.'],
  ])('config establecer %s: no dice "Entrada"', async (key, value, mensaje) => {
    expect(await detailsOf(['config', 'establecer', key, value])).toEqual([{ mensaje, ruta: [] }]);
  });
});

describe('el valor recibido no sale', () => {
  it.each([
    [{ cbu: 110599520000012 }, '110599520000012'],
    [{ key: '/Users/ana/secreta.key' }, 'secreta'],
    [{ aliasCbu: ['ALIAS.PRIVADO'] }, 'ALIAS.PRIVADO'],
  ])('%j', async (config, secret) => {
    profile.writeConfig(profile.configWith(profile.healthy, config));

    const service = new ConfigService();
    let thrown: unknown;

    try {
      service.getConfig();
    } catch (error) {
      thrown = error;
    } finally {
      service.close();
    }

    expect(thrown).toBeInstanceOf(ZodError);
    // `message` de un ZodError es el JSON de sus problemas: si llega a otro mensaje, el valor tampoco sale.
    expect(`${(thrown as ZodError).message}${JSON.stringify((thrown as ZodError).issues)}`).not.toContain(secret);

    await detailsOf(['config'], config);
    expect(profile.stderr + profile.stdout).not.toContain(secret);
  });
});
