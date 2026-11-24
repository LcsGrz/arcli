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

/** REV-52: cambiar el CBU en "Configuración" hace lo mismo que `config establecer cbu`. */

const CBU = '0110599520000012345678';
const OTHER_CBU = '0170099220000067797370';

let directory = '';
let output = '';

function withConfig<T>(run: (service: ConfigService) => T): T {
  const service = new ConfigService();

  try {
    return run(service);
  } finally {
    service.close();
  }
}

async function changeCbu(cbu: string): Promise<void> {
  vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
  vi.mocked(chooseStep)
    .mockImplementationOnce(
      async (_message, choices) =>
        choices
          .map((choice) => ('value' in choice ? choice.value : undefined))
          .find((value) => (value as { key?: string } | undefined)?.key === 'cbu') as never,
    )
    .mockResolvedValueOnce(BACK);
  vi.mocked(askTextStep).mockResolvedValueOnce(cbu);

  await runConfigMenu();
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-config-flow-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
  withConfig((service) => service.setValue('aliasCbu', 'mi.alias.cbu'));
});

afterEach(() => {
  vi.mocked(process.stdout.write).mockRestore();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe('cambiar el CBU en "Configuración" con un alias guardado', () => {
  it('con otro CBU borra el alias y lo dice', async () => {
    withConfig((service) => service.setValue('cbu', CBU));

    await changeCbu(OTHER_CBU);

    const config = withConfig((service) => service.getConfig());

    expect(config.cbu).toBe(OTHER_CBU);
    expect(config.aliasCbu).toBeUndefined();
    expect(stripAnsi(output)).toContain('Se borró el alias');
  });

  it('sin CBU guardado, el alias queda y avisa que se va a usar', async () => {
    await changeCbu(CBU);

    expect(withConfig((service) => service.getConfig())).toMatchObject({ aliasCbu: 'mi.alias.cbu', cbu: CBU });
    expect(stripAnsi(output)).toContain('El alias guardado');
  });
});
