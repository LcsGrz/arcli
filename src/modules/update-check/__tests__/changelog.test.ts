import { describe, expect, it } from 'vitest';

import { extractChangelog } from '../changelog';

const CHANGELOG = `# Changelog

## [Sin publicar]

### Agregado

- **Algo sin publicar:** no tiene que aparecer.

## [1.10.0] - 2026-10-20

Suma \`arcli algo\`. Ningún flag cambia.

### Agregado

- **Nuevo comando \`arcli algo\`:** hace algo.
- **Modo interactivo:**
  - **Repetir una factura:** copia una anterior.
- **Docs:** guía nueva del modo interactivo. Y otra cosa.
- Un cambio sin negrita. Con una segunda oración.

## [1.9.0] - 2026-10-12

### Corregido

- **Ver la [guía](https://example.com):** link arreglado.

## [1.8.0] - 2026-10-09

### Cambiado

- **Ya instalada:** no tiene que aparecer.
`;

describe('extractChangelog', () => {
  it('trae las versiones nuevas, de la mas nueva a la mas vieja, sin la instalada ni lo sin publicar', () => {
    expect(extractChangelog(CHANGELOG, '1.8.0', '1.10.0')).toEqual([
      {
        changes: [
          { kind: 'agregado', nested: false, text: 'Nuevo comando arcli algo' },
          { kind: 'agregado', nested: false, text: 'Modo interactivo' },
          { kind: 'agregado', nested: true, text: 'Repetir una factura' },
          { kind: 'agregado', nested: false, text: 'guía nueva del modo interactivo.', topic: 'Docs' },
          { kind: 'agregado', nested: false, text: 'Un cambio sin negrita.' },
        ],
        date: '2026-10-20',
        summary: 'Suma arcli algo.',
        version: '1.10.0',
      },
      { changes: [{ kind: 'corregido', nested: false, text: 'Ver la guía' }], date: '2026-10-12', version: '1.9.0' },
    ]);
  });

  it('no pasa de la ultima version publicada', () => {
    expect(extractChangelog(CHANGELOG, '1.8.0', '1.9.0').map((entry) => entry.version)).toEqual(['1.9.0']);
  });

  it('sin versiones nuevas devuelve una lista vacia', () => {
    expect(extractChangelog(CHANGELOG, '1.10.0', '1.10.0')).toEqual([]);
  });

  it('sigue leyendo "Arreglado" y "Deprecado" del formato viejo', () => {
    const old = '## [1.1.0] - 2026-08-24\n\n### Arreglado\n\n- **A:** uno.\n\n### Deprecado\n\n- **B:** dos.\n';

    expect(extractChangelog(old, '1.0.0', '1.1.0')[0].changes.map((change) => change.kind)).toEqual([
      'corregido',
      'deprecado',
    ]);
  });
});

const NEW_FORMAT = `# Changelog

## [Sin publicar]

### ✨ Agregado

- **Facturas:** no tiene que aparecer.

## [2.6.0] - 2026-11-21 · Monotributo y recibos

El monotributo en la terminal, Recibo A y B y fechas relativas. Y algo más.

#### El monotributo en la terminal

Las 11 categorías con topes y cuotas, con la tuya marcada.

\`\`\`sh
arcli monotributo
- no es un cambio
\`\`\`

#### Recibo A y Recibo B

- Una viñeta de un destacado tampoco.

> [!WARNING]
> **Puede afectar scripts**
> - Una moneda que no existe sale con \`INPUT_VALIDATION_ERROR\`.
>
> No cambia ningún comando, flag ni clave de config o de \`--json\`.

---

### ✨ Agregado

- **Monotributo:** \`arcli monotributo\` con categorías, topes y cuotas (#210).
- **Recibos:** Recibo A y Recibo B, \`arcli ra\` y \`arcli rb\` (#202).

<details><summary>Detalle</summary>

**Monotributo.** Párrafo largo con el detalle.

- Una viñeta en el detalle no es un cambio.

\`\`\`sh
arcli monotributo --categoria E
\`\`\`

</details>

### 🔧 Cambiado

- **Errores:** una moneda inexistente es \`INPUT_VALIDATION_ERROR\`.

### ⏳ Deprecado

- **Config:** la clave \`cotizacion\`.

### 🔒 Seguridad

- **Certificados:** algo.

## [2.5.2] - 2026-11-18

Cotización y pesos en la E.

### 🐛 Corregido

- **Factura E:** la cotización.
`;

