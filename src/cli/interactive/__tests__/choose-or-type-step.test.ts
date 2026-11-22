import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import type { FilterListRow } from '../prompts';

import type { ChooseOrTypeStep, ChooseOrTypeStepOptions } from './script';

/**
 * `chooseOrTypeStep` (TUI-35) de verdad: una lista que se filtra escribiendo, donde tambien se puede usar lo escrito.
 * Las teclas entran por un stdin propio y lo dibujado sale por `process.stdout.write`. Lo que se mira es lo que ve y
 * recibe quien responde: la fila "Usar lo escrito: …", el error y el valor que devuelve.
 */

const ENTER = '\r';

const ROWS: ReadonlyArray<FilterListRow<string>> = [
  { label: 'Alfa', value: 'a' },
  { label: 'Beta', value: 'b' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** El componente, si ya existe en `prompts.ts`: hoy no, y el test falla aca por eso. */
async function loadChooseOrTypeStep(): Promise<ChooseOrTypeStep> {
  const prompts = (await import('../prompts')) as unknown as Record<string, unknown>;

  expect(prompts.chooseOrTypeStep, 'chooseOrTypeStep no está en prompts.ts').toBeTypeOf('function');

  return prompts.chooseOrTypeStep as ChooseOrTypeStep;
}

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
  const chooseOrTypeStep = await loadChooseOrTypeStep();
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
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails(
    'con lo escrito que no es una fila muestra "Usar lo escrito"; si no valida, muestra el error y no cierra',
    async () => {
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
    },
  );

  // Criterio 3.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('con lo escrito valido, Enter devuelve lo que da `parse`', async () => {
    const { answer, screen: drawn } = await run({ parse, validate: () => true }, ['z', 'z', ENTER]);

    expect(answer).toBe('escrito:zz');
    expect(drawn).toContain('Usar lo escrito: zz');
  });

  // Criterio 3: lo escrito que coincide con una fila la deja primera, y Enter elige la fila, no lo escrito.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('escribir parte de una fila la encuentra y Enter la elige', async () => {
    const { answer } = await run({ parse }, ['b', 'e', 't', ENTER]);

    expect(answer).toBe('b');
  });

  // Criterio 4.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('opcional: Enter con el filtro vacío devuelve "sin valor"', async () => {
    const { answer } = await run({ optional: true, parse }, [ENTER]);

    expect(answer).toBeUndefined();
  });

  // Criterio 4: el primer Enter no cierra (si cerrara, con la primera fila, la respuesta seria "a").
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('obligatorio: Enter con el filtro vacío no cierra, y después se sigue eligiendo', async () => {
    const { answer } = await run({ parse }, [ENTER, 'b', 'e', 't', ENTER]);

    expect(answer).toBe('b');
  });

  // Criterio 5.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('con la lista vacía es un texto validado: vacío muestra el error y lo escrito se convierte', async () => {
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
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('con `previous` igual a una fila arranca con esa fila marcada: Enter la elige', async () => {
    const { answer } = await run({ parse, previous: 'b' }, [ENTER]);

    expect(answer).toBe('b');
  });

  // Criterio 6.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('con `previous` que no es una fila arranca escrito, con "Usar lo escrito"; Enter lo usa', async () => {
    const { answer, frames } = await run({ parse, previous: 'zz' }, [ENTER]);

    expect(frames[0]).toContain('Usar lo escrito: zz');
    expect(answer).toBe('escrito:zz');
  });

  // Criterio 6.
  // Tests primero (TUI-35): pasa a it() al implementarlo.
  it.fails('Esc vuelve al paso anterior', async () => {
    const { answer } = await run({ optional: true, parse }, ['b', BACK]);

    expect(answer).toBe(BACK);
  });
});
