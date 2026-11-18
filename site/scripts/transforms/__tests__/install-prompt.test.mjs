import { describe, expect, it, vi } from 'vitest';

import { installPromptFrom } from '../../lib/readme.mjs';
import { installPrompt } from '../install-prompt.mjs';

describe('installPrompt (<!-- arcli: prompt-instalacion -->)', () => {
  it('cambia la marca y el link de la linea siguiente por el prompt del README', () => {
    const input = 'Antes.\n\n<!-- arcli: prompt-instalacion -->\n[Ver el prompt](../README.md#x)\n\nDespues.';

    expect(installPrompt(input, { readmePrompt: () => 'Instalá arcli.' })).toBe(
      'Antes.\n\n```text title="Prompt" frame="terminal" wrap\nInstalá arcli.\n```\n\nDespues.',
    );
  });

  it('sin la marca no lee el README', () => {
    const readmePrompt = vi.fn();

    expect(installPrompt('Nada.', { readmePrompt })).toBe('Nada.');
    expect(readmePrompt).not.toHaveBeenCalled();
  });
});

describe('installPromptFrom', () => {
  it('toma el bloque text del plegable "Que lo instale tu IA"', () => {
    const readme = '```text\notro\n```\n<details><summary>Que lo instale tu IA</summary>\n\n```text\nEl prompt\n```\n';

    expect(installPromptFrom(readme)).toBe('El prompt');
  });

  it('falla si el README no tiene el plegable', () => {
    expect(() => installPromptFrom('# arcli')).toThrow('no encontré el prompt');
  });
});
