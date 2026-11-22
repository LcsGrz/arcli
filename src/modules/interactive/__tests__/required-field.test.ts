import { describe, expect, it } from 'vitest';

import { CONSUMER_IDENTIFICATION_THRESHOLD } from '../../billing/billing.iva-receptor';
import type { InteractiveChoice } from '../choices';
import {
  consumerIdentificationNotice,
  type ConsumerIdentity,
  describeConsumerIdentity,
  isConsumerIdentified,
  reachesConsumerThreshold,
} from '../consumer-identification';
import { type OptionalDef, optionalGroup, type OptionalGroupDef, requiredOptional } from '../optional-group';
import { type FieldDef, requiredField } from '../required-field';
import { BACK, type Back, runWizard, type WizardStep } from '../wizard';

/**
 * El caso de la RG 5700/2025 sobre un flujo sintetico (no el del asistente): los datos del consumidor final son
 * opcionales por debajo del tope y obligatorios desde ahi. Se declaran una vez, como opcional con `required`.
 */
interface Flow {
  readonly consumer: ConsumerIdentity;
  readonly finalConsumer: boolean;
  readonly totalAmount?: number;
}

interface Context {
  readonly finalConsumer: boolean;
  readonly totalAmount?: number;
}

type Key = 'consumidor' | 'otro';
type Script = Array<number | string | typeof BACK>;

const BELOW = CONSUMER_IDENTIFICATION_THRESHOLD - 1;
const DNI = { consumerDocumentNumber: 30123456, consumerDocumentType: 'dni' } as const;

function consumerField(script: { number: Script; type: Script }) {
  const seen: Array<[string, unknown]> = [];
  const field: FieldDef<ConsumerIdentity, Context> = {
    available: (context) => context.finalConsumer,
    key: 'consumidor',
    required: (context) =>
      reachesConsumerThreshold({ totalAmount: context.totalAmount })
        ? { reason: consumerIdentificationNotice() }
        : undefined,
    steps: () => [
      {
        name: 'consumidor-documento',
        run: async (_current, { previous }) => {
          seen.push(['documento', previous?.consumerDocumentType]);

          const answer = script.type.shift();

          return answer === BACK ? BACK : { consumerDocumentNumber: undefined, consumerDocumentType: answer as 'dni' };
        },
      },
      {
        dependsOn: ['consumidor-documento'],
        name: 'consumidor-numero',
        run: async (_current, { previous }) => {
          seen.push(['numero', previous?.consumerDocumentNumber]);

          const answer = script.number.shift();

          return answer === BACK ? BACK : { consumerDocumentNumber: answer as number };
        },
      },
    ],
  };

  return { field, seen };
}

const lens = {
  context: (state: Flow): Context => ({ finalConsumer: state.finalConsumer, totalAmount: state.totalAmount }),
  read: (state: Flow) => state.consumer,
  write: (consumer: ConsumerIdentity) => ({ consumer }),
};

interface PickCall {
  readonly choices: ReadonlyArray<InteractiveChoice<Key>>;
  readonly selected: readonly Key[];
}

/**
 * Monto, opcionales, el dato como obligatorio si hace falta y un paso final que vuelve las veces que diga `backs`. Con
 * `before`, el obligatorio va antes de los opcionales; con `other`, el grupo tiene otro opcional, primero y sin preguntas.
 */
function flow(
  field: FieldDef<ConsumerIdentity, Context>,
  script: {
    amounts: Array<number | Back>;
    backs?: number;
    before?: boolean;
    other?: boolean;
    picks?: Array<Key[] | Back>;
  },
) {
  const notices: string[] = [];
  const picks: PickCall[] = [];
  const consumer: OptionalDef<Key, ConsumerIdentity, Context> = {
    ...field,
    describe: (current) => describeConsumerIdentity(current),
    key: 'consumidor',
    label: 'Datos del consumidor final',
    owns: ['consumerDocumentNumber', 'consumerDocumentType'],
  };
  const group: OptionalGroupDef<Flow, Key, ConsumerIdentity, Context> = {
    ...lens,
    message: '¿Agregamos algún opcional?',
    name: 'opcionales',
    options: [
      ...(script.other
        ? [
            {
              available: () => true,
              describe: () => '',
              key: 'otro' as const,
              label: 'Otro',
              owns: [],
              steps: () => [],
            },
          ]
        : []),
      consumer,
    ],
    pick: async (_message, choices, selected) => {
      picks.push({ choices, selected });

      return script.picks?.shift() ?? [...selected];
    },
  };
  let backs = script.backs ?? 0;
  const required = requiredOptional(group, {
    key: 'consumidor',
    name: 'consumidor-obligatorio',
    notice: (reason) => notices.push(reason),
    questions: ['consumidor-documento', 'consumidor-numero'],
  });
  const steps: Array<WizardStep<Flow>> = [
    {
      name: 'monto',
      run: async () => {
        const amount = script.amounts.shift();

        return amount === BACK ? BACK : { totalAmount: amount };
      },
    },
    ...(script.before ? [...required, optionalGroup(group)] : [optionalGroup(group), ...required]),
    {
      name: 'fin',
      run: async () => {
        backs -= 1;

        return backs >= 0 ? BACK : {};
      },
    },
  ];

  return { notices, picks, steps };
}

