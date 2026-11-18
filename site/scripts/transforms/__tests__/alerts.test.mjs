import { describe, expect, it } from 'vitest';

import { githubAlertsToAsides } from '../alerts.mjs';

describe('githubAlertsToAsides (> [!TIPO])', () => {
  it('pasa cada tipo al aviso de Starlight', () => {
    const input = '> [!WARNING]\n> Cuidado.\n> Mucho.\n\nSigue.';

    expect(githubAlertsToAsides(input)).toBe(':::caution\nCuidado.\nMucho.\n:::\n\nSigue.');
  });

  it.each([
    ['NOTE', 'note'],
    ['TIP', 'tip'],
    ['IMPORTANT', 'note'],
    ['CAUTION', 'danger'],
  ])('%s → %s', (kind, aside) => {
    expect(githubAlertsToAsides(`> [!${kind}]\n> Texto.`)).toBe(`:::${aside}\nTexto.\n:::`);
  });

  it('la negrita del principio pasa a ser el titulo', () => {
    expect(githubAlertsToAsides('> [!TIP]\n> **La forma más fácil:** usá el asistente.')).toBe(
      ':::tip[La forma más fácil]\nUsá el asistente.\n:::',
    );
  });

  it('no toca los avisos dentro de un bloque de codigo', () => {
    const input = '```md\n> [!TIP]\n> Texto.\n```';

    expect(githubAlertsToAsides(input)).toBe(input);
  });
});
