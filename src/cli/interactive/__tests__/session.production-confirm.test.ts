import { Separator } from '@inquirer/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingCommandSchema } from '../../../modules/billing/billing.schemas';
import { BillingService } from '../../../modules/billing/billing.service';
import { systemClock } from '../../../services/time/system-clock';
import { billingAnswer } from '../../../testing/arca-answers';
import type { CliArcaRuntime } from '../../arca-runtime';
import { DO_NOT_EMIT_LABEL, EMIT_NOW_LABEL } from '../emission-prompt';
import { listSelect } from '../list-select';
import { confirm } from '../prompts';
import { EMIT_IN_PRODUCTION_LABEL, type InteractiveSession, previewAndEmit } from '../session';

/*
 * Sin mockear `confirm` ni `chooseOne` (TEST-21): solo la lista de abajo, que elige la opcion por su texto. Asi se
 * prueba que cada boton devuelve su valor; con "Sí" y "No" invertidos en `confirm`, "No, dejar sin emitir" emitiria.
 */
vi.mock('../list-select', () => ({ listSelect: vi.fn() }));
vi.mock('../pdf.flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf.flow')>()),
  offerPdf: vi.fn(async () => undefined),
}));

const selectMock = vi.mocked(listSelect);

/** Cada pregunta elige la opcion con ese texto, en orden. */
function pickByName(...names: string[]): string[] {
  const asked: string[] = [];

  for (const name of names) {
    selectMock.mockImplementationOnce(async (config) => {
      asked.push(config.message);
      const choice = config.choices.find(
        (item): item is { name: string; value: unknown } => !Separator.isSeparator(item) && item.name === name,
      );

      if (!choice) {
        throw new Error(`"${config.message}" no tiene la opcion "${name}"`);
      }

      return choice.value as never;
    });
  }

  return asked;
}

function createSession(environment: 'produccion' | 'testing') {
  const createVoucher = vi.fn(async () => billingAnswer({ cae: '86400940834693', response: {} }));
  const runtime = {
    config: { cert: {}, entornoPorDefecto: environment, key: {}, output: {}, pdf: 'nunca' },
    context: { cuit: 20333333334 },
    cuit: 20333333334,
    environment,
    outputJson: false,
    outputRaw: false,
    pointOfSale: 3,
  } as unknown as CliArcaRuntime;
  const session: InteractiveSession = {
    arca: {} as never,
    billingGateway: { createVoucher, getNextVoucherNumber: vi.fn(async () => 1), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime,
    service: new BillingService({ clock: systemClock }),
  };

  return { createVoucher, session };
}

const input = billingCommandSchema.parse({
  concept: 'servicios',
  ivaCondition: 'consumidor-final',
  shortcut: 'fc',
  totalAmount: 1000,
});

describe('confirmación de producción con el prompt real', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    selectMock.mockReset();
  });

  it('confirm devuelve true con la primera opción y false con la segunda', async () => {
    pickByName('Sí', 'No');
    expect(await confirm('¿Seguro?', 'Sí', 'No')).toBe(true);
    expect(await confirm('¿Seguro?', 'Sí', 'No')).toBe(false);
  });

  it('"No, dejar sin emitir" en la segunda confirmación de producción no emite', async () => {
    const { createVoucher, session } = createSession('produccion');
    const asked = pickByName(EMIT_NOW_LABEL, DO_NOT_EMIT_LABEL);

    await previewAndEmit(session, input);

    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('PRODUCCIÓN');
    expect(createVoucher).not.toHaveBeenCalled();
  });

  it('"Sí, emitir en producción" emite una sola vez', async () => {
    const { createVoucher, session } = createSession('produccion');

    pickByName(EMIT_NOW_LABEL, EMIT_IN_PRODUCTION_LABEL);
    await previewAndEmit(session, input);

    expect(createVoucher).toHaveBeenCalledTimes(1);
  });
});
