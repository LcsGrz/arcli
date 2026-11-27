import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentCompletionEnvironment, resolveCompletionPath } from '../../../modules/completion/installer';
import { stripAnsi } from '../../../ui';
import { createProgram } from '../../program';

async function run(argv: string[]): Promise<{ error?: unknown; stdout: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  try {
    await createProgram().parseAsync(['node', 'arcli', ...argv]);

    return { stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join('') };
  } catch (error) {
    return { error, stdout: '' };
  } finally {
    stdout.mockRestore();
  }
}

const complete = async (...words: string[]) =>
  (await run(['__completar', '--', ...words])).stdout.split('\n').filter(Boolean);

describe('arcli completado', () => {
  it('prints the script for each shell', async () => {
    expect((await run(['completado', 'zsh'])).stdout).toContain('compdef _arcli arcli');
    expect((await run(['completado', 'bash'])).stdout).toContain('complete -o default -F _arcli_completar arcli');
    expect((await run(['completado', 'fish'])).stdout).toContain('complete -c arcli');
  });

  it('rejects an unknown shell', async () => {
    expect((await run(['completado', 'powershell'])).error).toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
  });
});

describe('arcli __completar', () => {
  it('completes commands, without internal ones', async () => {
    const commands = await complete('');

    expect(commands).toEqual(expect.arrayContaining(['fc', 'factura', 'config', 'ultimos', 'completado']));
    expect(commands).not.toContain('storybook');
    expect(commands).not.toContain('__completar');
  });

  it('completes the flags and values of a voucher', async () => {
    expect(await complete('fc', '--ir-r')).toEqual(['--ir-ri', '--ir-rm']);
    expect(await complete('fc', '--iva-receptor', 'responsable-m')).toEqual(['responsable-monotributo']);
    expect(await complete('fcea', '--transferencia', '')).toEqual(['sca', 'adc']);
  });

  it('does not offer hidden aliases but still completes their values', async () => {
    expect(await complete('fc', '--p')).not.toContain('--pv');
    expect(await complete('fc', '--ir', 'responsable-m')).toEqual(['responsable-monotributo']);
  });

  it('completes shortcuts, config keys with their values, tables and letters', async () => {
    expect(await complete('ultimos', 'nc')).toEqual(expect.arrayContaining(['nca', 'ncb', 'ncc', 'ncea']));
    expect(await complete('config', 'establecer', 'punto')).toEqual(['puntoVenta']);
    expect(await complete('config', 'establecer', 'entorno', '')).toEqual(['testing', 'produccion']);
    expect(await complete('parametros', 'cot')).toEqual(['cotizacion']);
    // La E (exportacion) solo existe en la familia factura.
    expect(await complete('factura', '')).toEqual(['a', 'b', 'c', 'e']);
    expect(await complete('nota-credito', '')).toEqual(['a', 'b', 'c', 'e']);
    expect(await complete('recibo', '')).toEqual(['a', 'b', 'c']);
  });

  it('takes the typed words as they are, even flags or `ayuda`', async () => {
    expect(await complete('fc', '--monto', '1000', 'ayuda', '--ir-c')).toEqual(['--ir-ce', '--ir-cf']);
  });
});

describe('arcli completado instalar y desinstalar', () => {
  it('installs into the rc file of the given shell and reports it in JSON', async () => {
    const rc = resolveCompletionPath('bash', currentCompletionEnvironment());
    const installed = JSON.parse((await run(['completado', 'instalar', 'bash', '--json'])).stdout) as unknown;

    expect(installed).toMatchObject({ cambio: true, instalado: true, ruta: rc, shell: 'bash' });
    expect(readFileSync(rc, 'utf8')).toContain('arcli completado bash');

    const removed = JSON.parse((await run(['completado', 'desinstalar', 'bash', '--json'])).stdout) as unknown;

    expect(removed).toMatchObject({ cambio: true, instalado: false });
    expect(readFileSync(rc, 'utf8')).not.toContain('arcli completado');
  });

  it('completes the subcommands and shells after completado', async () => {
    expect(await complete('completado', '')).toEqual(['instalar', 'desinstalar', 'bash', 'zsh', 'fish']);
    expect(await complete('completado', 'instalar', 'z')).toEqual(['zsh']);
  });
});

describe('arcli completado sin shell: el de $SHELL, en texto o --json', () => {
  let shell: string | undefined;

  beforeEach(() => {
    shell = process.env.SHELL;
  });

  afterEach(() => {
    process.env.SHELL = shell;
  });

  it('muestra si esta instalado en el shell de $SHELL, en texto y en JSON', async () => {
    process.env.SHELL = '/usr/bin/fish';

    const text = stripAnsi((await run(['completado'])).stdout);
    const json = JSON.parse((await run(['completado', '--json'])).stdout) as unknown;

    expect(text).toMatch(/fish/);
    expect(json).toMatchObject({ instalado: false, shell: 'fish' });
  });

  it('instala y desinstala en texto con el shell de $SHELL', async () => {
    process.env.SHELL = '/bin/zsh';

    const rc = resolveCompletionPath('zsh', currentCompletionEnvironment());
    const installed = stripAnsi((await run(['completado', 'instalar'])).stdout);

    expect(readFileSync(rc, 'utf8')).toContain('arcli completado zsh');
    expect(installed).toContain('zsh');

    await run(['completado', 'desinstalar']);

    expect(readFileSync(rc, 'utf8')).not.toContain('arcli completado');
  });

  it('si no reconoce $SHELL pide indicarlo, nombrando el que encontro', async () => {
    process.env.SHELL = '/bin/tcsh';
    expect((await run(['completado', 'instalar'])).error).toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining('(/bin/tcsh). Indicalo: bash, zsh o fish.'),
    });

    delete process.env.SHELL;
    expect((await run(['completado'])).error).toMatchObject({
      message: 'No se pudo saber qué shell usás. Indicalo: bash, zsh o fish.',
    });
  });
});

describe('arcli __completar sin candidatos', () => {
  it('no escribe nada si ninguna opcion empieza asi', async () => {
    expect((await run(['__completar', '--', 'fc', '--zzz'])).stdout).toBe('');
  });

  it.each([['verificarFce'], ['consultarPadron']])('la clave de sí o no %s ofrece si y no', async (key) => {
    expect(await complete('config', 'establecer', key, '')).toEqual(['si', 'no']);
  });

  // Tests primero (REV-78): pasa a it() al implementarlo.
  it.fails.each([['emitir'], ['json'], ['bruto']])('la clave de sí o no %s también ofrece si y no', async (key) => {
    expect(await complete('config', 'establecer', key, '')).toEqual(['si', 'no']);
  });

  it('una clave de config sin valores fijos no ofrece valores', async () => {
    expect(await complete('config', 'establecer', 'cuit', '')).toEqual([]);
  });

  it('completa monedas, alícuotas y comprobantes asociados', async () => {
    expect(await complete('fc', '--moneda', 'US')).toContain('USD');
    expect(await complete('fa', '--alicuota', '10')).toContain('10.5');
    expect(await complete('nca', '--ac', 'fc')).toContain('fc');
  });
});
