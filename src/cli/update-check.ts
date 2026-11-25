import { checkForUpdate, type UpdateCheckResult } from '../modules/update-check/update-check.service';
import { requestNpmRegistry } from '../services/npm/npm-registry';

import { dataDirectory } from './data-directory';
import { CLI_VERSION } from './version';

/** Si hay una version nueva. `async`: si no se puede resolver la carpeta, rechaza en vez de cortar el comando. */
export async function checkCliUpdate(options: {
  readonly maxAgeMs?: number;
  readonly signal: AbortSignal;
}): Promise<UpdateCheckResult | null> {
  return checkForUpdate(CLI_VERSION, { ...options, cwd: dataDirectory(), request: requestNpmRegistry });
}
