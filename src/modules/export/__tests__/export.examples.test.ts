import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { assertExportItemsTotal } from '../export.items';
import { mapExportJsonItems, readExportJsonInput } from '../export.json-input';

/**
 * Los JSON de `ejemplos/` son la plantilla de `--cargar` de la factura de exportacion: tienen que pasar el
 * schema estricto y traer los datos obligatorios, porque se copian tal cual.
 */
const EXAMPLES_DIR = fileURLToPath(new URL('../../../../ejemplos/', import.meta.url));
const FILES = readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith('.json'));

describe('ejemplos de factura de exportacion', () => {
  it('tiene al menos un JSON para --cargar', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)('%s pasa el schema de --cargar y la suma de items da el monto', (file) => {
    const input = readExportJsonInput(JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8')));

    expect(input.monto).toBeGreaterThan(0);
    expect(input.cliente?.trim()).toBeTruthy();
    expect(input.domicilioCliente?.trim()).toBeTruthy();
    expect(input.paisDestino).toBeDefined();
    expect(mapExportJsonItems(input.items)?.length ?? 0).toBeGreaterThan(0);
    expect(() => assertExportItemsTotal(mapExportJsonItems(input.items), input.monto as number)).not.toThrow();
  });
});
