import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { WSCDC_WSDL } from '../wscdc-wsdl';

/**
 * El WSDL de WSCDC que usa `arcli constatar` es el oficial: `@arcasdk/core` 2.0.2 no lo trae. Los de `fixtures/` se
 * bajaron el 27/11/2026 con un GET a `?WSDL` (homologación `https://wswhomo.afip.gov.ar/WSCDC/service.asmx?WSDL`,
 * 21454 bytes; producción `https://servicios1.afip.gov.ar/WSCDC/service.asmx?WSDL`, el mismo esquema con otra
 * `soap:address`). Si ARCA publica otra versión, se bajan de nuevo los dos y se actualiza el del código.
 */
type Environment = 'produccion' | 'testing';

/** Sin los saltos de línea de Windows ni los espacios del final: git guarda los `.wsdl` con LF. */
function normalized(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function official(environment: Environment): string {
  return normalized(readFileSync(new URL(`fixtures/wscdc-${environment}.wsdl`, import.meta.url), 'utf8'));
}

describe('WSDL de WSCDC', () => {
  it('los oficiales apuntan cada uno a su entorno y declaran ComprobanteConstatar', () => {
    expect(official('testing')).toContain('location="https://wswhomo.afip.gov.ar/WSCDC/service.asmx"');
    expect(official('produccion')).toContain('location="https://servicios1.afip.gov.ar/WSCDC/service.asmx"');

    for (const environment of ['testing', 'produccion'] as const) {
      expect(official(environment)).toContain('targetNamespace="http://servicios1.afip.gob.ar/wscdc/"');
      expect(official(environment)).toContain('<s:element name="ComprobanteConstatar">');
    }
  });

  it.each(['testing', 'produccion'] as const)('el de %s es el oficial, tal cual', (environment) => {
    expect(normalized(WSCDC_WSDL[environment])).toBe(official(environment));
  });
});
