/**
 * Actualiza la tabla de categorias del monotributo que viene con ARCLI (`src/modules/monotributo/monotributo.bundled.ts`),
 * el respaldo cuando no se puede leer la pagina de ARCA. Se corre a mano en cada release de febrero y agosto:
 *
 *   yarn monotributo:tabla              # lee https://www.afip.gob.ar/monotributo/categorias.asp
 *   yarn monotributo:tabla pagina.html  # o una copia guardada de la pagina
 *
 * Usa el mismo parser y control que `arcli monotributo --actualizar`: si la pagina no pasa el control, no escribe nada.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { MONOTRIBUTO_CATEGORIES_URL } from '../../src/modules/monotributo/monotributo';
import { parseMonotributoPage } from '../../src/modules/monotributo/monotributo.parser';

const TARGET = new URL('../../src/modules/monotributo/monotributo.bundled.ts', import.meta.url);

async function readPage(path: string | undefined): Promise<string> {
  if (path) return readFileSync(path, 'utf8');

  const response = await fetch(MONOTRIBUTO_CATEGORIES_URL);

  if (!response.ok) throw new Error(`ARCA respondió ${response.status}`);

  return response.text();
}

const result = parseMonotributoPage(await readPage(process.argv[2]));

if (!result.ok) {
  console.error(`No se pudo leer la tabla:\n- ${result.problems.join('\n- ')}`);
  process.exit(1);
}

const { table } = result;
const rows = table.categories.map((category) => `    ${JSON.stringify(category)},`).join('\n');

writeFileSync(
  TARGET,
  `// Generado por \`yarn monotributo:tabla\` (scripts/monotributo/actualizar-tabla.ts): no se edita a mano.
import type { MonotributoTable } from './monotributo';

/**
 * La tabla de categorias de ARCA incluida en el paquete: se usa sin conexion, si la pagina cambio o hasta la primera
 * consulta. Se actualiza en cada release de febrero y agosto (ver docs/development.md).
 */
export const BUNDLED_MONOTRIBUTO_TABLE: MonotributoTable = {
  categories: [
${rows}
  ],
  validFrom: '${table.validFrom}',
};
`,
);

console.log(`Tabla incluida actualizada: vigente desde ${table.validFrom}, ${table.categories.length} categorías.`);
