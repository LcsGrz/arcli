/** Cada marca `<!-- arcli: … -->` que entienden los transforms está documentada (tabla de development.md y página del sitio). */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const transformsDir = new URL('../', import.meta.url);
const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

/** El nombre de cada marca que aparece en el código de los transforms (`pasos`, `pestañas`, `muestra`...). */
const markers = [
  ...new Set(
    readdirSync(transformsDir)
      .filter((file) => file.endsWith('.mjs'))
      .flatMap((file) =>
        [...readFileSync(new URL(file, transformsDir), 'utf8').matchAll(/<!-- arcli: ([\wñ-]+)/g)].map((m) => m[1]),
      ),
  ),
].sort();

describe('marcas de Markdown documentadas', () => {
  it('encuentra las marcas de los transforms', () => {
    expect(markers).toEqual(expect.arrayContaining(['atajos', 'chat', 'pasos', 'pestañas', 'prompt-instalacion']));
  });

  it.each(markers)('`%s` está en la tabla de docs/development.md', (marker) => {
    expect(read('docs/development.md')).toContain(`<!-- arcli: ${marker}`);
  });

  it.each(markers)('`%s` tiene su ejemplo en docs/design-system-sitio.md', (marker) => {
    expect(read('docs/design-system-sitio.md')).toContain(`<!-- arcli: ${marker}`);
  });
});
