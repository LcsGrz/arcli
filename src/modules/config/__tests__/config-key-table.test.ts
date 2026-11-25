import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ArcliConfig } from '../config.schemas';
import {
  type ConfigKeyRow,
  configPublicKeySchema,
  type CoveringKeys,
  storedKeyOf,
  type UncoveredData,
} from '../config-key-table';

// Los tipos los controla `yarn typecheck`: en ejecución esas afirmaciones no hacen nada.
describe('tabla de claves de config', () => {
  it('cada dato del esquema tiene su clave', () => {
    expectTypeOf<UncoveredData<ArcliConfig>>().toEqualTypeOf<never>();
  });

  it('un dato nuevo sin clave no compila, suelto o en un grupo', () => {
    type WithNewData = ArcliConfig & { grupo?: { otro?: string }; nuevo?: number };

    expectTypeOf<UncoveredData<WithNewData>>().toEqualTypeOf<'grupo.otro' | 'nuevo'>();
    // @ts-expect-error: queda `nuevo` sin clave.
    expectTypeOf<CoveringKeys<'cuit', 'nuevo'>>().not.toBeNever();
  });

  it('una ruta que no está en el esquema, o un grupo entero, no compila', () => {
    const rows: readonly ConfigKeyRow[] = [
      { stored: 'emisor.logo' },
      // @ts-expect-error: el esquema no tiene `cuil`.
      { stored: 'cuil' },
      // @ts-expect-error: `emisor` es un grupo.
      { stored: 'emisor' },
    ];

    expect(rows).toHaveLength(3);
  });

  it('dos claves no guardan en el mismo lugar', () => {
    const stored = configPublicKeySchema.options.map(storedKeyOf);

    expect(new Set(stored).size).toBe(stored.length);
  });
});
