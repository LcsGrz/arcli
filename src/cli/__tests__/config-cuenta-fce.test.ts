import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../ui';
import { createProgram } from '../program';

import { CLIENT_CUIT, CLOCK_CONFIG, useClockFixture } from './clock.fixture';

/** `cbu` y `aliasCbu` están deprecadas como claves de `config establecer`: usarlas en una FCE no avisa. */

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../spinner', () => ({
  startSpinner: () => null,
  withSpinner: (_text: unknown, run: () => unknown) => run(),
}));

const profile = useClockFixture();
const ACCOUNT = { aliasCbu: 'mi.alias.cbu', cbu: '0110599520000012345678' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FCE con cbu y aliasCbu guardados', () => {
  it.each([[['--json']], [[]]])('los usa sin aviso de deprecado, con %j', async (flags) => {
    profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, ...ACCOUNT }));

    let stdout = '';
    let stderr = '';

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);

      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);

      return true;
    });
    await createProgram().parseAsync([
      ...['node', 'arcli', 'fcea', '-m', '5000000', '--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'],
      ...['--previsualizar', ...flags],
    ]);

    expect(stripAnsi(stdout)).toContain(ACCOUNT.cbu);
    expect(stripAnsi(stdout)).toContain(ACCOUNT.aliasCbu);
    expect(`${stdout}${stderr}`).not.toMatch(/deprecad/);
  });
});
