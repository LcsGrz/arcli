import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../lib/errors/app-error';
import { errorPanel } from '../components/errorPanel';
import { noticePanel } from '../components/noticePanel';
import { sectionHeading } from '../components/sectionHeading';
import { formatAppError } from '../presenters/errors.presenter';
import { renderDivider } from '../primitives/renderDivider';
import { resolveKeyValueLabelWidth } from '../primitives/renderKeyValue';
import { renderLogo } from '../primitives/renderLogo';
import { panelContentWidth, renderPanel } from '../primitives/renderPanel';
import { stripAnsi, visibleWidth } from '../primitives/text';

/**
 * Lo que ve una persona en una terminal real que no es la del desarrollador: angosta, sin color, con bordes ASCII,
 * y con textos con acentos, emoji o muy largos.
 */

/** Sin secuencias de color: queda igual despues de sacarlas. */
const withoutColor = (text: string) => stripAnsi(text) === text;

let saved: { asciiEnv?: string; columns: number; isTTY: boolean; noColor?: string; stderrColumns: number };

beforeEach(() => {
  saved = {
    asciiEnv: process.env.ARCLI_ASCII,
    columns: process.stdout.columns,
    isTTY: process.stdout.isTTY,
    noColor: process.env.NO_COLOR,
    stderrColumns: process.stderr.columns,
  };
});

