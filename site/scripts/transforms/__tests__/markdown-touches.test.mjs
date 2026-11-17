import { describe, expect, it } from 'vitest';

import { markdownTouches } from '../markdown-touches.mjs';

describe('markdownTouches', () => {
  it('pone ARCLI en negrita en el texto corrido', () => {
    expect(markdownTouches('Con ARCLI emitís.')).toBe('Con **ARCLI** emitís.');
  });

  it('no toca titulos, HTML, codigo en linea, links ni lo que ya esta en negrita', () => {
    const input = ['## ARCLI', '<p>ARCLI</p>', 'Usá `ARCLI` o [ARCLI](x.md), **ARCLI** y ARCLIs.'].join('\n');

    expect(markdownTouches(input)).toBe(input);
  });

  it('titula los bloques de comandos y no toca su contenido', () => {
    const input = '```bash\narcli ARCLI\n```\n\n  ```powershell\nnpm i\n  ```\n\n```json\n{}\n```';

    expect(markdownTouches(input)).toBe(
      '```bash title="Terminal"\narcli ARCLI\n```\n\n  ```powershell title="PowerShell"\nnpm i\n  ```\n\n```json\n{}\n```',
    );
  });
});
