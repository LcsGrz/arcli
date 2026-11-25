import { describe, expect, it } from 'vitest';

import {
  assertExportClientIdentification,
  exportClientCountryCuitChoices,
  resolveExportClientCountryCuit,
} from '../export.country-cuit';
import type { ExportCountryCuit } from '../export.types';

const COUNTRY_CUITS: readonly ExportCountryCuit[] = [
  { countryName: 'Brasil - Persona Física', cuit: 50000000059 },
  { countryName: 'Brasil - Otro tipo de Entidad', cuit: 51600000059 },
  { countryName: 'Brasil - Persona Jurídica', cuit: 55000000050 },
  { countryName: 'Chile - Persona Jurídica', cuit: 55000000052 },
  { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
  { countryName: 'CHINA REP.POPULAR - Persona Jurídica', cuit: 55000002916 },
];

describe('assertExportClientIdentification', () => {
  const country = { code: 415, name: 'IRLANDA' };

  it('alcanza con el CUIT del pais o con el ID impositivo', () => {
    expect(() => assertExportClientIdentification({ clientCountryCuit: 55000000050, country })).not.toThrow();
    expect(() => assertExportClientIdentification({ clientTaxId: 'IE1234567T', country })).not.toThrow();
  });

  it('sin ninguno de los dos pide uno, como ARCA (error 1580)', () => {
    expect(() => assertExportClientIdentification({ clientTaxId: '  ', country })).toThrow(
      'La tabla de ARCA no tiene CUIT para "IRLANDA" y ARCA pide el CUIT del país o el ID impositivo del cliente (error 1580). Indicá el ID impositivo con `--id-impositivo` o el CUIT del país con `--cuit-pais`.',
    );
  });
});

describe('exportClientCountryCuitChoices', () => {
  it('con CUIT publicado para el destino, trae los del destino con el que elige el flag primero', () => {
    const country = { code: 203, name: 'BRASIL' };
    const choices = exportClientCountryCuitChoices({ countries: COUNTRY_CUITS, country }).map((entry) => entry.cuit);

    // Persona juridica, otro tipo de entidad y persona fisica, como `pickCountryCuit`.
    expect(choices).toEqual([55000000050, 51600000059, 50000000059]);
    expect(choices[0]).toBe(resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country }));
  });

  it('sin CUIT publicado para el destino, trae toda la tabla: `--cuit-pais` acepta cualquiera', () => {
    const country = { code: 999, name: 'ATLANTIDA' };
    const choices = exportClientCountryCuitChoices({ countries: COUNTRY_CUITS, country });

    expect(choices).toEqual(COUNTRY_CUITS);

    for (const { cuit } of choices) {
      expect(resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country, cuit })).toBe(cuit);
    }
  });

  it('cada uno que trae lo acepta `--cuit-pais` para ese destino', () => {
    const country = { code: 212, name: 'ESTADOS UNIDOS' };

    for (const { cuit } of exportClientCountryCuitChoices({ countries: COUNTRY_CUITS, country })) {
      expect(resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country, cuit })).toBe(cuit);
    }
  });
});

describe('resolveExportClientCountryCuit', () => {
  it('lo resuelve desde el pais de destino, sin el tipo de entidad que agrega la tabla', () => {
    expect(resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country: { code: 203, name: 'Brasil' } })).toBe(
      55000000050,
    );
  });

  it('prefiere la fila de persona juridica, sin importar el orden de la tabla', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: [
          { countryName: 'Peru - Otro tipo de Entidad', cuit: 51600000001 },
          { countryName: 'Peru - Persona Física', cuit: 50000000001 },
          { countryName: 'Peru - Persona Jurídica', cuit: 55000000001 },
        ],
        country: { code: 217, name: 'Peru' },
      }),
    ).toBe(55000000001);
  });

  it('acepta el CUIT indicado por el usuario', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000000052,
      }),
    ).toBe(55000000052);
  });

  it('compara sin acentos ni mayusculas', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'estados unidos' },
        cuit: 55000002126,
      }),
    ).toBe(55000002126);
  });

  it('rechaza un CUIT de otro pais y sugiere el del destino', () => {
    expect(() =>
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000000050,
      }),
    ).toThrow(/corresponde a "Brasil" y el destino es "Chile". Para "Chile" la tabla de ARCA trae 55000000052/);
  });

  it('rechaza un CUIT que no esta en la tabla', () => {
    expect(() =>
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 212, name: 'Chile' },
        cuit: 55000009999,
      }),
    ).toThrow(/no existe en la tabla/);
  });

  it('sin CUIT en la tabla ni por flag no hay CUIT: la E va con el ID impositivo (error 1580)', () => {
    expect(
      resolveExportClientCountryCuit({ countries: COUNTRY_CUITS, country: { code: 999, name: 'Narnia' } }),
    ).toBeUndefined();
  });

  it('acepta el CUIT cuando las dos tablas nombran distinto al pais', () => {
    expect(
      resolveExportClientCountryCuit({
        countries: COUNTRY_CUITS,
        country: { code: 310, name: 'CHINA' },
        cuit: 55000002916,
      }),
    ).toBe(55000002916);
  });
});
