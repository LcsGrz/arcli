import { describe, expect, it } from 'vitest';

import {
  exportDestinationCountryChoices,
  resolveExportActivity,
  resolveExportDestinationCountry,
  resolveExportLanguage,
  resolveExportType,
} from '../export.catalogs';
import type { ExportCountry } from '../export.types';

const COUNTRIES: readonly ExportCountry[] = [
  { code: 200, name: 'Argentina' },
  { code: 203, name: 'Brasil' },
  { code: 212, name: 'Chile' },
];

describe('resolveExportType', () => {
  it('por defecto es exportacion de servicios', () => {
    expect(resolveExportType(undefined)).toBe(2);
  });

  it('respeta el tipo indicado por el usuario', () => {
    expect(resolveExportType(1)).toBe(1);
    expect(resolveExportType(4)).toBe(4);
  });

  it('rechaza un tipo que ARCA no tiene', () => {
    expect(() => resolveExportType(3 as never)).toThrow(/--tipo-expo/);
  });
});

describe('resolveExportDestinationCountry', () => {
  it('busca por codigo y por nombre', () => {
    expect(resolveExportDestinationCountry('203', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
    expect(resolveExportDestinationCountry(' brasil ', COUNTRIES)).toEqual({ code: 203, name: 'Brasil' });
  });

  it('rechaza Argentina: no es un destino de exportacion', () => {
    expect(() => resolveExportDestinationCountry('Argentina', COUNTRIES)).toThrow(/no es un destino de exportación/);
  });

  it('rechaza un pais que no esta en la tabla', () => {
    expect(() => resolveExportDestinationCountry('Marte', COUNTRIES)).toThrow(/no existe en la tabla/);
  });
});

describe('exportDestinationCountryChoices', () => {
  it('trae los destinos que acepta `--pais-destino`: la tabla sin Argentina', () => {
    const countries = [
      { code: 200, name: 'ARGENTINA' },
      { code: 203, name: 'BRASIL' },
      { code: 212, name: 'ESTADOS UNIDOS' },
    ];

    expect(exportDestinationCountryChoices(countries)).toEqual(countries.slice(1));
    expect(() => resolveExportDestinationCountry('200', countries)).toThrow(/Argentina no es un destino/);
  });
});

describe('resolveExportActivity', () => {
  const ACTIVITIES = [
    { id: 62000, name: 'EXTRACCION DE GAS NATURAL' },
    { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    { id: 620300, name: 'SERVICIOS DE CONSULTORES EN TECNOLOGIA DE LA INFORMACION' },
  ];

  it('toma la actividad indicada si esta en la tabla de WSFEX', () => {
    expect(resolveExportActivity(620300, ACTIVITIES)).toBe(620300);
  });

  it('corta cuando la actividad no esta en la tabla, con las que empiezan igual', () => {
    expect(() => resolveExportActivity(620900, ACTIVITIES)).toThrow(
      /no está en la tabla de actividades de WSFEX y ARCA la rechaza \(error 2105\)\. Las que empiezan con 620 son 62000, 620100, 620300\. Indicá la que corresponda con `--actividad`/,
    );
  });

  it('no valida contra la tabla cuando ARCA no informa actividades', () => {
    expect(resolveExportActivity(620900, [])).toBe(620900);
  });

  it('rechaza codigos que no son enteros positivos', () => {
    expect(() => resolveExportActivity(0)).toThrow(/entero positivo/);
    expect(() => resolveExportActivity(1.5)).toThrow(/entero positivo/);
  });
});

describe('resolveExportLanguage (TEST-16)', () => {
  const languages = [{ id: 1 }, { id: 2 }];

  it('valida el idioma contra la tabla de ARCA', () => {
    expect(resolveExportLanguage(2, languages)).toBe(2);
    expect(() => resolveExportLanguage(9, languages)).toThrow(/idioma 9 no existe/);
  });

  it('sin tabla no valida, y sin idioma va el de siempre', () => {
    expect(resolveExportLanguage(9, [])).toBe(9);
    expect(resolveExportLanguage(undefined, languages)).toBe(1);
  });
});
