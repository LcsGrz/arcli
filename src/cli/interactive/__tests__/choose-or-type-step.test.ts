import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, onTestFinished, vi } from 'vitest';

import type { ExportActivity } from '../../../modules/export/export.types';
import { fieldLens } from '../../../modules/interactive/steps/lens';
import { BACK, stepMemo } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { chooseOrTypeStep, type ChooseOrTypeStepOptions, type FilterListRow } from '../prompts';
import { activityStep } from '../steps/export';

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
function run<T>(
  options: ChooseOrTypeStepOptions<T>,
  keys: ReadonlyArray<string | typeof BACK>,
  rows: ReadonlyArray<FilterListRow<T>> = ROWS as unknown as ReadonlyArray<FilterListRow<T>>,
) {
  return press(chooseOrTypeStep('¿Cuál?', rows, options), keys);
}

/** Manda cada tecla (o Esc) a la pregunta que ya arrancó y devuelve su respuesta y lo que se dibujo hasta ahi. */
async function press<A>(answer: Promise<A>, keys: ReadonlyArray<string | typeof BACK>) {
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

describe('chooseOrTypeStep: la fila de "sin valor"', () => {
  it('se ve solo con el filtro vacío: con "pais" escrito no coincide, y vuelve al borrarlo', async () => {
    const rows = [{ label: 'ESTADOS UNIDOS', value: 'US' }];
    const { answer, frames } = await run(
      { emptyLabel: 'Sin CUIT del país', optional: true, parse },
      ['p', 'a', 'i', 's', '\u007F', '\u007F', '\u007F', '\u007F', ENTER],
      rows,
    );

    expect(lastDraw(frames[4])).not.toContain('Sin CUIT del país');
    expect(lastDraw(frames[4])).toContain('❯ Usar lo escrito: pais');
    expect(lastDraw(frames.at(-1))).toContain('❯ Sin CUIT del país');
    expect(answer).toBeUndefined();
  });
});

describe('chooseOrTypeStep: un dato fiscal sin valor por defecto (`requireChoice`)', () => {
  const requireChoice = 'Elegí un CUIT de la lista o escribí el número.';

  it('arranca sin fila marcada y Enter con el filtro vacío muestra el error; ↓ marca la primera', async () => {
    const { answer, frames } = await run({ parse, requireChoice }, [ENTER, DOWN, ENTER]);

    expect(lastDraw(frames[0])).not.toContain('❯');
    expect(lastDraw(frames[1])).toContain(`> ${requireChoice}`);
    expect(answer).toBe('a');
  });

  it('con `previous` de la lista arranca marcado y Enter lo elige', async () => {
    const { answer } = await run({ parse, previous: 'b', requireChoice }, [ENTER]);

    expect(answer).toBe('b');
  });

  it('escribir parte de una fila la marca, y al borrar lo escrito no queda ninguna', async () => {
    const { answer, frames } = await run({ parse, requireChoice }, ['b', '\u007F', ENTER, 'b', ENTER]);

    expect(lastDraw(frames[2])).not.toContain('❯');
    expect(lastDraw(frames[3])).toContain(`> ${requireChoice}`);
    expect(answer).toBe('b');
  });
});

describe('chooseOrTypeStep: sin la fila "Volver" (`backRow: false`)', () => {
  it('no la muestra, las flechas no pasan de la última fila y Esc sigue volviendo', async () => {
    const { answer, frames } = await run({ backRow: false, parse }, [DOWN, DOWN, DOWN, BACK]);

    expect(lastDraw(frames[0])).not.toContain('Volver');
    expect(lastDraw(frames.at(-1))).toContain('❯ Beta');
    expect(answer).toBe(BACK);
  });
});

describe('chooseOrTypeStep: el alto en una terminal chica', () => {
  it('con 20 filas de terminal, la lista con "Usar lo escrito" y el error entra entera', async () => {
    const saved = Object.getOwnPropertyDescriptor(process.stdout, 'rows');

    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 20, writable: true });
    onTestFinished(() => {
      if (saved) {
        Object.defineProperty(process.stdout, 'rows', saved);
      } else {
        delete (process.stdout as { rows?: number }).rows;
      }
    });

    const rows = Array.from({ length: 40 }, (_, index) => ({ label: `Fila ${index + 1}`, value: index }));
    const keys: Array<string | typeof BACK> = [
      'f',
      'i',
      'l',
      'a',
      ...Array.from({ length: 40 }, () => DOWN),
      ENTER,
      BACK,
    ];
    const { frames } = await run(
      { header: 'FILA', help: 'Escribí el número de la fila.', parse: () => -1, validate: () => 'No vale.' },
      keys,
      rows,
    );
    const lines = `\n\n? ¿Cuál?${lastDraw(frames.at(-1))}`.split('\n');

    expect(lastDraw(frames.at(-1))).toContain('> No vale.');
    expect(lastDraw(frames.at(-1))).toContain('← Volver');
    expect(lines.length, lines.join('\n')).toBeLessThanOrEqual(20);
  });
});

