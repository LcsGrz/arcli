import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../../modules/billing/voucher-kind-map';
import type { ArcliConfig } from '../../../modules/config/config.schemas';
import { ConfigService } from '../../../modules/config/config.service';
import type { InvoiceState } from '../../../modules/interactive/invoice-input';
import { stripAnsi } from '../../../ui';
import { confirm } from '../prompts';
import { offerSavingCbu } from '../steps/cbu';

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  confirm: vi.fn(),
  isPromptCancellation: (error: unknown) => error instanceof Error && error.name === 'ExitPromptError',
}));

/** REV-52, cruce 2: guardar el CBU escrito a mano con un alias de otra cuenta en la config, hasta el archivo. */

const CBU = '0110599520000012345678';
const OLD_ALIAS = 'otra.cuenta';
const STATE: InvoiceState = {
  advanced: { currencyCode: 'ARS', sameCurrency: false },
  cbu: CBU,
  voucherKind: VOUCHER_KIND_MAP.fcea,
};

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

const saved = (): Pick<ArcliConfig, 'aliasCbu' | 'cbu'> => {
  const { aliasCbu, cbu } = withConfig((service) => service.getConfig());

  return { aliasCbu, cbu };
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-save-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);

    return true;
  });
  withConfig((service) => service.setValue('aliasCbu', OLD_ALIAS));
});

afterEach(() => {
  vi.mocked(process.stdout.write).mockRestore();
  vi.mocked(confirm).mockReset();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe('guardar el CBU con un alias de otra cuenta en la config', () => {
  it('sin alias escrito, lo pregunta, guarda el CBU, borra el alias y lo dice', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await offerSavingCbu(saved(), STATE, true);

    expect(vi.mocked(confirm).mock.calls[0]?.[0]).toBe(
      '¿Guardamos el CBU en la config para la próxima y borramos el alias otra.cuenta, que es de otro CBU?',
    );
    expect(saved()).toEqual({ aliasCbu: undefined, cbu: CBU });
    expect(stripAnsi(output).replace(/[\s│|]+/g, ' ')).toContain(
      'CBU guardado. Se borró el alias otra.cuenta de la config.',
    );
  });

  it.each([
    ['"No"', () => vi.mocked(confirm).mockResolvedValueOnce(false)],
    [
      'Ctrl+C',
      () => vi.mocked(confirm).mockRejectedValueOnce(Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' })),
    ],
  ])('%s no cambia nada', async (_name, answer) => {
    answer();

    await offerSavingCbu(saved(), STATE, true);

    expect(saved()).toEqual({ aliasCbu: OLD_ALIAS, cbu: undefined });
    expect(output).toBe('');
  });

  it('con alias escrito guarda los dos, sin aviso', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await offerSavingCbu(saved(), { ...STATE, cbuAlias: 'mi.alias.cbu' }, true);

    expect(saved()).toEqual({ aliasCbu: 'mi.alias.cbu', cbu: CBU });
    expect(output).toBe('');
  });

  it('si el CBU no se puede guardar, el alias queda', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await expect(offerSavingCbu(saved(), { ...STATE, cbu: '123' }, true)).rejects.toThrow();
    expect(saved()).toEqual({ aliasCbu: OLD_ALIAS, cbu: undefined });
  });
});
