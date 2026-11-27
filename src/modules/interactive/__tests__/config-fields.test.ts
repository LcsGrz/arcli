import { describe, expect, it } from 'vitest';

import { nodeLocalFiles } from '../../../services/files/local-files';
import { formatConfigValue } from '../../config/config.presenter';
import type { ArcliConfig } from '../../config/config.schemas';
import { validateConfigValue } from '../../config/config.service';
import { CONFIG_FIELDS, listMissingSetupKeys, resolveActiveEnvironment } from '../config-fields';

const BASE = {
  cert: {},
  emisor: {},
  entornoPorDefecto: 'testing',
  key: {},
  output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
} satisfies ArcliConfig;

const PATHS = { pdfFolder: '/Users/x/arcli/comprobantes', ticketPath: '/Users/x/arcli/tickets' };

describe('config-fields', () => {
  it('lists what is missing to emit', () => {
    expect(listMissingSetupKeys(BASE)).toEqual(['cuit', 'cert.testing', 'key.testing', 'puntoVenta']);
    expect(
      listMissingSetupKeys({
        ...BASE,
        cert: { testing: '/a.crt' },
        cuit: '20123456786',
        key: { testing: '/a.key' },
        puntoVentaPorDefecto: 3,
      }),
    ).toEqual([]);
  });

  it('asks for the certificate of the active environment, not always the testing one', () => {
    expect(
      listMissingSetupKeys({
        ...BASE,
        cert: { produccion: '/p.crt' },
        cuit: '20123456786',
        entornoPorDefecto: 'produccion',
        key: { produccion: '/p.key' },
        puntoVentaPorDefecto: 3,
      }),
    ).toEqual([]);
  });

  it('with --produccion or --testing, checks the certificate of that environment', () => {
    const testingOnly = {
      ...BASE,
      cert: { testing: '/t.crt' },
      cuit: '20123456786',
      key: { testing: '/t.key' },
      puntoVentaPorDefecto: 3,
    } satisfies ArcliConfig;

    expect(listMissingSetupKeys(testingOnly, resolveActiveEnvironment(testingOnly, { produccion: true }))).toEqual([
      'cert.produccion',
      'key.produccion',
    ]);
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'produccion' }, { testing: true })).toBe('testing');
    expect(resolveActiveEnvironment({ entornoPorDefecto: 'produccion' })).toBe('produccion');
  });

  it('masks paths and formats dates when describing values', () => {
    const config = {
      ...BASE,
      cert: { testing: '/Users/x/secretos/cert.crt' },
      emisor: { inicioActividades: '20200301' },
    };

    expect(formatConfigValue('cert.testing', config, PATHS)).toBe('.../secretos/cert.crt');
    expect(formatConfigValue('emisor.inicioActividades', config, PATHS)).toBe('01/03/2020');
    expect(formatConfigValue('cuit', config, PATHS)).toBe('sin configurar');
  });

  it('shows labels instead of raw values, without changing what is saved', () => {
    const config = {
      ...BASE,
      alicuotaPorDefecto: '10.5',
      consultarPadron: false,
      ivaReceptorPorDefecto: 'responsable-inscripto',
    };

    expect(formatConfigValue('ivaReceptor', config as ArcliConfig, PATHS)).toBe('Responsable inscripto');
    expect(formatConfigValue('alicuota', config as ArcliConfig, PATHS)).toBe('10,5%');
    expect(formatConfigValue('consultarPadron', config as ArcliConfig, PATHS)).toBe('no');
  });

  it('only offers choices that config accepts', () => {
    for (const field of CONFIG_FIELDS) {
      for (const choice of field.choices ?? []) {
        expect(() => validateConfigValue(field.key, choice, nodeLocalFiles)).not.toThrow();
      }
    }
  });

  it('has one field per key', () => {
    const keys = CONFIG_FIELDS.map((field) => field.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