describe('extractChangelog con el formato de 2.6.0', () => {
  it('lee el nombre, el resumen y las secciones con icono, sin destacados, citas, codigo ni detalle', () => {
    expect(extractChangelog(NEW_FORMAT, '2.5.1', '2.6.0')).toEqual([
      {
        changes: [
          {
            kind: 'agregado',
            nested: false,
            text: 'arcli monotributo con categorías, topes y cuotas (#210).',
            topic: 'Monotributo',
          },
          {
            kind: 'agregado',
            nested: false,
            text: 'Recibo A y Recibo B, arcli ra y arcli rb (#202).',
            topic: 'Recibos',
          },
          {
            kind: 'cambiado',
            nested: false,
            text: 'una moneda inexistente es INPUT_VALIDATION_ERROR.',
            topic: 'Errores',
          },
          { kind: 'deprecado', nested: false, text: 'la clave cotizacion.', topic: 'Config' },
          { kind: 'seguridad', nested: false, text: 'algo.', topic: 'Certificados' },
        ],
        date: '2026-11-21',
        name: 'Monotributo y recibos',
        summary: 'El monotributo en la terminal, Recibo A y B y fechas relativas.',
        version: '2.6.0',
      },
      {
        changes: [{ kind: 'corregido', nested: false, text: 'la cotización.', topic: 'Factura E' }],
        date: '2026-11-18',
        summary: 'Cotización y pesos en la E.',
        version: '2.5.2',
      },
    ]);
  });

  it('tolera un bloque de codigo antes del resumen (fuera de formato, lo marca changelog-format.test.ts)', () => {
    const markdown =
      '## [2.5.2] - 2026-11-18\n\n```sh\narcli fe --ayuda\n```\n\nCotización.\n\n### 🐛 Corregido\n\n- **Factura E:** x.\n';

    expect(extractChangelog(markdown, '2.5.1', '2.5.2')[0].summary).toBe('Cotización.');
  });

  it.each([
    ['un <details>', '<details><summary>Detalle</summary>\n\nTexto.\n'],
    ['un bloque de codigo', '```sh\narcli fc\n'],
  ])('%s sin cerrar no se come la version siguiente', (_, unclosed) => {
    const markdown = [
      '## [2.6.0] - 2026-11-21 · Nombre',
      '',
      'Resumen.',
      '',
      '### ✨ Agregado',
      '',
      '- **Docs:** uno.',
      '',
      unclosed,
      '## [2.5.2] - 2026-11-18',
      '',
      'Otro resumen.',
      '',
      '### 🐛 Corregido',
      '',
      '- **Docs:** dos.',
      '',
    ].join('\n');

    expect(extractChangelog(markdown, '2.5.1', '2.6.0')[1]).toEqual({
      changes: [{ kind: 'corregido', nested: false, text: 'dos.', topic: 'Docs' }],
      date: '2026-11-18',
      summary: 'Otro resumen.',
      version: '2.5.2',
    });
  });

  it('sin resumen, el texto de un destacado no pasa a ser el resumen', () => {
    const markdown =
      '## [3.0.0] - 2026-12-01 · Algo\n\n#### Destacado\n\nTexto del destacado.\n\n### ✨ Agregado\n\n- **Docs:** x.\n';

    expect(extractChangelog(markdown, '2.6.0', '3.0.0')[0].summary).toBeUndefined();
  });
});
