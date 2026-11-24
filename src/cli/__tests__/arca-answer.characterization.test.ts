import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportCliError } from '../error-output';
import { createProgram } from '../program';

import { approveWsfe, CLOCK_CONFIG, sdk, setClock, useClockFixture, type WsfeRequest } from './clock.fixture';

/**
 * Como se lee lo que devuelve el SDK a la llamada que emite (ARQ-4), por el comando entero: no importa en que capa se
 * lee. Solo lo que no fijan `json-golden.test.ts` (ERR-16, ERR-20) ni `billing-response`/`export.response`. Algunos
 * casos fijan rarezas de hoy: no son un pedido, pero cambiarlas es una decision, no un efecto del refactor.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);

const profile = useClockFixture();

beforeEach(() => {
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
  setClock(new Date('2026-11-10T15:00:00Z'));
});

const FC = ['fc', '-m', '1000', '--cs', '--cfinal'];
const FE = [
  ...['fe', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212', '-m', '1500'],
  ...['--moneda', 'PES'],
];
const CAE = '76463926585341';
const OTHER_CAE = '76463926585399';
const DUE = '20261121';
const VALIDATION = { Code: 10016, Msg: 'El número no es el próximo a autorizar' };
const INTERNAL = { Code: 501, Msg: 'Error interno de base de datos' };
const NO_DETAIL = 'ARCA no informó el detalle.';
const UNEXPECTED = /^hubo un error inesperado al emitir \(Cannot read properties of (undefined|null)/;
const BAD_CAE = 'el CAE de la respuesta no es un texto ni un número';
const EMPTY = 'ARCA contestó sin CAE, sin resultado y sin errores';

/** Corre el comando como `index.ts`. `output` es el JSON de stdout y `error`, el de stderr. */
async function run(args: readonly string[]): Promise<{
  readonly code: number;
  readonly error: Record<string, unknown> | null;
  readonly output: Record<string, unknown> | null;
}> {
  try {
    await createProgram().parseAsync(['node', 'arcli', ...args, '--emitir', '--json']);
  } catch (error) {
    process.exitCode = reportCliError(error, true);
  }

  const parse = (text: string) => (text ? (JSON.parse(text) as Record<string, unknown>) : null);

  return { code: Number(process.exitCode ?? 0), error: parse(profile.stderr), output: parse(profile.stdout) };
}

type Expected =
  /** El motivo de `EMISSION_UNCERTAIN`. */
  | { readonly uncertain: RegExp | string }
  /** Campos del JSON: con `estado: 'rechazado'` sale con 2 y si no, con 0. */
  | { readonly shows: Record<string, unknown> };

const emitted = (shows: Record<string, unknown> = {}): Expected => ({
  shows: { cae: CAE, estado: 'observado', ...shows },
});
const rejected = (shows: Record<string, unknown> = {}): Expected => ({
  shows: { cae: null, caeVencimiento: null, estado: 'rechazado', ...shows },
});
const uncertain = (reason: RegExp | string): Expected => ({ uncertain: reason });

function pick(output: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, output[key]]));
}

async function expectAnswer(args: readonly string[], expected: Expected): Promise<void> {
  const { code, error, output } = await run(args);

  expect(sdk.wsfe.createVoucher.mock.calls.length + sdk.wsfex.authorize.mock.calls.length).toBe(1);

  if ('uncertain' in expected) {
    expect({ code, output }).toEqual({ code: 1, output: null });
    expect(error).toMatchObject({
      codigo: 'EMISSION_UNCERTAIN',
      sugerencia: expect.stringContaining('Puede haberse emitido igual.'),
    });

    const { causa } = error!.detalles as { causa: string };

    if (typeof expected.uncertain === 'string') {
      expect(causa).toBe(expected.uncertain);
    } else {
      expect(causa).toMatch(expected.uncertain);
    }

    return;
  }

  expect(error).toBeNull();
  expect(code).toBe(expected.shows.estado === 'rechazado' ? 2 : 0);
  expect(pick(output!, Object.keys(expected.shows))).toEqual(expected.shows);
}

