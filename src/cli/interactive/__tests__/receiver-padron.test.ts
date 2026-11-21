import { describe, expect, it, vi } from 'vitest';

import { askReceiverIvaCondition } from '../receiver-padron';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

// REV-65: una condicion recordada que la letra ya no admite no queda marcada; arranca en la de la config.
describe('askReceiverIvaCondition', () => {
  const session = { runtime: { config: { consultarPadron: false } } } as unknown as InteractiveSession;

  it('lo elegido antes arranca marcado si la letra lo admite', async () => {
    script = createScript([[/Condición frente al IVA/, 'Responsable monotributo']]);

    await askReceiverIvaCondition(session, {}, 'a', 'responsable-inscripto', 'responsable-monotributo');

    expect(script.chooseStep.mock.calls[0]?.[2]).toBe('responsable-monotributo');
  });

  it('si la letra ya no lo admite, arranca en la de la config', async () => {
    script = createScript([[/Condición frente al IVA/, 'Responsable inscripto']]);

    await askReceiverIvaCondition(session, {}, 'a', 'responsable-inscripto', 'consumidor-final');

    expect(script.chooseStep.mock.calls[0]?.[2]).toBe('responsable-inscripto');
  });
});
