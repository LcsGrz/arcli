import { Separator } from '@inquirer/core';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { blockPager } from '../block-pager';
import { filterList } from '../filter-list';
import { listSelect } from '../list-select';
import { multiSelect } from '../multi-select';
import { withOutputGuard } from '../output-guard';
import {
  browseBlocks,
  browseFilterList,
  chooseFromFilterList,
  chooseManyStep,
  chooseOne,
  chooseStep,
  chooseStepWhileLoading,
  editRowsStep,
  eraseLastAnswer,
  fitPageSize,
} from '../prompts';
import { rowActionsList } from '../row-actions-list';

vi.mock('../list-select', () => ({ listSelect: vi.fn() }));
vi.mock('../row-actions-list', () => ({ rowActionsList: vi.fn() }));
vi.mock('../multi-select', () => ({ multiSelect: vi.fn() }));
vi.mock('../filter-list', () => ({ filterList: vi.fn() }));
vi.mock('../block-pager', () => ({ blockPager: vi.fn() }));

const selectMock = vi.mocked(listSelect);
const multiMock = vi.mocked(multiSelect);
const filterMock = vi.mocked(filterList);
const pagerMock = vi.mocked(blockPager);
const rowActionsMock = vi.mocked(rowActionsList);

/** Un prompt que espera hasta que lo aborten (Esc o fin de la carga), como el real. */
function waitForAbort(_config: unknown, context?: { signal?: AbortSignal }) {
  return new Promise((_resolve, reject) => {
    context?.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
    );
  }) as never;
}

function pressEscape(): void {
  process.stdin.emit('keypress', '', { name: 'escape' });
}

function writtenLines(write: MockInstance<typeof process.stdout.write>): string[] {
  return write.mock.calls.map((call) => stripAnsi(String(call[0])));
}

