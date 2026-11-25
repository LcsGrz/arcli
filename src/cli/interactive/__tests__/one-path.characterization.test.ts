import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArcaFceRegistryGateway } from '../../../services/arca/arca-fce-registry.gateway';
import { stripAnsi } from '../../../ui';
import { answerAssociated, CLIENT_CUIT, CLOCK_CONFIG, rejectWsfe, sdk } from '../../__tests__/clock.fixture';

import {
  EMIT,
  expectFinished,
  FA_STEPS,
  FC_ARGS,
  FC_STEPS,
  FE_ARGS,
  FE_STEPS,
  invoiceFlow,
  NO_OPTIONALS,
  NOTE_E_STEPS,
  noteEArgs,
  noteFlow,
  over,
  receiptFlow,
  repeatFlow,
  RI_ARGS,
  runAssistant,
  runCommand,
  SERVICES,
  TO_INVOICE,
  useOnePathFixture,
} from './one-path.fixture';
import type { Steps } from './one-path.prompts';

/**
 * REV-53: la misma entrada por el comando y por el asistente. Se compara lo que recibe ARCA, la vista previa (con sus
 * avisos, en orden), lo que queda anotado como emitido y lo que se muestra despues de emitir, byte a byte. Lo unico de
 * mas en el asistente es el comando equivalente, entre la vista previa y "¿Emitimos?". Los errores y las cancelaciones
 * estan en `one-path.outcomes.test.ts`.
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

interface Case {
  readonly after?: Steps;
  readonly args: readonly string[];
  readonly flow: () => Promise<unknown>;
  readonly prepare?: () => void;
  /** Sin "¿Emitimos?". */
  readonly steps: Steps;
  /** Los avisos de la vista previa, en orden. */
  readonly warnings?: readonly RegExp[];
}

const CBU = '0110599520000012345678';
const FOR_RI = { DocNro: CLIENT_CUIT, DocTipo: 80, ImpIVA: 21_000, ImpNeto: 100_000, ImpTotal: 121_000 };
const ONLY_THREE = { resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] } };
const QUERY_ERROR = { FECompConsultarResult: { Errors: { Err: [{ Code: 600, Msg: 'Fuera de rango' }] } } };
const inRegistry = () => {
  answerAssociated(FOR_RI);
  vi.spyOn(ArcaFceRegistryGateway.prototype, 'getVoucherState').mockResolvedValue('Aceptado');
};
const associatedArgs = (shortcut: string, number = '41', pointOfSale = '3') => [
  ...['--ac', shortcut, '--apv', pointOfSale, '--ar', number, '--afecha', '01/11/2026'],
];
const NOTE_FCE: Steps = [
  ...over('Factura de crédito electrónica A'),
  [/Total o parcial/, 'Parcial'],
  [/Monto de la nota de crédito/, '60,50'],
  [/Condición frente al IVA/, 'Responsable inscripto'],
];
/** El asociado escrito a mano que ARCA no tiene, en un punto de venta que no es de web service. */
const OTHER_SYSTEM_STEPS: Steps = [
  ...over('Factura C', TO_INVOICE, 'Ingresar el número a mano'),
  [/Punto de venta/, '50'],
  [/^Número/, '15'],
  [/^Fecha de la factura C 00050-00000015/, '01/11/2026'],
  [/A quién va la nota/, 'Consumidor final'],
  [/Qué concepto ajusta la nota/, 'Servicios'],
  [/Monto de la nota de/, '100'],
  NO_OPTIONALS,
];
const otherSystem = (answer: 'error' | 'missing') => () => {
  sdk.wsfe.getSalesPoints.mockResolvedValue(ONLY_THREE);
  answerAssociated({}, { missing: 15 });

  if (answer === 'error') {
    const found = sdk.generic.call.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;

    sdk.generic.call.mockImplementation(async (...args: unknown[]) =>
      (args[2] as { FeCompConsReq?: { PtoVta?: number } } | undefined)?.FeCompConsReq?.PtoVta === 50
        ? QUERY_ERROR
        : found(...args),
    );
  }
};
const otherSystemArgs = (shortcut: string) => [
  ...[shortcut, '-m', '100', '--cs', '--cfinal'],
  ...associatedArgs('fc', '15', '50'),
];
const withFutureDate = (steps: Steps, date = '12/11/2026'): Steps => [
  ...steps.slice(0, -1),
  [/Agregamos/, ['Fecha del comprobante']],
  [/^Fecha del comprobante/, date],
];
const FUTURE = ['--fecha', '12/11/2026'];

