import { describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui';
import { answerAssociated, CLIENT_CUIT, CLOCK_CONFIG } from '../../__tests__/clock.fixture';

import {
  DO_NOT_EMIT,
  expectFinished,
  FA_STEPS,
  FC_STEPS,
  FE_STEPS,
  invoiceFlow,
  NO_OPTIONALS,
  NOTE_E_STEPS,
  noteFlow,
  over,
  receiptFlow,
  repeatFlow,
  runAssistant,
  TO_INVOICE,
  useOnePathFixture,
} from './one-path.fixture';
import type { Steps } from './one-path.prompts';

/**
 * TUI-47: con `asistente.comandoEquivalente` en no, el asistente no muestra "Esto equivale a:" antes de "¿Emitimos?",
 * en ninguna familia; en sí o sin guardar, lo muestra como siempre. Se contesta "No" a "¿Emitimos?": nada se emite.
 * La configuración por comando está en `src/cli/__tests__/config.comando-equivalente.test.ts`.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../../spinner', async (original) => ({
  ...(await original<typeof import('../../spinner')>()),
  startSpinner: () => null,
}));
vi.mock('../prompts', async (original) =>
  (await import('./one-path.prompts')).scriptedPrompts(await original<typeof import('../prompts')>()),
);

const profile = useOnePathFixture();

interface Family {
  readonly flow: () => Promise<unknown>;
  readonly name: string;
  readonly prepare?: () => void;
  /** Sin "¿Emitimos?". */
  readonly steps: Steps;
}

const CBU = '0110599520000012345678';
const FOR_RI = { DocNro: CLIENT_CUIT, DocTipo: 80, ImpIVA: 21_000, ImpNeto: 100_000, ImpTotal: 121_000 };

const FAMILIES: readonly Family[] = [
  { flow: invoiceFlow, name: 'Factura A', steps: FA_STEPS },
  { flow: invoiceFlow, name: 'Factura C', steps: FC_STEPS },
  {
    flow: invoiceFlow,
    name: 'FCE A',
    steps: [
      [/comprobante/, 'Factura de crédito electrónica A'],
      ...FA_STEPS.slice(1, 5),
      [/Monto total/, '5000000'],
      [/^CBU/, CBU],
      [/Alias del CBU/, ''],
      NO_OPTIONALS,
    ],
  },
  {
    flow: receiptFlow,
    name: 'Recibo C',
    steps: [
      [/Qué recibo/, 'Recibo C'],
      [/A quién le hacés el recibo/, 'Consumidor final'],
      [/Qué estás cobrando/, 'Servicios'],
      [/Monto total/, '1000'],
      NO_OPTIONALS,
    ],
  },
  {
    flow: noteFlow('credito'),
    name: 'Nota de crédito A',
    prepare: () => answerAssociated(FOR_RI),
    steps: [
      ...over('Factura A', TO_INVOICE),
      [/Total o parcial/, 'Parcial'],
      [/Monto de la nota de crédito/, '1210'],
      [/Condición frente al IVA/, 'Responsable inscripto'],
      NO_OPTIONALS,
    ],
  },
  {
    flow: repeatFlow,
    name: 'Repetir una factura C',
    steps: [
      [/Qué comprobante querés repetir/, 'Factura C'],
      [/Cuál repetimos/, '00003-00000041'],
      [/Mismo monto/, 'Sí'],
      [/Período del servicio/, 'Un solo día'],
      NO_OPTIONALS,
    ],
  },
  { flow: invoiceFlow, name: 'Factura E', steps: FE_STEPS },
  { flow: noteFlow('credito'), name: 'Nota de crédito E', steps: NOTE_E_STEPS },
  { flow: noteFlow('debito'), name: 'Nota de débito E', steps: NOTE_E_STEPS },
];

/** La config de los tests de un solo camino, con `asistente.comandoEquivalente` si se pasa. */
function writeConfig(comandoEquivalente?: boolean): void {
  profile.writeConfig(
    profile.configWith(profile.healthy, {
      ...CLOCK_CONFIG,
      ...(comandoEquivalente === undefined ? {} : { asistente: { comandoEquivalente } }),
    }),
  );
}

/** Lo que muestra el asistente antes de "¿Emitimos?", sin colores. */
async function shownBeforeEmitting({ flow, prepare, steps }: Family): Promise<string> {
  const full: Steps = [...steps, DO_NOT_EMIT];
  const result = await runAssistant(flow, { prepare, steps: full });

  expectFinished(result, full);
  expect(result.requests).toEqual([]);

  return stripAnsi(result.before.join(''));
}

describe.each(FAMILIES)('$name', (family) => {
  it('sin la clave guardada, muestra el comando equivalente antes de "¿Emitimos?"', async () => {
    writeConfig();

    expect(await shownBeforeEmitting(family)).toContain('Esto equivale a:');
  });

  it('con `asistente.comandoEquivalente` en sí, lo muestra', async () => {
    writeConfig(true);

    expect(await shownBeforeEmitting(family)).toContain('Esto equivale a:');
  });
  it('con `asistente.comandoEquivalente` en no, no lo muestra, pero sí la vista previa', async () => {
    writeConfig(false);

    const shown = await shownBeforeEmitting(family);

    expect(shown).not.toContain('Esto equivale a:');
    expect(shown).toContain('SIN EMITIR');
  });
});
