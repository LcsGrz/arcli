import { Agent, get, globalAgent } from 'node:https';
import type { Duplex } from 'node:stream';

import type { RegistryRequest } from '../../modules/update-check/update-check.service';

/**
 * Un GET que, al cancelarlo, corta tambien la conexion, en cualquier momento. Con `fetch` no alcanza: si se cancela
 * mientras conecta, el socket queda hasta su tope (10 segundos) y el proceso no termina antes.
 */
export const requestNpmRegistry: RegistryRequest = (url, { signal }) =>
  new Promise((resolve, reject) => {
    // Las opciones del agente global traen el proxy del entorno (`NODE_USE_ENV_PROXY`), como en `fetch`.
    const agent = new Agent({ ...globalAgent.options, keepAlive: false });
    const connect = agent.createConnection.bind(agent);
    const sockets: Duplex[] = [];

    // A traves de un proxy, `signal` no corta el tunel a medio armar: el socket llega al pedido recien al final.
    agent.createConnection = (...args) => {
      const socket = connect(...args);

      if (socket) {
        sockets.push(socket);
      }

      return socket;
    };
    signal.addEventListener('abort', () => {
      sockets.forEach((socket) => socket.destroy());
      reject(new Error('Consulta a npm cancelada.'));
    });

    get(url, { agent, signal }, (response) => {
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
