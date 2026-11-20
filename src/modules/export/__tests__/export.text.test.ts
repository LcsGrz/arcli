import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripAnsi, visibleWidth } from '../../../ui/primitives';
import { formatExportPayloadTable, formatExportResultAsText } from '../export.text';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult, type ExportVoucherPayload } from '../export.types';

function result(
  payload: Partial<ExportVoucherPayload> = {},
  display: Partial<ExportExecutionResult['display']> = {},
): ExportExecutionResult {
  return {
    display: { countryName: 'ESTADOS UNIDOS', languageName: 'Español', unitNames: { 7: 'unidades' }, ...display },
    dryRun: true,
    environment: 'testing',
    payload: {
      Actividades: { Actividad: [{ Id: 620100 }] },
      CanMisMonExt: 'N',
      Cbte_nro: 2,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000002126,
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fecha_cbte: '20261030',
      Fecha_pago: '20261030',
      Forma_pago: 'Transferencia Internacional',
      Id: 2,
      Id_impositivo: '',
      Idioma_cbte: 1,
      Imp_total: 1500.5,
      Incoterms: 'FOB',
      Incoterms_Ds: 'FOB',
      Items: { Item: [] },
      Moneda_ctz: 1174.605,
      Moneda_Id: 'DOL',
      Obs: '',
      Obs_comerciales: '',
      Permiso_existente: 'N',
      Punto_vta: 4,
      Tipo_expo: 1,
      ...payload,
    },
    response: {
      cae: null,
      caeVencimiento: null,
      errors: [],
      events: [],
      observacion: null,
      observaciones: [],
      raw: null,
      resultado: null,
      status: 'observado',
      suggestions: [],
    },
    voucherKind: EXPORT_VOUCHER_KIND,
  };
}

const table = (value: ExportExecutionResult) => stripAnsi(formatExportPayloadTable(value));

describe('formatExportPayloadTable', () => {
  it('en una nota muestra el comprobante asociado y no la fecha de pago', () => {
    const invoice = { ...result().payload, CanMisMonExt: undefined, Fecha_pago: undefined };
    const text = table({
      ...result(),
      display: {
        ...result().display,
        associatedVoucher: {
          currencyCode: 'DOL',
          date: '20261030',
          displayName: 'Factura de exportación E',
          total: 1500,
        },
      },
      payload: {
        ...invoice,
        Cbte_Tipo: 21,
        Cmps_asoc: { Cmp_asoc: [{ Cbte_cuit: 20409509763, Cbte_nro: 1, Cbte_punto_vta: 4, Cbte_tipo: 19 }] },
        Permiso_existente: '',
      },
    });

    expect(text).toMatch(/Comprobante asociado\s+Factura de exportación E 00004-00000001 del 30\/10\/2026, 1\.500 USD/);
    expect(text).not.toContain('Fecha de pago');
  });

  it('sin CUIT del pais no muestra esa fila y el ID impositivo va despues del domicilio', () => {
    const text = table(result({ Cuit_pais_cliente: undefined, Id_impositivo: 'IE1234567T' }));

    expect(text).not.toContain('CUIT del país');
    expect(text).toMatch(/Domicilio del cliente\s+123 Main St\s+ID impositivo del cliente\s+IE1234567T/);
  });

  it('muestra el importe con el codigo de la moneda, no con el $ de los pesos', () => {
    expect(table(result())).toMatch(/Importe total\s+1\.500,50 USD/);
    expect(table(result({ Moneda_ctz: 1, Moneda_Id: 'PES' }))).toMatch(/Importe total\s+\$ 1\.500,50/);
    expect(table(result())).toMatch(/Moneda\s+Dólares estadounidenses \(USD\), cotización/);
    expect(table(result())).toMatch(/Número\s+\d{5}-\d{8}/);
  });

  it('no repite el incoterm cuando la tabla de ARCA trae el codigo como descripcion', () => {
    expect(table(result())).toMatch(/Incoterm\s+FOB\n/);
    expect(table(result({ Incoterms_Ds: 'Free on Board' }))).toMatch(/Incoterm\s+FOB - Free on Board/);
  });

  it('muestra el idioma con su nombre de la tabla de WSFEX', () => {
    expect(table(result())).toMatch(/Idioma\s+1 - Español/);
    expect(table(result({}, { languageName: undefined }))).toMatch(/Idioma\s+1\n/);
  });

  it('muestra al lado de cada permiso de embarque lo que contesto ARCA', () => {
    const permits = {
      Permiso_existente: 'S' as const,
      Permisos: {
        Permiso: [
          { Dst_merc: 212, Id_permiso: 'P1' },
          { Dst_merc: 212, Id_permiso: 'P2' },
        ],
      },
    };
    const checks = {
      permitChecks: [
        { permit: 'P1', status: 'valido' as const },
        { permit: 'P2', status: 'sin-verificar' as const },
      ],
    };

    const production = { ...result(permits, checks), environment: 'produccion' as const };

    expect(table(production)).toMatch(/Permisos de embarque\s+P1 \(válido en ARCA\), P2 \(sin verificar\)/);
    // Testing contesta OK a cualquier permiso: no se promete que sea valido.
    expect(table(result(permits, checks))).toMatch(/Permisos de embarque\s+P1 \(OK en testing\), P2/);
    expect(table(result(permits))).toMatch(/Permisos de embarque\s+P1, P2\n?/);
  });
});