/** Un objeto que falla al leer `key`. */
function throwing(key: string, rest: object = {}, message = 'no se pudo leer'): object {
  return Object.defineProperty({ ...rest }, key, {
    enumerable: true,
    get: () => {
      throw new Error(message);
    },
  });
}

describe('A, B y C', () => {
  const answer = (response: unknown, sdkResult: Record<string, unknown> = {}) => ({
    cae: CAE,
    caeFchVto: DUE,
    response,
    ...sdkResult,
  });
  const noCae = (response: unknown) => answer(response, { cae: '', caeFchVto: '' });
  const details = (FECAEDetResponse: unknown, root: Record<string, unknown> = {}) => ({
    ...root,
    FeDetResp: { FECAEDetResponse },
  });
  const APPROVED = { CAE, CAEFchVto: DUE, Resultado: 'A' };
  const approved = (detail: Record<string, unknown>, root: Record<string, unknown> = {}) =>
    answer(details([{ ...APPROVED, ...detail }], root));

  const ANSWERS: ReadonlyArray<readonly [string, unknown, Expected]> = [
    // La respuesta entera.
    ['undefined', undefined, uncertain(UNEXPECTED)],
    ['null', null, uncertain(UNEXPECTED)],
    ['un texto', 'OK', uncertain(EMPTY)],
    ['un objeto vacío', {}, uncertain(EMPTY)],
    ['una lista vacía', [], uncertain(EMPTY)],
    ['solo el CAE, sin response', { cae: CAE, caeFchVto: DUE }, emitted({ caeVencimiento: DUE, resultado: null })],
    ['response nulo, con CAE', answer(null), emitted({ errores: [], eventos: [] })],
    ['response de texto, con CAE', answer('x'), emitted()],
    ['response nulo, sin CAE', noCae(null), uncertain(EMPTY)],
    ['response de texto, sin CAE', noCae('x'), uncertain(EMPTY)],

    // El detalle.
    ...[
      ['FeDetResp nulo', { FeDetResp: null }],
      ['FeDetResp de texto', { FeDetResp: 'x' }],
      ['FeDetResp en una lista', { FeDetResp: [{ FECAEDetResponse: [APPROVED] }] }],
      ['un detalle nulo', details(null)],
      ['una lista de detalles vacía', details([])],
      ['una lista con un detalle nulo', details([null])],
      ['un detalle de texto', details('x')],
    ].flatMap(([name, response]): Array<readonly [string, unknown, Expected]> => [
      [`${String(name)}, con CAE`, answer(response), emitted({ caeVencimiento: DUE, resultado: null })],
      [`${String(name)}, sin CAE`, noCae(response), uncertain(EMPTY)],
    ]),
    [
      'dos detalles: vale el primero',
      noCae(details([APPROVED, { ...APPROVED, CAE: OTHER_CAE, Resultado: 'R' }])),
      emitted({ estado: 'aprobado' }),
    ],
    ['dos detalles, el primero rechazado', noCae(details([{ Resultado: 'R' }, APPROVED])), rejected()],
    ['un detalle suelto rechazado', noCae(details({ Resultado: 'R' })), rejected({ resultado: 'R' })],

    // El CAE: el de arriba o, sin él, el del detalle.
    ...[undefined, null, '', ' ', '0', 0].map((cae): readonly [string, unknown, Expected] => [
      `el CAE de arriba ${JSON.stringify(cae)}, con el del detalle`,
      answer(details([APPROVED]), { cae, caeFchVto: '' }),
      emitted({ caeVencimiento: DUE, estado: 'aprobado' }),
    ]),
    [
      'dos CAE distintos: vale el de arriba',
      approved({ CAE: OTHER_CAE, CAEFchVto: '20261130' }),
      emitted({ caeVencimiento: DUE, estado: 'aprobado' }),
    ],
    ['el CAE de arriba, con uno ilegible en el detalle', approved({ CAE: {} }), emitted({ estado: 'aprobado' })],
    ['uno ilegible arriba, con el del detalle', answer(details([APPROVED]), { cae: {} }), uncertain(BAD_CAE)],
    ['uno ilegible solo en el detalle', noCae(details([{ ...APPROVED, CAE: {} }])), uncertain(BAD_CAE)],
    [
      'un texto que no es un CAE solo en el detalle',
      noCae(details([{ ...APPROVED, CAE: 'NULL' }])),
      uncertain('el CAE de la respuesta no se puede leer'),
    ],
    [
      'el CAE del detalle como número',
      noCae(details([{ ...APPROVED, CAE: Number(CAE) }])),
      emitted({ estado: 'aprobado' }),
    ],
    [
      'el CAE con espacios: sin ellos',
      answer(details([APPROVED]), { cae: ` ${CAE} ` }),
      emitted({ estado: 'aprobado' }),
    ],
    ['el CAE en una lista', answer(details([APPROVED]), { cae: [CAE] }), uncertain(BAD_CAE)],
    [
      'el CAE de un rechazo, ilegible arriba',
      answer(details([{ Resultado: 'R' }]), { cae: {}, caeFchVto: '' }),
      rejected(),
    ],

    // El vencimiento: el de arriba salvo vacío.
    ...[undefined, null, '', 0].map((caeFchVto): readonly [string, unknown, Expected] => [
      `el vencimiento de arriba ${JSON.stringify(caeFchVto)}: el del detalle`,
      answer(details([APPROVED]), { caeFchVto }),
      emitted({ caeVencimiento: DUE, estado: 'aprobado' }),
    ]),
    [
      'el vencimiento de arriba ilegible: null, aunque esté en el detalle',
      answer(details([APPROVED]), { caeFchVto: 'x' }),
      emitted({ caeVencimiento: null, estado: 'aprobado' }),
    ],
    [
      'un rechazo con el vencimiento arriba: se muestra',
      answer(details([{ Resultado: 'R' }]), { cae: '' }),
      rejected({ caeVencimiento: DUE }),
    ],

    // El resultado: el del detalle o, para saber si se rechazó, el de la cabecera.
    ['la cabecera en A, sin el del detalle', answer({ FeCabResp: { Resultado: 'A' } }), emitted({ resultado: null })],
    ['la cabecera en A, sin CAE', noCae({ FeCabResp: { Resultado: 'A' } }), uncertain(EMPTY)],
    ...[undefined, null, '', ' ', {}].map((Resultado): readonly [string, unknown, Expected] => [
      `la cabecera en R y el detalle en ${JSON.stringify(Resultado)}`,
      noCae(details([{ Resultado }], { FeCabResp: { Resultado: 'R' } })),
      rejected({ resultado: null }),
    ]),
    ['la cabecera nula', noCae({ FeCabResp: null }), uncertain(EMPTY)],
    ['la cabecera de texto', noCae({ FeCabResp: 'R' }), uncertain(EMPTY)],
    ['la cabecera en una lista', noCae({ FeCabResp: [{ Resultado: 'R' }] }), uncertain(EMPTY)],
    [
      'la cabecera en R y el detalle con un número',
      noCae(details([{ Resultado: 0 }], { FeCabResp: { Resultado: 'R' } })),
      uncertain('ARCA contestó sin CAE, con el resultado 0 y sin errores'),
    ],
    [
      'un R con espacios no es un R',
      noCae(details([{ Resultado: ' R ' }])),
      uncertain('ARCA contestó sin CAE, con el resultado R y sin errores'),
    ],

    // Los errores.
    ...[null, 'x', [], { Err: null }, { Err: [] }].map((Errors): readonly [string, unknown, Expected] => [
      `los errores ${JSON.stringify(Errors)} no son un error`,
      approved({}, { Errors }),
      emitted({ errores: [], estado: 'aprobado' }),
    ]),
    [
      'errores de varias formas, en orden',
      approved({}, { Errors: { Err: [VALIDATION, 'hola', null, 7, {}, { Msg: 'sin código' }] } }),
      emitted({
        errores: [
          { ...VALIDATION, codigo: 10016, mensaje: VALIDATION.Msg },
          { codigo: null, mensaje: 'hola' },
          { codigo: null, mensaje: NO_DETAIL },
          { codigo: null, mensaje: '7' },
          {},
          { Msg: 'sin código', mensaje: 'sin código' },
        ],
      }),
    ],
    [
      'un error con claves de más: pasan como vinieron',
      approved({}, { Errors: { Err: { ...VALIDATION, Otra: { a: 1 } } } }),
      emitted({ errores: [{ ...VALIDATION, Otra: { a: 1 }, codigo: 10016, mensaje: VALIDATION.Msg }] }),
    ],
    ['un error suelto con el código como texto', noCae({ Errors: { Err: { Code: '10016', Msg: 'x' } } }), rejected()],
    [
      'un error nulo, sin CAE',
      noCae({ Errors: { Err: [null] } }),
      uncertain(`ARCA contestó sin CAE, sin resultado y con errores: ${NO_DETAIL}`),
    ],
    [
      'un error de texto, sin CAE',
      noCae({ Errors: { Err: 'hola' } }),
      uncertain('ARCA contestó sin CAE, sin resultado y con errores: hola'),
    ],
    [
      'un error con el código ilegible, sin CAE',
      noCae({ Errors: { Err: { Code: {}, Msg: 'x' } } }),
      uncertain('ARCA contestó sin CAE, sin resultado y con errores: x'),
    ],
    [
      'un error interno y la cabecera en R',
      noCae({ Errors: { Err: INTERNAL }, FeCabResp: { Resultado: 'R' } }),
      rejected(),
    ],

    // Los eventos.
    ...[null, 'x', { Evt: null }, { Evt: [] }, { Evt: [null, null] }].map(
      (Events): readonly [string, unknown, Expected] => [
        `los eventos ${JSON.stringify(Events)} no son un evento`,
        approved({}, { Events }),
        emitted({ estado: 'aprobado', eventos: [] }),
      ],
    ),
    [
      'eventos de varias formas, en orden',
      approved({}, { Events: { Evt: [{ Code: 39, Msg: 'x' }, null, 'hola', {}] } }),
      emitted({
        estado: 'aprobado',
        eventos: [{ Code: 39, Msg: 'x', codigo: 39, mensaje: 'x' }, { codigo: null, mensaje: 'hola' }, {}],
      }),
    ],

    // Las observaciones.
    ...[null, 'x', [], { Obs: null }, { Obs: [] }, { Obs: 'x' }, { Obs: 7 }].map(
      (Observaciones): readonly [string, unknown, Expected] => [
        `las observaciones ${JSON.stringify(Observaciones)} no son una observación`,
        approved({ Observaciones }),
        emitted({ estado: 'aprobado', observacion: null, observaciones: [] }),
      ],
    ),
    [
      'observaciones de varias formas, en orden',
      approved({ Observaciones: { Obs: [{ Code: 1, Msg: 'a' }, null, { Code: 2 }, { Code: 3, Msg: 4 }] } }),
      emitted({ observacion: 'a | 4', observaciones: ['a', '4'] }),
    ],
  ];

  it.each(ANSWERS)('%s', async (_name, value, expected) => {
    sdk.wsfe.createVoucher.mockResolvedValue(value);

    await expectAnswer(FC, expected);
  });

  // Leer la respuesta es parte de la emisión: si falla, no se sabe si se emitió, aunque haya CAE.
  it.each<[string, object]>([
    ['la respuesta', throwing('response', { cae: CAE, caeFchVto: DUE })],
    ['el CAE', throwing('cae', answer(details([APPROVED])))],
    ['el vencimiento', throwing('caeFchVto', answer(details([APPROVED])))],
    ['FeDetResp', answer(throwing('FeDetResp'))],
    ['la lista de detalles', answer({ FeDetResp: throwing('FECAEDetResponse') })],
    ['el resultado', answer(details([throwing('Resultado', APPROVED)]))],
    ['el CAE del detalle', noCae(details([throwing('CAE', APPROVED)]))],
    ['el vencimiento del detalle', noCae(details([throwing('CAEFchVto', APPROVED)]))],
    ['las observaciones', answer(details([throwing('Observaciones', APPROVED)]))],
    ['la lista de observaciones', approved({ Observaciones: throwing('Obs') })],
    ['una observación', approved({ Observaciones: { Obs: [throwing('Msg')] } })],
    ['la cabecera, sin el resultado del detalle', answer(throwing('FeCabResp'))],
    ['el resultado de la cabecera', answer({ FeCabResp: throwing('Resultado') })],
    ['los errores', answer(throwing('Errors', details([APPROVED])))],
    ['la lista de errores', approved({}, { Errors: throwing('Err') })],
    ['un error', approved({}, { Errors: { Err: [throwing('Code')] } })],
    ['los eventos', answer(throwing('Events', details([APPROVED])))],
    ['la lista de eventos', approved({}, { Events: throwing('Evt') })],
  ])('falla al leer %s: EMISSION_UNCERTAIN, con su motivo', async (_name, value) => {
    sdk.wsfe.createVoucher.mockResolvedValue(value);

    await expectAnswer(FC, uncertain('no se pudo leer'));
  });

  it.each<[string, unknown]>([
    ['sin response', { cae: CAE, caeFchVto: DUE }],
    ['con claves que ARCLI no lee', { ...approved({ Otra: [null, { a: '' }] }, { Nueva: 0 }), extra: false }],
    ['con el CAE solo en el detalle', noCae(details([APPROVED]))],
    [
      'con el detalle suelto y los errores sueltos',
      approved({}, { Errors: { Err: VALIDATION }, Events: { Evt: 'x' } }),
    ],
    ['rechazada por la cabecera', noCae({ FeCabResp: { Resultado: 'R' }, Errors: { Err: [null] } })],
  ])('--bruto %s: la respuesta tal cual, con las claves en el mismo orden', async (_name, value) => {
    sdk.wsfe.createVoucher.mockResolvedValue(value);

    const { output } = await run([...FC, '--bruto']);

    expect(JSON.stringify(output!.respuesta)).toBe(JSON.stringify(value));
  });

  it('sin --bruto no sale la respuesta', async () => {
    expect((await run(FC)).output).not.toHaveProperty('respuesta');
  });

  it('en un lote con --bruto, cada uno con la suya', async () => {
    const values = await Promise.all([42, 43].map((CbteDesde) => approveWsfe({ CbteDesde } as WsfeRequest)));

    for (const value of values) {
      sdk.wsfe.createVoucher.mockResolvedValueOnce(value);
    }

    const item = { concepto: 'servicios', ivaReceptor: 'consumidor-final', tipoDocumento: 'consumidor-final' };
    const path = join(profile.configDirectory, 'lote.json');

    writeFileSync(path, JSON.stringify([1000, 2000].map((montoTotal) => ({ ...item, montoTotal }))));

    const { output } = await run(['fc', '--cargar', path, '--bruto']);

    expect((output as unknown as Array<{ respuesta: unknown }>).map(({ respuesta }) => respuesta)).toEqual(values);
  });
});

