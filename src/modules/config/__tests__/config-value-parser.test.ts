import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { nodeLocalFiles } from '../../../services/files/local-files';
import { arcliConfigSchema } from '../config.schemas';
import { parseConfigValue } from '../config-value-parser';

const temporaryDirectories: string[] = [];

/** Un valor fuera de la lista: error de entrada con lo que llego y los valores validos. */
function enumRejection(value: string, values: readonly string[]) {
  return expect.objectContaining({
    code: 'INPUT_VALIDATION_ERROR',
    message: `No se acepta "${value}". Valores válidos: ${values.join(', ')}.`,
  });
}

function writePemFile(filename: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-config-value-parser-'));

  temporaryDirectories.push(directory);

  const fullPath = join(directory, filename);

  writeFileSync(fullPath, content, 'utf8');

  return fullPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('config-value-parser', () => {
  it('parses simple enum-backed keys', () => {
    expect(parseConfigValue('conceptoPorDefecto', 'Servicios', nodeLocalFiles)).toBe('servicios');
    expect(parseConfigValue('entornoPorDefecto', 'PRODUCCION', nodeLocalFiles)).toBe('produccion');
    expect(parseConfigValue('ivaReceptorPorDefecto', 'consumidor-final', nodeLocalFiles)).toBe('consumidor-final');
  });

  it('rejects values outside of the supported enums', () => {
    expect(() => parseConfigValue('entornoPorDefecto', 'demo', nodeLocalFiles)).toThrow(
      enumRejection('demo', ['testing', 'produccion']),
    );
    expect(() => parseConfigValue('conceptoPorDefecto', 'cosas', nodeLocalFiles)).toThrow(
      enumRejection('cosas', ['productos', 'productos-servicios', 'servicios']),
    );
    expect(() => parseConfigValue('ivaReceptorPorDefecto', 'algo-raro', nodeLocalFiles)).toThrow(
      /responsable-inscripto/,
    );
  });

  it('con la clave como la escribió la persona, el mensaje la nombra junto al valor recibido', () => {
    expect(() => parseConfigValue('emisor.condicionIva', 'Inscripto', nodeLocalFiles, 'emisor.condicionIva')).toThrow(
      /^`emisor\.condicionIva` no acepta "Inscripto"\. Valores válidos: .*responsable-inscripto/,
    );
    expect(() => parseConfigValue('entornoPorDefecto', 'demo', nodeLocalFiles, 'entorno')).toThrow(
      '`entorno` no acepta "demo". Valores válidos: testing, produccion.',
    );
    expect(() => parseConfigValue('output.emitirPorDefecto', 'quizas', nodeLocalFiles, 'emitir')).toThrow(
      '`emitir` no acepta "quizas". Usá true/false, si/no o 1/0.',
    );
    expect(() => parseConfigValue('puntoVentaPorDefecto', 'abc', nodeLocalFiles, 'puntoVenta')).toThrow(
      '`puntoVenta` no acepta "abc": tiene que ser un entero positivo válido.',
    );
    expect(() => parseConfigValue('emisor.razonSocial', ' ', nodeLocalFiles, 'emisor.razonSocial')).toThrow(
      '`emisor.razonSocial` no puede estar vacío.',
    );
    expect(() => parseConfigValue('condicionVenta', '', nodeLocalFiles, 'condicionVenta')).toThrow(
      '`condicionVenta` no puede estar vacío.',
    );
  });

  it('la moneda tiene que ser un código de 3 caracteres', () => {
    expect(parseConfigValue('monedaPorDefecto', '060', nodeLocalFiles)).toBe('060');
    expect(() => parseConfigValue('monedaPorDefecto', '', nodeLocalFiles, 'moneda')).toThrow(
      /^`moneda` no acepta "": tiene que ser/,
    );
    expect(() => parseConfigValue('monedaPorDefecto', 'DOLAR', nodeLocalFiles)).toThrow(
      /código de moneda de 3 caracteres/,
    );
  });

  it('normalizes the currency code to uppercase', () => {
    expect(parseConfigValue('monedaPorDefecto', 'usd', nodeLocalFiles)).toBe('USD');
  });

  it('parses booleans accepting the spanish and numeric aliases', () => {
    expect(parseConfigValue('output.emitirPorDefecto', 'true', nodeLocalFiles)).toBe(true);
    expect(parseConfigValue('output.jsonPorDefecto', 'si', nodeLocalFiles)).toBe(true);
    expect(parseConfigValue('output.brutoPorDefecto', '1', nodeLocalFiles)).toBe(true);
    expect(parseConfigValue('output.emitirPorDefecto', 'no', nodeLocalFiles)).toBe(false);
    expect(parseConfigValue('output.jsonPorDefecto', '0', nodeLocalFiles)).toBe(false);
  });

  it('rejects values that are not recognizable booleans', () => {
    expect(() => parseConfigValue('output.emitirPorDefecto', 'tal-vez', nodeLocalFiles)).toThrow(
      /no es un booleano válido/,
    );
  });

  it('reports invalid values as input errors, not unexpected ones', () => {
    expect(() => parseConfigValue('puntoVentaPorDefecto', 'abc', nodeLocalFiles)).toThrow(InputValidationError);
    expect(() => parseConfigValue('filasPorLista', '99', nodeLocalFiles)).toThrow(InputValidationError);
  });

  it('normalizes the default IVA rate', () => {
    expect(parseConfigValue('alicuotaPorDefecto', '10,5', nodeLocalFiles)).toBe('10.5');
    expect(parseConfigValue('alicuotaPorDefecto', '21%', nodeLocalFiles)).toBe('21');
    expect(() => parseConfigValue('alicuotaPorDefecto', '19', nodeLocalFiles)).toThrow(
      /general \(21\), reducida \(10\.5\)/,
    );
  });

  it('validates the FCE CBU and its alias', () => {
    expect(parseConfigValue('cbu', ' 0110599520000012345678 ', nodeLocalFiles)).toBe('0110599520000012345678');
    expect(parseConfigValue('aliasCbu', 'mi.alias.cbu', nodeLocalFiles)).toBe('mi.alias.cbu');
    expect(() => parseConfigValue('cbu', '123', nodeLocalFiles)).toThrow(/debe tener 22 dígitos/);
    expect(() => parseConfigValue('cbu', '0110599420000012345678', nodeLocalFiles)).toThrow(
      /bloque de banco y sucursal/,
    );
    expect(() => parseConfigValue('cbu', '0110599520000012345677', nodeLocalFiles)).toThrow(/bloque de la cuenta/);
    // La config que ya está en el archivo pasa por la misma regla.
    expect(arcliConfigSchema.safeParse({ cbu: '0110599520000012345678' }).success).toBe(true);
    expect(arcliConfigSchema.safeParse({ cbu: '0110599520000012345677' }).success).toBe(false);
    expect(() => parseConfigValue('aliasCbu', 'abc', nodeLocalFiles)).toThrow(/entre 6 y 20/);
  });

  it('parses positive numbers and integers', () => {
    expect(parseConfigValue('cotizacionPorDefecto', '1.234,5', nodeLocalFiles)).toBe(1234.5);
    expect(parseConfigValue('cotizacionPorDefecto', '1452,123456', nodeLocalFiles)).toBe(1452.123456);
    expect(parseConfigValue('puntoVentaPorDefecto', '3', nodeLocalFiles)).toBe(3);
  });

  it('valida la cantidad de comprobantes por lista entre 1 y 50', () => {
    expect(parseConfigValue('filasPorLista', ' 25 ', nodeLocalFiles)).toBe(25);
    expect(() => parseConfigValue('filasPorLista', '0', nodeLocalFiles)).toThrow(/entre 1 y 50/);
    expect(() => parseConfigValue('filasPorLista', '51', nodeLocalFiles)).toThrow(/entre 1 y 50/);
    expect(() => parseConfigValue('filasPorLista', '2.5', nodeLocalFiles)).toThrow(/entre 1 y 50/);
  });

  it('rejects non-positive numbers and integers', () => {
    expect(() => parseConfigValue('cotizacionPorDefecto', '0', nodeLocalFiles)).toThrow(/tiene que ser mayor a 0/);
    expect(() => parseConfigValue('cotizacionPorDefecto', '1234.5', nodeLocalFiles)).toThrow(
      /usá coma para los decimales/,
    );
    expect(() => parseConfigValue('puntoVentaPorDefecto', '0', nodeLocalFiles)).toThrow(
      /no es un entero positivo válido/,
    );
    expect(() => parseConfigValue('puntoVentaPorDefecto', 'abc', nodeLocalFiles)).toThrow(
      /no es un entero positivo válido/,
    );
    expect(() => parseConfigValue('puntoVentaPorDefecto', '3a', nodeLocalFiles)).toThrow(
      /no es un entero positivo válido/,
    );
    expect(() => parseConfigValue('puntoVentaPorDefecto', '3.5', nodeLocalFiles)).toThrow(
      /no es un entero positivo válido/,
    );
  });

  it('accepts the CUIT with or without dashes and checks its check digit', () => {
    expect(parseConfigValue('cuit', '  20123456786  ', nodeLocalFiles)).toBe('20123456786');
    expect(parseConfigValue('cuit', '20-12345678-6', nodeLocalFiles)).toBe('20123456786');
    expect(parseConfigValue('cuit', '20 12345678 6', nodeLocalFiles)).toBe('20123456786');
    expect(() => parseConfigValue('cuit', '20-12345678-9', nodeLocalFiles)).toThrow(/dígito verificador/);
    expect(() => parseConfigValue('cuit', '123', nodeLocalFiles)).toThrow(/debe tener 11 dígitos/);
  });

  it('trims free-form string keys without transforming them', () => {
    expect(parseConfigValue('ticketPath', '  /ruta/a/tickets  ', nodeLocalFiles)).toBe(resolve('/ruta/a/tickets'));
  });

  it('rejects empty free-form string keys', () => {
    expect(() => parseConfigValue('ticketPath', '   ', nodeLocalFiles)).toThrow(/no puede estar vacío/);
  });

  it('validates that cert and key paths exist and contain a valid PEM', () => {
    const certPath = writePemFile('cert.pem', '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----');
    const keyPath = writePemFile('key.pem', '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----');

    expect(parseConfigValue('cert.testing', certPath, nodeLocalFiles)).toBe(certPath);
    expect(parseConfigValue('key.produccion', keyPath, nodeLocalFiles)).toBe(keyPath);
  });

  it('stores cert, key and ticket paths as absolute, so they do not depend on the current folder', () => {
    const keyPath = writePemFile('key.pem', '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----');
    const previous = process.cwd();

    try {
      process.chdir(dirname(keyPath));

      expect(parseConfigValue('key.testing', basename(keyPath), nodeLocalFiles)).toBe(
        join(process.cwd(), basename(keyPath)),
      );
      expect(parseConfigValue('ticketPath', 'tickets', nodeLocalFiles)).toBe(join(process.cwd(), 'tickets'));
    } finally {
      process.chdir(previous);
    }
  });

  it('rejects an encrypted private key with a clear message', () => {
    const keyPath = writePemFile(
      'cifrada.key',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nKEY\n-----END ENCRYPTED PRIVATE KEY-----',
    );

    expect(() => parseConfigValue('key.testing', keyPath, nodeLocalFiles)).toThrow(/cifrada con contraseña/);
  });

  it('rejects cert and key paths with invalid PEM content', () => {
    const invalidPath = writePemFile('invalid.pem', 'NOT-A-PEM');

    expect(() => parseConfigValue('cert.testing', invalidPath, nodeLocalFiles)).toThrow(/formato PEM inválido/);
    expect(() => parseConfigValue('key.testing', invalidPath, nodeLocalFiles)).toThrow(/formato PEM inválido/);
  });

  it('parses the PDF mode and folder', () => {
    expect(parseConfigValue('pdf', 'Siempre', nodeLocalFiles)).toBe('siempre');
    expect(() => parseConfigValue('pdf', 'a-veces', nodeLocalFiles)).toThrow(
      enumRejection('a-veces', ['siempre', 'preguntar', 'nunca']),
    );
    expect(parseConfigValue('pdfCarpeta', '/tmp/comprobantes', nodeLocalFiles)).toBe(resolve('/tmp/comprobantes'));
  });

  it('requires the year in the start of activities date', () => {
    expect(parseConfigValue('emisor.inicioActividades', '1/03/2020', nodeLocalFiles)).toBe('20200301');
    expect(() => parseConfigValue('emisor.inicioActividades', '1/03', nodeLocalFiles)).toThrow(/D\/MM\/YYYY/);
  });

  it('accepts only existing PNG or JPG logos', () => {
    const logoPath = writePemFile('logo.png', 'png');
    const textPath = writePemFile('logo.txt', 'txt');

    expect(parseConfigValue('emisor.logo', logoPath, nodeLocalFiles)).toBe(logoPath);
    expect(() => parseConfigValue('emisor.logo', textPath, nodeLocalFiles)).toThrow(/PNG o JPG/);
    expect(() => parseConfigValue('emisor.logo', '/no/existe.png', nodeLocalFiles)).toThrow(/No se encontró el logo/);
  });

  it('rejects a browser path that does not exist', () => {
    expect(() => parseConfigValue('pdfNavegador', '/no/existe/chrome', nodeLocalFiles)).toThrow(
      /No se encontró el navegador/,
    );
  });
});
