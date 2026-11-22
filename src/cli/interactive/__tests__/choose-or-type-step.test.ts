import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { chooseOrTypeStep, type ChooseOrTypeStepOptions, type FilterListRow } from '../prompts';

/**
 * `chooseOrTypeStep` (TUI-35) de verdad: una lista que se filtra escribiendo, donde tambien se puede usar lo escrito.
 * Las teclas entran por un stdin propio y lo dibujado sale por `process.stdout.write`. Lo que se mira es lo que ve y
 * recibe quien responde: la fila "Usar lo escrito: …", el error y el valor que devuelve.
 */

const ENTER = '\r';
const DOWN = '\u001B[B';

const ROWS: ReadonlyArray<FilterListRow<string>> = [
  { label: 'Alfa', value: 'a' },
  { label: 'Beta', value: 'b' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let input: PassThrough;
let write: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  input = new PassThrough();
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
  write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function screen(): string {
  return stripAnsi(write.mock.calls.map(([chunk]) => String(chunk)).join(''));
}

function pressEscape(): void {
  input.emit('keypress', '', { name: 'escape' });
}

/** Corre el paso, manda cada tecla (o Esc) y devuelve la respuesta y lo que se dibujo hasta ahi. */
async function run<T>(
  options: ChooseOrTypeStepOptions<T>,
  keys: ReadonlyArray<string | typeof BACK>,
  rows: ReadonlyArray<FilterListRow<T>> = ROWS as unknown as ReadonlyArray<FilterListRow<T>>,
) {
  const answer = chooseOrTypeStep('¿Cuál?', rows, options);
  const frames: string[] = [];

  for (const key of keys) {
    await tick();
    frames.push(screen());

    if (key === BACK) {
      pressEscape();
    } else {
      input.write(key);
    }
  }

  return { answer: await answer, frames, screen: screen() };
}

const parse = (text: string) => `escrito:${text.trim()}`;

describe('chooseOrTypeStep (TUI-35)', () => {
  // Criterio 3.
  it('con lo escrito que no es una fila muestra "Usar lo escrito"; si no valida, muestra el error y no cierra', async () => {
    const {
      answer,
      frames,
      screen: drawn,
    } = await run({ parse, validate: (text) => (text.trim() === 'zz' ? 'No vale "zz".' : true) }, [
      'z',
      'z',
      ENTER,
      BACK,
    ]);

    expect(frames.at(-2)).toContain('Usar lo escrito: zz');
    expect(drawn).toContain('No vale "zz".');
    // Enter no cerro con un valor: lo que cerro fue Esc.
    expect(answer).toBe(BACK);
  });

  // Criterio 3.
  it('con lo escrito valido, Enter devuelve lo que da `parse`', async () => {
    const { answer, screen: drawn } = await run({ parse, validate: () => true }, ['z', 'z', ENTER]);

    expect(answer).toBe('escrito:zz');
    expect(drawn).toContain('Usar lo escrito: zz');
  });

  // Criterio 3: lo escrito que coincide con una fila la deja primera, y Enter elige la fila, no lo escrito.
  it('escribir parte de una fila la encuentra y Enter la elige', async () => {
    const { answer } = await run({ parse }, ['b', 'e', 't', ENTER]);

    expect(answer).toBe('b');
  });

  // Lo escrito que coincide con filas: "Usar lo escrito" queda debajo de ellas y se llega con las flechas.
  it('con lo escrito que coincide con filas, "Usar lo escrito" queda debajo; ↓ lo marca y Enter lo usa', async () => {
    const { answer, frames } = await run({ parse, validate: () => true }, ['a', DOWN, DOWN, ENTER]);

    expect(frames[1]).toMatch(/❯ Alfa\n\s+Beta\n\s+Usar lo escrito: a/);
    expect(answer).toBe('escrito:a');
  });

  // Criterio 4.
  it('opcional: Enter con el filtro vacío devuelve "sin valor"', async () => {
    const { answer } = await run({ optional: true, parse }, [ENTER]);

    expect(answer).toBeUndefined();
  });

  // Criterio 4, con la decision del 22/11: obligatoria, arranca con la primera fila marcada y Enter la elige, como
  // cualquier lista del asistente.
  it('obligatorio: Enter con el filtro vacío elige la primera fila', async () => {
    const { answer, frames } = await run({ parse }, [ENTER]);

    expect(frames[0]).toMatch(/❯ Alfa/);
    expect(frames[0]).not.toContain('Omitir');
    expect(answer).toBe('a');
  });

  // Criterio 4, con la decision del 22/11: opcional, la primera fila dice que pasa si se deja vacia y arranca marcada.
  it('opcional: la primera fila es la de `emptyLabel`, marcada, y elegirla devuelve "sin valor"', async () => {
    const { answer, frames } = await run({ emptyLabel: 'Sin CUIT del país', optional: true, parse }, [ENTER]);

    expect(frames[0]).toMatch(/❯ Sin CUIT del país\n\s+Alfa/);
    expect(answer).toBeUndefined();
  });

  it('opcional con `previous` de la lista: arranca marcada esa fila, no la de "sin valor"', async () => {
    const { answer } = await run({ optional: true, parse, previous: 'b' }, [ENTER]);

    expect(answer).toBe('b');
  });

  // Criterio 5.
  it('con la lista vacía es un texto validado: vacío muestra el error y lo escrito se convierte', async () => {
    const { answer, screen: drawn } = await run(
      {
        parse: (text: string) => text.trim().toUpperCase(),
        validate: (text) => (text.trim() ? true : 'El incoterm es obligatorio.'),
      },
      [ENTER, 'f', 'o', 'b', ENTER],
      [],
    );

    expect(drawn).toContain('El incoterm es obligatorio.');
    expect(answer).toBe('FOB');
  });

  // Criterio 6.
  it('con `previous` igual a una fila arranca con esa fila marcada: Enter la elige', async () => {
    const { answer } = await run({ parse, previous: 'b' }, [ENTER]);

    expect(answer).toBe('b');
  });

  // Criterio 6.
  it('con `previous` que no es una fila arranca escrito, con "Usar lo escrito"; Enter lo usa', async () => {
    const { answer, frames } = await run({ parse, previous: 'zz' }, [ENTER]);

    expect(frames[0]).toContain('Usar lo escrito: zz');
    expect(answer).toBe('escrito:zz');
  });

  // Criterio 6.
  it('Esc vuelve al paso anterior', async () => {
    const { answer } = await run({ optional: true, parse }, ['b', BACK]);

    expect(answer).toBe(BACK);
  });
});

/** El ultimo dibujo de la pregunta en una pantalla acumulada. */
function lastDraw(frame: string | undefined): string {
  return (frame ?? '').split('? ¿Cuál?').at(-1) ?? '';
}

const UP = '\u001B[A';

describe('chooseOrTypeStep: lo escrito y las filas', () => {
  it('lo escrito igual a una fila no muestra "Usar lo escrito"', async () => {
    const { answer, frames } = await run({ parse }, ['b', 'e', 't', 'a', ENTER]);

    expect(lastDraw(frames.at(-1))).toMatch(/❯ Beta/);
    expect(lastDraw(frames.at(-1))).not.toContain('Usar lo escrito');
    expect(answer).toBe('b');
  });

  // Como `--pais-destino niger`: la fila exacta gana a la primera que coincide.
  it('con "niger", Enter elige NIGER aunque NIGERIA vaya antes', async () => {
    const countries = [
      { label: 'NIGERIA', value: 'NIGERIA' },
      { label: 'NIGER', value: 'NIGER' },
    ];
    const { answer, frames } = await run({ parse }, ['n', 'i', 'g', 'e', 'r', ENTER], countries);

    expect(lastDraw(frames.at(-1))).toMatch(/ {2}NIGERIA\n❯ NIGER/);
    expect(answer).toBe('NIGER');
  });

  it('sin coincidencias muestra "Usar lo escrito" en lugar de "Nada coincide"', async () => {
    const { frames } = await run({ parse }, ['z', 'z', BACK]);

    expect(lastDraw(frames.at(-1))).toContain('❯ Usar lo escrito: zz');
    expect(lastDraw(frames.at(-1))).not.toContain('Nada coincide');
  });

  it('con las flechas se llega a "Volver" pasando por la fila de lo escrito, y se vuelve', async () => {
    const { answer, frames } = await run({ parse }, ['a', DOWN, DOWN, DOWN, UP, DOWN, ENTER]);

    expect(lastDraw(frames[3])).toContain('❯ Usar lo escrito: a');
    expect(lastDraw(frames[4])).toContain('❯ ← Volver');
    expect(lastDraw(frames[5])).toContain('❯ Usar lo escrito: a');
    expect(answer).toBe(BACK);
  });
});
