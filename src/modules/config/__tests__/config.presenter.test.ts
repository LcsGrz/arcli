import { describe, expect, it } from 'vitest';

import { renderJson, stripAnsi } from '../../../ui/primitives';
import {
  formatConfigAsText,
  formatConfigDoctorAsText,
  serializeConfig,
  serializeConfigDoctor,
} from '../config.presenter';
import { MISSING_CUIT_MESSAGE } from '../config.schemas';
import { buildConfigDoctorReport } from '../config-doctor';

describe('config.presenter', () => {
  it('masks certificate and key paths in config output', () => {
    const text = formatConfigAsText(
      {
        cert: {
          testing: '/Users/ana/secretos/cert.pem',
        },
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {
          testing: '/Users/ana/secretos/key.pem',
        },
        output: {
          emitirPorDefecto: false,
          brutoPorDefecto: false,
          jsonPorDefecto: false,
        },
      },
      { pdfFolder: '/Users/ana/arcli/comprobantes', ticketPath: '/Users/ana/secretos/tickets' },
    );

    const json = renderJson(
      serializeConfig(
        {
          cert: {
            testing: '/Users/ana/secretos/cert.pem',
          },
          emisor: {},
          entornoPorDefecto: 'testing',
          key: {
            testing: '/Users/ana/secretos/key.pem',
          },
          output: {
            emitirPorDefecto: false,
            brutoPorDefecto: false,
            jsonPorDefecto: false,
          },
        },
        { pdfFolder: '/Users/ana/arcli/comprobantes', ticketPath: '/Users/ana/secretos/tickets' },
      ),
    );

    expect(text).toContain('.../secretos/cert.pem');
    expect(text).toContain('.../secretos/key.pem');
    expect(text).toContain('.../secretos/tickets');
    expect(text).not.toContain('/Users/ana/secretos/cert.pem');
    expect(json).toContain('.../secretos/cert.pem');
    expect(json).not.toContain('/Users/ana/secretos/key.pem"');
    expect(json).not.toContain('/Users/ana/secretos/tickets"');

    // Por secciones, en el orden del modo interactivo; los certificados van juntos con los tickets.
    const plain = stripAnsi(text);
    const order = ['Cuenta', 'Certificados', 'Al facturar', 'FCE', 'Datos del emisor', 'PDF', 'Salida y listados'];

    expect(order.map((title) => plain.indexOf(title))).toEqual(
      [...order.map((title) => plain.indexOf(title))].sort((a, b) => a - b),
    );
    expect(plain.indexOf('Carpeta de tickets WSAA')).toBeGreaterThan(plain.indexOf('Certificados'));
    expect(plain.indexOf('Carpeta de tickets WSAA')).toBeLessThan(plain.indexOf('Al facturar'));
  });

  it('shows the CUIT with dashes, the environment and yes/no with their accents', () => {
    const text = stripAnsi(
      formatConfigAsText(
        {
          cert: {},
          cuit: '20333333334',
          emisor: {},
          entornoPorDefecto: 'produccion',
          key: {},
          output: { brutoPorDefecto: false, emitirPorDefecto: true, jsonPorDefecto: false },
        },
        { pdfFolder: '/tmp/pdf', ticketPath: '/tmp/tickets' },
      ),
    );

    expect(text).toContain('20-33333333-4');
    expect(text).toContain('producción');
    expect(text).toMatch(/Emitir sin `--emitir`\s+sí/);
  });

  describe('filasPorLista en el JSON', () => {
    const base = {
      cert: {},
      emisor: {},
      entornoPorDefecto: 'testing' as const,
      key: {},
      output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false },
    };
    const paths = { pdfFolder: '/pdfs', ticketPath: '/tickets' };
    const parse = (value: unknown): Record<string, unknown> => JSON.parse(renderJson(value)) as Record<string, unknown>;

    it('trae filasPorLista y, con el mismo valor, comprobantesPorLista deprecada', () => {
      const json = parse(serializeConfig({ ...base, comprobantesPorLista: 8 }, paths));

      expect(json).toMatchObject({ comprobantesPorLista: 8, filasPorLista: 8 });
      expect(json.deprecado).toEqual([expect.stringContaining('`filasPorLista`')]);
    });

    it('con las dos, gana filasPorLista', () => {
      const json = parse(serializeConfig({ ...base, comprobantesPorLista: 8, filasPorLista: 20 }, paths));

      expect(json).toMatchObject({ comprobantesPorLista: 20, filasPorLista: 20 });
    });

    it('sin valor no trae ninguna ni deprecado', () => {
      const json = parse(serializeConfig(base, paths));

      expect(json).not.toHaveProperty('filasPorLista');
      expect(json).not.toHaveProperty('comprobantesPorLista');
      expect(json).not.toHaveProperty('deprecado');
    });

    it('monotributo sale solo con monotributo.tope, y el texto lo muestra en su sección', () => {
      expect(parse(serializeConfig(base, paths))).not.toHaveProperty('monotributo');
      expect(parse(serializeConfig({ ...base, monotributo: { tope: 30_000_000 } }, paths))).toMatchObject({
        monotributo: { tope: 30_000_000 },
      });
      expect(stripAnsi(formatConfigAsText(base, paths))).toMatch(
        /Monotributo[\s│]+Tope de ingresos anuales propio\s+el de tu categoría/,
      );
      expect(stripAnsi(formatConfigAsText({ ...base, monotributo: { tope: 30_000_000 } }, paths))).toMatch(
        /Tope de ingresos anuales propio\s+\$ 30\.000\.000/,
      );
    });

    it('el texto la muestra como Filas por lista, con el valor de la vieja si es la unica', () => {
      const text = stripAnsi(formatConfigAsText({ ...base, comprobantesPorLista: 8 }, paths));

      expect(text).toMatch(/Filas por lista\s+8/);
      expect(text).not.toContain('Comprobantes por lista');
    });
  });

  it('serializes revision with masked runtime-friendly details', () => {
    const report = buildConfigDoctorReport(
      {
        cert: {
          testing: '/Users/ana/secretos/cert.pem',
        },
        cuit: '20123456786',
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {
          testing: '/Users/ana/secretos/key.pem',
        },
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
      },
      new Date(),
      [{ environment: 'testing', error: 'Falta el punto de venta.' }],
    );

    expect(renderJson(serializeConfigDoctor(report))).toContain('"etiqueta": "Validación testing"');
    expect(formatConfigDoctorAsText(report)).toContain('REVISIÓN DE CONFIGURACIÓN');
    expect(formatConfigDoctorAsText(report)).toContain('Falta el punto de venta');
  });

  describe('sin CUIT', () => {
    const report = buildConfigDoctorReport(
      {
        cert: {},
        emisor: {},
        entornoPorDefecto: 'testing',
        key: {},
        output: {
          emitirPorDefecto: false,
          jsonPorDefecto: false,
          brutoPorDefecto: false,
        },
      },
      new Date(),
      [
        { environment: 'testing', error: MISSING_CUIT_MESSAGE },
        { environment: 'produccion', error: MISSING_CUIT_MESSAGE },
      ],
    );

    it('el texto lo muestra una sola vez, como error, en Cuenta', () => {
      const text = stripAnsi(formatConfigDoctorAsText(report));

      expect(text.match(/Falta el CUIT/g)).toHaveLength(1);
      expect(text).not.toContain('Configurá tu CUIT');
      expect(text).not.toContain('Validaciones');
      expect(text).toContain('Hay puntos críticos por corregir antes de emitir');
    });

    it('el JSON sigue trayendo todos los chequeos, sin claves nuevas', () => {
      const { chequeos } = serializeConfigDoctor(report) as {
        chequeos: Array<Record<string, string>>;
      };

      expect(chequeos.map((check) => check.etiqueta)).toEqual(
        expect.arrayContaining(['CUIT', 'Validación testing', 'Validación producción']),
      );
      expect(chequeos.find((check) => check.etiqueta === 'CUIT')?.categoria).toBe('warning');
      expect(Object.keys(chequeos.find((check) => check.etiqueta === 'Validación testing') ?? {})).toEqual([
        'categoria',
        'detalle',
        'etiqueta',
      ]);
    });
  });
});
