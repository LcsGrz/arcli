import { describe, expect, it } from 'vitest';

import { optionCards } from '../option-cards.mjs';

const table = (rows) => ['| Largo | Corto | Qué es |', '| --- | --- | --- |', ...rows].join('\n');

describe('optionCards (<!-- arcli: opciones=req|opt|run -->)', () => {
  it('cada ### pasa a una tarjeta con texto, filas y ejemplo, hasta el proximo ##', () => {
    const input = [
      '<!-- arcli: opciones=req -->',
      '### Monto',
      'Lo que cobrás.',
      table(['| `--monto` | `-m` | El total con **IVA** |', '| `--neto` | | Sin IVA \\| neto |']),
      'Ej.: `-m 1000`',
      '',
      '## Despues',
    ].join('\n');

    expect(optionCards(input)).toBe(
      '<div class="arcli-opts"><div class="arcli-opt arcli-opt-req"><div class="arcli-opt-top"><b>Monto</b><span class="arcli-ej">Ej.: <code>-m 1000</code></span></div><p>Lo que cobrás.</p><div class="arcli-opt-rows">' +
        '<div class="arcli-opt-row"><span class="l"><code>--monto</code></span><span class="s"><code>-m</code></span><span class="w">El total con <strong>IVA</strong></span></div>' +
        '<div class="arcli-opt-row"><span class="l"><code>--neto</code></span><span class="s"></span><span class="w">Sin IVA | neto</span></div>' +
        '</div></div></div>\n\n## Despues',
    );
  });

  it('con mas de 5 filas muestra 4 y pliega el resto en "Ver las N"', () => {
    const rows = Array.from({ length: 6 }, (_, i) => `| \`--f${i}\` | | Fila ${i} |`);
    const output = optionCards(`<!-- arcli: opciones=opt -->\n### Varias\n${table(rows)}\n`);

    expect(output).toContain('arcli-opt-opt');
    expect(output).not.toContain('<p>');
    expect(output).not.toContain('arcli-ej');
    expect(output).toContain('<details class="arcli-more"><summary>Ver las 6</summary>');
    expect(output.split('<details')[0].match(/class="arcli-opt-row"/g)).toHaveLength(4);
    expect(output.split('<details')[1].match(/class="arcli-opt-row"/g)).toHaveLength(2);
  });

  it('con 5 filas no pliega', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| \`--f${i}\` | | Fila ${i} |`);

    expect(optionCards(`<!-- arcli: opciones=run -->\n### Cinco\n${table(rows)}\n`)).not.toContain('<details');
  });
});
