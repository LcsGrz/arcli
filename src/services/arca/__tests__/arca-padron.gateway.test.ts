import { describe, expect, it } from 'vitest';

import { ArcaPadronGateway, mapTaxpayerDetails } from '../arca-padron.gateway';

// Respuestas reales de ARCA testing (15/10/2026), recortadas.
const PERSONA_FISICA = {
  datosGenerales: {
    apellido: 'VICTORIA CAROLINA',
    domicilioFiscal: {
      codPostal: '1030',
      descripcionProvincia: 'CIUDAD AUTONOMA BUENOS AIRES',
      direccion: 'LARREA 1',
    },
    nombre: 'DARIO',
  },
  datosRegimenGeneral: {
    actividad: [{ descripcionActividad: 'ALQUILER DE EQUIPO', idActividad: 439100, orden: 1 }],
    impuesto: [
      { descripcionImpuesto: 'GANANCIAS PERSONAS FISICAS', estadoImpuesto: 'AC', idImpuesto: 11 },
      { descripcionImpuesto: 'IVA', estadoImpuesto: 'AC', idImpuesto: 30 },
    ],
  },
  estadoClave: 'ACTIVO',
  idPersona: 20201797064,
  tipoPersona: 'FISICA',
};

const PERSONA_JURIDICA = {
  datosGenerales: {
    domicilioFiscal: { codPostal: '1439', direccion: 'BALANDRA CARMEN 6036' },
    razonSocial: 'JACKSON-MASON FC 53 535062',
  },
  estadoClave: 'ACTIVO',
  tipoPersona: 'JURIDICA',
};

describe('mapTaxpayerDetails', () => {
  it('arma nombre, domicilio, impuestos y condicion IVA de una persona fisica', () => {
    expect(mapTaxpayerDetails(20201797064, PERSONA_FISICA)).toEqual({
      activities: [{ description: 'ALQUILER DE EQUIPO', id: 439100 }],
      address: 'LARREA 1, CP 1030, CIUDAD AUTONOMA BUENOS AIRES',
      cuit: 20201797064,
      ivaCondition: 'responsable-inscripto',
      keyStatus: 'ACTIVO',
      monotributoCategory: null,
      monotributoCategoryLetter: null,
      monotributoCategorySince: null,
      name: 'VICTORIA CAROLINA DARIO',
      notices: [],
      personType: 'fisica',
      taxes: [
        { active: true, description: 'GANANCIAS PERSONAS FISICAS', id: 11 },
        { active: true, description: 'IVA', id: 30 },
      ],
    });
  });

  it('usa la razon social y, sin impuestos, no informa la condicion IVA', () => {
    expect(mapTaxpayerDetails(30546689979, PERSONA_JURIDICA)).toMatchObject({
      ivaCondition: null,
      name: 'JACKSON-MASON FC 53 535062',
      personType: 'juridica',
    });
  });

  it('lee monotributo con la categoria como objeto y los avisos de la constancia', () => {
    const taxpayer = mapTaxpayerDetails(20111111112, {
      datosMonotributo: {
        categoriaMonotributo: { descripcionCategoria: 'D LOCACIONES DE SERVICIO', idCategoria: 4, periodo: 202602 },
        impuesto: { descripcionImpuesto: 'MONOTRIBUTO', idImpuesto: 20 },
      },
      errorConstancia: { error: ['El domicilio fiscal no esta confirmado'] },
    });

    expect(taxpayer).toMatchObject({
      ivaCondition: 'responsable-monotributo',
      monotributoCategory: 'D LOCACIONES DE SERVICIO',
      monotributoCategoryLetter: 'D',
      monotributoCategorySince: '202602',
      notices: ['El domicilio fiscal no esta confirmado'],
    });
  });

  it('con la categoria como texto o sin periodo valido, no inventa la letra ni el periodo', () => {
    expect(
      mapTaxpayerDetails(20111111112, { datosMonotributo: { categoriaMonotributo: 'MONOTRIBUTO SOCIAL' } }),
    ).toMatchObject({
      monotributoCategory: 'MONOTRIBUTO SOCIAL',
      monotributoCategoryLetter: null,
      monotributoCategorySince: null,
    });
    expect(
      mapTaxpayerDetails(20111111112, {
        datosMonotributo: { categoriaMonotributo: { descripcionCategoria: 'B VENTAS', periodo: 0 } },
      }),
    ).toMatchObject({ monotributoCategoryLetter: 'B', monotributoCategorySince: null });
  });

  it('no repite las actividades que vienen en el regimen general y en el monotributo, y conserva el orden', () => {
    // Como 20000000001 en ARCA testing (18/11/2026): las mismas actividades en los dos bloques.
    const activity = (idActividad: number, descripcionActividad: string) => ({ descripcionActividad, idActividad });
    const taxpayer = mapTaxpayerDetails(20000000001, {
      datosMonotributo: {
        actividadMonotributista: [activity(352020, 'DISTRIBUCION DE GAS'), activity(551021, 'HOSPEDAJE')],
      },
      datosRegimenGeneral: {
        actividad: [activity(14121, 'CRIA DE GANADO'), activity(352020, 'DISTRIBUCION DE GAS')],
      },
    });

    expect(taxpayer.activities).toEqual([
      { description: 'CRIA DE GANADO', id: 14121 },
      { description: 'DISTRIBUCION DE GAS', id: 352020 },
      { description: 'HOSPEDAJE', id: 551021 },
    ]);
  });
});

describe('ArcaPadronGateway', () => {
  const gateway = (getTaxpayerDetails: () => Promise<unknown>) =>
    new ArcaPadronGateway({ registerInscriptionProofService: { getTaxpayerDetails } } as never);

  it('devuelve null si el CUIT no esta en el padron', async () => {
    await expect(gateway(async () => null).getTaxpayer(20111111112)).resolves.toBeNull();
  });

  it('traduce el error de servicio no autorizado', async () => {
    await expect(
      gateway(async () => {
        throw new Error('ns1:coe.notAuthorized');
      }).getTaxpayer(20201797064),
    ).rejects.toMatchObject({ code: 'PADRON_SERVICE_NOT_AUTHORIZED' });
  });
});
