import input from '@inquirer/input';
import select from '@inquirer/select';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { askText, askTextStep, chooseOne, chooseStep, confirm, isPromptCancellation } from '../prompts';

vi.mock('@inquirer/select', () => ({ default: vi.fn() }));
vi.mock('@inquirer/input', () => ({ default: vi.fn() }));

const selectMock = vi.mocked(select);
const inputMock = vi.mocked(input);

describe('prompts', () => {
  afterEach(() => {
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
    expect(selectMock.mock.calls[0]?.[0]).toMatchObject({ default: 'a', loop: false, message: '¿Cual?' });
  });

  it('chooseStep agrega "Volver" al final de las opciones', async () => {
    selectMock.mockResolvedValueOnce(BACK as never);

    expect(await chooseStep('¿Cual?', [{ name: 'A', value: 'a' }])).toBe(BACK);

    const choices = (selectMock.mock.calls[0]?.[0] as unknown as { choices: Array<{ name: string; value: unknown }> })
      .choices;

    expect(choices.at(-1)).toEqual({ name: '← Volver', value: BACK });
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

    expect(options.message).toContain('(< para volver)');
    expect(options.validate('<')).toBe(true);
    expect(options.validate('x')).toBe('mal');

    inputMock.mockResolvedValueOnce('ok' as never);
    expect(await askTextStep('Monto:', { validate })).toBe('ok');
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
