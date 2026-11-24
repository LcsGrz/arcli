import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../../modules/config/config.service';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { runConfigMenu } from '../config.flow';
import { askTextStep, chooseOne, chooseStep } from '../prompts';

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  chooseOne: vi.fn(),
  chooseOrTypeStep: vi.fn(),
  chooseStep: vi.fn(),
  confirm: vi.fn(),
  fitPageSize: () => 12,
}));

/** "Cuenta" en "Modificar configuración" hace lo mismo que `config establecer cuenta` y `config eliminar cuenta`. */

const CBU = '0110599520000012345678';
const OTHER_CBU = '0170099220000067797370';
const ALIAS = 'mi.alias.cbu';

let directory = '';
let output = '';
let fceKeys: unknown[] = [];

function withConfig<T>(run: (service: ConfigService) => T): T {
  const service = new ConfigService();

  try {
    return run(service);
  } finally {
    service.close();
  }
}

/** Elige "Cuenta" y responde las preguntas de texto, en orden. */
async function changeAccount(...answers: Array<string | typeof BACK>): Promise<void> {
  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(chooseStep)
    .mockImplementationOnce(async (_message, choices) => {
      const fields = choices.map((choice) => ('value' in choice ? choice.value : undefined)) as Array<
        { key: string } | undefined
      >;

      fceKeys = fields.map((field) => field?.key).filter((key) => ['cuenta', 'cbu', 'aliasCbu'].includes(key ?? ''));

      return fields.find((field) => field?.key === 'cuenta') as never;
    })
    .mockResolvedValueOnce(BACK);

  for (const answer of answers) {
    vi.mocked(askTextStep).mockResolvedValueOnce(answer);
  }

  await runConfigMenu();

  expect(askTextStep).toHaveBeenCalledTimes(answers.length);
}

const saved = () => {
  const { aliasCbu, cbu } = withConfig((service) => service.getConfig());

  return { aliasCbu, cbu };
};

function question(index: number) {
  const [message, options] = vi.mocked(askTextStep).mock.calls[index] ?? [];

  return { message, ...options };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-config-flow-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  vi.mocked(askTextStep).mockReset();
  vi.mocked(chooseOne).mockReset();
  vi.mocked(chooseStep).mockReset();
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
  withConfig((service) => service.setValue('cbu', CBU));
  withConfig((service) => service.setValue('aliasCbu', ALIAS));
});

afterEach(() => {
  vi.mocked(process.stdout.write).mockRestore();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe('"Cuenta" en "Modificar configuración"', () => {
  it('es una sola opción: pide el CBU, con el guardado propuesto, después el alias, y guarda los dos', async () => {
    await changeAccount(OTHER_CBU, 'otro.alias');

    expect(fceKeys).toEqual(['cuenta']);
    expect(saved()).toEqual({ aliasCbu: 'otro.alias', cbu: OTHER_CBU });
    expect(question(0)).toMatchObject({ defaultValue: CBU, message: expect.stringContaining('CBU') });
    expect(question(1).message).toContain('Alias');
    expect(stripAnsi(output)).toContain('Guardado.');
    expect(stripAnsi(output)).not.toContain('Se borró');
  });

  it('con otro CBU, Enter en el alias borra el viejo: la pregunta lo dice antes y el panel después', async () => {
    await changeAccount(OTHER_CBU, '');

    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
    expect(question(1)).toMatchObject({
      hint: `(Enter para omitirlo: borra ${ALIAS})`,
      message: 'Alias del CBU:',
    });
    expect(question(1).defaultValue).toBeUndefined();
    expect(stripAnsi(output)).toContain('Se borró el alias');
  });

  it('con el mismo CBU, el alias guardado es el valor por defecto y "-" lo borra', async () => {
    await changeAccount(CBU, '-');

    expect(question(1)).toMatchObject({ defaultValue: ALIAS, message: 'Alias del CBU ("-" para borrar):' });
    expect(question(1).hint).toBeUndefined();
    expect(question(1).validate?.('-')).toBe(true);
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: CBU });
    expect(stripAnsi(output)).toContain('Dato borrado.');
  });

  it('con el mismo CBU se puede cambiar el alias', async () => {
    await changeAccount(CBU, 'otro.alias');

    expect(saved()).toEqual({ aliasCbu: 'otro.alias', cbu: CBU });
    expect(stripAnsi(output)).not.toContain('Se borró');
  });

  it('"-" no es un alias válido si no hay uno guardado de ese CBU', async () => {
    await changeAccount(OTHER_CBU, BACK, BACK);

    expect(question(1).validate?.('-')).toContain('entre 6 y 20');
  });

  it('al volver y cambiar el CBU, el alias escrito para el otro no se propone', async () => {
    await changeAccount(CBU, BACK, OTHER_CBU, 'otro.alias');

    expect(question(1).defaultValue).toBe(ALIAS);
    expect(question(3).defaultValue).toBeUndefined();
    expect(question(3).previousAnswer).toBeUndefined();
  });

  it('sin alias guardado, Enter lo omite y no hay nada que avisar', async () => {
    withConfig((service) => service.unsetValue('aliasCbu'));

    await changeAccount(OTHER_CBU, '');

    expect(saved()).toEqual({ aliasCbu: undefined, cbu: OTHER_CBU });
    expect(question(1).hint).toBe('(Enter para omitirlo)');
    expect(stripAnsi(output)).not.toContain('Se borró');
  });

  it('lo mismo que lo guardado no cambia nada', async () => {
    const write = vi.spyOn(ConfigService.prototype, 'setValue');

    await changeAccount(CBU, ALIAS);

    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
    expect(stripAnsi(output)).toContain('Sin cambios.');
    expect(stripAnsi(output)).not.toContain('Se borró');
  });

  it('Esc en el CBU no cambia nada', async () => {
    await changeAccount(BACK);

    expect(fceKeys).toEqual(['cuenta']);
    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
    expect(output).toBe('');
  });

  it('Esc en el alias vuelve al CBU, con lo escrito, y no guarda nada', async () => {
    await changeAccount(OTHER_CBU, BACK, BACK);

    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: CBU });
    expect(question(2)).toMatchObject({ message: question(0).message, previousAnswer: OTHER_CBU });
  });

  it('al volver del alias se puede cambiar el CBU', async () => {
    await changeAccount('2850590940090418135201', BACK, OTHER_CBU, ALIAS);

    expect(saved()).toEqual({ aliasCbu: ALIAS, cbu: OTHER_CBU });
  });

  it('"-" en el CBU borra la cuenta entera sin pedir el alias', async () => {
    await changeAccount('-');

    expect(question(0).message).toContain('"-" para borrar');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: undefined });
    expect(stripAnsi(output)).toContain('Dato borrado.');
  });

  it('sin cuenta, Enter en el CBU deja todo como estaba y no pide el alias', async () => {
    withConfig((service) => service.unsetValue('cbu'));
    withConfig((service) => service.unsetValue('aliasCbu'));

    await changeAccount('');

    expect(question(0).message).not.toContain('para borrar');
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: undefined });
    expect(stripAnsi(output)).toContain('Sin cambios.');
  });

  it('valida el CBU y el alias como la config', async () => {
    await changeAccount(CBU, BACK, BACK);

    const cbu = question(0).validate;
    const alias = question(1).validate;

    expect(cbu?.('123')).toContain('22 dígitos');
    expect(cbu?.(CBU)).toBe(true);
    expect(cbu?.('-')).toBe(true);
    expect(alias?.('abc')).toContain('entre 6 y 20');
    expect(alias?.('')).toBe(true);
  });
});
