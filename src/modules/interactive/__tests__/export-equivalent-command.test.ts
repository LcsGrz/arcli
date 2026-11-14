import { describe, expect, it } from 'vitest';

import { EXPORT_CREDIT_NOTE_KIND } from '../../export/export.types';
import { buildExportEquivalentCommand } from '../export-equivalent-command';

describe('buildExportEquivalentCommand', () => {
  it('incluye los opcionales de la factura E con los flags del CLI', () => {
    const command = buildExportEquivalentCommand(
      {
        amount: 1500,
        clientAddress: '123 Main St',
        clientCountryCuit: 55000002126,
        clientName: 'ACME LLC',
        commercialObservations: 'Pago a 30 días',
        currencyCode: 'DOL',
        destinationCountry: 'ESTADOS UNIDOS',
        emit: false,
        exchangeRate: 1174.605,
        exportType: 1,
        incoterm: 'FOB',
        incotermDescription: 'Free on board',
        items: [
          { description: 'Bienes varios', quantity: 2, unit: 1, unitPrice: 500 },
          { code: 'A1', description: 'Flete', quantity: 1, unit: 7, unitPrice: 500 },
        ],
        language: 2,
        observations: 'Pedido 42',
      },
      { activity: 620100, environment: 'testing' },
    );

    expect(command).toBe(
      'arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino "ESTADOS UNIDOS" --cuit-pais 55000002126 --tipo-expo 1 --actividad 620100 --item "Bienes varios|2|500|1" --item "A1|Flete|1|500|7" --moneda DOL --cm 1174,605 --incoterm FOB --incoterms-desc "Free on board" --idioma 2 --observaciones "Pedido 42" --obs-comerciales "Pago a 30 días" --testing --emitir',
    );
  });

  it('en una nota sobre otra nota E agrega --ac y omite la unidad por defecto del ítem', () => {
    const command = buildExportEquivalentCommand(
      {
        amount: 100,
        associatedVoucher: { number: 3, pointOfSale: 4, shortcut: 'nde' },
        emit: false,
        items: [{ description: 'Ajuste', quantity: 1, unitPrice: 100 }],
        voucherKind: EXPORT_CREDIT_NOTE_KIND,
      },
      { environment: 'produccion' },
    );

    expect(command).toBe('arcli nce -m 100 --ar 3 --apv 4 --ac nde --item "Ajuste|1|100" --produccion --emitir');
  });
});
