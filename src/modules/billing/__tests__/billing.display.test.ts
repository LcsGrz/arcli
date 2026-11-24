import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';

import { formatPayloadTable, formatResultSummary } from '../billing.display';
import { formatBillingResultAsText } from '../billing.text';
import type { BillingExecutionResult } from '../billing.types.internal';
import { getVoucherKindByShortcut } from '../voucher-kind-map';
import type { UnnumberedVoucherRequest } from '../voucher-request';

function createResult(
  shortcut: string,
  payload: Partial<UnnumberedVoucherRequest>,
  overrides: Partial<BillingExecutionResult> = {},
): BillingExecutionResult {
  const voucherKind = getVoucherKindByShortcut(shortcut);

  if (!voucherKind) {
    throw new Error(`Atajo desconocido: ${shortcut}`);
  }

  return {
    dryRun: true,
    environment: 'testing',
    payload: {
      CantReg: 1,
      CbteFch: '20261003',
      CbteTipo: voucherKind.arcaType,
      Concepto: 1,
      CondicionIVAReceptorId: 5,
      DocNro: 0,
      DocTipo: 99,
      ImpIVA: 0,
      ImpNeto: 1000,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 1000,
      ImpTrib: 0,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
      ...payload,
    },
    response: {
      cae: null,
      caeVencimiento: null,
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: null,
      resultado: null,
      suggestions: [],
      status: 'previsualizacion',
    },
    voucherKind,
    ...overrides,
  } as BillingExecutionResult;
}

/** Las filas de la vista previa como pares [etiqueta, valor], sin colores ni relleno. */
function rows(result: BillingExecutionResult): Array<[string, string]> {
  return stripVTControlCharacters(formatPayloadTable(result))
    .split('\n')
    .map((line) => {
      const match = /^(\S+(?: \S+)*)\s{2,}(.*)$/.exec(line);

      if (!match?.[1] || match[2] === undefined) {
        throw new Error(`Fila sin separar: ${line}`);
      }

      return [match[1], match[2]];
    });
}

function labels(result: BillingExecutionResult): string[] {
  return rows(result).map(([label]) => label);
}

function valueOf(result: BillingExecutionResult, label: string): string | undefined {
  return rows(result).find(([key]) => key === label)?.[1];
}