describe('E', () => {
  const OK = { FEXErr: { ErrCode: 0, ErrMsg: 'OK' }, FEXEvents: { EventCode: 0, EventMsg: 'OK' } };
  const AUTHORIZED = { Cae: CAE, Fch_venc_Cae: DUE, Motivos_Obs: '', Resultado: 'A' };
  const fex = (root: unknown) => ({ FEXAuthorizeResult: root });
  const approved = (authorization: Record<string, unknown>, root: Record<string, unknown> = {}) =>
    fex({ ...OK, FEXResultAuth: { ...AUTHORIZED, ...authorization }, ...root });
  const asApproved = (shows: Record<string, unknown> = {}) => emitted({ estado: 'aprobado', ...shows });
  const ERROR = { ErrCode: 1601, ErrMsg: 'x' };

  const ANSWERS: ReadonlyArray<readonly [string, unknown, Expected]> = [
    // La respuesta entera.
    ['undefined', undefined, uncertain(UNEXPECTED)],
    ['null', null, uncertain(UNEXPECTED)],
    ['un texto', 'OK', uncertain(EMPTY)],
    ['una lista vacía', [], uncertain(EMPTY)],
    ['el resultado nulo', fex(null), uncertain(EMPTY)],
    ['el resultado de texto', fex('x'), uncertain(EMPTY)],
    ['el resultado en una lista', fex([{ FEXResultAuth: AUTHORIZED }]), uncertain(EMPTY)],

    // La autorización.
    ...[null, [], [null], 'x'].map((FEXResultAuth): readonly [string, unknown, Expected] => [
      `la autorización ${JSON.stringify(FEXResultAuth)}`,
      fex({ ...OK, FEXResultAuth }),
      uncertain(EMPTY),
    ]),
    ['la autorización nula, con un error', fex({ FEXErr: ERROR, FEXResultAuth: null }), rejected({ resultado: null })],
    [
      'dos autorizaciones: vale la primera',
      fex({ ...OK, FEXResultAuth: [AUTHORIZED, { Cae: OTHER_CAE, Resultado: 'R' }] }),
      asApproved(),
    ],
    ['dos autorizaciones, la primera rechazada', fex({ FEXResultAuth: [{ Resultado: 'R' }, AUTHORIZED] }), rejected()],

    // El CAE, el vencimiento y el resultado.
    ['el CAE con espacios: sin ellos', approved({ Cae: ` ${CAE} ` }), asApproved()],
    ['el CAE en una lista', approved({ Cae: [CAE] }), uncertain(BAD_CAE)],
    ['un R con espacios es un R', approved({ Cae: '', Resultado: ' R ' }), rejected({ resultado: 'R' })],
    ['una A con espacios es una A', approved({ Resultado: ' A ' }), asApproved({ resultado: 'A' })],
    ['un resultado numérico', approved({ Resultado: 1 }), emitted({ resultado: '1' })],
    ['un rechazo con vencimiento', approved({ Cae: '0', Resultado: 'R' }), rejected()],
    ['sin vencimiento', approved({ Fch_venc_Cae: undefined }), asApproved({ caeVencimiento: null })],

    // Los errores.
    ...[undefined, null, [], [null], ''].map((FEXErr): readonly [string, unknown, Expected] => [
      `los errores ${JSON.stringify(FEXErr)} no son un error`,
      approved({}, { FEXErr }),
      asApproved({ errores: [] }),
    ]),
    ['un error nulo, sin CAE', fex({ FEXErr: [null] }), uncertain(EMPTY)],
    [
      'errores de varias formas, en orden y sin el OK',
      approved({}, { FEXErr: [ERROR, OK.FEXErr, ' hola ', 7, null, { ErrCode: '1602', ErrMsg: ' y ' }, {}] }),
      emitted({
        errores: [
          { code: 1601, codigo: 1601, mensaje: 'x', message: 'x' },
          { codigo: null, mensaje: 'hola' },
          { codigo: null, mensaje: '7' },
          { code: 1602, codigo: 1602, mensaje: 'y', message: 'y' },
          { codigo: null, mensaje: NO_DETAIL },
        ],
      }),
    ],
    ['un error con el código como texto', fex({ FEXErr: { ErrCode: '1601', ErrMsg: 'x' } }), rejected()],

    // Los eventos.
    ...[undefined, null, [], [null], '', {}, { EventCode: 0, EventMsg: 'x' }, { EventMsg: 'x' }].map(
      (FEXEvents): readonly [string, unknown, Expected] => [
        `los eventos ${JSON.stringify(FEXEvents)} no son un evento`,
        approved({}, { FEXEvents }),
        asApproved({ eventos: [] }),
      ],
    ),
    [
      'eventos de varias formas, en orden',
      approved({}, { FEXEvents: [{ EventCode: 1, EventMsg: ' x ' }, 'hola', 7] }),
      asApproved({
        eventos: [
          { code: 1, codigo: 1, mensaje: 'x', message: 'x' },
          { codigo: null, mensaje: 'hola' },
          { codigo: null, mensaje: '7' },
        ],
      }),
    ],
    [
      'un evento con el código como texto: sale como vino',
      approved({}, { FEXEvents: { EventCode: '1', EventMsg: 'x' } }),
      asApproved({ eventos: [{ code: '1', codigo: '1', mensaje: 'x', message: 'x' }] }),
    ],
    [
      'un evento con el código ilegible: sale como vino',
      approved({}, { FEXEvents: { EventCode: { a: 1 }, EventMsg: 'x' } }),
      asApproved({ eventos: [{ code: { a: 1 }, codigo: { a: 1 }, mensaje: 'x', message: 'x' }] }),
    ],

    // Los motivos.
    ...[undefined, null, [], ' ', [null, {}]].map((Motivos_Obs): readonly [string, unknown, Expected] => [
      `los motivos ${JSON.stringify(Motivos_Obs)} no son un motivo`,
      approved({ Motivos_Obs }),
      asApproved({ observacion: null, observaciones: [] }),
    ]),
    [
      'motivos de varias formas, en orden',
      approved({ Motivos_Obs: [' a ', 7, null, 'b'] }),
      emitted({ observacion: 'a | 7 | b', observaciones: ['a', '7', 'b'] }),
    ],
  ];

  it.each(ANSWERS)('%s', async (_name, value, expected) => {
    sdk.wsfex.authorize.mockResolvedValue(value);

    await expectAnswer(FE, expected);
  });

  it.each<[string, object]>([
    ['el resultado', throwing('FEXAuthorizeResult')],
    ['la autorización', fex(throwing('FEXResultAuth', OK))],
    ['el CAE', fex({ ...OK, FEXResultAuth: throwing('Cae', AUTHORIZED) })],
    ['el vencimiento', fex({ ...OK, FEXResultAuth: throwing('Fch_venc_Cae', AUTHORIZED) })],
    ['el resultado de la autorización', fex({ ...OK, FEXResultAuth: throwing('Resultado', AUTHORIZED) })],
    ['los motivos', fex({ ...OK, FEXResultAuth: throwing('Motivos_Obs', AUTHORIZED) })],
    ['los errores', fex(throwing('FEXErr', { FEXResultAuth: AUTHORIZED }))],
    ['un error', approved({}, { FEXErr: throwing('ErrCode') })],
    ['el texto de un error', approved({}, { FEXErr: throwing('ErrMsg', { ErrCode: 1 }) })],
    ['los eventos', fex(throwing('FEXEvents', { FEXResultAuth: AUTHORIZED }))],
    ['un evento', approved({}, { FEXEvents: throwing('EventCode') })],
  ])('falla al leer %s: EMISSION_UNCERTAIN, con su motivo', async (_name, value) => {
    sdk.wsfex.authorize.mockResolvedValue(value);

    await expectAnswer(FE, uncertain('no se pudo leer'));
  });

  // Solo la llamada se traduce a "no está autorizado": al leer, el texto queda como vino.
  it('un fallo al leer que menciona notAuthorized no se traduce', async () => {
    const message = 'ns1:coe.notAuthorized: x';

    sdk.wsfex.authorize.mockResolvedValue(throwing('FEXAuthorizeResult', {}, message));

    await expectAnswer(FE, uncertain(message));
  });

  it('la llamada sin autorización es incierta, con el motivo traducido', async () => {
    sdk.wsfex.authorize.mockRejectedValue(new Error('ns1:coe.notAuthorized: x'));

    await expectAnswer(FE, uncertain(/^El certificado no está autorizado/));
  });

  it.each<[string, unknown]>([
    ['rechazada', approved({ Cae: '', Motivos_Obs: 'x', Resultado: 'R' })],
    ['rechazada por un error, sin autorización', fex({ FEXErr: [ERROR] })],
    ['con claves que ARCLI no lee', { ...approved({ Otra: [null] }, { Nueva: 0 }), extra: false }],
    ['con la autorización en una lista', fex({ ...OK, FEXResultAuth: [AUTHORIZED] })],
  ])('--bruto %s: la respuesta tal cual, con las claves en el mismo orden', async (_name, value) => {
    sdk.wsfex.authorize.mockResolvedValue(value);

    const { output } = await run([...FE, '--bruto']);

    expect(JSON.stringify(output!.respuesta)).toBe(JSON.stringify(value));
  });

  it('sin --bruto no sale la respuesta', async () => {
    expect((await run(FE)).output).not.toHaveProperty('respuesta');
  });
});
