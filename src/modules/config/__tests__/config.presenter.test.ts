import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui';
import { formatConfig, formatConfigAsText, formatConfigDoctor, formatConfigDoctorAsText } from '../config.presenter';
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

    const json = formatConfig(
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
      [{ environment: 'testing', error: 'Falta el punto de venta.' }],
    );

    expect(formatConfigDoctor(report)).toContain('"etiqueta": "Validación testing"');
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
      const { chequeos } = JSON.parse(formatConfigDoctor(report)) as {
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
