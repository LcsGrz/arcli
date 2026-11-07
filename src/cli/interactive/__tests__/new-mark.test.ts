import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui';
import { markIfNew } from '../new-mark';

describe('markIfNew', () => {
  const choice = { description: 'Recibo C por un cobro', name: 'Emitir recibo', value: 'recibo' };

  it('suma "(nuevo)" al final y deja la respuesta sin la marca', () => {
    const marked = markIfNew(choice, 'recibo', '2.3.0');

    expect(stripAnsi(marked.name)).toBe('Emitir recibo (nuevo)');
    expect(marked.short).toBe('Emitir recibo');
    expect(marked.value).toBe('recibo');
  });

  it('deja la opcion igual cuando ya no es nueva', () => {
    expect(markIfNew(choice, 'recibo', '2.5.0')).toBe(choice);
  });

  it('un submenu lleva la marca si alguna opcion de adentro es nueva', () => {
    const config = { name: 'Configuración', value: 'config' };

    expect(stripAnsi(markIfNew(config, ['autocompletado', 'acceso-directo'], '2.5.0').name)).toBe(
      'Configuración (nuevo)',
    );
  });
});
