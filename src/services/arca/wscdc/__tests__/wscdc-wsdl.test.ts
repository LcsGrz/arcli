import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El WSDL de WSCDC que usa `arcli constatar` es el oficial: `@arcasdk/core` 2.0.2 no lo trae. Los de `fixtures/` se
 * bajaron el 27/11/2026 con un GET a `?WSDL` (homologación `https://wswhomo.afip.gov.ar/WSCDC/service.asmx?WSDL`,
 * 21454 bytes; producción `https://servicios1.afip.gov.ar/WSCDC/service.asmx?WSDL`, el mismo esquema con otra
 * `soap:address`). Si ARCA publica otra versión, se bajan de nuevo los dos y se actualiza el del código.
 *
 * Tests primero (SDK-10): el módulo todavía no existe. Se carga con un `import()` de ruta variable para que el
 * typecheck pase hoy; al implementarlo, pasá a `import { WSCDC_WSDL } from '../wscdc-wsdl'` y cada `it.fails` a `it`.
 */
type Environment = 'produccion' | 'testing';

const MODULE = '../wscdc-wsdl';

async function wsdlOf(environment: Environment): Promise<string> {
  const module = (await import(/* @vite-ignore */ MODULE).catch((error: unknown) =>
    expect.fail(`Falta src/services/arca/wscdc/wscdc-wsdl.ts con WSCDC_WSDL: ${String(error)}`),
  )) as { readonly WSCDC_WSDL?: Partial<Record<Environment, string>> };

  expect(module.WSCDC_WSDL?.[environment], `WSCDC_WSDL.${environment}`).toBeTypeOf('string');

  return module.WSCDC_WSDL![environment]!;
}

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

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['testing', 'produccion'] as const)('el de %s es el oficial, tal cual', async (environment) => {
    expect(normalized(await wsdlOf(environment))).toBe(official(environment));
  });
});
