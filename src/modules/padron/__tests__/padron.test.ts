import { describe, expect, it } from 'vitest';

import { deriveIvaCondition, PADRON_TAX_IDS, parseArcaPeriod, parseMonotributoCategoryLetter } from '../padron';
import { formatPadronAsJson, formatPadronAsText } from '../padron.presenter';

const tax = (id: number, active = true) => ({ active, description: String(id), id });

describe('deriveIvaCondition', () => {
  it('monotributo gana sobre el resto', () => {
    expect(deriveIvaCondition({ monotributo: true, taxes: [tax(PADRON_TAX_IDS.iva)] })).toBe('responsable-monotributo');
    expect(deriveIvaCondition({ monotributo: false, taxes: [tax(PADRON_TAX_IDS.monotributo)] })).toBe(
      'responsable-monotributo',
    );
  });

  it('IVA activo es responsable inscripto; IVA exento, sujeto exento', () => {
    expect(deriveIvaCondition({ monotributo: false, taxes: [tax(11), tax(PADRON_TAX_IDS.iva)] })).toBe(
      'responsable-inscripto',
    );
    expect(deriveIvaCondition({ monotributo: false, taxes: [tax(PADRON_TAX_IDS.ivaExento)] })).toBe('sujeto-exento');
  });

  it('sin impuestos que alcancen, o con IVA dado de baja, no adivina', () => {
    expect(deriveIvaCondition({ monotributo: false, taxes: [] })).toBeNull();
    expect(deriveIvaCondition({ monotributo: false, taxes: [tax(PADRON_TAX_IDS.iva, false)] })).toBeNull();
  });
});

describe('parseMonotributoCategoryLetter', () => {
  it('saca la letra del principio de la descripcion de ARCA', () => {
    expect(parseMonotributoCategoryLetter('E VENTAS DE COSAS MUEBLES')).toBe('E');
    expect(parseMonotributoCategoryLetter(' k  locaciones de servicio')).toBe('K');
    expect(parseMonotributoCategoryLetter('A')).toBe('A');
  });

  it('sin una letra de A a K sola al principio, no la inventa', () => {
    expect(parseMonotributoCategoryLetter(null)).toBeNull();
    expect(parseMonotributoCategoryLetter('')).toBeNull();
    expect(parseMonotributoCategoryLetter('L VENTAS')).toBeNull();
    expect(parseMonotributoCategoryLetter('EVENTUAL')).toBeNull();
    expect(parseMonotributoCategoryLetter('CATEGORIA E')).toBeNull();
  });
});

describe('parseArcaPeriod', () => {
  it('acepta yyyymm como numero o texto', () => {
    expect(parseArcaPeriod(201309)).toBe('201309');
    expect(parseArcaPeriod(' 202612 ')).toBe('202612');
  });

  it('acepta enero, el borde inferior del mes (TEST-19)', () => {
    expect(parseArcaPeriod(202601)).toBe('202601');
    expect(parseArcaPeriod('201901')).toBe('201901');
  });

  it('descarta lo que no es un periodo', () => {
    expect(parseArcaPeriod(undefined)).toBeNull();
    expect(parseArcaPeriod(202613)).toBeNull();
    expect(parseArcaPeriod(202600)).toBeNull();
    expect(parseArcaPeriod('20130901')).toBeNull();
    expect(parseArcaPeriod('abc')).toBeNull();
  });
});

describe('padron presenter', () => {
  const taxpayer = {
    activities: [
      { description: 'ALQUILER', id: 439100 },
      { description: 'INMOBILIARIA', id: 681098 },
    ],
    address: 'LARREA 1, CP 1030',
    cuit: 20201797064,
    ivaCondition: 'responsable-inscripto' as const,
    keyStatus: 'ACTIVO',
    monotributoCategory: null,
    monotributoCategoryLetter: null,
    monotributoCategorySince: null,
    name: 'VICTORIA CAROLINA DARIO',
    notices: [],
    personType: 'fisica' as const,
    taxes: [tax(30)],
  };

  it('el JSON usa claves en castellano y la condicion IVA del CLI', () => {
    expect(JSON.parse(formatPadronAsJson({ environment: 'testing', taxpayer }))).toMatchObject({
      actividades: [
        { descripcion: 'ALQUILER', id: 439100 },
        { descripcion: 'INMOBILIARIA', id: 681098 },
      ],
      condicionIva: 'responsable-inscripto',
      cuit: 20201797064,
      entorno: 'testing',
      nombre: 'VICTORIA CAROLINA DARIO',
      tipoPersona: 'fisica',
    });
  });

  it('en texto muestra la actividad principal y cuantas mas hay', () => {
    const text = formatPadronAsText({ environment: 'testing', taxpayer });

    expect(text).toContain('ALQUILER (y 1 más)');
    expect(text).toContain('Responsable inscripto');
  });

  it('sin condicion IVA pide indicarla con --ir', () => {
    expect(formatPadronAsText({ environment: 'testing', taxpayer: { ...taxpayer, ivaCondition: null } })).toContain(
      'indicala con `--ir`',
    );
  });

  describe('categoria del monotributo', () => {
    const monotributista = {
      ...taxpayer,
      ivaCondition: 'responsable-monotributo' as const,
      monotributoCategory: 'E VENTAS DE COSAS MUEBLES',
      monotributoCategoryLetter: 'E' as const,
      monotributoCategorySince: '201309',
    };

    it('en el JSON suma la letra y el periodo sin tocar categoriaMonotributo', () => {
      expect(JSON.parse(formatPadronAsJson({ environment: 'testing', taxpayer: monotributista }))).toMatchObject({
        categoriaMonotributo: 'E VENTAS DE COSAS MUEBLES',
        categoriaMonotributoDesde: '201309',
        categoriaMonotributoLetra: 'E',
      });
    });

    it('en texto muestra la letra aparte y el mes desde el que rige', () => {
      const text = formatPadronAsText({ environment: 'testing', taxpayer: monotributista });

      expect(text).toMatch(/Categoría monotributo\s+E · VENTAS DE COSAS MUEBLES/);
      expect(text).toMatch(/Categoría vigente desde\s+09\/2013/);
    });

    it('si no es monotributista, los campos van en null y no hay filas de categoria', () => {
      expect(JSON.parse(formatPadronAsJson({ environment: 'testing', taxpayer }))).toMatchObject({
        categoriaMonotributo: null,
        categoriaMonotributoDesde: null,
        categoriaMonotributoLetra: null,
      });
      expect(formatPadronAsText({ environment: 'testing', taxpayer })).not.toContain('Categoría');
    });

    it('sin letra ni periodo, muestra la descripcion como viene y N/D', () => {
      const text = formatPadronAsText({
        environment: 'testing',
        taxpayer: {
          ...monotributista,
          monotributoCategory: 'SOCIAL',
          monotributoCategoryLetter: null,
          monotributoCategorySince: null,
        },
      });

      expect(text).toMatch(/Categoría monotributo\s+SOCIAL/);
      expect(text).toMatch(/Categoría vigente desde\s+N\/D/);
    });
  });
});
