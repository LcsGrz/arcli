import { describe, expect, it } from 'vitest';

import { ConfigurationError, InputValidationError } from '../../../lib/errors/app-error';
import { formatCliError } from '../errors.presenter';

describe('errors.presenter', () => {
  it('formats configuration errors in a friendly text panel', () => {
    const output = formatCliError(
      new ConfigurationError('La ruta de la clave privada apunta a un archivo con formato PEM invalido.', {
        path: '.../testing/ARCATestingKey.key',
      }),
      false,
    );

    expect(output).toContain('ERROR DE CONFIGURACION');
    expect(output).toContain('La ruta de la clave privada apunta a un archivo con formato PEM');
    expect(output).toContain('invalido.');
    expect(output).toContain('Ruta:');
    expect(output).toContain('ARCATestingKey.key');
    expect(output).toContain('Sugerencia');
  });

  it('formats input errors in a friendly text panel', () => {
    const output = formatCliError(new InputValidationError('Falta el concepto.'), false);

    expect(output).toContain('ERROR DE ENTRADA');
    expect(output).toContain('Falta el concepto.');
    expect(output).toContain('ayuda');
  });

  it('keeps json output structured for app errors', () => {
    const output = formatCliError(new ConfigurationError('Mensaje de prueba', { path: '/tmp/test.key' }), true);

    expect(output).toContain('"codigo": "CONFIGURATION_ERROR"');
    expect(output).toContain('"error": "Mensaje de prueba"');
    expect(output).toContain('"ruta": "/tmp/test.key"');
  });
});
