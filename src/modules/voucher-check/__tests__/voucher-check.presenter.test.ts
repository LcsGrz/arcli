import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import type { VoucherCheckAnswer, VoucherCheckReport, VoucherCheckRequest } from '../voucher-check';
import { formatVoucherCheckAsText } from '../voucher-check.presenter';

/**
 * Lo que ve quien corre `arcli constatar` sin `--json`: qué dato se muestra y en qué caso, no cada texto (la salida
 * humana no es contrato). El `--json` lo fijan `constatar.test.ts` y los golden.
 */

const REQUEST: VoucherCheckRequest = {
  authorizationCode: '76463926585341',
  currency: null,
  date: '20261110',
  issuerCuit: '30709965812',
  mode: 'CAE',
  number: 1234,
  pointOfSale: 3,
  receiver: { documentNumber: '20111111112', documentType: 80 },
  shortcut: 'fa',
  total: 12100,
  voucherType: 1,
};

const CHECKED: VoucherCheckAnswer = {
  errors: [],
  events: [],
  observations: [],
  processedAt: '20261117120000',
  result: 'A',
};

const NOT_FOUND = { code: 100, message: 'El CAE informado no existe.' };
const CAEA_NOT_RENDERED = { code: 200, message: 'Existe CAEA, no fue rendido.' };

function text(request: Partial<VoucherCheckRequest> = {}, answer: Partial<VoucherCheckAnswer> = {}): string {
  const report: VoucherCheckReport = {
    answer: { ...CHECKED, ...answer },
    environment: 'testing',
    request: { ...REQUEST, ...request },
  };

  return stripAnsi(formatVoucherCheckAsText(report));
}

/** Una fila de la ficha: el nombre y su valor. */
function row(label: string, value: string): RegExp {
  return new RegExp(`${label} +${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** El veredicto al pie: la línea que tiene solo eso. */
function verdict(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.replace(/[│┃]/g, '').trim())
    .find((line) => line === 'CONSTATADO' || line === 'NO CONSTATADO');
}

describe('formatVoucherCheckAsText', () => {
  it('la ficha de un constatado: cada dato con su nombre y CONSTATADO al pie', () => {
    const output = text();

    expect(output).toContain('CONSTATACIÓN DE COMPROBANTE');
    expect(output).toMatch(row('Comprobante', 'Factura A 00003-00001234'));
    expect(output).toMatch(row('Emisor', '30-70996581-2'));
    expect(output).toMatch(row('Fecha', '10/11/2026'));
    expect(output).toMatch(row('Importe total', '12.100'));
    expect(output).toMatch(row('CAE', '76463926585341'));
    expect(output).toMatch(row('Receptor', 'CUIT 20-11111111-2'));
    expect(output).toMatch(row('Constatado el', '17/11/2026 12:00'));
    expect(verdict(output)).toBe('CONSTATADO');
  });

  it('un no constatado dice cuándo se consultó y NO CONSTATADO al pie', () => {
    const output = text({}, { observations: [NOT_FOUND], result: 'R' });

    expect(output).toMatch(row('Consultado el', '17/11/2026 12:00'));
    expect(output).not.toContain('Constatado el');
    expect(verdict(output)).toBe('NO CONSTATADO');
  });

  it.each<[string, number, string]>([
    ['el que ARCLI emite, por su nombre', 6, 'Factura B'],
    ['la E, por el suyo', 19, 'Factura de exportación E'],
    ['el que ARCLI no emite, con su código', 51, 'Tipo 51 de ARCA'],
  ])('nombra el tipo: %s', (_name, voucherType, label) => {
    expect(text({ voucherType })).toMatch(row('Comprobante', `${label} 00003-00001234`));
  });

  it.each<[string, VoucherCheckRequest['receiver'], string]>([
    ['el DNI con puntos', { documentNumber: '11111111', documentType: 96 }, 'DNI 11.111.111'],
    ['el CUIL con guiones', { documentNumber: '20111111112', documentType: 86 }, 'CUIL 20-11111111-2'],
    ['el pasaporte del QR, con su código', { documentNumber: '12345678', documentType: 94 }, 'Documento 94 12.345.678'],
  ])('el receptor: %s', (_name, receiver, label) => {
    expect(text({ receiver })).toMatch(row('Receptor', label));
  });

  it('sin receptor no muestra la fila', () => {
    expect(text({ receiver: null })).not.toContain('Receptor');
  });

  it('el importe con la moneda del QR; con los flags, el número solo', () => {
    expect(text({ currency: 'DOL' })).toMatch(row('Importe total', '12.100 USD'));
    expect(text({ currency: null })).toMatch(/Importe total +12\.100 +│/);
  });

  it.each([null, '202611171200001', '2026-11-17 12:00', '20261117120'])(
    'una fecha de proceso que no es yyyymmddhhmmss (%j) no se muestra',
    (processedAt) => {
      expect(text({}, { processedAt })).not.toContain('Constatado el');
    },
  );

  it('un constatado sin observaciones ni errores no muestra paneles de ARCA', () => {
    const output = text();

    expect(output).not.toMatch(/OBSERVACIONES DE ARCA|MOTIVO DE ARCA|ERRORES DE ARCA|EVENTOS DE ARCA/);
    expect(output).not.toContain('ARCA no informó el motivo.');
  });

  it('un constatado con observaciones las muestra como aviso, no como motivo', () => {
    const output = text({}, { observations: [CAEA_NOT_RENDERED] });

    expect(output).toContain('OBSERVACIONES DE ARCA');
    expect(output).toContain('200: Existe CAEA, no fue rendido.');
    expect(output).not.toContain('MOTIVO DE ARCA');
  });

  it('un no constatado muestra el motivo de ARCA, y si no vino, que ARCA no lo informó', () => {
    const withReason = text({}, { observations: [NOT_FOUND], result: 'R' });
    const withoutReason = text({}, { result: 'R' });

    expect(withReason).toContain('MOTIVO DE ARCA');
    expect(withReason).toContain('100: El CAE informado no existe.');
    expect(withReason).not.toContain('ARCA no informó el motivo.');
    expect(withReason).not.toContain('OBSERVACIONES DE ARCA');
    expect(withoutReason).toContain('MOTIVO DE ARCA');
    expect(withoutReason).toContain('ARCA no informó el motivo.');
  });

  it('los errores y los eventos de un constatado salen cada uno en su panel', () => {
    const output = text({}, { errors: [{ code: 1, message: 'Aviso.' }], events: [{ code: 2, message: 'Evento.' }] });

    expect(output).toContain('ERRORES DE ARCA');
    expect(output).toContain('1: Aviso.');
    expect(output).toContain('EVENTOS DE ARCA');
    expect(output).toContain('2: Evento.');
  });
});
