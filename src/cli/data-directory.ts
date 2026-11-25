import envPaths from 'env-paths';
import { resolve } from 'node:path';

/**
 * Carpeta de datos de ARCLI: la config, los tickets, los certificados, el plugin de PDF y los cachés. Es el unico lugar
 * que conoce la de siempre y que lee `ARCLI_CONFIG_DIR`, que usa otra: para tener una config aparte o para los tests de
 * punta a punta, que no pueden tocar la real. Todo lo demas la recibe.
 *
 * La de siempre es la que eligio `conf` (la saca de `env-paths`): cambiarla deja a cada usuario sin su config.
 */
export function dataDirectory(): string {
  const custom = process.env.ARCLI_CONFIG_DIR?.trim();

  return custom ? resolve(custom) : envPaths('arcli', { suffix: '' }).config;
}