const INITIAL: Flow = { consumer: {}, finalConsumer: true };

describe('opcional obligatorio segun el contexto: datos del consumidor final (RG 5700/2025)', () => {
  it('debajo del tope es opcional: el grupo lo ofrece y no se pide', async () => {
    const { field, seen } = consumerField({ number: [], type: [] });
    const { notices, picks, steps } = flow(field, { amounts: [BELOW] });

    expect(await runWizard(steps, INITIAL)).toEqual({ ...INITIAL, totalAmount: BELOW });
    expect(picks.map(({ choices }) => choices.map((choice) => choice.value))).toEqual([['consumidor']]);
    expect(notices).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('desde el tope es obligatorio: el grupo no lo ofrece y se pide con el motivo', async () => {
    const { field } = consumerField({ number: [30123456], type: ['dni'] });
    const { notices, picks, steps } = flow(field, { amounts: [CONSUMER_IDENTIFICATION_THRESHOLD] });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    // Sin nada para ofrecer, el grupo no pregunta.
    expect(picks).toEqual([]);
    expect(notices).toEqual([consumerIdentificationNotice()]);
  });

  it('si ya se cargo como opcional, desde el tope no se vuelve a pedir', async () => {
    const { field, seen } = consumerField({ number: [30123456], type: ['dni'] });
    // Monto bajo, marca el consumidor y carga el DNI; vuelve hasta el monto y lo sube.
    const { notices, picks, steps } = flow(field, {
      amounts: [BELOW, CONSUMER_IDENTIFICATION_THRESHOLD],
      backs: 1,
      picks: [['consumidor'], BACK],
    });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(seen).toEqual([
      ['documento', undefined],
      ['numero', undefined],
    ]);
    expect(notices).toEqual([]);
    expect(picks).toHaveLength(2);
  });

  it('si baja el monto, lo cargado como obligatorio queda como opcional marcado con el DNI', async () => {
    const { field, seen } = consumerField({ number: [30123456, BACK, 30123456], type: ['dni', BACK, 'dni'] });
    // Monto alto: se pide el DNI. Desde el final vuelve, pregunta por pregunta (numero y documento), hasta el monto y
    // lo baja.
    const { picks, steps } = flow(field, {
      amounts: [CONSUMER_IDENTIFICATION_THRESHOLD, BELOW],
      backs: 1,
    });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(picks).toEqual([
      {
        choices: [{ description: 'DNI 30123456', name: 'Datos del consumidor final', value: 'consumidor' }],
        selected: ['consumidor'],
      },
    ]);
    // Obligatorio, al volver desde el final (escrito, primero el numero) y como opcional marcado (escrito).
    expect(seen).toEqual([
      ['documento', undefined],
      ['numero', undefined],
      ['numero', 30123456],
      ['documento', 'dni'],
      ['documento', 'dni'],
      ['numero', 30123456],
    ]);
  });

  it('lo cargado como obligatorio sigue marcado aunque se confirme la seleccion mientras es obligatorio', async () => {
    const { field, seen } = consumerField({ number: [30123456, BACK, 30123456], type: ['dni', BACK, 'dni'] });
    // Obligatorio antes del grupo: DNI; Enter en la seleccion (sin el consumidor); desde el final vuelve hasta el
    // monto (el numero y el documento se preguntan de nuevo y vuelven) y lo baja.
    const { notices, picks, steps } = flow(field, {
      amounts: [CONSUMER_IDENTIFICATION_THRESHOLD, BELOW],
      backs: 1,
      before: true,
      other: true,
      picks: [[], BACK],
    });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(picks.map(({ choices, selected }) => [choices.map((choice) => choice.value), selected])).toEqual([
      [['otro'], []],
      [['otro'], []],
      [['otro', 'consumidor'], ['consumidor']],
    ]);
    expect(notices).toHaveLength(2);
    expect(seen.at(-1)).toEqual(['numero', 30123456]);
  });

  it('antes del grupo, la primera vez se pide con el motivo', async () => {
    const { field } = consumerField({ number: [30123456], type: ['dni'] });
    const { notices, steps } = flow(field, { amounts: [CONSUMER_IDENTIFICATION_THRESHOLD], before: true, other: true });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(notices).toEqual([consumerIdentificationNotice()]);
  });

  it('si se vuelve desde el obligatorio sin terminarlo, lo escrito se ofrece al volver', async () => {
    const { field, seen } = consumerField({ number: [BACK, 30123456], type: ['dni', BACK, 'dni'] });
    const { steps } = flow(field, {
      amounts: [CONSUMER_IDENTIFICATION_THRESHOLD, CONSUMER_IDENTIFICATION_THRESHOLD],
      before: true,
    });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(seen).toEqual([
      ['documento', undefined],
      ['numero', undefined],
      ['documento', 'dni'],
      ['documento', 'dni'],
      ['numero', undefined],
    ]);
  });

  it('si se marco como opcional pero quedo a medias, desde el tope se pide', async () => {
    const { field, seen } = consumerField({ number: [30123456], type: [BACK, 'dni'] });
    // Monto bajo: marca el consumidor, vuelve desde el documento y desde la seleccion; sube el monto.
    const { notices, steps } = flow(field, {
      amounts: [BELOW, CONSUMER_IDENTIFICATION_THRESHOLD],
      other: true,
      picks: [['consumidor'], BACK, []],
    });

    expect((await runWizard(steps, INITIAL))?.consumer).toEqual(DNI);
    expect(notices).toEqual([consumerIdentificationNotice()]);
    expect(seen.map(([name]) => name)).toEqual(['documento', 'documento', 'numero']);
  });

  it('si el receptor no es consumidor final, no se ofrece ni se pide', async () => {
    const { field, seen } = consumerField({ number: [], type: [] });
    const { picks, steps } = flow(field, { amounts: [CONSUMER_IDENTIFICATION_THRESHOLD] });

    await runWizard(steps, { ...INITIAL, finalConsumer: false });

    expect(picks).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('falla al armarlo si el grupo no tiene ese opcional', () => {
    const group = { ...lens, message: '', name: 'opcionales', options: [], pick: async () => [] };

    expect(() =>
      requiredOptional<Flow, Key, ConsumerIdentity, Context>(group, {
        key: 'consumidor',
        name: 'x',
        notice: () => {},
        questions: [],
      }),
    ).toThrow('El grupo opcionales no tiene el opcional consumidor.');
  });
});

describe('requiredField: un dato obligatorio fuera de un grupo', () => {
  function steps(field: FieldDef<ConsumerIdentity, Context>, notices: string[]): Array<WizardStep<Flow>> {
    return [
      { name: 'monto', run: async () => ({ totalAmount: CONSUMER_IDENTIFICATION_THRESHOLD }) },
      requiredField({
        ...lens,
        answered: (state) => isConsumerIdentified(state.consumer),
        field,
        name: 'consumidor',
        notice: (reason) => notices.push(reason),
      }),
    ];
  }

  it('lo pide con el motivo si es obligatorio y no esta respondido', async () => {
    const notices: string[] = [];
    const { field } = consumerField({ number: [30123456], type: ['dni'] });

    expect((await runWizard(steps(field, notices), INITIAL))?.consumer).toEqual(DNI);
    expect(notices).toEqual([consumerIdentificationNotice()]);
  });

  it('no lo pide si no es obligatorio', async () => {
    const notices: string[] = [];
    const { field, seen } = consumerField({ number: [], type: [] });
    const [, consumer] = steps(field, notices);
    const below: Array<WizardStep<Flow>> = [
      { name: 'monto', run: async () => ({ totalAmount: BELOW }) },
      consumer as WizardStep<Flow>,
    ];

    expect((await runWizard(below, INITIAL))?.consumer).toEqual({});
    expect(seen).toEqual([]);
  });

  it('no lo pide si nunca es obligatorio', async () => {
    const notices: string[] = [];
    const { field, seen } = consumerField({ number: [], type: [] });
    const optional: FieldDef<ConsumerIdentity, Context> = {
      available: field.available,
      key: field.key,
      steps: field.steps,
    };

    await runWizard(steps(optional, notices), INITIAL);

    expect(seen).toEqual([]);
  });

  it('no lo pide si ya esta respondido', async () => {
    const notices: string[] = [];
    const { field, seen } = consumerField({ number: [], type: [] });

    expect((await runWizard(steps(field, notices), { ...INITIAL, consumer: DNI }))?.consumer).toEqual(DNI);
    expect(seen).toEqual([]);
  });

  it('Volver en la primera pregunta vuelve al paso anterior, y al volver se ofrece lo escrito', async () => {
    const notices: string[] = [];
    const { field, seen } = consumerField({ number: [BACK, 30123456], type: ['cuit', BACK, 'cuit'] });
    const amounts: Array<number | Back> = [CONSUMER_IDENTIFICATION_THRESHOLD, CONSUMER_IDENTIFICATION_THRESHOLD];
    const [, consumer] = steps(field, notices);
    const flowSteps: Array<WizardStep<Flow>> = [
      {
        name: 'monto',
        run: async () => {
          const amount = amounts.shift();

          return amount === BACK ? BACK : { totalAmount: amount };
        },
      },
      consumer as WizardStep<Flow>,
    ];

    await runWizard(flowSteps, INITIAL);

    expect(seen).toEqual([
      ['documento', undefined],
      ['numero', undefined],
      ['documento', 'cuit'],
      ['documento', 'cuit'],
      ['numero', undefined],
    ]);
  });
});
