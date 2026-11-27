import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';

import { InputIssuesError } from '../../lib/errors/app-error';
import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { parseZodInput, summarizeZodError } from '../../modules/billing/billing.zod-errors';
import { openConfigService } from '../config-service';

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

describe('`-m 0`', () => {
  // `arcli constatar` acepta `-m 0` (WSCDC, ImpTotal >= 0): al emitir, el monto sigue teniendo que ser mayor a 0.
  it.each([['fc'], ['fe']])('al emitir con %s sigue siendo inválido', async (kind) => {
    const error = await profile.runJsonError([kind, '-m', '0', '--previsualizar']);

    expect(error).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', error: expect.stringContaining('mayor a 0') });
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

function inputFile(content: unknown): string {
  const path = join(profile.temporaryDirectory('arcli-entrada-'), 'entrada.json');

  writeFileSync(path, JSON.stringify(content));

  return path;
}

const ITEM = { concepto: 'servicios', ivaReceptor: 'consumidor-final', montoTotal: 1000, puntoVenta: 3 };

describe('--cargar', () => {
  it.each([
    ['fc', { ...ITEM, puntoVenta: 1.5 }, 'Punto de venta tiene que ser un entero.', ['puntoVenta']],
    [
      'ncc',
      { ...ITEM, comprobanteAsociado: { atajo: 'fc', numero: 1.5, puntoVenta: 3 } },
      '`comprobanteAsociado.numero` tiene que ser un entero.',
      ['associatedVoucher', 'numero'],
    ],
    [
      'fb',
      { ...ITEM, alicuotas: [{ monto: -1, tasa: 21 }] },
      '`alicuotas.0.monto` debe ser mayor a 0.',
      ['ivaRateAmounts', '0', 'amount'],
    ],
  ])('%s %j: nombra la clave del JSON; `ruta` no cambia', async (command, item, mensaje, ruta) => {
    expect(await detailsOf([command, '--cargar', inputFile(item), '--previsualizar'])).toContainEqual({
      mensaje,
      ruta,
    });
  });

  it('en un lote', async () => {
    const error = await profile.runJsonError([
      'fc',
      '--cargar',
      inputFile([ITEM, { ...ITEM, puntoVenta: 1.5 }]),
      '--previsualizar',
    ]);

    expect(error.detalles).toEqual({
      comprobantes: [
        {
          codigo: 'INPUT_VALIDATION_ERROR',
          error: 'Punto de venta tiene que ser un entero.',
          indice: 2,
          sugerencia: null,
        },
      ],
    });
  });

  it('las demás claves anidadas', () => {
    const invalid = { associatedVoucher: { shortcut: 1 }, ivaRateAmounts: [{ amount: 1 }], shortcut: 'fc' };
    let message = '';

    try {
      parseZodInput(billingCommandSchema, invalid);
    } catch (error) {
      message = summarizeZodError(error as ZodError);
    }

    expect(message).toContain('`comprobanteAsociado.atajo` tiene que ser un texto.');

    const rate = z.object({ ivaRateAmounts: z.array(z.object({ rate: z.string() })) });

    expect(() => parseZodInput(rate, { ivaRateAmounts: [{ rate: 1 }] })).toThrow(
      expect.toSatisfy(
        (error: ZodError) => summarizeZodError(error) === '`alicuotas.0.tasa` tiene que ser un texto.',
      ) as Error,
    );
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
    [['--pv', '99999'], 'El punto de venta va de 1 a 99998: ARCA rechaza 99999 (error 10004).'],
    [['--dia', '0'], 'Día de vencimiento debe ser 1 o más.'],
  ])('flags: %j', async (flags, mensaje) => {
    expect(await detailsOf([...FC, ...flags])).toEqual([expect.objectContaining({ mensaje })]);
  });

  it('config establecer sobre una config que ya estaba mal', async () => {
    // Con un valor válido se guarda y avisa (config-repair.test.ts): uno inválido sale con su error.
    expect(await detailsOf(['config', 'establecer', 'moneda', 'XX'], { puntoVentaPorDefecto: 'a' })).toEqual([
      { mensaje: '`monedaPorDefecto` tiene que tener 3 caracteres.', ruta: ['monedaPorDefecto'] },
    ]);
  });

  it('una fecha de inicio de actividades mal guardada', async () => {
    expect(await detailsOf(['config'], { emisor: { inicioActividades: '1/3/2020' } })).toEqual([
      {
        mensaje: 'El inicio de actividades tiene que ser una fecha AAAAMMDD.',
        ruta: ['emisor', 'inicioActividades'],
      },
    ]);
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

    const service = openConfigService();
    let thrown: unknown;

    try {
      service.getConfig();
    } catch (error) {
      thrown = error;
    } finally {
      service.close();
    }

    expect(thrown).toBeInstanceOf(InputIssuesError);
    // Un error de verdad: con stack, y reconocible por quien solo mira `instanceof Error`.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).stack).toContain('config.service');
    expect(`${(thrown as InputIssuesError).message}${JSON.stringify(thrown)}`).not.toContain(secret);

    await detailsOf(['config'], config);
    expect(profile.stderr + profile.stdout).not.toContain(secret);
  });
});
