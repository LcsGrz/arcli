import { describe, expect, it } from 'vitest';

import { CONSUMER_IDENTIFICATION_THRESHOLD } from '../../billing/billing.iva-receptor';
import {
  consumerIdentificationNotice,
  type ConsumerIdentity,
  describeConsumerIdentity,
  isConsumerIdentified,
  reachesConsumerThreshold,
} from '../consumer-identification';
import { type OptionalDef, optionalGroup } from '../optional-group';
import { type FieldDef, requiredField } from '../required-field';
import { BACK, type Back, runWizard, type WizardStep } from '../wizard';

/**
 * El caso de la RG 5700/2025 sobre un flujo sintetico (no el del asistente): los datos del consumidor final son
 * opcionales por debajo del tope y obligatorios desde ahi. Se declaran una vez y sirven para las dos cosas.
 */
interface Flow {
  readonly consumer: ConsumerIdentity;
  readonly finalConsumer: boolean;
  readonly totalAmount?: number;
}

interface Context {
  readonly finalConsumer: boolean;
}

type Script = Array<number | string | typeof BACK>;

function consumerField(script: { number: Script; type: Script }) {
  const seen: Array<[string, unknown]> = [];
  const steps = (): ReadonlyArray<WizardStep<ConsumerIdentity>> => [
    {
      name: 'consumidor-documento',
      run: async (_current, previous) => {
        seen.push(['documento', previous?.consumerDocumentType]);

        const answer = script.type.shift();

        return answer === BACK ? BACK : { consumerDocumentNumber: undefined, consumerDocumentType: answer as 'dni' };
      },
    },
    {
      dependsOn: ['consumidor-documento'],
      name: 'consumidor-numero',
      run: async (_current, previous) => {
        seen.push(['numero', previous?.consumerDocumentNumber]);

        const answer = script.number.shift();

        return answer === BACK ? BACK : { consumerDocumentNumber: answer as number };
      },
    },
  ];
  const field: FieldDef<Flow, ConsumerIdentity, Context> = {
    answered: (state) => isConsumerIdentified(state.consumer),
    available: (context) => context.finalConsumer,
    key: 'consumidor',
    required: (state) =>
      reachesConsumerThreshold({ totalAmount: state.totalAmount })
        ? { reason: consumerIdentificationNotice() }
        : undefined,
    steps,
  };

  return { field, seen };
}

const lens = {
  context: (state: Flow): Context => ({ finalConsumer: state.finalConsumer }),
  read: (state: Flow) => state.consumer,
  write: (consumer: ConsumerIdentity) => ({ consumer }),
};

/** Monto, opcionales y, despues, el dato como obligatorio si hace falta. */
function flow(
  field: FieldDef<Flow, ConsumerIdentity, Context>,
  amounts: Array<number | Back>,
  picks: Array<'consumidor'[]>,
) {
  const notices: string[] = [];
  const pickCalls: Array<readonly string[]> = [];
  const optional: OptionalDef<'consumidor', ConsumerIdentity, Context> = {
    ...field,
    key: 'consumidor',
    describe: (current) => describeConsumerIdentity(current),
    label: 'Datos del consumidor final',
    owns: ['consumerDocumentNumber', 'consumerDocumentType'],
  };
  const steps: Array<WizardStep<Flow>> = [
    {
      name: 'monto',
      run: async () => {
        const amount = amounts.shift();

        return amount === BACK ? BACK : { totalAmount: amount };
      },
    },
    optionalGroup<Flow, 'consumidor', ConsumerIdentity, Context>({
      ...lens,
      message: '¿Agregamos algún opcional?',
      name: 'opcionales',
      options: [optional],
      pick: async (_message, choices, selected) => {
        pickCalls.push(choices.map((choice) => choice.value));

        return picks.shift() ?? [...selected];
      },
    }),
    requiredField({
      ...lens,
      field,
      name: 'consumidor-obligatorio',
      notice: (reason) => notices.push(reason),
    }),
  ];

  return { notices, pickCalls, steps };
}

const INITIAL: Flow = { consumer: {}, finalConsumer: true };

describe('requiredField: datos del consumidor final (RG 5700/2025)', () => {
  it('debajo del tope es opcional: esta en el grupo y no se pide', async () => {
    const { field, seen } = consumerField({ number: [], type: [] });
    const { notices, pickCalls, steps } = flow(field, [CONSUMER_IDENTIFICATION_THRESHOLD - 1], [[]]);

    expect(await runWizard(steps, INITIAL)).toEqual({ ...INITIAL, totalAmount: CONSUMER_IDENTIFICATION_THRESHOLD - 1 });
    expect(pickCalls).toEqual([['consumidor']]);
    expect(notices).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('desde el tope es obligatorio: se pide con el motivo', async () => {
    const { field } = consumerField({ number: [30123456], type: ['dni'] });
    const { notices, steps } = flow(field, [CONSUMER_IDENTIFICATION_THRESHOLD], [[]]);

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual({
      consumerDocumentNumber: 30123456,
      consumerDocumentType: 'dni',
    });
    expect(notices).toEqual([consumerIdentificationNotice()]);
  });

  it('si ya se cargo como opcional, desde el tope no se vuelve a pedir', async () => {
    const { field, seen } = consumerField({ number: [30123456], type: ['dni'] });
    const { notices, steps } = flow(field, [CONSUMER_IDENTIFICATION_THRESHOLD], [['consumidor']]);

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual({
      consumerDocumentNumber: 30123456,
      consumerDocumentType: 'dni',
    });
    expect(seen).toHaveLength(2);
    expect(notices).toEqual([]);
  });

  it('si el receptor no es consumidor final, no se ofrece ni se pide', async () => {
    const { field, seen } = consumerField({ number: [], type: [] });
    const { pickCalls, steps } = flow(field, [CONSUMER_IDENTIFICATION_THRESHOLD], [[]]);

    await runWizard(steps, { ...INITIAL, finalConsumer: false });

    expect(pickCalls).toEqual([[]]);
    expect(seen).toEqual([]);
  });

  it('Volver desde la pregunta obligatoria vuelve al paso anterior, y al volver se ofrece lo escrito', async () => {
    const { field, seen } = consumerField({ number: [BACK, 30123456], type: ['cuit', BACK, 'cuit'] });
    const { steps } = flow(field, [CONSUMER_IDENTIFICATION_THRESHOLD], [[], []]);

    await runWizard(steps, INITIAL);

    expect(seen).toEqual([
      ['documento', undefined],
      ['numero', undefined],
      ['documento', 'cuit'],
      // Volver desde el documento lleva a los opcionales; al seguir, el tipo se ofrece de nuevo.
      ['documento', 'cuit'],
      ['numero', undefined],
    ]);
  });
});