describe('billing.display: filas de la vista previa (TEST-18)', () => {
  it('factura C a consumidor final sin identificar: una sola fila de receptor, sin IVA ni opcionales', () => {
    expect(rows(createResult('fc', {}))).toEqual([
      ['Concepto', expect.any(String)],
      ['Punto de venta', '3'],
      ['Fecha del comprobante', expect.any(String)],
      ['Receptor', 'Consumidor final'],
      ['Moneda', expect.any(String)],
      ['Importe neto', expect.any(String)],
      ['Importe total', expect.any(String)],
    ]);
  });

  it('consumidor final con documento: muestra el tipo y el número, no "Consumidor final"', () => {
    const result = createResult('fb', { DocNro: 30123456, DocTipo: 96 });

    expect(labels(result)).toEqual(expect.arrayContaining(['Tipo de documento', 'Número de documento']));
    expect(valueOf(result, 'Receptor')).toBeUndefined();
  });

  it('tipo 99 con número: no es el consumidor final sin identificar, muestra el número', () => {
    const result = createResult('fb', { DocNro: 12345, DocTipo: 99 });

    expect(valueOf(result, 'Receptor')).toBeUndefined();
    expect(valueOf(result, 'Número de documento')).toBe('12.345');
  });

  it('consumidor final sin identificar con otra condición de IVA: agrega la fila de IVA receptor', () => {
    const result = createResult('fc', { CondicionIVAReceptorId: 6 });

    expect(valueOf(result, 'Receptor')).toBe('Consumidor final');
    expect(valueOf(result, 'IVA receptor')).toBeDefined();
  });

  it('una sola alícuota: muestra la tasa, no el desglose', () => {
    const result = createResult('fa', {
      CondicionIVAReceptorId: 1,
      DocNro: 30712345671,
      DocTipo: 80,
      ImpIVA: 210,
      ImpTotal: 1210,
      Iva: [{ BaseImp: 1000, Id: 5, Importe: 210 }],
    });

    expect(valueOf(result, 'Alícuota de IVA')).toBe('21%');
    expect(labels(result).filter((label) => label.startsWith('IVA 2'))).toEqual([]);
    expect(valueOf(result, 'Importe IVA')).toBe('$ 210');
  });

  it('varias alícuotas: una fila por alícuota con su IVA sobre su neto', () => {
    const result = createResult('fa', {
      CondicionIVAReceptorId: 1,
      DocNro: 30712345671,
      DocTipo: 80,
      ImpIVA: 262.5,
      ImpNeto: 1500,
      ImpTotal: 1762.5,
      Iva: [
        { BaseImp: 1000, Id: 5, Importe: 210 },
        { BaseImp: 500, Id: 4, Importe: 52.5 },
      ],
    });

    expect(valueOf(result, 'Alícuota de IVA')).toBeUndefined();
    expect(valueOf(result, 'IVA 21%')).toBe('$ 210 sobre $ 1.000');
    expect(valueOf(result, 'IVA 10,5%')).toBe('$ 52,50 sobre $ 500');
  });

  it('exento, no gravado y tributos solo aparecen cuando tienen valor', () => {
    const result = createResult('fa', { ImpOpEx: 100, ImpTotConc: 50, ImpTotal: 1150 });

    expect(valueOf(result, 'Importe exento')).toBe('$ 100');
    expect(valueOf(result, 'Importe no gravado')).toBe('$ 50');
    expect(valueOf(result, 'Importe tributos')).toBeUndefined();
    expect(valueOf(result, 'Importe IVA')).toBeUndefined();
  });

  it('moneda extranjera: agrega la cotización', () => {
    expect(valueOf(createResult('fc', { MonCotiz: 1174.5, MonId: 'DOL' }), 'Cotización')).toMatch(/1\.174,5/);
    expect(valueOf(createResult('fc', {}), 'Cotización')).toBeUndefined();
  });

  it('servicios: fechas desde y hasta, y vencimiento del pago', () => {
    const result = createResult('fc', {
      Concepto: 2,
      FchServDesde: '20261001',
      FchServHasta: '20261031',
      FchVtoPago: '20261110',
    });

    expect(valueOf(result, 'Servicio desde')).toBe('01/10/2026');
    expect(valueOf(result, 'Servicio hasta')).toBe('31/10/2026');
    expect(valueOf(result, 'Vencimiento del pago')).toBe('10/11/2026');
  });

  it('productos: sin filas de fechas de servicio ni vencimiento', () => {
    const result = createResult('fc', {});

    expect(labels(result)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(Servicio|Vencimiento)/)]));
  });

  it('nota con asociado: tipo, número, CUIT y fecha del asociado', () => {
    const result = createResult('ncc', {
      CbtesAsoc: [{ CbteFch: '20261001', Cuit: '20123456786', Nro: 120, PtoVta: 3, Tipo: 11 }],
    });

    expect(valueOf(result, 'Comprobante asociado')).toBe(getVoucherKindByShortcut('fc')?.displayName);
    expect(valueOf(result, 'Número asociado')).toBe('00003-00000120');
    expect(valueOf(result, 'CUIT asociado')).toBe('20-12345678-6');
    expect(valueOf(result, 'Fecha asociado')).toBe('01/10/2026');
  });

  it('asociado sin CUIT (opcional en A, B y C): sin fila de CUIT, nunca N/D (TUI-20)', () => {
    const result = createResult('ncc', {
      CbtesAsoc: [{ Nro: 120, PtoVta: 3, Tipo: 11 } as never],
    });

    expect(valueOf(result, 'Número asociado')).toBe('00003-00000120');
    expect(labels(result)).not.toContain('CUIT asociado');
    expect(formatPayloadTable(result)).not.toContain('N/D');
  });

  it('sin dato, la fila no va: receptor sin número ni concepto conocido (TUI-20)', () => {
    const result = createResult('fa', { Concepto: undefined, DocNro: undefined, DocTipo: 80 } as never);

    expect(labels(result)).not.toContain('Concepto');
    expect(labels(result)).not.toContain('Número de documento');
    expect(formatPayloadTable(result)).not.toContain('N/D');
  });

  it('período asociado con una sola punta: "desde …" o "hasta …", nunca "undefined" (TUI-20)', () => {
    const onlyFrom = createResult('ncc', { PeriodoAsoc: { FchDesde: '20261001', FchHasta: '' } } as never);
    const onlyTo = createResult('ncc', { PeriodoAsoc: { FchDesde: '', FchHasta: '20261031' } } as never);

    expect(valueOf(onlyFrom, 'Período asociado')).toBe('desde 01/10/2026');
    expect(valueOf(onlyTo, 'Período asociado')).toBe('hasta 31/10/2026');
    expect(formatPayloadTable(onlyFrom)).not.toContain('undefined');
    expect(
      valueOf(
        createResult('ncc', { PeriodoAsoc: { FchDesde: '20261001', FchHasta: '20261031' } } as never),
        'Período asociado',
      ),
    ).toBe('01/10/2026 al 31/10/2026');
  });

  it('asociado sin fecha ni tipo conocido: el tipo numérico y sin fila de fecha', () => {
    const result = createResult('ncc', {
      CbtesAsoc: [{ Cuit: '20123456786', Nro: 120, PtoVta: 3, Tipo: 999 }],
    });

    expect(valueOf(result, 'Comprobante asociado')).toBe('999');
    expect(valueOf(result, 'Fecha asociado')).toBeUndefined();
  });

  it('período asociado: desde y hasta en una fila', () => {
    const result = createResult('ncc', { PeriodoAsoc: { FchDesde: '20261001', FchHasta: '20261031' } });

    expect(valueOf(result, 'Período asociado')).toBe('01/10/2026 al 31/10/2026');
  });

  it('FCE: anulación Sí/No, CBU y alias; un opcional desconocido no se muestra', () => {
    const anulada = createResult('ncea', {
      Opcionales: [
        { Id: '22', Valor: 'S' },
        { Id: '9999', Valor: 'x' },
      ],
    });
    const factura = createResult('fcea', {
      Opcionales: [
        { Id: '2101', Valor: '0123456789012345678901' },
        { Id: '2102', Valor: 'mi.alias' },
        { Id: '27', Valor: 'SCA' },
      ],
    });

    expect(valueOf(anulada, 'Anulación')).toBe('Sí');
    expect(labels(anulada)).not.toContain('9999');
    expect(valueOf(createResult('ncea', { Opcionales: [{ Id: '22', Valor: 'N' }] }), 'Anulación')).toBe('No');
    expect(valueOf(factura, 'CBU')).toBe('0123456789012345678901');
    expect(valueOf(factura, 'Alias CBU')).toBe('mi.alias');
    expect(valueOf(factura, 'Transferencia')).toBe('SCA');
  });

  it('receptor del padrón: nombre y la marca (padrón) en el IVA', () => {
    const result = createResult(
      'fa',
      { CondicionIVAReceptorId: 1, DocNro: 30712345671, DocTipo: 80 },
      { receiver: { ivaConditionFromPadron: true, name: 'Cliente SA' } },
    );

    expect(valueOf(result, 'Receptor')).toBe('Cliente SA');
    expect(valueOf(result, 'IVA receptor')).toMatch(/\(padrón\)$/);
    expect(valueOf(result, 'Número de documento')).toBe('30-71234567-1');
  });
});

describe('formatResultSummary (TEST-18)', () => {
  it('sin número muestra el punto de venta; con número, el número completo', () => {
    const previa = createResult('fc', {});

    expect(formatResultSummary(previa)[2]).toEqual(['Punto de venta', 3]);
    expect(formatResultSummary({ ...previa, voucherNumber: 125 })[2]).toEqual(['Número', '00003-00000125']);
  });

  it('rechazado: el CAE dice "sin CAE" y no hay vencimiento (TUI-20)', () => {
    const rejected = createResult('fc', {}, { dryRun: false });
    const text = stripVTControlCharacters(
      formatBillingResultAsText({
        ...rejected,
        response: { ...rejected.response, cae: '', caeVencimiento: '', status: 'rechazado' },
      }),
    );

    expect(text).toMatch(/CAE\s+sin CAE/);
    expect(text).not.toContain('Vencimiento CAE');
    expect(text).not.toContain('N/D');
  });
});
