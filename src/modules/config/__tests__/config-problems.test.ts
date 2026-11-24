import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { onlyOldProblems, parseConfigProblems, suggestConfigFix } from '../config-problems';

/** Hoy el esquema no tiene reglas entre claves: si se suma una, un cambio que la rompe no se puede guardar. */
function error(...issues: ReadonlyArray<readonly [path: string, message: string]>): z.ZodError {
  return new z.ZodError(
    issues.map(([path, message]) => ({ code: 'custom', input: undefined, message, path: path.split('.') })),
  );
}

describe('onlyOldProblems', () => {
  const saved = error(['cuit', 'a'], ['emisor', 'b']);

  it('acepta lo que ya estaba', () => {
    expect(onlyOldProblems(error(['cuit', 'a']), saved, 'alicuotaPorDefecto')).toBe(true);
  });

  it('rechaza uno nuevo en otra clave, u otro problema en la misma', () => {
    expect(onlyOldProblems(error(['cuit', 'a'], ['pdf', 'a']), saved, 'alicuotaPorDefecto')).toBe(false);
    expect(onlyOldProblems(error(['cuit', 'otro']), saved, 'alicuotaPorDefecto')).toBe(false);
    expect(onlyOldProblems(error(['cuit', 'a']), undefined, 'alicuotaPorDefecto')).toBe(false);
  });

  it('rechaza los de la clave que se cambia y los de su grupo', () => {
    expect(onlyOldProblems(error(['cuit', 'a']), saved, 'cuit')).toBe(false);
    expect(onlyOldProblems(error(['emisor', 'b']), saved, 'emisor.logo')).toBe(false);
  });
});

describe('suggestConfigFix', () => {
  it('si un problema no tiene clave pública, manda al archivo con su ruta', () => {
    const suggestion = suggestConfigFix(error(['cuit', 'a'], ['desconocida', 'b']), '/x/config.json');

    expect(suggestion).toBe('Corregilo en /x/config.json, o renombrá ese archivo y volvé a cargar los datos.');
  });

  it('una clave y su nombre viejo se arreglan con la misma', () => {
    expect(suggestConfigFix(error(['filasPorLista', 'a'], ['comprobantesPorLista', 'b']), '/x')).toBe(
      'Corregilo con `arcli config establecer filasPorLista <valor>` o borralo con `arcli config eliminar filasPorLista`.',
    );
  });

  it('todo lo que el esquema puede rechazar de un grupo tiene clave pública', () => {
    const problems = parseConfigProblems({
      cert: 1,
      emisor: 1,
      exportacion: { cert: 1, key: 1 },
      key: 1,
      monotributo: 1,
      output: 1,
    });

    expect(problems?.issues).toHaveLength(7);
    expect(suggestConfigFix(problems!, '/x/config.json')).not.toContain('/x/config.json');
  });
});