describe('prompts de paso', () => {
  let write: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    write.mockRestore();
    vi.clearAllMocks();
  });

  describe('fitPageSize', () => {
    let rows: number | undefined;

    beforeEach(() => {
      rows = process.stdout.rows;
    });

    afterEach(() => {
      process.stdout.rows = rows as number;
    });

    it('muestra todas las filas si entran, con un minimo de 12', () => {
      process.stdout.rows = 40;

      expect(fitPageSize(3)).toBe(12);
      expect(fitPageSize(20)).toBe(20);
    });

    it('si no entran, achica la pagina para que "Volver" y los avisos queden en pantalla', () => {
      process.stdout.rows = 30;

      // 30 - 6 de la pregunta - 2 de "Volver" = 22 lineas; con los avisos de desplazamiento, 20.
      expect(fitPageSize(22)).toBe(22);
      expect(fitPageSize(23)).toBe(20);
      // Sin "Volver" entran dos mas.
      expect(fitPageSize(24, { back: false })).toBe(24);
      // Lo que suma un filtro tambien se descuenta.
      expect(fitPageSize(50, { extraLines: 4 })).toBe(16);
    });

    it('en una terminal muy baja deja al menos 3 filas, y sin alto conocido supone 24', () => {
      process.stdout.rows = 8;
      expect(fitPageSize(50)).toBe(3);

      process.stdout.rows = 0;
      // 24 - 6 - 2 = 16 lineas; con los avisos, 14.
      expect(fitPageSize(50)).toBe(14);
    });
  });

  describe('eraseLastAnswer', () => {
    let isTTY: boolean;

    beforeEach(() => {
      isTTY = process.stdout.isTTY;
    });

    afterEach(() => {
      process.stdout.isTTY = isTTY;
    });

    it('borra la linea anterior solo en una terminal', () => {
      process.stdout.isTTY = false;
      eraseLastAnswer();
      expect(write).not.toHaveBeenCalled();

      process.stdout.isTTY = true;
      eraseLastAnswer();
      expect(write).toHaveBeenCalledWith('\u001B[1A\u001B[2K\r');
    });
  });

  describe('chooseOne', () => {
    it('con Esc devuelve el valor de escape y no deja linea de respuesta', async () => {
      selectMock.mockImplementationOnce(waitForAbort);

      const answer = chooseOne('¿Salir?', [{ name: 'Si', value: 'si' }], undefined, {
        escapeLabel: 'salir',
        escapeValue: 'salir',
      });

      pressEscape();
      expect(await answer).toBe('salir');
      expect(write).not.toHaveBeenCalled();
    });

    it('la ayuda de Esc usa la etiqueta pedida y traduce las teclas de @inquirer', async () => {
      selectMock.mockResolvedValueOnce('a' as never);

      await chooseOne('¿Cual?', [{ name: 'A', value: 'a' }], undefined, { escapeLabel: 'salir', escapeValue: 'x' });

      const { theme } = selectMock.mock.calls[0]?.[0] as unknown as {
        theme: { style: { keysHelpTip: (keys: Array<[string, string]>) => string } };
      };
      const help = stripAnsi(
        theme.style.keysHelpTip([
          ['↑↓', 'navigate'],
          ['⏎', 'select'],
          ['x', 'otra'],
        ]),
      );

      expect(help).toContain('mover');
      expect(help).toContain('elegir');
      // Lo que no tiene traduccion queda como vino.
      expect(help).toContain('x otra');
      expect(help).toMatch(/esc salir$/);
    });

    it('con `compactTop` deja una sola linea en blanco arriba', async () => {
      selectMock.mockResolvedValueOnce('a' as never);

      await chooseOne('¿Cual?', [{ name: 'A', value: 'a' }], undefined, { compactTop: true });

      const { theme } = selectMock.mock.calls[0]?.[0] as unknown as { theme: { prefix: { idle: string } } };

      expect(theme.prefix.idle).toMatch(/^\n[^\n]/);
    });

    it('la linea de respuesta usa el texto corto de la opcion, si lo tiene', async () => {
      selectMock.mockResolvedValueOnce('b' as never);

      await chooseOne('¿Cual?', [new Separator(), { name: 'Opcion larga B', short: 'B', value: 'b' }], undefined, {
        escapeValue: 'x',
      });

      expect(writtenLines(write)).toEqual(['✔ ¿Cual? B\n']);
    });

    it('un error que no es Esc no se traga: llega a quien pregunto', async () => {
      selectMock.mockRejectedValueOnce(Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' }));

      await expect(chooseOne('¿Cual?', [{ name: 'A', value: 'a' }], undefined, { escapeValue: 'x' })).rejects.toThrow(
        'Ctrl+C',
      );
      // Despues de un error no queda escuchando teclas.
      expect(process.stdin.listenerCount('keypress')).toBe(0);
    });
  });

  it('chooseStep con una respuesta que no esta entre las opciones deja la linea sin texto', async () => {
    selectMock.mockResolvedValueOnce('z' as never);

    expect(await chooseStep('¿Cual?', [{ name: 'A', value: 'a' }])).toBe('z');
    expect(writtenLines(write)).toEqual(['✔ ¿Cual? \n']);
  });

  it('chooseStepWhileLoading: Esc antes de que termine la carga vuelve atras', async () => {
    selectMock.mockImplementationOnce(waitForAbort);

    const result = chooseStepWhileLoading('¿Cual?', [{ name: 'A', value: 'a' }], undefined, 12, new Promise(() => {}));

    pressEscape();
    expect(await result).toEqual({ answer: BACK });
  });

  it('chooseStepWhileLoading, en el asistente: la carga que termina antes de abrir la lista también la cierra', async () => {
    // El control de la salida espera un turno antes de escuchar (ERR-18).
    selectMock.mockImplementationOnce((config, context) =>
      context?.signal?.aborted
        ? (Promise.reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })) as never)
        : waitForAbort(config, context),
    );

    let result: unknown;

    await withOutputGuard(async () => {
      result = await chooseStepWhileLoading('¿Cual?', [], undefined, 12, Promise.resolve('cargado'));
    });

    expect(result).toEqual({ loaded: 'cargado' });
  });

  it('chooseStepWhileLoading: si la carga falla, la lista se cierra y el error sale', async () => {
    selectMock.mockImplementationOnce(waitForAbort);

    await expect(
      chooseStepWhileLoading('¿Cual?', [{ name: 'A', value: 'a' }], undefined, 12, Promise.reject(new Error('ARCA'))),
    ).rejects.toThrow('ARCA');
  });

  describe('chooseManyStep', () => {
    const choices = [
      { name: 'IVA', value: 'iva' },
      { name: 'Tributos', value: 'tributos' },
      { name: 'Opcionales', value: 'opcionales' },
    ];

    it('devuelve lo marcado y deja la linea con los nombres en el orden de las opciones', async () => {
      multiMock.mockResolvedValueOnce(['opcionales', 'iva'] as never);

      expect(await chooseManyStep('¿Que agregás?', choices, ['iva'])).toEqual(['opcionales', 'iva']);
      expect(multiMock.mock.calls[0]?.[0]).toMatchObject({ backLabel: '← Volver', selected: ['iva'] });
      expect(writtenLines(write)).toEqual(['✔ ¿Que agregás? IVA, Opcionales\n']);
    });

    it('sin marcar nada tambien vale', async () => {
      multiMock.mockResolvedValueOnce([] as never);

      expect(await chooseManyStep('¿Que agregás?', choices)).toEqual([]);
      expect(multiMock.mock.calls[0]?.[0]).toMatchObject({ selected: [] });
    });

    it('el boton "Volver" vuelve y deja su texto en la linea', async () => {
      multiMock.mockResolvedValueOnce(BACK as never);

      expect(await chooseManyStep('¿Que agregás?', choices)).toBe(BACK);
      expect(writtenLines(write)).toEqual(['✔ ¿Que agregás? ← Volver\n']);
    });

    it('Esc vuelve sin dejar la pregunta en pantalla', async () => {
      multiMock.mockImplementationOnce(waitForAbort);

      const answer = chooseManyStep('¿Que agregás?', choices);

      pressEscape();
      expect(await answer).toBe(BACK);
      expect(write).not.toHaveBeenCalled();
    });
  });

  describe('chooseFromFilterList', () => {
    const rows = [
      { label: 'DOL   Dólar', short: 'Dólar', value: 'DOL' },
      { label: '060   Euro\n  europeo', value: '060' },
    ];

    it('devuelve la fila elegida y deja su texto corto', async () => {
      filterMock.mockResolvedValueOnce('DOL' as never);

      expect(await chooseFromFilterList('Moneda', rows, { defaultValue: '060', pageSize: 10 })).toBe('DOL');
      expect(filterMock.mock.calls[0]?.[0]).toMatchObject({ default: '060', mode: 'elegir', pageSize: 10 });
      expect(writtenLines(write)).toEqual(['✔ Moneda Dólar\n']);
    });

    it('sin texto corto deja la etiqueta en una sola linea', async () => {
      filterMock.mockResolvedValueOnce('060' as never);

      await chooseFromFilterList('Moneda', rows, { pageSize: 10 });

      expect(writtenLines(write)).toEqual(['✔ Moneda 060 Euro europeo\n']);
    });

    it('una respuesta que no esta entre las filas deja la linea vacia', async () => {
      filterMock.mockResolvedValueOnce('XXX' as never);

      expect(await chooseFromFilterList('Moneda', rows, { pageSize: 10 })).toBe('XXX');
      expect(writtenLines(write)).toEqual(['✔ Moneda \n']);
    });

    it('"Volver" (sin valor) y Esc vuelven al paso anterior', async () => {
      filterMock.mockResolvedValueOnce(undefined as never);
      expect(await chooseFromFilterList('Moneda', rows, { pageSize: 10 })).toBe(BACK);
      expect(writtenLines(write)).toEqual(['✔ Moneda ← Volver\n']);

      filterMock.mockImplementationOnce(waitForAbort);
      const answer = chooseFromFilterList('Moneda', rows, { pageSize: 10 });

      pressEscape();
      expect(await answer).toBe(BACK);
    });
  });

  describe('editRowsStep (NAV-10)', () => {
    const rows = [{ detail: '1 unidades x 500 USD', title: 'Flete', total: '500 USD' }];
    const options = { addLabel: '+ Agregar ítem', minRows: 1, minRowsNotice: 'Queda al menos uno.' };

    it('devuelve las marcas y deja en la línea lo que se aplicó', async () => {
      rowActionsMock.mockResolvedValueOnce({ add: true, edit: [0], remove: [1, 2] } as never);
      expect(await editRowsStep('Ítems', rows, options)).toEqual({ add: true, edit: [0], remove: [1, 2] });
      expect(rowActionsMock.mock.calls[0]?.[0]).toMatchObject({ ...options, backLabel: '← Volver', rows });

      rowActionsMock.mockResolvedValueOnce({ add: false, edit: [], remove: [] } as never);
      await editRowsStep('Ítems', rows, options);
      rowActionsMock.mockResolvedValueOnce({ add: false, edit: [0, 1], remove: [] } as never);
      await editRowsStep('Ítems', rows, options);
      rowActionsMock.mockResolvedValueOnce({ add: true, edit: [], remove: [] } as never);
      await editRowsStep('Ítems', rows, options);

      expect(writtenLines(write)).toEqual([
        '✔ Ítems 1 para modificar, 2 para borrar y uno nuevo\n',
        '✔ Ítems sin cambios\n',
        '✔ Ítems 2 para modificar\n',
        '✔ Ítems uno nuevo\n',
      ]);
    });

    it('"Volver" y Esc vuelven al paso anterior', async () => {
      rowActionsMock.mockResolvedValueOnce(BACK as never);
      expect(await editRowsStep('Ítems', rows, options)).toBe(BACK);
      expect(writtenLines(write)).toEqual(['✔ Ítems ← Volver\n']);

      rowActionsMock.mockImplementationOnce(waitForAbort);
      const answer = editRowsStep('Ítems', rows, options);

      pressEscape();
      expect(await answer).toBe(BACK);
    });
  });

  it('browseFilterList muestra las filas en modo "ver" y no deja rastro', async () => {
    filterMock.mockResolvedValueOnce('a' as never);

    await browseFilterList('Monedas', ['a', 'b'], { header: 'Código', pageSize: 5 });

    expect(filterMock.mock.calls[0]?.[0]).toMatchObject({
      header: 'Código',
      mode: 'ver',
      rows: [
        { label: 'a', value: 'a' },
        { label: 'b', value: 'b' },
      ],
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('browseBlocks arma la ayuda con las teclas pedidas y no deja rastro', async () => {
    pagerMock.mockResolvedValueOnce('uno' as never);

    await browseBlocks('Ayuda', ['uno', 'dos'], (block) => block, [
      ['←→', 'cambiar'],
      ['enter', 'cerrar'],
    ]);

    const config = pagerMock.mock.calls[0]?.[0] as { readonly blocks: readonly string[]; readonly help: string };

    expect(config.blocks).toEqual(['uno', 'dos']);
    expect(stripAnsi(config.help)).toMatch(/^←→ cambiar .+ enter cerrar$/);
    expect(write).not.toHaveBeenCalled();
  });
});
