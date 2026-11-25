import { describe, expect, it, vi } from 'vitest';

import { checkAssociatedInArca, checkFceCancellationInRegistry } from '../billing.associated-lookup';
import { resolveBillingInput } from '../billing.input';
import type { BillingJsonInput } from '../billing.json-input';
import { BillingService } from '../billing.service';
import type { VoucherShortcut } from '../billing.types';
import type { BillingRuntime } from '../billing.types.internal';

/** ARQ-22 (14): sin `--apv`, el punto de venta del asociado es el de la nota, como en la E. */

const NOW = new Date('2026-11-10T15:00:00Z');
const EMITTER = 20123456786;
const runtime: BillingRuntime = { cuit: EMITTER, environment: 'testing', pointOfSale: 7 };
const service = new BillingService({ clock: { now: () => NOW } });

const CONSUMER: BillingJsonInput = {
  concepto: 'servicios',
  fechaComprobante: '10/11/2026',
  ivaReceptor: 'consumidor-final',
  montoTotal: 1000,
  tipoDocumento: 'consumidor-final',
};
const COMPANY: BillingJsonInput = {
  ...CONSUMER,
  ivaReceptor: 'responsable-inscripto',
  numeroDocumento: 30709965812,
  tipoDocumento: 'cuit',
};

const NOTES: ReadonlyArray<readonly [VoucherShortcut, string, BillingJsonInput]> = [
  ['nca', 'fa', COMPANY],
  ['nda', 'fa', COMPANY],
  ['ncb', 'fb', CONSUMER],
  ['ndb', 'fb', CONSUMER],
  ['ncc', 'fc', CONSUMER],
  ['ndc', 'rc', CONSUMER],
  ['ncea', 'fcea', COMPANY],
  ['ndea', 'fcea', COMPANY],
  ['ncec', 'fcec', COMPANY],
];

interface Layers {
  readonly file?: BillingJsonInput;
  readonly flags?: BillingJsonInput;
}

function resolve(shortcut: VoucherShortcut, { file, flags }: Layers) {
  return resolveBillingInput({
    defaults: { defaultPointOfSale: 7, emitterCuit: EMITTER },
    file,
    flags,
    now: NOW,
    shortcut,
  }).input;
}

const associatedOf = (shortcut: VoucherShortcut, layers: Layers) =>
  service.buildVoucherPayload(resolve(shortcut, layers), runtime).CbtesAsoc?.[0];

