import { describe, expect, it } from 'vitest';

import { findArcaCurrency, ISO_CURRENCY_ALIASES, toArcaCurrencyCode, toIsoCurrencyCode } from '../currency-codes';

/**
 * TEST-19: la tabla ISO -> ARCA escrita aparte, para que borrar o cambiar un alias falle. Los códigos son los de
 * `arcli parametros monedas`; agregar una moneda es sumarla acá también.
 */
const ISO_TO_ARCA: Readonly<Record<string, string>> = {
  ANG: '028',
  ARS: 'PES',
  AUD: '026',
  BOB: '031',
  BRL: '012',
  CAD: '018',
  CHF: '009',
  CLP: '033',
  CNY: '064',
  COP: '032',
  CZK: '024',
  DKK: '014',
  DOP: '042',
  EGP: '046',
  EUR: '060',
  GBP: '021',
  GTQ: '055',
  HKD: '051',
  HNL: '063',
  HUF: '056',
  ILS: '030',
  INR: '062',
  JMD: '053',
  JPY: '019',
  KWD: '059',
  MAD: '045',
  MXN: '010',
  NIO: '044',
  NOK: '015',
  PAB: '043',
  PEN: '035',
  PLN: '061',
  PYG: '029',
  RON: '040',
  RSD: '025',
  SAR: '047',
  SEK: '016',
  SGD: '052',
  THB: '057',
  TWD: '054',
  USD: 'DOL',
  UYU: '011',
  VES: '023',
  XDR: '041',
  ZAR: '034',
};

describe('currency-codes: ISO <-> ARCA para toda la tabla (TEST-19)', () => {
  it('los alias ISO son exactamente los de la tabla', () => {
    expect([...ISO_CURRENCY_ALIASES].sort()).toEqual(Object.keys(ISO_TO_ARCA).sort());
  });

  it.each(Object.entries(ISO_TO_ARCA))('%s se envía como %s y vuelve a %s', (iso, arca) => {
    expect(toArcaCurrencyCode(iso)).toBe(arca);
    expect(toArcaCurrencyCode(iso.toLowerCase())).toBe(arca);
    expect(toIsoCurrencyCode(arca)).toBe(iso);
    expect(findArcaCurrency(iso)?.arca).toBe(arca);
    expect(findArcaCurrency(arca)?.iso).toBe(iso);
  });

  it.each(['NZD', 'RUB', '002', '049'])('%s no tiene alias ISO y se usa con el código de ARCA', (arca) => {
    expect(toArcaCurrencyCode(arca)).toBe(arca);
    expect(toIsoCurrencyCode(arca)).toBe(arca);
    expect(findArcaCurrency(arca)?.iso).toBeUndefined();
    expect(findArcaCurrency(arca)?.arca).toBe(arca);
  });
});