// TUI-16: las fechas, una linea en blanco, los items, otra linea en blanco y el importe total; el importe de cada item
// a la derecha, en su columna, medido con el ancho visible.
describe('formatExportResultAsText: items de la vista previa', () => {
  const ACCENTED = 'Té de Bogotá con 東京';
  const LONG =
    'Servicio de consultoría en desarrollo de software a medida para la plataforma de comercio electrónico internacional';
  const item = (description: string, quantity: number, total: number) => ({
    Pro_bonificacion: 0,
    Pro_codigo: '',
    Pro_ds: description,
    Pro_precio_uni: total / quantity,
    Pro_qty: quantity,
    Pro_total_item: total,
    Pro_umed: 7,
  });
  const withItems = result({
    Imp_total: 1512.5,
    Items: { Item: [item(ACCENTED, 2, 12.5), item(LONG, 1, 1500)] },
    Obs: 'Pago a 30 días',
  });
  let saved: { readonly stderr: number; readonly stdout: number };

  beforeEach(() => {
    saved = { stderr: process.stderr.columns, stdout: process.stdout.columns };
  });

  afterEach(() => {
    process.stdout.columns = saved.stdout;
    process.stderr.columns = saved.stderr;
  });

  /** Las lineas de adentro del comprobante, sin bordes ni el margen que lo centra. */
  function previewLines(columns: number): string[] {
    process.stdout.columns = columns;
    process.stderr.columns = columns;

    return stripAnsi(formatExportResultAsText(withItems, { environment: 'produccion' }))
      .split('\n')
      .filter((line) => line.includes('│'))
      .map((line) =>
        line
          .slice(line.indexOf('│') + 1, line.lastIndexOf('│'))
          .trimEnd()
          .replace(/^ {2}/, ''),
      );
  }

  /** La columna (visible) donde termina `amount` en la linea que lo tiene. */
  function amountEdge(lines: readonly string[], amount: string): number {
    const line = lines.find((candidate) => candidate.endsWith(amount));

    if (!line) {
      throw new Error(`No hay una linea que termine en ${amount}:\n${lines.join('\n')}`);
    }

    return visibleWidth(line);
  }

  it('va de las fechas a los items y recien al final el importe total, separados por lineas en blanco', () => {
    const lines = previewLines(140);
    const paymentDate = lines.findIndex((line) => line.startsWith('Fecha de pago'));
    const firstItem = lines.findIndex((line) => line.startsWith('2 x Té'));
    const total = lines.findIndex((line) => line.startsWith('Importe total'));

    expect(lines.findIndex((line) => line.startsWith('Observaciones'))).toBeLessThan(paymentDate);
    expect(lines[paymentDate + 1]).toBe('');
    expect(firstItem).toBe(paymentDate + 2);
    expect(lines[total - 1]).toBe('');
    expect(lines.slice(firstItem, total - 1).every((line) => line !== '')).toBe(true);
    expect(lines[total]).toMatch(/^Importe total\s+1\.512,50 USD$/);
  });

  it.each([40, 140])('en %i columnas los importes de los items terminan en la misma columna', (columns) => {
    const lines = previewLines(columns);

    expect(amountEdge(lines, '12,50 USD')).toBe(amountEdge(lines, '1.500 USD'));
    expect(Math.max(...lines.map(visibleWidth))).toBeLessThanOrEqual(columns);
  });

  it('en 140 columnas cada importe va al lado del comienzo de su descripcion, y la larga sigue debajo', () => {
    const lines = previewLines(140);

    expect(lines).toContainEqual(expect.stringMatching(/^2 x Té de Bogotá con 東京 \(unidades\)\s+12,50 USD$/));
    expect(lines).toContainEqual(expect.stringMatching(/^1 x Servicio de consultoría .*\s{2,}1\.500 USD$/));
    // La descripcion larga se parte dentro de su columna: no invade la de los importes.
    expect(lines).toContainEqual('para la plataforma de comercio electrónico internacional');
  });

  it('en 40 columnas cada item va con la descripcion arriba y el importe debajo, a la derecha', () => {
    const lines = previewLines(40);

    for (const amount of ['12,50 USD', '1.500 USD']) {
      const index = lines.findIndex((line) => line.endsWith(amount));

      expect(lines[index]?.trim()).toBe(amount);
      expect(lines[index - 1]).toMatch(/\(unidades\)$/);
    }
  });
});
