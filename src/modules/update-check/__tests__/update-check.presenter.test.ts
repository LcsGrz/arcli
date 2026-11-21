import { describe, expect, it } from 'vitest';

import { renderUpdateDetails } from '../update-check.presenter';
import type { UpdateCheckResult } from '../update-check.service';

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m|\u001b\]8;;[^\u0007]*\u0007/g, '');
}

const RESULT: UpdateCheckResult = { currentVersion: '2.5.2', latestVersion: '2.6.0' };

describe('renderUpdateDetails', () => {
  it('muestra el nombre de la version entre la version y la fecha, y lo deprecado con su etiqueta', () => {
    const text = stripAnsi(
      renderUpdateDetails(RESULT, [
        {
          changes: [
            { kind: 'agregado', nested: false, text: 'arcli monotributo.', topic: 'Monotributo' },
            { kind: 'deprecado', nested: false, text: 'la clave cotizacion.', topic: 'Config' },
          ],
          date: '2026-11-21',
          name: 'Monotributo y recibos',
          summary: 'El monotributo en la terminal.',
          version: '2.6.0',
        },
        { changes: [{ kind: 'corregido', nested: false, text: 'algo.' }], date: '2026-11-18', version: '2.5.2' },
      ]),
    );

    expect(text).toContain('2.6.0 · Monotributo y recibos · 21/11/2026');
    expect(text).toMatch(/deprecado {2}Config: la clave cotizacion\./);
    expect(text).toMatch(/nuevo {6}Monotributo: arcli monotributo\./);
    // Sin nombre, como antes.
    expect(text).toContain('2.5.2 · 18/11/2026');
  });
});
