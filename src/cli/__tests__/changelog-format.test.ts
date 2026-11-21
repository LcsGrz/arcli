import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El formato de CHANGELOG.md (DOCS-11). Lo leen el aviso de actualizacion (`src/modules/update-check/changelog.ts`) y
 * Novedades del sitio (`site/scripts/transforms/releases.mjs`), y la skill `changelog` lo escribe. Si este test
 * falla, arreglá la entrada; si cambia el formato, cambian los tres.
 */
const SECTIONS = ['✨ Agregado', '🔧 Cambiado', '⏳ Deprecado', '🧹 Eliminado', '🐛 Corregido', '🔒 Seguridad'];
const AREAS = new Set([
  'Asistente',
  'Facturas',
  'Recibos',
  'Notas',
  'FCE',
  'Factura E',
  'Monotributo',
  'Consultas',
  'PDF',
  'Config',
  'Certificados',
  'Salida',
  'Errores',
  'Fechas',
  'Instalación',
  'Docs',
]);
const MAX_WORDS = 30;

const VERSION_HEADING = /^## \[(\d+)\.(\d+)\.(\d+)\] - \d{4}-\d{2}-\d{2}(?: · (\S.*))?$/;
const ENTRY = /^- \*\*([^*]+):\*\* \S/;
// `(#210)` o `(#210, #212)`: no cuentan como palabras.
const PR_REFERENCES = /\(#\d+(?:,\s*#\d+)*\)/g;

/** Los problemas de formato de un CHANGELOG, uno por renglon con su numero de linea; vacio si esta bien. */
function changelogFormatProblems(markdown: string): string[] {
  const problems: string[] = [];
  const lines = markdown.split('\n');
  let version: { hasSummary: boolean; line: number; published: boolean; summaryClosed?: boolean } | undefined;
  let sectionIndex = -1;
  let inSection = false;
  let inFence = false;
  let inDetails = false;
  let afterEntry = false;

  const closeVersion = () => {
    if (version?.published && !version.hasSummary) {
      problems.push(`${version.line}: la versión no tiene resumen (una línea de prosa antes de las secciones)`);
    }
  };

  lines.forEach((line, index) => {
    const at = index + 1;

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      afterEntry = false;
      return;
    }

    if (inFence) return;

    if (/<details[\s>]/.test(line) || inDetails) {
      inDetails = !line.includes('</details>');
      afterEntry = false;

      if (/^\s*[-*] /.test(line)) problems.push(`${at}: una viñeta dentro de <details> (el detalle va en párrafos)`);

      return;
    }

    if (line.startsWith('## ')) {
      closeVersion();
      sectionIndex = -1;
      inSection = false;
      afterEntry = false;

      if (line === '## [Sin publicar]') {
        version = { hasSummary: true, line: at, published: false };
        return;
      }

      const heading = VERSION_HEADING.exec(line);

      if (!heading) {
        problems.push(`${at}: el título de la versión no es \`## [X.Y.Z] - AAAA-MM-DD\` (con \` · Nombre\` opcional)`);
      } else if (heading[4] && heading[3] !== '0') {
        problems.push(`${at}: una versión de arreglos (${heading[1]}.${heading[2]}.${heading[3]}) no lleva nombre`);
      }

      version = { hasSummary: false, line: at, published: true };
      return;
    }

    if (!version) return;

    if (line.startsWith('### ')) {
      const name = line.slice(4).trim();
      const position = SECTIONS.indexOf(name);

      if (position < 0) {
        problems.push(`${at}: la sección "${name}" no es una de ${SECTIONS.join(', ')}`);
      } else if (position <= sectionIndex) {
        problems.push(`${at}: la sección "${name}" va antes (orden: ${SECTIONS.join(', ')})`);
      } else {
        sectionIndex = position;
      }

      inSection = true;
      afterEntry = false;
      return;
    }

    if (!inSection) {
      // El resumen: una linea de prosa antes de los destacados (`####`), como lo lee el aviso de actualizacion. La
      // caja (`>`), la linea `---`, el HTML y las viñetas no cuentan.
      if (line.startsWith('#### ')) {
        version.summaryClosed = true;
      } else if (!version.summaryClosed && line.trim() && !/^\s*(?:#|>|<|---|- )/.test(line)) {
        version.hasSummary = true;
      }

      return;
    }

    if (!line.trim()) {
      afterEntry = false;
      return;
    }

    if (!line.startsWith('- ')) {
      if (afterEntry) {
        problems.push(`${at}: la entrada de arriba sigue en otra línea (va en una sola; el detalle, en <details>)`);
      }

      return;
    }

    afterEntry = true;

    const entry = ENTRY.exec(line);

    if (!entry || !AREAS.has(entry[1])) {
      problems.push(
        `${at}: la entrada no empieza con \`- **Área:**\` y un área de la lista (${[...AREAS].join(', ')})`,
      );
      return;
    }

    // Una palabra tiene al menos una letra o un numero: el punto que queda al sacar `(#N).` no cuenta.
    const words = line
      .slice(2)
      .replace(PR_REFERENCES, '')
      .split(/\s+/)
      .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

    if (words > MAX_WORDS) {
      problems.push(`${at}: la entrada tiene ${words} palabras (máximo ${MAX_WORDS}, sin los \`(#N)\`)`);
    }
  });

  closeVersion();

  return problems;
}

const VALID = `# Changelog

## [Sin publicar]

### 🐛 Corregido

- **Facturas:** algo sin publicar.

## [2.6.0] - 2026-11-21 · Monotributo y recibos

El monotributo en la terminal, Recibo A y B y fechas relativas.

#### El monotributo en la terminal

Las 11 categorías con topes y cuotas, con la tuya marcada.

\`\`\`sh
arcli monotributo
- no es una entrada
\`\`\`

> [!WARNING]
> **Puede afectar scripts**
> - Una moneda que no existe sale con \`INPUT_VALIDATION_ERROR\`.

---

### ✨ Agregado

- **Monotributo:** \`arcli monotributo\` con categorías, topes y cuotas (#210).
- **Recibos:** Recibo A y Recibo B, \`arcli ra\` y \`arcli rb\` (#202, #205).

<details><summary>Detalle</summary>

**Monotributo.** Párrafo largo con el detalle.

</details>

### 🔧 Cambiado

- **Errores:** una moneda inexistente es \`INPUT_VALIDATION_ERROR\` (#212).

### ⏳ Deprecado

- **Config:** la clave \`cotizacion\`.

## [2.5.2] - 2026-11-18

Cotización y pesos en la E.

### 🐛 Corregido

- **Factura E:** la cotización (#212).
`;

describe('changelogFormatProblems', () => {
  it('un CHANGELOG en el formato acepta destacados, caja, detalle y versiones sin nombre', () => {
    expect(changelogFormatProblems(VALID)).toEqual([]);
  });

  it.each([
    ['## [2.5.3] - 2026-11-19 · Arreglos\n\nResumen.\n', 'no lleva nombre'],
    ['## 2.6.0 - 2026-11-21\n\nResumen.\n', 'el título de la versión'],
    ['## [2.6.0] - 21/11/2026\n\nResumen.\n', 'el título de la versión'],
    ['## [2.6.0] - 2026-11-21\n\n### ✨ Agregado\n\n- **Docs:** x.\n', 'no tiene resumen'],
    ['## [2.6.0] - 2026-11-21\n\n#### Destacado\n\nTexto.\n\n### ✨ Agregado\n', 'no tiene resumen'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### Agregado\n', 'no es una de'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### 🐛 Corregido\n\n### ✨ Agregado\n', 'va antes'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n- **Monotributo** sin dos puntos.\n', '- **Área:**'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n- **Modo interactivo:** x.\n', '- **Área:**'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n- **Docs:** x\n  sigue acá.\n', 'una sola'],
    ['## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n- **Docs:** x\n  - **Anidada:** y.\n', 'una sola'],
    [`## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n- **Docs:** ${'palabra '.repeat(30)}(#1).\n`, '31 palabras'],
    [
      '## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n<details><summary>D</summary>\n\n- x\n\n</details>\n',
      '<details>',
    ],
  ])('marca %j', (markdown, problem) => {
    const problems = changelogFormatProblems(markdown);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it('30 palabras sin contar los (#N) estan bien', () => {
    const entry = `- **Docs:** ${'palabra '.repeat(29).trim()} (#1, #2).`;

    expect(changelogFormatProblems(`## [2.6.0] - 2026-11-21\n\nR.\n\n### ✨ Agregado\n\n${entry}\n`)).toEqual([]);
  });
});

describe('CHANGELOG.md', () => {
  it('sigue el formato', () => {
    const markdown = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');

    expect(changelogFormatProblems(markdown)).toEqual([]);
  });
});
