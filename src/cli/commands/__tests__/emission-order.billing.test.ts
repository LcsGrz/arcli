import { describe, expect, it, vi } from 'vitest';

import {
  batch,
  CLIENT_CUIT,
  DO_NOT_EMIT,
  EMIT,
  EMIT_WITH_PDF,
  FC,
  INSTALL,
  INSTALL_QUESTION,
  MAKE_PDF,
  PDF_QUESTION,
  runBilling,
  useEmissionSequence,
} from './emission-sequence.fixture';

/** El orden de `executeBillingCommand`: llamadas a ARCA, lo que se anota, salidas, preguntas y PDF (REV-50). */
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
vi.mock('../../interactive/list-select', () => ({ listSelect: vi.fn() }));

useEmissionSequence();

const ASK = { pdf: 'preguntar' };
const ALWAYS = { pdf: 'siempre' };
const QUESTION = 'pregunta: ¿Emitimos la factura C en testing?';
const BATCH_QUESTION = 'pregunta: ¿Emitimos los 2 comprobantes en testing?';
const CLIENT = ['--cs', '--cuit', String(CLIENT_CUIT)];

/** Pedir el número, emitir y anotarlo, sin nada en el medio. */
function emitted(number: number, amount: number, noted = `fc del punto de venta 3, ${number}`): string[] {
  return ['ARCA getNextVoucherNumber', `ARCA createVoucher ${number} por ${amount}`, `anotado: ${noted}`];
}

const FIRST = emitted(42, 1000);
const SECOND = emitted(43, 2000, 'fc del punto de venta 3, 42 y 43');