/**
 * Criterio 6 de TUI-25 (Búsquedas y filtros de `criterios.md`): códigos y descripciones contenidos en otros. 62010 está
 * dentro de 620100 y de 6201000, "SERVICIOS DE CONSULTORES EN INFORMATICA" dentro de la descripción de 6201000, y las
 * palabras de "SERVICIOS DE INFORMATICA" en las tres. ARCA puede mandar la más larga primero: lo escrito entero elige
 * esa fila, no la primera que lo contiene.
 */
const NESTED_ACTIVITIES: readonly ExportActivity[] = [
  { id: 6201000, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA Y SUMINISTROS DE PROGRAMAS' },
  { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
  { id: 62010, name: 'SERVICIOS DE INFORMATICA' },
];

/** Cada caracter de `text` como una tecla, y Enter. */
function typed(text: string): string[] {
  return [...text, ENTER];
}

describe('chooseOrTypeStep: códigos y descripciones contenidos en otros (TUI-25, criterio 6)', () => {
  // Las filas como las de "Monedas y cotizaciones": la fila con código y descripción, el código como palabra clave y la
  // descripción como lo que deja al elegirla.
  const rows: ReadonlyArray<FilterListRow<number>> = NESTED_ACTIVITIES.map((activity) => ({
    keywords: String(activity.id),
    label: `${activity.id}  ${activity.name}`,
    short: activity.name,
    value: activity.id,
  }));

  it.each([
    ['620100', 620100],
    ['62010', 62010],
    ['SERVICIOS DE CONSULTORES EN INFORMATICA', 620100],
    ['servicios de informatica', 62010],
  ])('"%s" entero elige su fila aunque otra que lo contiene vaya antes', async (text, expected) => {
    const { answer } = await run({ parse: Number }, typed(text), rows);

    expect(answer).toBe(expected);
  });
});

describe('la actividad de WSFEX con la tabla de verdad: códigos y descripciones contenidos en otros (TUI-25, criterio 6)', () => {
  interface ActivityState {
    readonly activity?: number;
  }

  /** La pregunta de la actividad de "Emitir factura E" y "Repetir" E, con la tabla anidada. */
  function askActivity(keys: ReadonlyArray<string | typeof BACK>) {
    const step = activityStep<ActivityState>({
      activities: async () => NESTED_ACTIVITIES,
      activity: fieldLens('activity'),
      skip: () => false,
    });

    return press(step.run({}, { memo: stepMemo(new Map(), 'actividad') }), keys);
  }

  // Lo de hoy: el código entero vale aunque esté contenido en otro de la tabla.
  it.each([
    ['620100', 620100],
    ['62010', 62010],
  ])('el código %s escrito entero es esa actividad, aunque 6201000 vaya antes', async (text, expected) => {
    const { answer } = await askActivity(typed(text));

    expect(answer).toEqual({ activity: expected });
  });

  // Esc al final: si Enter no cierra la pregunta, vuelve y el test falla en lo que mira.
  // Tests primero (TUI-25): pasa a it() al implementarlo.
  it.fails('la descripción entera de 620100 elige 620100, aunque la de 6201000 la contiene y va antes', async () => {
    const { answer } = await askActivity([...typed('SERVICIOS DE CONSULTORES EN INFORMATICA'), BACK]);

    expect(answer).toEqual({ activity: 620100 });
  });

  // Tests primero (TUI-25): pasa a it() al implementarlo.
  it.fails(
    'con el filtro vacío, la fila "Sin actividad" arranca marcada y Enter deja la actividad sin informar',
    async () => {
      const { answer, frames } = await askActivity([ENTER]);

      expect(frames[0]).toMatch(/❯ Sin actividad/i);
      expect(answer).toEqual({ activity: undefined });
    },
  );
});
