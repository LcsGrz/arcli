import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * El `arcli` compilado contra ARCA testing, con tu config y tu certificado de testing. Solo local y a pedido
 * (`yarn build && yarn test:arca`): nunca en el CI, porque necesita credenciales. Todo corre con `--testing`, que el
 * helper agrega siempre, asi que no puede tocar produccion. Emite comprobantes de prueba, sin validez fiscal.
 */
const CLI = resolve('dist/cli/index.js');

/** CUITs de prueba de ARCA testing: uno con padron completo y uno obligado a recibir FCE. */
const PADRON_CUIT = '20201797064';
const FCE_OBLIGATED_CUIT = '30546689979';

function arcli(...args: string[]): { readonly code: number | null; readonly json: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [CLI, ...args, '--testing', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
    timeout: 90_000,
  });
  const output = result.status === 0 ? result.stdout : result.stderr || result.stdout;

  return { code: result.status, json: JSON.parse(output) as Record<string, unknown> };
}

beforeAll(() => {
  if (process.env.CI) {
    throw new Error('Los tests contra ARCA no corren en el CI: usan tu certificado de testing.');
  }

  if (!existsSync(CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:arca`.');
  }
});

describe('ARCA testing', () => {
  it('estado: los servidores responden y la config está lista', () => {
    const { code, json } = arcli('estado');

    expect(code).toBe(0);
    expect(json).toMatchObject({
      entorno: 'testing',
      listo: true,
      servidores: { aplicacion: 'OK', autenticacion: 'OK', baseDeDatos: 'OK' },
    });
  });

  it('parametros: la tabla de alícuotas trae el 21%', () => {
    const { code, json } = arcli('parametros', 'alicuotas');

    expect(code).toBe(0);
    expect(json.valores).toEqual(expect.arrayContaining([expect.objectContaining({ descripcion: '21%', id: '5' })]));
  });

  it('padron: el CUIT de prueba trae nombre y condición frente al IVA', () => {
    const { code, json } = arcli('padron', PADRON_CUIT);

    expect(code).toBe(0);
    expect(json).toMatchObject({ entorno: 'testing', nombre: expect.any(String) });
    expect(json.condicionIva).toBeTruthy();
  });

  it('fce-obligado: el CUIT de prueba está obligado desde un monto', () => {
    const { code, json } = arcli('fce-obligado', FCE_OBLIGATED_CUIT);

    expect(code).toBe(0);
    expect(json).toMatchObject({ montoDesde: expect.any(Number), obligado: true });
  });

  it('vista previa de una Factura C: consulta ARCA y no emite', () => {
    const { code, json } = arcli('fc', '-m', '1000', '--cs', '--cfinal', '--previsualizar');

    expect(code).toBe(0);
    expect(json).toMatchObject({ cae: null, estado: 'previsualizacion', previsualizacion: true });
  });

  it('emite una Factura C de prueba y la encuentra con consultar', () => {
    const emitted = arcli('fc', '-m', '1', '--cs', '--cfinal', '--emitir');

    expect(emitted.code).toBe(0);
    expect(emitted.json).toMatchObject({ estado: 'aprobado', cae: expect.stringMatching(/^\d{14}$/) });

    const { numero, puntoVenta } = emitted.json as { numero: number; puntoVenta: number };
    const found = arcli('consultar', 'fc', String(numero), '--pv', String(puntoVenta));

    expect(found.code).toBe(0);
    expect(found.json).toMatchObject({ cae: emitted.json.cae, numero, resultado: 'A' });
  });
});
