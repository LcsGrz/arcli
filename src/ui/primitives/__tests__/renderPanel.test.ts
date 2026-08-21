import { describe, expect, it } from 'vitest';

import { renderPanel } from '../renderPanel';
import { stripAnsi } from '../text';

describe('renderPanel', () => {
  it('does not add an extra blank body line when only subtitle is present', () => {
    const output = renderPanel({
      content: [],
      subtitle: 'Galeria visual del CLI',
      title: 'Terminal Storybook',
      width: 48,
    });

    expect(output).toContain('Galeria visual del CLI');
    expect(output).not.toContain(
      '│                                              │\n│                                              │\n│                                              │',
    );
  });

  it('renders footer divider and footer when provided', () => {
    const output = renderPanel({
      content: ['Linea 1', 'Linea 2'],
      footer: 'APROBADO',
      footerDivider: true,
      title: 'Demo',
      width: 40,
    });

    expect(output).toContain('APROBADO');
    expect(output).toContain('═');
  });

  it('preserves indentation when wrapping multiline pretty content', () => {
    const output = stripAnsi(
      renderPanel({
        content: ['{', '  "Msg": "uno dos tres cuatro cinco seis siete ocho nueve diez once doce"', '}'],
        maxWidth: 24,
        title: 'Demo',
        width: 24,
      }),
    );

    expect(output).toContain('│    "Msg": "uno dos');
    expect(output).toContain('│    tres cuatro');
    expect(output).toContain('│    cinco seis siete');
  });
});
