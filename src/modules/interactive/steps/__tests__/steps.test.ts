import { describe, expect, it } from 'vitest';

import { CONSUMER_IDENTIFICATION_THRESHOLD } from '../../../billing/billing.iva-receptor';
import { VOUCHER_KIND_MAP } from '../../../billing/voucher-kind-map';
import { amountQuestion } from '../amount';
import { activityToSave, cbuToSave } from '../config-offer';
import { consumerContext, needsOfficialRate, officialRateQuery, withOfficialRate } from '../consumer';
import { foreignCurrencyOf, repeatCurrencyLock } from '../currency';
import { fieldLens, nestedLens } from '../lens';

describe('lentes', () => {
  interface State {
    readonly amount?: number;
    readonly copy?: { readonly amount?: number; readonly items?: readonly string[] };
  }

  it('un campo de la raiz: lee y escribe solo ese campo', () => {
    const lens = fieldLens<State, 'amount'>('amount');

    expect(lens.get({ amount: 10 })).toBe(10);
    expect(lens.get({})).toBeUndefined();
    expect(lens.set(20, { amount: 10, copy: {} })).toEqual({ amount: 20 });
  });

  it('un campo anidado: escribe el objeto entero con lo que tenia', () => {
    const lens = nestedLens<State, 'copy', 'amount'>('copy', 'amount');

    expect(lens.get({ copy: { amount: 5 } })).toBe(5);
    expect(lens.get({})).toBeUndefined();
    expect(lens.set(7, { copy: { amount: 5, items: ['a'] } })).toEqual({ copy: { amount: 7, items: ['a'] } });
    // Sin objeto todavia, arranca vacio o con el que da `parent`.
    expect(lens.set(7, {})).toEqual({ copy: { amount: 7 } });
    expect(nestedLens<State, 'copy', 'amount'>('copy', 'amount', () => ({ items: ['b'] })).set(1, {})).toEqual({
      copy: { amount: 1, items: ['b'] },
    });
  });
});

describe('amountQuestion (REV-74, #12)', () => {
  it('nombra la moneda extranjera con su ISO, tambien desde el codigo de ARCA', () => {
    expect(amountQuestion('Monto total', 'USD')).toBe('Monto total en USD:');
    expect(amountQuestion('Monto total', 'DOL')).toBe('Monto total en USD:');
    expect(amountQuestion('Monto total', '060')).toBe('Monto total en EUR:');
  });

  it('en pesos, o sin moneda todavia, no la nombra', () => {
    expect(amountQuestion('Monto total', 'ARS')).toBe('Monto total:');
    expect(amountQuestion('Monto total', 'PES')).toBe('Monto total:');
    expect(amountQuestion('Monto total', undefined)).toBe('Monto total:');
    expect(amountQuestion('Monto total', '')).toBe('Monto total:');
  });
});

describe('la moneda trabada al repetir (REV-73)', () => {
  const inDollars = { currency: 'DOL' };
  const inPesos = { currency: 'PES' };

  it('la moneda extranjera de un comprobante, con su ISO; en pesos o sin comprobante, ninguna', () => {
    expect(foreignCurrencyOf(inDollars)).toBe('USD');
    expect(foreignCurrencyOf(inPesos)).toBeUndefined();
    expect(foreignCurrencyOf({})).toBeUndefined();
    expect(foreignCurrencyOf(undefined)).toBeUndefined();
  });

  it('en moneda extranjera se traba en esa moneda, con el mismo monto o con otro', () => {
    const lock = {
      code: 'USD',
      reason: 'El comprobante original era en USD: se repite en USD con una cotización nueva.',
    };

    expect(repeatCurrencyLock(inDollars, true)).toEqual(lock);
    expect(repeatCurrencyLock(inDollars, false)).toEqual(lock);
    expect(repeatCurrencyLock(inDollars, undefined)).toEqual(lock);
  });

  it('en pesos se traba solo con el mismo monto: con otro, la moneda se elige', () => {
    expect(repeatCurrencyLock(inPesos, true)).toEqual({
      code: 'ARS',
      reason: 'El monto confirmado es el del comprobante original, en pesos.',
    });
    expect(repeatCurrencyLock({}, true)?.code).toBe('ARS');
    expect(repeatCurrencyLock(inPesos, false)).toBeUndefined();
    expect(repeatCurrencyLock(inPesos, undefined)).toBeUndefined();
    expect(repeatCurrencyLock(undefined, true)).toBeUndefined();
  });
});

