import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui';
import { filterList, type FilterListRow, filterRows } from '../filter-list';

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ENTER = '\r';
const BACKSPACE = '\u007F';

const THEME = {
  style: {
    description: (text: string) => text,
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key]) => key).join(' '),
  },
};

const CURRENCIES: ReadonlyArray<FilterListRow<string>> = [
  { keywords: 'USD', label: 'DOL  Dólar Estadounidense', value: 'DOL' },
  { keywords: 'EUR', label: '060  Euro', value: '060' },
  { keywords: 'BRL', label: '012  Real', value: '012' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Corre el prompt de verdad: las teclas entran por `input` y lo dibujado sale por `output`. */
async function run(
  keys: readonly string[],
  options: {
    readonly back?: string;
    readonly mode?: 'elegir' | 'ver';
    readonly pageSize?: number;
    readonly rows?: ReadonlyArray<FilterListRow<string>>;
  } = {},
) {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';

  output.on('data', (chunk: Buffer) => {
    screen += chunk.toString();
  });

  const answer = filterList(
    {
      back: options.back,
      header: 'CÓDIGO  MONEDA',
      help: 'Escribí el nombre o el código.',
      message: '¿De qué moneda?',
      mode: options.mode ?? 'elegir',
      pageSize: options.pageSize ?? 10,
      rows: options.rows ?? CURRENCIES,
      theme: THEME,
    },
    { input, output },
  );

  for (const key of keys) {
    await tick();
    input.write(key);
  }

  return { answer: await answer, screen: stripAnsi(screen) };
}

describe('filterRows', () => {
  it('sin tildes ni mayúsculas, y también por las palabras clave', () => {
    expect(filterRows(CURRENCIES, 'dolar').map((row) => row.value)).toEqual(['DOL']);
    expect(filterRows(CURRENCIES, 'usd').map((row) => row.value)).toEqual(['DOL']);
    expect(filterRows(CURRENCIES, '060').map((row) => row.value)).toEqual(['060']);
    expect(filterRows(CURRENCIES, '  ')).toHaveLength(3);
  });

  it('por palabras, en cualquier orden y aunque la fila las separe con varios espacios', () => {
    expect(filterRows(CURRENCIES, 'estadounidense dol').map((row) => row.value)).toEqual(['DOL']);
    expect(filterRows(CURRENCIES, 'dol euro')).toEqual([]);
  });
});

describe('filterList', () => {
  it('muestra el encabezado, la ayuda y las filas', async () => {
    const { screen } = await run([ENTER]);

    expect(screen).toContain('Filtrar:');
    expect(screen).toContain('CÓDIGO  MONEDA');
    expect(screen).toContain('❯ DOL  Dólar Estadounidense');
    expect(screen).toContain('Escribí el nombre o el código.');
  });

  it('se filtra escribiendo y Enter elige la primera que coincide', async () => {
    const { answer, screen } = await run(['e', 'u', 'r', ENTER]);

    expect(answer).toBe('060');
    expect(screen).toContain('1 de 3');
  });

  it('las flechas se mueven sin borrar el filtro', async () => {
    // "o" deja el dólar y el euro: la flecha baja al euro. Si las flechas borraran el filtro, "u" solo dejaría primero
    // al dólar.
    const { answer: moved } = await run(['o', DOWN, UP, DOWN, ENTER]);
    const { answer: kept } = await run(['e', DOWN, 'u', ENTER]);

    expect(moved).toBe('060');
    expect(kept).toBe('060');
  });

  it('sin coincidencias lo dice, y Enter no elige nada hasta borrar', async () => {
    const { answer, screen } = await run(['x', 'y', ENTER, BACKSPACE, BACKSPACE, ENTER]);

    expect(screen).toContain('Nada coincide con "xy".');
    expect(answer).toBe('DOL');
  });

  it('si no entran todas, avisa cuantas quedan arriba y abajo; si entran, nada', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ label: `Fila ${index + 1}`, value: String(index) }));
    const { screen } = await run([DOWN, DOWN, DOWN, DOWN, ENTER], { pageSize: 3, rows });
    const { screen: fits } = await run([ENTER]);

    expect(screen).toContain('↓ 7 más');
    expect(screen).toMatch(/↑ 3 más\n {2}Fila 4\n❯ Fila 5\n {2}Fila 6\n {2}↓ 4 más/);
    expect(fits).not.toContain('más');
  });

  it('"Volver" queda fijo debajo de una lista que se desplaza; se llega con la flecha y Enter cierra sin elegir', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ label: `Fila ${index + 1}`, value: String(index) }));
    const { answer, screen } = await run([DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, ENTER], {
      back: '← Volver',
      pageSize: 3,
      rows,
    });

    // En la primera pantalla, con la lista arriba de todo, "Volver" ya se ve abajo.
    expect(screen).toMatch(/❯ Fila 1\n {2}Fila 2\n {2}Fila 3\n {2}↓ 7 más\n\s*\n {2}← Volver/);
    expect(screen).toMatch(/↑ 7 más\n {2}Fila 8\n {2}Fila 9\n {2}Fila 10\n\s*\n\s*\n❯ ← Volver/);
    expect(answer).toBeUndefined();
  });

  it('desde "Volver", la flecha arriba vuelve a la última fila', async () => {
    const { answer } = await run([DOWN, DOWN, DOWN, UP, ENTER], { back: '← Volver' });

    expect(answer).toBe(CURRENCIES.at(-1)?.value);
  });

  it('para mirar, Enter la cierra sin elegir', async () => {
    const { answer } = await run([DOWN, ENTER], { mode: 'ver' });

    expect(answer).toBeUndefined();
  });
});