describe('un comprobante', () => {
  it.each([
    ['--previsualizar', [...FC, '--previsualizar'], {}, 'vista previa'],
    ['sin terminal', FC, {}, 'vista previa'],
    ['--json', FC, { json: true, tty: true }, 'JSON previsualizacion'],
  ])('vista previa, %s: una salida y nada más', async (_name, args, options, output) => {
    expect((await runBilling(args, options)).events).toEqual([`salida: ${output}`, 'fin: exit 0']);
  });

  it.each([DO_NOT_EMIT, 'Esc'])('"¿Emitimos?" con %s: avisa y sale con 0', async (answer) => {
    expect((await runBilling(FC, { answers: [answer], tty: true })).events).toEqual([
      'salida: vista previa',
      QUESTION,
      'salida: no se emitió nada',
      'fin: exit 0',
    ]);
  });

  it('"¿Emitimos?" con Ctrl+C: sale con 1', async () => {
    expect((await runBilling(FC, { answers: ['Ctrl+C'], tty: true })).events).toEqual([
      'salida: vista previa',
      QUESTION,
      'error: Cancelado. No se emitió nada.',
      'fin: exit 1',
    ]);
  });

  it('confirmado, sin PDF', async () => {
    expect((await runBilling(FC, { answers: [EMIT], config: ASK, tty: true })).events).toEqual([
      'salida: vista previa',
      QUESTION,
      ...FIRST,
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it('confirmado con PDF: el CAE, y después el PDF', async () => {
    expect((await runBilling(FC, { answers: [EMIT_WITH_PDF], tty: true })).events).toEqual([
      'salida: vista previa',
      QUESTION,
      ...FIRST,
      'salida: CAE',
      'PDF cargar',
      'PDF generar 42',
      'salida: PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('--emitir: el CAE, y después preguntar, instalar y generar el PDF', async () => {
    const { events } = await runBilling([...FC, '--emitir'], {
      answers: [MAKE_PDF, INSTALL],
      config: ASK,
      pluginInstalled: false,
      tty: true,
    });

    expect(events).toEqual([
      ...FIRST,
      'salida: CAE',
      PDF_QUESTION,
      INSTALL_QUESTION,
      'PDF instalar',
      'PDF cargar',
      'PDF generar 42',
      'salida: PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('--emitir, sin terminal: ni pregunta ni genera el PDF', async () => {
    expect((await runBilling([...FC, '--emitir'], { config: ASK })).events).toEqual([
      ...FIRST,
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it.each([
    ['stdin', [false, true]],
    ['stdout', [true, false]],
  ] as const)('--emitir, sin %s en una terminal: no hay a quién preguntar el PDF', async (_name, tty) => {
    expect((await runBilling([...FC, '--emitir'], { config: ASK, tty })).events).toEqual([
      ...FIRST,
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it.each([
    ['--bruto', ['--bruto'], false, true],
    ['bruto en la config', [], true, true],
    ['sin ninguno', [], false, false],
  ])('%s: la respuesta de ARCA en el JSON', async (_name, args, raw, shown) => {
    const { stdout } = await runBilling([...FC, '--emitir', ...args], { json: true, raw });

    expect('respuesta' in (JSON.parse(stdout) as object)).toBe(shown);
  });

  it('sin PDF, el aviso de los datos que solo van ahí sale después del CAE', async () => {
    const { events } = await runBilling([...FC, '--emitir', '--descripcion', 'Clase', '--sin-pdf']);

    // Sin nada en el medio, las dos salidas son una.
    expect(events).toEqual([...FIRST, 'salida: CAE, aviso de datos del PDF', 'fin: exit 0']);
  });

  it('--json: el PDF antes del único JSON, que lo trae', async () => {
    expect((await runBilling([...FC, '--emitir'], { config: ALWAYS, json: true, tty: true })).events).toEqual([
      ...FIRST,
      'PDF cargar',
      'PDF generar 42',
      'salida: JSON aprobado 42 con PDF',
      'fin: exit 0',
    ]);
  });

  it.each([
    ['texto', false, 'rechazado'],
    ['--json', true, 'JSON rechazado 42'],
  ])('rechazado, %s: se muestra, sin PDF y con exit 2', async (_name, json, output) => {
    expect((await runBilling([...FC, '--emitir'], { arca: ['R'], config: ALWAYS, json })).events).toEqual([
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 42 por 1000',
      `salida: ${output}`,
      'fin: exit 2',
    ]);
  });

  it.each(['incierta', 'ilegible'] as const)('respuesta %s: solo el error, sin reintentar', async (step) => {
    expect((await runBilling([...FC, '--emitir'], { arca: [step], config: ALWAYS })).events).toEqual([
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 42 por 1000',
      'error: EMISSION_UNCERTAIN',
      'fin: exit 1',
    ]);
  });

  it('si falla el número no llega a emitir, y no es una emisión sin confirmar', async () => {
    expect((await runBilling([...FC, '--emitir'], { arca: ['sin numero'] })).events).toEqual([
      'ARCA getNextVoucherNumber',
      'error: LoginFault',
      'fin: exit 1',
    ]);
  });

  // Lo mismo en la E no muestra el CAE: ver emission-order.export.test.ts.
  it('si la pregunta del PDF falla (no es una cancelación), el CAE ya se mostró', async () => {
    const { events } = await runBilling([...FC, '--emitir'], {
      answers: [new Error('falló la pregunta')],
      config: ASK,
      tty: true,
    });

    expect(events).toEqual([...FIRST, 'salida: CAE', PDF_QUESTION, 'error: falló la pregunta', 'fin: exit 1']);
  });
});

describe('lo que se consulta antes de la vista previa', () => {
  it('nota FCE de anulación: el asociado y su estado, una vez y antes de preguntar', async () => {
    const args = ['-m', '1000', ...CLIENT, '--ir-ri', '--ac', 'fcea', '--apv', '3', '--ar', '12', '--anulacion'];
    const { events } = await runBilling(args, {
      answers: [EMIT],
      issued: { documentNumber: CLIENT_CUIT, documentTypeCode: 80 },
      shortcut: 'ncea',
      tty: true,
    });

    expect(events).toEqual([
      'ARCA getVoucher',
      'ARCA getVoucherState',
      'salida: vista previa',
      'pregunta: ¿Emitimos la nota de crédito electrónica A en testing?',
      ...emitted(42, 1000, 'ncea del punto de venta 3, 42'),
      'salida: CAE',
      'fin: exit 0',
    ]);
  });

  it('lote en dólares con el padrón: cada uno entero, y el régimen FCE al final, con el lote ya validado', async () => {
    const path = batch(2, () => ({
      ivaReceptor: undefined,
      codigoMoneda: 'USD',
      numeroDocumento: CLIENT_CUIT,
      tipoDocumento: 'cuit',
    }));
    const { events } = await runBilling(['--cargar', path, '--previsualizar'], {
      config: { consultarPadron: true, verificarFce: true },
      shortcut: 'fa',
    });

    expect(events).toEqual([
      'ARCA getTaxpayer',
      'ARCA getQuotation',
      'ARCA getTaxpayer',
      'ARCA getQuotation',
      'ARCA getObligation',
      'ARCA getObligation',
      'salida: vista previa, vista previa',
      'fin: exit 0',
    ]);
  });

  it('con un inválido, se valida todo el lote sin consultar el régimen FCE ni emitir ninguno', async () => {
    const path = batch(3, (position) => ({
      codigoMoneda: 'USD',
      ...(position === 1 ? { fechaComprobante: '01/01/2026' } : {}),
    }));
    const { events } = await runBilling(['--cargar', path, '--emitir'], { config: { verificarFce: true } });

    expect(events).toEqual([
      'ARCA getQuotation',
      'ARCA getQuotation',
      'ARCA getQuotation',
      'error: BATCH_VALIDATION_ERROR',
      'fin: exit 1',
    ]);
  });
});

describe('un lote', () => {
  it('--emitir: de a uno, en orden; todos los CAE, una pregunta y los PDF', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], {
      answers: ['Sí, generar los PDFs'],
      config: ASK,
      tty: true,
    });

    expect(events).toEqual([
      ...FIRST,
      ...SECOND,
      'salida: CAE, CAE',
      'pregunta: ¿Generamos los PDFs de los 2 comprobantes?',
      'PDF cargar',
      'PDF generar 42',
      'PDF generar 43',
      'salida: PDF guardado, PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('confirmado con PDF: todas las vistas previas y una sola pregunta', async () => {
    const { events } = await runBilling(['--cargar', batch(2)], { answers: [EMIT_WITH_PDF], tty: true });

    expect(events).toEqual([
      'salida: vista previa, vista previa',
      BATCH_QUESTION,
      ...FIRST,
      ...SECOND,
      'salida: CAE, CAE',
      'PDF cargar',
      'PDF generar 42',
      'PDF generar 43',
      'salida: PDF guardado, PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('con "No" no se emite ninguno', async () => {
    expect((await runBilling(['--cargar', batch(2)], { answers: [DO_NOT_EMIT], tty: true })).events).toEqual([
      'salida: vista previa, vista previa',
      BATCH_QUESTION,
      'salida: no se emitió nada',
      'fin: exit 0',
    ]);
  });

  it('--json: todos los PDF antes del único JSON', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], { config: ALWAYS, json: true });

    expect(events).toEqual([
      ...FIRST,
      ...SECOND,
      'PDF cargar',
      'PDF generar 42',
      'PDF generar 43',
      'salida: JSON aprobado 42 con PDF, aprobado 43 con PDF',
      'fin: exit 0',
    ]);
  });

  it('si solo algunos dicen emitir, se emiten esos sin preguntar y el resto queda en vista previa', async () => {
    const path = batch(3, (position) => ({ emitir: position !== 1 }));

    expect((await runBilling(['--cargar', path], { config: ALWAYS, tty: true })).events).toEqual([
      ...FIRST,
      ...emitted(43, 3000, 'fc del punto de venta 3, 42 y 43'),
      'salida: CAE, vista previa, CAE',
      'PDF cargar',
      'PDF generar 42',
      'PDF generar 43',
      'salida: PDF guardado, PDF guardado',
      'fin: exit 0',
    ]);
  });

  it('un rechazado no corta: siguen los demás, con exit 2', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], { arca: ['R', 'A'], config: ALWAYS });

    expect(events).toEqual([
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 42 por 1000',
      ...emitted(42, 2000),
      'salida: rechazado, CAE',
      'PDF cargar',
      'PDF generar 42',
      'salida: PDF guardado',
      'fin: exit 2',
    ]);
  });
});

describe('un lote cortado en el medio', () => {
  it.each([
    ['sin confirmar', 'incierta', ['ARCA getNextVoucherNumber', 'ARCA createVoucher 43 por 3000']],
    ['antes de emitir', 'sin numero', ['ARCA getNextVoucherNumber']],
  ] as const)('%s: los procesados y sus PDF antes del error, y no sigue', async (_name, step, failing) => {
    const { events } = await runBilling(['--cargar', batch(4), '--emitir'], {
      arca: ['A', 'R', step],
      config: ALWAYS,
    });

    expect(events).toEqual([
      ...FIRST,
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
      ...failing,
      'salida: CAE, rechazado',
      'PDF cargar',
      'PDF generar 42',
      'salida: PDF guardado',
      'error: BATCH_EMISSION_ERROR',
      'fin: exit 1',
    ]);
  });

  it('--json: los procesados, con su PDF, en el JSON de stdout antes del error', async () => {
    const { events } = await runBilling(['--cargar', batch(3), '--emitir'], {
      arca: ['A', 'incierta'],
      config: ALWAYS,
      json: true,
    });

    expect(events).toEqual([
      ...FIRST,
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
      'PDF cargar',
      'PDF generar 42',
      'salida: JSON aprobado 42 con PDF',
      'error: BATCH_EMISSION_ERROR',
      'fin: exit 1',
    ]);
  });

  it('confirmado con PDF: lo mismo', async () => {
    const { events } = await runBilling(['--cargar', batch(2)], {
      answers: [EMIT_WITH_PDF],
      arca: ['A', 'incierta'],
      tty: true,
    });

    expect(events).toEqual([
      'salida: vista previa, vista previa',
      BATCH_QUESTION,
      ...FIRST,
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
      'salida: CAE',
      'PDF cargar',
      'PDF generar 42',
      'salida: PDF guardado',
      'error: BATCH_EMISSION_ERROR',
      'fin: exit 1',
    ]);
  });

  it('si falla la pregunta del PDF de los procesados, el aviso va después de su CAE y antes del error', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], {
      answers: [new Error('falló la pregunta')],
      arca: ['A', 'incierta'],
      config: ASK,
      tty: true,
    });

    expect(events).toEqual([
      ...FIRST,
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 43 por 2000',
      'salida: CAE',
      PDF_QUESTION,
      'stderr: no se pudieron mostrar',
      'error: BATCH_EMISSION_ERROR',
      'fin: exit 1',
    ]);
  });

  it('en el primero: no hay nada para mostrar', async () => {
    const { events } = await runBilling(['--cargar', batch(2), '--emitir'], { arca: ['incierta'], config: ALWAYS });

    expect(events).toEqual([
      'ARCA getNextVoucherNumber',
      'ARCA createVoucher 42 por 1000',
      'error: BATCH_EMISSION_ERROR',
      'fin: exit 1',
    ]);
  });
});