describe('el consumidor final desde el tope (REV-66)', () => {
  const THRESHOLD = CONSUMER_IDENTIFICATION_THRESHOLD;

  it('la consulta de la oficial: la moneda (pesos si no hay), la fecha y si se cobra en esa moneda', () => {
    expect(officialRateQuery({ totalAmount: 1 })).toEqual({
      billingDate: undefined,
      currencyCode: 'ARS',
      sameCurrency: false,
    });
    expect(officialRateQuery({ billingDate: '10/11/2026', currencyCode: 'USD', sameCurrency: true })).toEqual({
      billingDate: '10/11/2026',
      currencyCode: 'USD',
      sameCurrency: true,
    });
  });

  it('la oficial solo completa lo que falta: en pesos o con cotizacion, no cambia nada', () => {
    const usd = { currencyCode: 'USD', sameCurrency: true, totalAmount: 10_000 };

    expect(withOfficialRate(usd, 1000)).toEqual({ ...usd, exchangeRate: 1000, sameCurrency: false });
    expect(withOfficialRate(usd, undefined)).toBe(usd);
    expect(withOfficialRate({ currencyCode: 'ARS', totalAmount: 5 }, 1000)).toEqual({
      currencyCode: 'ARS',
      totalAmount: 5,
    });
    expect(withOfficialRate({ currencyCode: 'USD', exchangeRate: 900, totalAmount: 5 }, 1000).exchangeRate).toBe(900);
    expect(needsOfficialRate(usd, undefined)).toBe(true);
    expect(needsOfficialRate(usd, 1000)).toBe(false);
    expect(needsOfficialRate({ currencyCode: 'ARS', totalAmount: 5 }, undefined)).toBe(false);
  });

  it('solo a consumidor final; obligatorio si el total en pesos llega al tope', () => {
    const base = { offered: true, receiver: 'r' };

    expect(consumerContext({ ...base, amount: { totalAmount: THRESHOLD }, documentType: 'dni' })).toBeUndefined();
    expect(consumerContext({ ...base, amount: { totalAmount: THRESHOLD }, documentType: undefined })).toBeUndefined();
    expect(consumerContext({ ...base, amount: { totalAmount: THRESHOLD }, documentType: 'consumidor-final' })).toEqual({
      offered: true,
      receiver: 'r',
      required: true,
    });
    expect(
      consumerContext({ ...base, amount: { totalAmount: THRESHOLD - 1 }, documentType: 'consumidor-final' }),
    ).toEqual({ offered: true, receiver: 'r', required: false });
    // En dolares cobrados en dolares, recien con la oficial se sabe.
    const usd = { currencyCode: 'USD', sameCurrency: true, totalAmount: THRESHOLD / 1000 };

    expect(consumerContext({ ...base, amount: usd, documentType: 'consumidor-final' })?.required).toBe(false);
    expect(
      consumerContext({ ...base, amount: usd, documentType: 'consumidor-final', officialRate: 1000 })?.required,
    ).toBe(true);
    expect(
      consumerContext({ amount: usd, documentType: 'consumidor-final', offered: false, receiver: 'x' })?.offered,
    ).toBe(false);
  });
});

describe('lo que se ofrece guardar en la config (REV-74, #16)', () => {
  const fce = { cbu: '0170099220000067797370', voucherKind: VOUCHER_KIND_MAP.fcea };

  it('el CBU escrito a mano de una FCE emitida, con el alias si se escribio', () => {
    expect(cbuToSave(fce, {}, true)).toEqual({
      message: '¿Guardamos el CBU en la config para la próxima?',
      values: [['cbu', '0170099220000067797370']],
    });
    expect(cbuToSave({ ...fce, cbuAlias: 'mi.alias' }, {}, true)).toEqual({
      message: '¿Guardamos el CBU y el alias mi.alias en la config para la próxima?',
      values: [
        ['cbu', '0170099220000067797370'],
        ['aliasCbu', 'mi.alias'],
      ],
    });
  });

  it('nada si no se emitio, si la config ya tiene CBU, si no se escribio o si no es una FCE', () => {
    expect(cbuToSave(fce, {}, false)).toBeUndefined();
    expect(cbuToSave(fce, { cbu: '0170099220000067797370' }, true)).toBeUndefined();
    expect(cbuToSave({ ...fce, cbu: undefined }, {}, true)).toBeUndefined();
    expect(cbuToSave({ ...fce, voucherKind: VOUCHER_KIND_MAP.fa }, {}, true)).toBeUndefined();
  });

  it('la actividad de la E escrita a mano, solo si se emitio y la config no tiene una', () => {
    expect(activityToSave(620100, undefined, true)).toEqual({
      message: '¿Guardamos la actividad 620100 en la config para la próxima?',
      values: [['exportacion.actividad', '620100']],
    });
    expect(activityToSave(620100, undefined, false)).toBeUndefined();
    expect(activityToSave(620100, 620100, true)).toBeUndefined();
    expect(activityToSave(undefined, undefined, true)).toBeUndefined();
  });
});