const CASES: ReadonlyArray<readonly [string, Case]> = [
  ['Factura A', { args: ['fa', '-m', '1000', '--cs', ...RI_ARGS], flow: invoiceFlow, steps: FA_STEPS }],
  [
    'Factura B',
    {
      args: ['fb', '-m', '1000', '--cs', '--cfinal'],
      flow: invoiceFlow,
      steps: [[/comprobante/, 'Factura B'], [/A quién/, 'Consumidor final'], ...SERVICES, NO_OPTIONALS],
    },
  ],
  ['Factura C', { args: FC_ARGS, flow: invoiceFlow, steps: FC_STEPS }],
  [
    'Factura C con fecha futura',
    {
      args: [...FC_ARGS, ...FUTURE],
      flow: invoiceFlow,
      steps: withFutureDate(FC_STEPS),
      warnings: [/\(12\/11\/2026\) es futura/],
    },
  ],
  [
    'FCE A',
    {
      after: [[/Guardamos el CBU/, 'No']],
      args: ['fcea', '-m', '5000000', '--cs', ...RI_ARGS, '--cbu', CBU],
      flow: invoiceFlow,
      steps: [
        [/comprobante/, 'Factura de crédito electrónica A'],
        ...FA_STEPS.slice(1, 5),
        [/Monto total/, '5000000'],
        [/^CBU/, CBU],
        [/Alias del CBU/, ''],
        NO_OPTIONALS,
      ],
    },
  ],
  [
    'Recibo C',
    {
      args: ['rc', '-m', '1000', '--cs', '--cfinal'],
      flow: receiptFlow,
      steps: [
        [/Qué recibo/, 'Recibo C'],
        [/A quién le hacés el recibo/, 'Consumidor final'],
        [/Qué estás cobrando/, 'Servicios'],
        [/Monto total/, '1000'],
        NO_OPTIONALS,
      ],
    },
  ],
  [
    'Nota de crédito A',
    {
      args: ['nca', '-m', '1210', '--cs', ...RI_ARGS, ...associatedArgs('fa')],
      flow: noteFlow('credito'),
      prepare: () => answerAssociated(FOR_RI),
      steps: [
        ...over('Factura A', TO_INVOICE),
        [/Total o parcial/, 'Parcial'],
        [/Monto de la nota de crédito/, '1210'],
        [/Condición frente al IVA/, 'Responsable inscripto'],
        NO_OPTIONALS,
      ],
    },
  ],
  [
    'Nota de débito C',
    {
      args: ['ndc', '-m', '100', '--cs', '--cfinal', ...associatedArgs('fc')],
      flow: noteFlow('debito'),
      steps: [...over('Factura C', TO_INVOICE), [/Monto de la nota de débito/, '100'], NO_OPTIONALS],
    },
  ],
  [
    'Nota de crédito C que anula el total',
    {
      args: ['ncc', '-m', '5000', '--cs', '--cfinal', ...associatedArgs('fc')],
      flow: noteFlow('credito'),
      steps: [...over('Factura C', TO_INVOICE), [/Total o parcial/, 'Anular el total'], NO_OPTIONALS],
    },
  ],
  [
    'Nota de crédito C sobre otro sistema',
    {
      args: otherSystemArgs('ncc'),
      flow: noteFlow('credito'),
      prepare: otherSystem('missing'),
      steps: OTHER_SYSTEM_STEPS,
      warnings: [/No se encontró la factura C 00050-00000015 en ARCA.*no lo supere/],
    },
  ],
  [
    'Nota de débito C sobre otro sistema',
    {
      args: otherSystemArgs('ndc'),
      flow: noteFlow('debito'),
      prepare: otherSystem('missing'),
      steps: OTHER_SYSTEM_STEPS,
      warnings: [/No se encontró la factura C 00050-00000015 en ARCA(?!.*no lo supere)/],
    },
  ],
  [
    'Nota de crédito C sobre otro sistema, con un error de ARCA al consultarlo',
    {
      args: otherSystemArgs('ncc'),
      flow: noteFlow('credito'),
      prepare: otherSystem('error'),
      steps: OTHER_SYSTEM_STEPS,
      warnings: [/No se pudo consultar la factura C 00050-00000015 en ARCA \(.*600/],
    },
  ],
  [
    'Nota de crédito C sobre otro sistema, con fecha futura: primero el asociado',
    {
      args: [...otherSystemArgs('ncc'), ...FUTURE],
      flow: noteFlow('credito'),
      prepare: otherSystem('missing'),
      steps: withFutureDate(OTHER_SYSTEM_STEPS),
      warnings: [/No se encontró la factura C/, /\(12\/11\/2026\) es futura/],
    },
  ],
  [
    'Nota de crédito FCE A que no es de anulación',
    {
      args: ['ncea', '-m', '60,50', '--cs', ...RI_ARGS, ...associatedArgs('fcea')],
      flow: noteFlow('credito'),
      prepare: inRegistry,
      steps: [...NOTE_FCE, [/rechazó la factura/, 'No'], NO_OPTIONALS],
    },
  ],
  [
    'Nota de crédito FCE A de anulación, sin el rechazo en el Registro',
    {
      args: [
        'ncea',
        '-m',
        '60,50',
        '--cs',
        ...RI_ARGS,
        ...associatedArgs('fcea'),
        '--anulacion',
        '--fecha',
        '11/11/2026',
      ],
      flow: noteFlow('credito'),
      prepare: inRegistry,
      steps: withFutureDate([...NOTE_FCE, [/rechazó la factura/, 'Sí'], NO_OPTIONALS], '11/11/2026'),
      warnings: [/no rechazó la factura de crédito electrónica A 00003-00000041.*10154/, /\(11\/11\/2026\) es futura/],
    },
  ],
  [
    'Repetir una factura C',
    {
      args: ['fc', '-m', '5000', '--cs', '--cfinal'],
      flow: repeatFlow,
      steps: [
        [/Qué comprobante querés repetir/, 'Factura C'],
        [/Cuál repetimos/, '00003-00000041'],
        [/Mismo monto/, 'Sí'],
        [/Período del servicio/, 'Un solo día'],
        NO_OPTIONALS,
      ],
    },
  ],
  [
    'Factura C en dólares, pagada en dólares',
    {
      args: [...FC_ARGS, '--moneda', 'USD', '--misma-moneda'],
      flow: invoiceFlow,
      steps: [
        ...FC_STEPS.slice(0, -1),
        [/Agregamos/, ['Moneda']],
        [/Moneda del comprobante/, 'Dólares'],
        [/Cómo te pagan/, 'En dólares'],
        [/Monto total en USD/, '1000'],
        [/Agregamos/, ['Moneda']],
        [/Moneda del comprobante/, 'Dólares'],
        [/Cómo te pagan/, 'En dólares'],
      ],
    },
  ],
  ['Factura E', { args: FE_ARGS, flow: invoiceFlow, steps: FE_STEPS }],
  ['Nota de crédito E', { args: noteEArgs('nce'), flow: noteFlow('credito'), steps: NOTE_E_STEPS }],
  ['Nota de débito E', { args: noteEArgs('nde'), flow: noteFlow('debito'), steps: NOTE_E_STEPS }],
  [
    'Factura E con fecha futura',
    {
      args: [...FE_ARGS, ...FUTURE],
      flow: invoiceFlow,
      steps: withFutureDate(FE_STEPS),
      warnings: [/\(12\/11\/2026\) es futura/],
    },
  ],
];

/** Lo mismo por los dos caminos, confirmando. */
async function runBoth({ after = [], args, flow, prepare, steps }: Case) {
  const full: Steps = [...steps, EMIT, ...after];
  const command = await runCommand(args, { prepare, steps: [EMIT] });
  const assistant = await runAssistant(flow, { prepare, steps: full });

  expectFinished(command, [EMIT]);
  expectFinished(assistant, full);

  return { assistant, command };
}

/** Lo que se ve, sin colores ni marcos. */
const plain = (text: string) =>
  stripAnsi(text)
    .replace(/[^\p{L}\p{N}\p{P}$ ]/gu, ' ')
    .replace(/\s+/g, ' ');

describe('la misma entrada por el comando y por el asistente', () => {
  it.each(CASES)('%s', async (_name, onePath) => {
    const { assistant, command } = await runBoth(onePath);

    expect(assistant.requests).toHaveLength(1);
    expect(assistant.requests).toEqual(command.requests);
    expect(command.before).toHaveLength(1);
    expect(assistant.before.at(-2)).toBe(command.before[0]);
    expect(stripAnsi(assistant.before.at(-1) ?? '')).toContain('Esto equivale a:');
    expect(assistant.after).toEqual(command.after);
    expect(assistant.emitted).toHaveLength(1);
    expect(assistant.emitted).toEqual(command.emitted);

    const shown = plain(command.before[0] ?? '');
    const positions = (onePath.warnings ?? []).map((warning) => shown.search(warning));

    expect(positions, shown).not.toContain(-1);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });
});

describe('las consultas de la vista previa', () => {
  const NOTE_CASES = CASES.filter(([name]) => /^Nota de \S+ (A|C|FCE A)\b/.test(name));

  it.each(NOTE_CASES)('%s: el asociado ya leído no se consulta de nuevo', async (_name, { flow, prepare, steps }) => {
    const result = await runAssistant(flow, { prepare, steps: [...steps, EMIT] });

    expectFinished(result, [...steps, EMIT]);
    expect(result.previewQueries).toEqual([]);
  });

  it.each([
    ['ndc', ['ndc', '-m', '100', '--cs', '--cfinal', ...associatedArgs('fc')], 'FECompConsultar'],
    ['nce', noteEArgs('nce'), 'wsfex.getCmp'],
    ['nde', noteEArgs('nde'), 'wsfex.getCmp'],
  ])('%s: el comando consulta el asociado, una vez', async (_shortcut, args, query) => {
    const { previewQueries } = await runCommand(args, { steps: [EMIT] });

    expect(previewQueries.filter((name) => name === query)).toHaveLength(1);
  });

  const NOTES_E: ReadonlyArray<readonly ['nce' | 'nde', 'credito' | 'debito']> = [
    ['nce', 'credito'],
    ['nde', 'debito'],
  ];

  // Tests primero (REV-53): pasa a it() al implementarlo. La solicitud y la vista previa, con los defaults del asociado,
  // las compara con las del comando "Nota de crédito E" y "Nota de débito E", arriba.
  it.fails.each(NOTES_E)('%s: el asistente no vuelve a consultar el asociado ya leído', async (shortcut, kind) => {
    const steps: Steps = [...NOTE_E_STEPS, EMIT];
    const command = await runCommand(noteEArgs(shortcut), { steps: [EMIT] });
    const assistant = await runAssistant(noteFlow(kind), { steps });

    expectFinished(assistant, steps);
    expect(assistant.requests).toEqual(command.requests);
    expect(assistant.previewQueries).not.toContain('wsfex.getCmp');
  });
});

describe('lo que contesta ARCA', () => {
  const answerExport = (auth: object) =>
    sdk.wsfex.authorize.mockImplementation(
      async ({ Cmp }: { Cmp: { Cbte_nro: number; Cbte_Tipo: number; Fecha_cbte: string; Id: number } }) => ({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
          FEXEvents: { EventCode: 0, EventMsg: 'OK' },
          FEXResultAuth: {
            Cbte_nro: Cmp.Cbte_nro,
            Cbte_tipo: Cmp.Cbte_Tipo,
            Cuit: 20123456786,
            Fch_cbte: Cmp.Fecha_cbte,
            Fch_venc_Cae: '',
            Id: Cmp.Id,
            Punto_vta: 3,
            Reproceso: 'N',
            ...auth,
          },
        },
      }),
    );
  const observe = async (request: { CbteDesde: number }) => ({
    cae: '76463926585341',
    caeFchVto: '20261121',
    response: {
      FeDetResp: {
        FECAEDetResponse: [
          { CbteDesde: request.CbteDesde, Observaciones: { Obs: [{ Code: 10217, Msg: 'Ojo' }] }, Resultado: 'A' },
        ],
      },
    },
  });

  it.each<[string, Case]>([
    [
      'Factura C',
      {
        args: FC_ARGS,
        flow: invoiceFlow,
        prepare: () => sdk.wsfe.createVoucher.mockImplementation(observe),
        steps: FC_STEPS,
      },
    ],
    [
      'Factura E',
      {
        args: FE_ARGS,
        flow: invoiceFlow,
        prepare: () =>
          answerExport({ Cae: '76463926585399', Fch_venc_Cae: '20261121', Motivos_Obs: '01 Ojo', Resultado: 'A' }),
        steps: FE_STEPS,
      },
    ],
  ])('%s observada: se muestra y queda anotada igual', async (_name, onePath) => {
    const { assistant, command } = await runBoth(onePath);

    expect(stripAnsi(assistant.after.join(''))).toMatch(/OBSERVAD[^]*Ojo/);
    expect(assistant.after).toEqual(command.after);
    expect(assistant.emitted).toHaveLength(1);
    expect(assistant.emitted).toEqual(command.emitted);
  });

  it.each<[string, Case]>([
    [
      'Factura C',
      {
        args: FC_ARGS,
        flow: invoiceFlow,
        prepare: () => sdk.wsfe.createVoucher.mockImplementation(rejectWsfe),
        steps: FC_STEPS,
      },
    ],
    [
      'Factura E',
      {
        args: FE_ARGS,
        flow: invoiceFlow,
        prepare: () => answerExport({ Cae: '', Motivos_Obs: '1500 Fecha', Resultado: 'R' }),
        steps: FE_STEPS,
      },
    ],
  ])('%s rechazada: se muestra igual, nada queda anotado y solo el comando sale con 2', async (_name, onePath) => {
    const { assistant, command } = await runBoth(onePath);

    expect(stripAnsi(assistant.after.join(''))).toContain('RECHAZAD');
    expect(assistant.after).toEqual(command.after);
    expect([assistant.emitted, command.emitted]).toEqual([[], []]);
    // El asistente sigue abierto: el codigo de salida es solo del comando.
    expect([assistant.exitCode, command.exitCode]).toEqual([undefined, 2]);
  });
});

describe('`bruto` de la config solo cambia los comandos (docs/modo-interactivo.md)', () => {
  beforeEach(() => {
    profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, output: { brutoPorDefecto: true } }));
  });

  it.each<[string, Case]>([
    ['Factura C', { args: FC_ARGS, flow: invoiceFlow, steps: FC_STEPS }],
    ['Factura E', { args: FE_ARGS, flow: invoiceFlow, steps: FE_STEPS }],
  ])('%s: solo el comando muestra la respuesta cruda', async (_name, onePath) => {
    const { assistant, command } = await runBoth(onePath);

    expect(assistant.requests).toEqual(command.requests);
    expect(command.after.join('')).toMatch(/FeDetResp|FEXResultAuth/);
    expect(assistant.after.join('')).not.toMatch(/FeDetResp|FEXResultAuth/);
  });
});
