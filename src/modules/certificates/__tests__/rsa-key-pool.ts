import type { generateKeyPairSync } from 'node:crypto';

/**
 * `generateKeyPairSync` que genera de verdad las primeras `size` claves de cada tipo y opciones y después las reusa en
 * rueda: dos llamadas seguidas nunca dan la misma clave, así que los tests de "clave de otro pedido" siguen valiendo.
 * Las claves se generan en el test, una vez por archivo; no hay ninguna guardada en el repo.
 *
 * Uso, en el archivo de tests:
 *
 *     vi.mock('node:crypto', async (importOriginal) => {
 *       const original = await importOriginal<typeof import('node:crypto')>();
 *       const { pooledGenerateKeyPairSync } = await import('./rsa-key-pool');
 *
 *       return { ...original, generateKeyPairSync: pooledGenerateKeyPairSync(original.generateKeyPairSync) };
 *     });
 */
export function pooledGenerateKeyPairSync(original: typeof generateKeyPairSync, size = 4): typeof generateKeyPairSync {
  const pools = new Map<string, { calls: number; pairs: unknown[] }>();

  return ((...args: Parameters<typeof generateKeyPairSync>) => {
    const id = JSON.stringify(args);
    const pool = pools.get(id) ?? { calls: 0, pairs: [] };

    pools.set(id, pool);

    const call = pool.calls++;

    if (pool.pairs.length < size) {
      pool.pairs.push(original(...args));
    }

    return pool.pairs[call % size];
  }) as typeof generateKeyPairSync;
}