describe('sin --apv, el punto de venta del asociado es el de la nota', () => {
  it.each(NOTES)('%s: el de la config', (shortcut, atajo, base) => {
    expect(associatedOf(shortcut, { flags: { ...base, comprobanteAsociado: { atajo, numero: 5 } } })).toMatchObject({
      Nro: 5,
      PtoVta: 7,
    });
  });

  it.each(NOTES)('%s: el de --pv, y lo mismo con --cargar', (shortcut, atajo, base) => {
    const written = { ...base, comprobanteAsociado: { atajo, numero: 5 }, puntoVenta: 4 };

    expect(associatedOf(shortcut, { flags: written })).toMatchObject({ PtoVta: 4 });
    expect(associatedOf(shortcut, { file: written })).toMatchObject({ PtoVta: 4 });
  });

  it('con --at también, y --apv gana', () => {
    const at = { numero: 5, tipo: 11 };

    expect(associatedOf('ncc', { flags: { ...CONSUMER, comprobanteAsociado: at } })).toMatchObject({
      PtoVta: 7,
      Tipo: 11,
    });
    expect(
      associatedOf('ncc', { flags: { ...CONSUMER, comprobanteAsociado: { ...at, puntoVenta: 9 } } }),
    ).toMatchObject({ PtoVta: 9 });
  });

  it('`--ar` sobre el archivo deja el punto de venta del asociado del archivo', () => {
    expect(
      associatedOf('ncc', {
        file: { ...CONSUMER, comprobanteAsociado: { atajo: 'fc', numero: 1, puntoVenta: 2 } },
        flags: { comprobanteAsociado: { numero: 5 } },
      }),
    ).toMatchObject({ Nro: 5, PtoVta: 2 });
  });

  it('con período no hay asociado, y mezclarlos sigue siendo un error', () => {
    const period = { ...CONSUMER, periodoAsociado: { desde: '01/10/2026', hasta: '31/10/2026' } };

    expect(associatedOf('ncc', { flags: period })).toBeUndefined();
    expect(() => associatedOf('ncc', { file: { ...period, comprobanteAsociado: { atajo: 'fc', numero: 5 } } })).toThrow(
      'pero no ambos',
    );
  });

  it('de otro CUIT se sigue pidiendo: el de la nota no dice nada del otro emisor', () => {
    const withCuit = (cuit: string) => ({
      flags: { ...CONSUMER, comprobanteAsociado: { atajo: 'fc', cuit, numero: 5 } },
    });

    expect(() => associatedOf('ncc', withCuit('30709965812'))).toThrow(
      'Falta el punto de venta del comprobante asociado de la nota de crédito C. Usá `--apv <número>`',
    );
    expect(associatedOf('ncc', withCuit(String(EMITTER)))).toMatchObject({ PtoVta: 7 });
  });

  it('`--pv` de otro punto de venta que el del archivo: es otro asociado y la fecha del archivo no va', () => {
    const asociado = { atajo: 'fc', fecha: '01/10/2026', numero: 5 };
    const file = { ...CONSUMER, comprobanteAsociado: asociado, puntoVenta: 3 };

    expect(associatedOf('ncc', { file, flags: { puntoVenta: 4 } })).toEqual({
      Cuit: String(EMITTER),
      Nro: 5,
      PtoVta: 4,
      Tipo: 11,
    });
    expect(associatedOf('ncc', { file, flags: { puntoVenta: 3 } })).toMatchObject({ CbteFch: '20261001', PtoVta: 3 });
    // La escrita en el flag sí va, y con el punto de venta del asociado en el archivo nada cambia.
    expect(
      associatedOf('ncc', { file, flags: { comprobanteAsociado: { fecha: '02/10/2026' }, puntoVenta: 4 } }),
    ).toMatchObject({ CbteFch: '20261002', PtoVta: 4 });
    expect(
      associatedOf('ncc', {
        file: { ...file, comprobanteAsociado: { ...asociado, puntoVenta: 3 } },
        flags: { puntoVenta: 4 },
      }),
    ).toMatchObject({ CbteFch: '20261001', PtoVta: 3 });
  });

  it.each<[string, BillingJsonInput, BillingJsonInput, Record<string, unknown>]>([
    [
      '--apv distinto del `puntoVenta` del JSON',
      { puntoVenta: 3 },
      { comprobanteAsociado: { puntoVenta: 4 } },
      { PtoVta: 4 },
    ],
    ['--apv distinto del de la config', {}, { comprobanteAsociado: { puntoVenta: 4 } }, { PtoVta: 4 }],
    ['--pv distinto del de la config', {}, { puntoVenta: 4 }, { PtoVta: 4 }],
    ['--apv igual al de la config', {}, { comprobanteAsociado: { puntoVenta: 7 } }, { CbteFch: '20261001', PtoVta: 7 }],
    ['--pv igual al de la config', {}, { puntoVenta: 7 }, { CbteFch: '20261001', PtoVta: 7 }],
    [
      '--pv con --apv igual al del JSON',
      { puntoVenta: 3 },
      { comprobanteAsociado: { puntoVenta: 3 }, puntoVenta: 4 },
      { CbteFch: '20261001', PtoVta: 3 },
    ],
  ])('la fecha del archivo va solo si el punto de venta es el mismo: %s', (_name, file, flags, expected) => {
    const comprobanteAsociado = { atajo: 'fc', fecha: '01/10/2026', numero: 5 };

    expect(associatedOf('ncc', { file: { ...CONSUMER, ...file, comprobanteAsociado }, flags })).toEqual({
      Cuit: String(EMITTER),
      Nro: 5,
      Tipo: 11,
      ...expected,
    });
  });

  it.each<[string, BillingJsonInput['comprobanteAsociado']]>([
    ['otro número', { numero: 9 }],
    ['otro tipo', { atajo: 'ndc' }],
  ])('un CUIT ajeno del archivo descartado por %s no deja heredar el de la nota', (_name, comprobanteAsociado) => {
    const file = { ...CONSUMER, comprobanteAsociado: { atajo: 'fc', cuit: '30709965812', numero: 5 }, puntoVenta: 3 };

    expect(() => associatedOf('ncc', { file, flags: { comprobanteAsociado } })).toThrow('Falta el punto de venta');
    expect(() => associatedOf('ncc', { file, flags: { comprobanteAsociado, puntoVenta: 4 } })).toThrow(
      'Falta el punto de venta',
    );
    expect(
      associatedOf('ncc', { file, flags: { comprobanteAsociado: { ...comprobanteAsociado, puntoVenta: 4 } } }),
    ).toMatchObject({ Cuit: String(EMITTER), PtoVta: 4 });
    // Con el CUIT propio en el flag vuelve a ser del emisor.
    expect(
      associatedOf('ncc', { file, flags: { comprobanteAsociado: { ...comprobanteAsociado, cuit: String(EMITTER) } } }),
    ).toMatchObject({ PtoVta: 3 });
  });

  it('un asociado ajeno sin punto de venta, completado con --apv, conserva su CUIT y su fecha', () => {
    const file = {
      ...CONSUMER,
      comprobanteAsociado: { atajo: 'fc', cuit: '30709965812', fecha: '01/10/2026', numero: 5 },
      puntoVenta: 3,
    };

    expect(associatedOf('ncc', { file, flags: { comprobanteAsociado: { puntoVenta: 4 } } })).toEqual({
      CbteFch: '20261001',
      Cuit: '30709965812',
      Nro: 5,
      PtoVta: 4,
      Tipo: 11,
    });
  });

  it('`--acuit` propio sobre un CUIT ajeno del archivo: cambia de quién es y la fecha no va', () => {
    const comprobanteAsociado = { atajo: 'fc', cuit: '30709965812', fecha: '01/10/2026', numero: 5 };
    const build = (cuit: string, file: BillingJsonInput['comprobanteAsociado']) =>
      associatedOf('ncc', {
        file: { ...CONSUMER, comprobanteAsociado: file, puntoVenta: 3 },
        flags: { comprobanteAsociado: { cuit } },
      });

    expect(build(String(EMITTER), comprobanteAsociado)).toEqual({
      Cuit: String(EMITTER),
      Nro: 5,
      PtoVta: 3,
      Tipo: 11,
    });
    expect(build(String(EMITTER), { ...comprobanteAsociado, puntoVenta: 2 })).toEqual({
      Cuit: String(EMITTER),
      Nro: 5,
      PtoVta: 2,
      Tipo: 11,
    });
    expect(build('30709965812', { ...comprobanteAsociado, puntoVenta: 2 })).toMatchObject({ CbteFch: '20261001' });
  });

  it.each<[VoucherShortcut, string, string, BillingJsonInput]>([
    ['nca', 'fa', 'nda', COMPANY],
    ['ncb', 'fb', 'ndb', CONSUMER],
    ['ncc', 'fc', 'ndc', CONSUMER],
  ])('%s: con el CUIT ajeno descartado, su punto de venta del archivo tampoco va', (shortcut, atajo, other, base) => {
    const ajeno = { atajo, cuit: '30709965812', numero: 5, puntoVenta: 2 };
    const build = (comprobanteAsociado: BillingJsonInput['comprobanteAsociado']) => () =>
      associatedOf(shortcut, {
        file: { ...base, comprobanteAsociado: ajeno, puntoVenta: 3 },
        flags: { comprobanteAsociado },
      });

    for (const elsewhere of [{ numero: 9 }, { atajo: other }]) {
      expect(build(elsewhere)).toThrow('Falta el punto de venta');
      expect(build({ ...elsewhere, puntoVenta: 4 })()).toMatchObject({ Cuit: String(EMITTER), PtoVta: 4 });
      expect(build({ ...elsewhere, cuit: String(EMITTER) })()).toMatchObject({ Cuit: String(EMITTER), PtoVta: 3 });
      // El mismo ajeno, repetido: sigue siendo de ese emisor.
      expect(build({ ...elsewhere, cuit: '30709965812' })()).toMatchObject({ Cuit: '30709965812', PtoVta: 2 });
    }
  });

  it('FCE: con el CUIT ajeno descartado, también falta el punto de venta', () => {
    const file = {
      ...COMPANY,
      comprobanteAsociado: { atajo: 'fcea', cuit: '30709965812', numero: 5, puntoVenta: 2 },
      puntoVenta: 3,
    };

    expect(() => associatedOf('ncea', { file, flags: { comprobanteAsociado: { numero: 9 } } })).toThrow(
      'Falta el punto de venta',
    );
  });

  it('sin punto de venta en ningún lado, falta el de la nota', () => {
    const { input } = resolveBillingInput({
      defaults: { emitterCuit: EMITTER },
      flags: { ...CONSUMER, comprobanteAsociado: { atajo: 'fc', numero: 5 } },
      now: NOW,
      shortcut: 'ncc',
    });

    expect(() => service.buildVoucherPayload(input, { ...runtime, pointOfSale: undefined })).toThrow(
      'Falta el punto de venta. Usá `--pv <numero>`',
    );
  });

  it('se consulta en ARCA igual que con --apv, y lo mismo el rechazo de una anulación FCE', async () => {
    const getVoucher = vi.fn(async () => ({
      currency: 'PES',
      date: '20261001',
      documentNumber: 30709965812,
      documentTypeCode: 80,
      ivaAmount: 0,
      netAmount: 1000,
      number: 5,
      total: 1000,
    }));
    const getVoucherState = vi.fn(async () => undefined);
    const input = resolve('ncea', {
      flags: { ...COMPANY, anulacion: true, comprobanteAsociado: { atajo: 'fcea', numero: 5 } },
    });
    const checked = await checkAssociatedInArca({
      gateway: { getLastNumber: vi.fn(), getVoucher },
      input,
      runtime,
      service,
    });

    await checkFceCancellationInRegistry({ gateway: { getVoucherState }, input: checked.input, runtime, service });

    expect(getVoucher).toHaveBeenCalledWith(5, 7, 201);
    expect(checked.input.associatedVoucher).toMatchObject({ fecha: '01/10/2026' });
    expect(getVoucherState).toHaveBeenCalledWith({ arcaType: 201, cuit: EMITTER, number: 5, pointOfSale: 7 });
  });
});

