import input from '@inquirer/input';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { listSelect } from '../list-select';
import {
  askText,
  askTextStep,
  chooseOne,
  chooseStep,
  chooseStepWhileLoading,
  confirm,
  isPromptCancellation,
} from '../prompts';

vi.mock('../list-select', () => ({ listSelect: vi.fn() }));
vi.mock('@inquirer/input', () => ({ default: vi.fn() }));

const selectMock = vi.mocked(listSelect);
const inputMock = vi.mocked(input);

describe('prompts', () => {
  // Las respuestas dejan su linea "✔ pregunta respuesta" en stdout: se captura para mirarla y no ensuciar la salida.
  let write: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    write.mockRestore();
    vi.clearAllMocks();
  });

  it('chooseOne pasa las opciones y devuelve la elegida', async () => {
    selectMock.mockResolvedValueOnce('b' as never);

    expect(
      await chooseOne(
        '¿Cual?',
        [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b' },
        ],
        'a',
      ),
    ).toBe('b');
    expect(selectMock.mock.calls[0]?.[0]).toMatchObject({ default: 'a', message: '¿Cual?' });
  });

  it('chooseStep agrega "Volver" fijo debajo de las opciones', async () => {
    selectMock.mockResolvedValueOnce(BACK as never);

    expect(await chooseStep('¿Cual?', [{ name: 'A', value: 'a' }])).toBe(BACK);
    expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
      back: { label: '← Volver', value: BACK },
      choices: [{ name: 'A', value: 'a' }],
    });
    // La respuesta queda como "✔ ¿Cual? ← Volver".
    expect(stripAnsi(String(write.mock.calls[0]?.[0]))).toBe('✔ ¿Cual? ← Volver\n');
  });

  it('chooseOne con `back` deja la respuesta con el texto del boton', async () => {
    selectMock.mockResolvedValueOnce('volver' as never);

    expect(
      await chooseOne('¿Cual?', [{ name: 'A', value: 'a' }], undefined, {
        back: { label: '← Volver al menú', value: 'volver' },
        escapeValue: 'volver',
      }),
    ).toBe('volver');
    expect(stripAnsi(String(write.mock.calls[0]?.[0]))).toBe('✔ ¿Cual? ← Volver al menú\n');
  });

  it('chooseStepWhileLoading devuelve lo cargado y cierra la lista sin dejar rastro', async () => {
    selectMock.mockImplementationOnce(
      (_config, context) =>
        new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
          );
        }) as never,
    );

    const result = await chooseStepWhileLoading('¿Cual?', [{ name: 'A', value: 'a' }], 'a', 12, Promise.resolve([1]));

    expect(result).toEqual({ loaded: [1] });
    expect(selectMock.mock.calls[0]?.[1]).toMatchObject({ clearPromptOnDone: true });
  });

  it('chooseStepWhileLoading devuelve la opcion elegida antes de que termine la carga', async () => {
    selectMock.mockResolvedValueOnce('a' as never);

    const result = await chooseStepWhileLoading('¿Cual?', [{ name: 'A', value: 'a' }], 'a', 12, new Promise(() => {}));

    expect(result).toEqual({ answer: 'a' });
    expect(String(write.mock.calls[0]?.[0])).toContain('A');
  });

  it('askText recorta la respuesta', async () => {
    inputMock.mockResolvedValueOnce('  hola  ' as never);

    expect(await askText('Texto:')).toBe('hola');
  });

  it('askTextStep: "<" vuelve atras y lo demas pasa por la validacion', async () => {
    const validate = vi.fn((value: string) => (value === 'ok' ? true : 'mal'));

    inputMock.mockResolvedValueOnce('<' as never);
    expect(await askTextStep('Monto:', { validate })).toBe(BACK);

    const options = inputMock.mock.calls[0]?.[0] as { message: string; validate: (value: string) => string | true };

    expect(options.message).toContain('([esc] para volver)');
    expect(options.validate('<')).toBe(true);
    expect(options.validate('x')).toBe('mal');

    inputMock.mockResolvedValueOnce('ok' as never);
    expect(await askTextStep('Monto:', { validate })).toBe('ok');
  });

  it('askTextStep: lo escrito antes arranca escrito y editable; sin eso, el valor por defecto con tab', async () => {
    inputMock.mockResolvedValue('1' as never);

    await askTextStep('Monto:', { defaultValue: '4', previousAnswer: '1.500' });
    await askTextStep('Monto:', { defaultValue: '4', previousAnswer: '  ' });
    await askTextStep('Monto:');

    expect(inputMock.mock.calls[0]?.[0]).toMatchObject({ default: '1.500', prefill: 'editable' });
    expect(inputMock.mock.calls[1]?.[0]).toMatchObject({ default: '4', prefill: 'tab' });
    expect(inputMock.mock.calls[2]?.[0]).toMatchObject({ default: undefined, prefill: 'tab' });
    inputMock.mockReset();
  });

  it('Esc vuelve al paso anterior en texto y en listas, sin dejar la pregunta en pantalla', async () => {
    const waitForAbort = (_config: unknown, context?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        context?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
        );
      }) as never;

    inputMock.mockImplementationOnce(waitForAbort);
    selectMock.mockImplementationOnce(waitForAbort);

    const text = askTextStep('Monto:');

    process.stdin.emit('keypress', '', { name: 'escape' });
    expect(await text).toBe(BACK);

    const list = chooseStep('¿Cual?', [{ name: 'A', value: 'a' }]);

    process.stdin.emit('keypress', '', { name: 'escape' });
    expect(await list).toBe(BACK);
    expect(inputMock.mock.calls[0]?.[1]).toMatchObject({ clearPromptOnDone: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('al responder deja la linea "✔ pregunta respuesta" sin la ayuda de Esc', async () => {
    inputMock.mockResolvedValueOnce('150' as never);
    await askTextStep('Monto:');

    const line = stripAnsi(String(write.mock.calls[0]?.[0]));

    expect(line).toBe('✔ Monto: 150\n');
  });

  it('Esc en una confirmacion cuenta como no', async () => {
    selectMock.mockImplementationOnce(
      (_config, context) =>
        new Promise((_resolve, reject) => {
          context?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('abort'), { name: 'AbortPromptError' })),
          );
        }) as never,
    );

    const answer = confirm('¿Seguro?', 'Si');

    process.stdin.emit('keypress', '', { name: 'escape' });
    expect(await answer).toBe(false);
  });

  it('las listas dejan aire: dos lineas arriba, una bajo la pregunta y otra bajo la descripcion', async () => {
    selectMock.mockResolvedValueOnce('a' as never);

    await chooseOne('¿Cual?', [{ name: 'A', value: 'a' }]);

    const { theme } = selectMock.mock.calls[0]?.[0] as unknown as {
      theme: {
        prefix: { idle: string };
        style: { description: (text: string) => string; message: (text: string, status: string) => string };
      };
    };

    expect(theme.prefix.idle).toMatch(/^\n\n/);
    expect(stripAnsi(theme.style.message('¿Cual?', 'idle'))).toBe('¿Cual?\n');
    expect(stripAnsi(theme.style.message('¿Cual?', 'done'))).toBe('¿Cual?');
    expect(stripAnsi(theme.style.description('Ayuda'))).toBe('Ayuda\n');
  });

  it('confirm devuelve true o false segun la opcion', async () => {
    selectMock.mockResolvedValueOnce(true as never);

    expect(await confirm('¿Seguro?', 'Si')).toBe(true);
  });

  it('reconoce la cancelacion con Ctrl+C', () => {
    const cancellation = Object.assign(new Error('cancelado'), { name: 'ExitPromptError' });

    expect(isPromptCancellation(cancellation)).toBe(true);
    expect(isPromptCancellation(new Error('otro'))).toBe(false);
  });
});