afterEach(() => {
  process.stdout.columns = saved.columns;
  process.stderr.columns = saved.stderrColumns;
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: saved.isTTY });

  for (const [key, value] of [
    ['ARCLI_ASCII', saved.asciiEnv],
    ['NO_COLOR', saved.noColor],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function narrowTerminal(columns: number): void {
  process.stdout.columns = columns;
  process.stderr.columns = columns;
}

const widest = (text: string) =>
  Math.max(
    ...stripAnsi(text)
      .split('\n')
      .map((line) => visibleWidth(line)),
  );

describe('terminal angosta', () => {
  it('el logo se reduce al nombre, con la version si la hay', () => {
    narrowTerminal(40);

    expect(stripAnsi(renderLogo('2.5.2'))).toBe('ARCLI v2.5.2');
    expect(stripAnsi(renderLogo())).toBe('ARCLI');
  });

  it('el logo entero, en una terminal ancha, termina con la version y la firma', () => {
    narrowTerminal(120);

    const logo = stripAnsi(renderLogo('2.5.2')).split('\n');

    expect(logo.length).toBeGreaterThan(3);
    expect(logo.at(-1)?.trim()).toBe('v2.5.2 | LcsGrz');
    expect(stripAnsi(renderLogo()).split('\n').at(-1)?.trim()).toBe('LcsGrz');
  });

  it.each([30, 40, 60])('un aviso largo con acentos y emoji no pasa de %i columnas', (columns) => {
    narrowTerminal(columns);

    const text = `La facturación de ${'Ñandú 🧾 '.repeat(12)}quedó lista: revisá el punto de venta y la cotización.`;
    const panel = noticePanel(text, 'warning');

    expect(widest(panel)).toBeLessThanOrEqual(columns);
    // No se pierde texto al partir las lineas.
    expect(stripAnsi(panel).replace(/[│┃╏|+\-─═┌┐└┘\s]+/g, '')).toContain(
      'quedólista:revisáelpuntodeventaylacotización.',
    );
  });

  it('un panel no baja de 24 columnas aunque la terminal sea mas angosta', () => {
    narrowTerminal(10);

    expect(widest(renderPanel({ content: 'Hola', title: 'Aviso' }))).toBeGreaterThanOrEqual(24);
    expect(panelContentWidth()).toBeGreaterThan(0);
  });

  it('el titulo de seccion se ajusta al ancho de la terminal', () => {
    narrowTerminal(30);

    const heading = stripAnsi(sectionHeading('Datos del receptor', 'info'));

    expect(visibleWidth(heading)).toBeLessThanOrEqual(30);
    expect(heading).toContain('DATOS DEL RECEPTOR');
  });

  it('un titulo de seccion mas largo que la terminal igual lleva su trazo', () => {
    narrowTerminal(24);

    expect(stripAnsi(sectionHeading('Un título de sección realmente muy largo'))).toMatch(/^── .+ ──+$/);
  });
});

describe('bordes ASCII (ARCLI_ASCII=1)', () => {
  it('paneles, titulos de seccion y bloques de comando no usan caracteres de caja', () => {
    process.env.ARCLI_ASCII = '1';

    const output = [
      renderPanel({ content: 'Contenido', title: 'Título' }),
      sectionHeading('Sección'),
      renderPanel({ borderType: 'command', content: 'arcli fc -m 100' }),
      noticePanel('Aviso', 'info'),
    ].join('\n');

    expect(stripAnsi(output)).not.toMatch(/[─━│┃┌┐└┘╒╕╘╛═╟╢┄]/);
    expect(stripAnsi(output)).toContain('-- SECCIÓN');
  });
});

describe('sin color', () => {
  it('con NO_COLOR los paneles y errores salen sin secuencias de color', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.env.NO_COLOR = '1';

    expect(withoutColor(noticePanel('Aviso', 'warning'))).toBe(true);
    expect(withoutColor(errorPanel('Error', 'Algo falló', ['detalle'], 'Probá de nuevo'))).toBe(true);
    expect(withoutColor(sectionHeading('Título', 'success'))).toBe(true);
  });
});

describe('bloque de comando', () => {
  it('lleva el titulo arriba y saca las lineas en blanco, salvo que se pidan', () => {
    const block = stripAnsi(
      renderPanel({ borderType: 'command', content: ['arcli fc -m 100', '', 'arcli fc -m 200'], title: 'Comando' }),
    ).split('\n');

    expect(block).toHaveLength(3);
    expect(block[0]).toContain('COMANDO');

    const kept = stripAnsi(
      renderPanel({ borderType: 'command', content: 'uno\n\ndos', preserveBlankLines: true }),
    ).split('\n');

    expect(kept).toHaveLength(3);
    // A la derecha no queda nada: se copia el comando sin bordes ni espacios de mas.
    expect(kept.every((line) => line === line.trimEnd())).toBe(true);
  });

  it('una linea muy larga no se parte: la terminal la ajusta y se copia entera', () => {
    narrowTerminal(30);

    const command = `arcli fe -m 1500 --cliente 'O'\\''Brien & Peña' ${'--item x|1|1 '.repeat(10)}`.trim();

    expect(stripAnsi(renderPanel({ borderType: 'command', content: command }))).toContain(command);
  });
});

describe('panel con ancho, padding y subtitulo propios', () => {
  it('respeta un ancho maximo numerico y un padding parcial', () => {
    narrowTerminal(200);

    const panel = renderPanel({
      content: 'x'.repeat(150),
      maxWidth: 60,
      padding: { left: 4 },
      subtitle: 'Subtítulo',
      title: 'Título',
      titleColor: 'info',
      width: 40,
    });

    expect(widest(panel)).toBeLessThanOrEqual(60);
    expect(stripAnsi(panel)).toContain('Subtítulo');
    expect(stripAnsi(panel)).toMatch(/│ {4}x/);
  });
});

describe('lo que queda chico', () => {
  it('el divisor por defecto es doble', () => {
    expect(renderDivider({ width: 5 })).toBe('═════');
    expect(renderDivider({ character: '-', width: 3 })).toBe('---');
  });

  it('la columna de etiquetas no baja de la etiqueta mas larga ni de la proporcion del tema', () => {
    const proportional = resolveKeyValueLabelWidth('standard', [['CAE']]);

    expect(resolveKeyValueLabelWidth('standard', [])).toBe(proportional);
    expect(resolveKeyValueLabelWidth('standard', [['Una etiqueta larguísima con acentos y más']])).toBe(
      visibleWidth('Una etiqueta larguísima con acentos y más'),
    );
  });

  it('un error sin detalles ni sugerencia es solo el mensaje', () => {
    const panel = stripAnsi(errorPanel('Error', 'Falló'));

    expect(panel).toContain('Falló');
    expect(panel).not.toContain('Detalles');
    expect(panel).not.toContain('Sugerencia');
  });

  it('un error de la app con un codigo sin titulo propio sale como "Error", sin sugerencia inventada', () => {
    const text = stripAnsi(formatAppError(new AppError('Algo raro.', { code: 'CODIGO_NUEVO' }), false));

    expect(text).toMatch(/ERROR/);
    expect(text).toContain('Algo raro.');
    expect(text).not.toContain('Sugerencia');
  });

  it('un error que no es Error dice que fue inesperado, en texto y en JSON', () => {
    expect(stripAnsi(formatAppError('cadena suelta', false))).toContain('Ocurrió un error inesperado.');
    expect(JSON.parse(formatAppError(42, true))).toMatchObject({ codigo: 'UNEXPECTED_ERROR' });
  });
});