describe('lo que falta del asociado', () => {
  const error = (comprobanteAsociado: BillingJsonInput['comprobanteAsociado']) => () =>
    associatedOf('ncc', { flags: { ...CONSUMER, comprobanteAsociado } });

  it('nombra el tipo o el número, y `--apv` solo si es de otro punto de venta', () => {
    expect(error({ atajo: 'fc' })).toThrow(
      'Falta el número del comprobante asociado de la nota de crédito C. Usá `--ar <número>` (y `--apv` si es de otro punto de venta), o un período con',
    );
    expect(error({ numero: 5 })).toThrow(
      'Falta el tipo del comprobante asociado de la nota de crédito C. Usá `--ac <tipo>`',
    );
    expect(error({ puntoVenta: 5 })).toThrow('Faltan el tipo y el número del comprobante asociado');
  });

  it('sin nada que lo identifique pide el comprobante entero, con `--apv` opcional', () => {
    for (const associated of [undefined, { cuit: String(EMITTER) }, { fecha: '01/10/2026' }]) {
      expect(error(associated)).toThrow(
        'La nota de crédito C requiere comprobante asociado. Usá `--ac` o `--at` y `--ar` (con `--apv` si es de otro punto de venta y `--acuit` si es de otro CUIT), o un período con',
      );
    }
  });
});
