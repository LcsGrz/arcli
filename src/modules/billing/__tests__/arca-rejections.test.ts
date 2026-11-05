import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
      const [, anchor] = guide.split('troubleshooting.md#');

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
