import input from '@inquirer/input';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { outputState } from '../../closed-output';
import { blockPager } from '../block-pager';
import { filterList } from '../filter-list';
import { listSelect } from '../list-select';
import { multiSelect } from '../multi-select';
import { withOutputGuard } from '../output-guard';
import * as prompts from '../prompts';
import { rowActionsList } from '../row-actions-list';

vi.mock('@inquirer/input', () => ({ default: vi.fn(async () => 'x') }));
vi.mock('../list-select', () => ({ listSelect: vi.fn(async () => 'a') }));
vi.mock('../row-actions-list', () => ({ rowActionsList: vi.fn(async () => ({ add: false, edit: [], remove: [] })) }));
vi.mock('../multi-select', () => ({ multiSelect: vi.fn(async () => []) }));
vi.mock('../filter-list', () => ({ filterList: vi.fn(async () => 'a') }));
vi.mock('../block-pager', () => ({ blockPager: vi.fn(async () => 'a') }));

const COMPONENTS = [input, listSelect, rowActionsList, multiSelect, filterList, blockPager];
const choices = [{ name: 'A', value: 'a' }];
const rows = [{ label: 'A', value: 'a' }];
const parse = (text: string) => text;
const editOptions = { addLabel: '+', minRows: 1, minRowsNotice: 'x' };

/** Cada funcion de `prompts` que pregunta, con cada camino por el que abre un prompt. */
const ASKING = {
  askText: [() => prompts.askText('¿?')],
  askTextStep: [() => prompts.askTextStep('¿?')],
  browseBlocks: [() => prompts.browseBlocks('¿?', ['a'], () => '', [])],
  browseFilterList: [() => prompts.browseFilterList('¿?', ['a'], { pageSize: 5 })],
  chooseFromFilterList: [() => prompts.chooseFromFilterList('¿?', rows, {})],
  chooseManyStep: [() => prompts.chooseManyStep('¿?', choices)],
  chooseOne: [
    () => prompts.chooseOne('¿?', choices),
    () => prompts.chooseOne('¿?', choices, undefined, { escapeValue: 'z' }),
  ],
  chooseOrTypeStep: [
    () => prompts.chooseOrTypeStep('¿?', rows, { parse }),
    () => prompts.chooseOrTypeStep('¿?', [], { parse }),
  ],
  chooseStep: [() => prompts.chooseStep('¿?', choices)],
  chooseStepWhileLoading: [
    () => prompts.chooseStepWhileLoading('¿?', choices, undefined, 5, new Promise(() => undefined)),
  ],
  confirm: [() => prompts.confirm('¿?', 'Sí')],
  editRowsStep: [() => prompts.editRowsStep('¿?', [], editOptions)],
} satisfies Partial<Record<keyof typeof prompts, ReadonlyArray<() => Promise<unknown>>>>;
/** Las que no preguntan. */
const NOT_ASKING = ['eraseLastAnswer', 'fitPageSize', 'isPromptCancellation'];
const PATHS = Object.entries(ASKING).flatMap(([name, calls]) =>
  (calls as ReadonlyArray<() => Promise<unknown>>).map((call, index) => [`${name} ${index + 1}`, call] as const),
);

const opened = (): number => COMPONENTS.reduce((total, component) => total + vi.mocked(component).mock.calls.length, 0);

beforeEach(() => {
  COMPONENTS.forEach((component) =>
    vi
      .mocked(component)
      .mockReset()
      .mockResolvedValue('a' as never),
  );
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  outputState.failures.clear();
  vi.restoreAllMocks();
});

describe('toda pregunta del asistente pasa por el control de la salida (ERR-18)', () => {
  it.each(PATHS)('%s: con stdout sano abre el prompt', async (_name, call) => {
    // Lo que devuelve el prompt falso no importa.
    await withOutputGuard(async () => void (await call().catch(() => undefined)));

    expect(opened()).toBe(1);
  });

  it.each(PATHS)('%s: con stdout roto no lo abre', async (_name, call) => {
    outputState.failures.set('stdout', new Error('write'));

    await expect(withOutputGuard(async () => void (await call()))).rejects.toThrow();
    expect(opened()).toBe(0);
  });

  it.each(PATHS)('%s: si stdout se rompe con el prompt abierto, lo cierra', async (_name, call) => {
    for (const component of COMPONENTS) {
      vi.mocked(component).mockImplementationOnce(((_config: unknown, context?: { signal?: AbortSignal }) => {
        const answer = new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
          );
        });

        // Como el fallo al dibujarlo: llega con la pregunta ya abierta.
        setImmediate(() => {
          outputState.failures.set('stdout', new Error('write'));
          process.stdout.emit('error', new Error('write'));
        });

        return answer;
      }) as never);
    }

    const quiet = () => undefined;
    const listeners = process.stdout.listenerCount('error');

    process.stdout.on('error', quiet);

    try {
      await expect(withOutputGuard(async () => void (await call()))).rejects.toMatchObject({ name: 'ExitPromptError' });
      expect(process.stdout.listenerCount('error')).toBe(listeners + 1);
    } finally {
      process.stdout.off('error', quiet);
    }
  });

  it('la lista de arriba tiene todas las funciones de `prompts`', () => {
    const functions = Object.entries(prompts).flatMap(([name, value]) => (typeof value === 'function' ? [name] : []));

    expect(functions.sort()).toEqual([...Object.keys(ASKING), ...NOT_ASKING].sort());
  });

  it('nadie más abre un prompt: ni de @inquirer ni de los propios', () => {
    const root = join(import.meta.dirname, '..', '..');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.includes('__tests__'))
      .map((name) => ({ name: name.replaceAll('\\', '/'), source: readFileSync(join(root, name), 'utf8') }));
    const own = files.flatMap(({ source }) =>
      [...source.matchAll(/export const (\w+) = createPrompt\b/g)].map(([, name]) => name),
    );
    const components = files.filter(({ source }) => /\bcreatePrompt\b/.test(source)).map(({ name }) => name);
    const asking = files
      .filter(({ source }) =>
        [...source.matchAll(/import\s+(?!type\b)([^;]*?)\s+from\s+'([^']+)'/g)].some(
          ([, names, from]) =>
            /^@inquirer\/(?!core$)/.test(from) ||
            /\bnode:readline\/promises\b/.test(from) ||
            own.some((prompt) => new RegExp(`(?<!type )\\b${prompt}\\b`).test(names)),
        ),
      )
      .map(({ name }) => name);

    expect(own).toHaveLength(COMPONENTS.length - 1);
    expect(components).toHaveLength(own.length);
    expect(asking).toEqual(['interactive/prompts.ts']);
  });
});
