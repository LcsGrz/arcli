import { get } from 'node:https';

import type { RegistryRequest } from '../../modules/update-check/update-check.service';

/**
 * Un GET que, al cancelarlo, corta tambien la conexion. Con `fetch` no alcanza: si se cancela mientras conecta, el
 * socket queda hasta su tope (10 segundos) y el proceso no termina antes.
 */
export const requestNpmRegistry: RegistryRequest = (url, { signal }) =>
  new Promise((resolve, reject) => {
    get(url, { agent: false, signal }, (response) => {
      const status = response.statusCode ?? 0;
      let body = '';

      response
        .setEncoding('utf8')
        .on('data', (chunk: string) => (body += chunk))
        .on('error', reject)
        .on('end', () => {
          resolve({ json: async () => JSON.parse(body) as unknown, ok: status >= 200 && status < 300 });
        });
    }).on('error', reject);
  });
