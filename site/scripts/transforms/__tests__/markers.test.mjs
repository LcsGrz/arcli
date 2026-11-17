/** Las marcas `<!-- arcli: … -->` que cambian cómo se dibuja un bloque en el sitio (ver docs/development.md). */
import { describe, expect, it } from 'vitest';

import { chats } from '../chats.mjs';
import { samples } from '../samples.mjs';
import { shortcutGrids } from '../shortcut-grids.mjs';
import { steps } from '../steps.mjs';
import { tabs } from '../tabs.mjs';
import { ways } from '../ways.mjs';

describe('shortcutGrids (<!-- arcli: atajos -->)', () => {
  it('envuelve la tabla siguiente', () => {
    expect(shortcutGrids('<!-- arcli: atajos -->\n\n| A | B |\n| - | - |\n| fa | fb |\n\nDespues.')).toBe(
      '<div class="arcli-atajos">\n\n| A | B |\n| - | - |\n| fa | fb |\n\n</div>\n\nDespues.',
    );
  });
});

describe('chats (<!-- arcli: chat -->)', () => {
  it('la cita pasa a una conversacion e ignora lo que no es de Vos ni del asistente', () => {
    const input =
      '<!-- arcli: chat -->\n> **Vos:** Haceme una `factura`.\n>\n> **Tu asistente:** Listo.\n> Otra cosa.\n';

    expect(chats(input)).toBe(
      '<div class="arcli-chat"><div class="arcli-msg user"><span class="who">Vos</span>Haceme una <code>factura</code>.</div><div class="arcli-msg bot"><span class="who">Tu asistente</span>Listo.</div></div>\n',
    );
  });
});

describe('samples (<!-- arcli: muestra=error|vista -->)', () => {
  it('el bloque de texto pasa a un cartel: titulo y filas etiqueta / valor', () => {
    const input =
      '<!-- arcli: muestra=vista -->\n\n```text\nVista previa\nTotal    $ 1.000\nSin <valor>\n```\nDespues.';

    expect(samples(input)).toBe(
      '<div class="arcli-block"><div class="arcli-sample arcli-sample-vista"><b>Vista previa</b><span class="row"><span>Total</span><i>$ 1.000</i></span><span>Sin &lt;valor&gt;</span></div></div>\nDespues.',
    );
  });

  it('el tipo va en la clase', () => {
    expect(samples('<!-- arcli: muestra=error -->\n```text\nError\n```')).toContain('arcli-sample-error');
  });
});

describe('ways (<!-- arcli: formas -->)', () => {
  it('cada fila lleva a su forma de uso; con comillas es un pedido', () => {
    const input = [
      '<!-- arcli: formas -->',
      '| Si querés | Escribís | Forma |',
      '| --- | --- | --- |',
      '| Facturar | `arcli` | [Asistente](/uso/asistente/) |',
      '| Delegar | "Haceme una factura" | Con IA |',
    ].join('\n');

    expect(ways(input)).toBe(
      '<div class="arcli-ways">' +
        '<a class="arcli-way" href="/uso/asistente/"><span class="q">Facturar</span><span class="do"><small>Escribís</small><code>arcli</code></span><span class="go">Asistente →</span></a>' +
        '<a class="arcli-way" href="#"><span class="q">Delegar</span><span class="do"><small>Le pedís</small><q>Haceme una factura</q></span><span class="go">Con IA →</span></a>' +
        '</div>\n',
    );
  });
});

describe('steps (<!-- arcli: pasos -->)', () => {
  it('numera los pasos hasta el proximo ## y envuelve desplegables y avisos', () => {
    const input = [
      'Intro.',
      '<!-- arcli: pasos -->',
      '### 1. Entrá',
      '<details>',
      'Capturas',
      '</details>',
      '### 2. Pedí',
      ':::tip',
      'Ojo.',
      ':::',
      '',
      '## Despues',
    ].join('\n');

    expect(steps(input)).toBe(
      [
        'Intro.',
        '<div class="arcli-steps">',
        '',
        '### Entrá',
        '<div class="arcli-block">',
        '',
        '<details>',
        'Capturas',
        '</details>',
        '',
        '</div>',
        '### Pedí',
        '<div class="arcli-block">',
        '',
        ':::tip',
        'Ojo.',
        ':::',
        '',
        '</div>',
        '',
        '</div>',
        '',
        '## Despues',
      ].join('\n'),
    );
  });

  it('dos bloques del mismo grupo no repiten ids', () => {
    const block = '<!-- arcli: pestañas=so -->\n### Windows\nUno.\n';
    const output = tabs(`${block}\n## Otra\n\n${block}`);

    expect(output).toContain('id="tab-so-1-windows"');
    expect(output).toContain('id="tab-so-2-windows"');
  });
});

describe('tabs (<!-- arcli: pestañas=grupo -->)', () => {
  it('cada ### es una pestaña; la primera abierta y la unica que entra con Tab', () => {
    const input = '<!-- arcli: pestañas=so -->\n### Windows\nUno.\n### macOS\nDos.\n\n## Despues';

    expect(tabs(input)).toBe(
      [
        '<div class="arcli-tabs" data-sync="so"><div role="tablist"><button type="button" role="tab" id="tab-so-1-windows" aria-selected="true" aria-controls="panel-so-1-windows" data-tab="windows">Windows</button><button type="button" role="tab" id="tab-so-1-macos" aria-selected="false" aria-controls="panel-so-1-macos" tabindex="-1" data-tab="macos">macOS</button></div>',
        '<div role="tabpanel" id="panel-so-1-windows" aria-labelledby="tab-so-1-windows" data-panel="windows">',
        '',
        'Uno.',
        '',
        '</div>',
        '<div role="tabpanel" id="panel-so-1-macos" aria-labelledby="tab-so-1-macos" data-panel="macos" hidden>',
        '',
        'Dos.',
        '',
        '</div>',
        '</div>',
        '',
        '## Despues',
      ].join('\n'),
    );
  });
});
