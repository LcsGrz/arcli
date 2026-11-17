import { describe, expect, it } from 'vitest';

import { problems } from '../problems.mjs';

const SEARCH =
  '<div class="arcli-faq-search"><input type="search" placeholder="Buscá lo que ves: EACCES, punto de venta, 10005…" aria-label="Buscar un problema"></div>\n<p class="arcli-faq-empty" hidden>No encontramos ese problema. Probá con otra palabra o mirá los errores de ARCA más abajo.</p>\n';

describe('problems (Problemas frecuentes)', () => {
  it('cada ### pasa a un desplegable con severidad, filas y "Más en", agrupados por ##', () => {
    const input = [
      'Intro.',
      '',
      '## Instalación',
      '',
      '### No encuentra `arcli`',
      '',
      '- **Severidad:** frecuente, en Windows',
      '- **Síntoma:** la terminal dice que no conoce el comando.',
      '- **Solución:** reinstalá.',
      '  ```bash',
      '  npm i -g arcli',
      '  ```',
      '- **Documentación relacionada:** [Instalar](/empezar/instalar/)',
      '',
    ].join('\n');

    expect(problems(input)).toBe(
      `Intro.\n\n${SEARCH}\n` +
        '<section class="arcli-faq-section">\n\n## Instalación\n\n' +
        '<details class="arcli-faq" id="no-encuentra-arcli">\n<summary><span class="t">No encuentra <code>arcli</code><span class="sub">En Windows.</span></span><span class="sev sev-frecuente">frecuente</span></summary>\n\n' +
        '<div class="arcli-faq-row"><b>Síntoma</b><div>\n\nLa terminal dice que no conoce el comando.\n\n\n\n</div></div>\n' +
        '<div class="arcli-faq-row"><b>Solución</b><div>\n\nReinstalá.\n  ```bash\n  npm i -g arcli\n  ```\n\n\n\n</div></div>\n' +
        '\n<div class="arcli-faq-more">\n\nMás en [Instalar](/empezar/instalar/)\n\n</div>\n' +
        '\n\n</details>\n\n</section>\n',
    );
  });

  it('el mensaje de ARCLI citado en el sintoma va como salida y el texto lo nombra', () => {
    const input =
      'Intro.\n\n## Emitir\n\n### Rechazo\n\n- **Severidad:** a veces\n- **Síntoma:** al emitir aparece `El punto de venta no existe`.\n';
    const output = problems(input);

    expect(output).toContain('<pre class="arcli-salida">El punto de venta no existe</pre>');
    expect(output).toContain('Al emitir aparece el mensaje de abajo.');
    expect(output).toContain('<span class="sev sev-media">a veces</span>');
  });

  it('si el sintoma es solo el mensaje, no lo repite', () => {
    const output = problems('Intro.\n\n## X\n\n### Y\n\n- **Síntoma:** `No hay certificado configurado`\n');

    expect(output).toContain(
      '<b>Síntoma</b><div>\n\n\n\n<pre class="arcli-salida">No hay certificado configurado</pre>',
    );
  });

  it('los mensajes de otros programas quedan en el texto', () => {
    const output = problems('Intro.\n\n## X\n\n### Y\n\n- **Síntoma:** npm dice `npm ERR! code EACCES`.\n');

    expect(output).not.toContain('arcli-salida');
    expect(output).toContain('Npm dice `npm ERR! code EACCES`.');
  });

  it('sin el formato de filas deja el cuerpo como esta', () => {
    expect(problems('Intro.\n\n## X\n\n### Y\n\nTexto libre.\n')).toContain('</summary>\n\nTexto libre.\n\n</details>');
  });

  it('falla con una severidad desconocida', () => {
    expect(() => problems('Intro.\n\n## X\n\n### Y\n\n- **Severidad:** grave\n')).toThrow('la severidad "grave"');
  });
});
