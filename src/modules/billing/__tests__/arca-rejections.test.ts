import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TROUBLESHOOTING_URL } from '../../../lib/links';
import { ARCA_REJECTIONS, findArcaRejections, formatArcaRejection } from '../arca-rejections';
import { mapBillingResponse } from '../billing-response';

const TROUBLESHOOTING = readFileSync(join(process.cwd(), 'docs', 'troubleshooting.md'), 'utf8');

/** Slug de un titulo como lo arma GitHub: minusculas, sin puntuacion, espacios a guiones. */
function headingSlugs(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/^#{2,4} (.+)$/gm)].map(([, title]) =>
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replace(/ /g, '-'),
    ),
  );
}

describe('tabla de rechazos de ARCA', () => {
  it('cada código tiene su fila en docs/troubleshooting.md', () => {
    for (const code of ARCA_REJECTIONS.flatMap((rejection) => rejection.codes)) {
      expect(TROUBLESHOOTING, `falta el código ${code}`).toContain(`\`${code}\``);
    }
  });

  it('cada link a troubleshooting apunta a un título que existe', () => {
    const slugs = headingSlugs(TROUBLESHOOTING);

    for (const guide of ARCA_REJECTIONS.flatMap((rejection) => rejection.guide ?? [])) {
      const [, anchor] = guide.split(`${TROUBLESHOOTING_URL}#`);

      if (anchor) {
        expect(slugs, `no existe #${anchor}`).toContain(anchor);
      }
    }
  });

  it('no repite códigos entre filas', () => {
    const codes = ARCA_REJECTIONS.flatMap((rejection) => rejection.codes);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('encuentra por código o por mensaje', () => {
    expect(findArcaRejections([10243], '')).toHaveLength(1);
    expect(findArcaRejections([], 'Campo DocNro no puede ser igual al del emisor.')).toHaveLength(1);
    expect(findArcaRejections([99999], 'otra cosa')).toEqual([]);
  });

  it('10154: la nota FCE de anulación pide que el comprador rechace el asociado, por código o por mensaje', () => {
    const [rejection] = findArcaRejections([10154], '');

    expect(formatArcaRejection(rejection)).toMatch(
      /^Una nota FCE de anulación necesita que el comprador haya rechazado.*Pedile al comprador que lo rechace.*sin `--anulacion`.*Más info: https:.*#arca-rechaza-la-nota-fce-de-anulación$/,
    );
    expect(findArcaRejections([], 'Comprobante electronico autorizado, NO rechazado por el Comprador')).toEqual([
      rejection,
    ]);
  });

  it('el texto dice qué pasó, qué hacer y el link', () => {
    const [rejection] = findArcaRejections([10174], '');

    expect(formatArcaRejection(rejection)).toMatch(/^El CBU no está registrado.*Usá un CBU propio.*Más info: https:/);
  });
});

describe('mapBillingResponse: sugerencias', () => {
  it('lee los códigos de las observaciones, no solo de los errores', () => {
    const summary = mapBillingResponse({
      cae: '',
      caeFchVto: '',
      response: {
        FeDetResp: {
          FECAEDetResponse: [
            { Observaciones: { Obs: [{ Code: 10243, Msg: 'Condicion IVA receptor no valida' }] }, Resultado: 'R' },
          ],
        },
      },
    } as never);

    expect(summary.suggestions).toEqual([expect.stringContaining('IVA receptor no es válido para la letra')]);
  });

  it('una observación de padrón en un comprobante aprobado aclara que no es un rechazo', () => {
    const summary = mapBillingResponse({
      cae: '12345678901234',
      caeFchVto: '20261130',
      response: {
        FeDetResp: { FECAEDetResponse: [{ Observaciones: { Obs: [{ Code: 10217, Msg: 'Obs' }] }, Resultado: 'A' }] },
      },
    } as never);

    expect(summary.status).toBe('observado');
    expect(summary.suggestions).toEqual([expect.stringContaining('No es un rechazo')]);
  });

  it.each([
    [10236, /límite de tu categoría de Monotributo.*No es un rechazo.*próxima recategorización.*`arcli monotributo`/],
    [817, /límite de tu categoría de Monotributo/],
    [10235, /categoría máxima del Monotributo.*No es un rechazo.*régimen general.*`arcli monotributo`/],
    [816, /categoría máxima del Monotributo/],
  ])('la observación %i del tope del Monotributo explica que el comprobante está emitido (MONO-6)', (code, text) => {
    const summary = mapBillingResponse({
      cae: '12345678901234',
      caeFchVto: '20261130',
      response: {
        FeDetResp: { FECAEDetResponse: [{ Observaciones: { Obs: [{ Code: code, Msg: 'Obs' }] }, Resultado: 'A' }] },
      },
    } as never);

    expect(summary.status).toBe('observado');
    expect(summary.suggestions).toEqual([expect.stringMatching(text)]);
  });

  it('el receptor igual al emisor se reconoce por el código 10069 o por el mensaje', () => {
    expect(findArcaRejections([10069], '')).toEqual(findArcaRejections([], 'DocNro no puede ser igual al del emisor'));
  });

  it('separa el 10017 (receptor no activo) del 10217 (crédito fiscal de un monotributista)', () => {
    const [inactive] = findArcaRejections([10017], '');
    const [monotributo] = findArcaRejections([10217], '');

    expect(formatArcaRejection(inactive)).toMatch(/no figura activo en el padrón/);
    expect(formatArcaRejection(monotributo)).toMatch(/monotributista.*Procedimiento permanente de transición/);
    expect(formatArcaRejection(monotributo)).not.toMatch(/condición del receptor/);
  });

  it('un receptor que no está en los padrones (10015, solo en observaciones) tiene su sugerencia', () => {
    // Respuesta real de ARCA testing (18/11/2026): `fb --cuit 20201797064`.
    const summary = mapBillingResponse({
      cae: '',
      caeFchVto: '',
      response: {
        FeDetResp: {
          FECAEDetResponse: [
            {
              Observaciones: {
                Obs: [
                  {
                    Code: 10015,
                    Msg: 'Factura B (CbteDesde igual a CbteHasta), DocTipo: 80, DocNro 20201797064 no se encuentra registrado en los padrones de AFIP y no corresponde a una cuit pais.',
                  },
                ],
              },
              Resultado: 'R',
            },
          ],
        },
      },
    } as never);

    expect(summary.status).toBe('rechazado');
    expect(summary.suggestions).toEqual([
      expect.stringMatching(/^ARCA no encuentra el documento del receptor en sus padrones\. Revisá el documento/),
    ]);
  });

  it('un rechazo sin código conocido pide revisar errores y observaciones', () => {
    const summary = mapBillingResponse({
      cae: '',
      caeFchVto: '',
      response: {
        Errors: { Err: [{ Code: 99999, Msg: 'Otro' }] },
        FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] },
      },
    } as never);

    expect(summary.suggestions).toEqual(['Revisá observaciones y errores de ARCA antes de volver a emitir.']);
  });
});
