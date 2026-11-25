import tls from 'node:tls';

/**
 * WSFE y WSFEX de producción prefieren DHE con una clave de 1024 bits, que corta con `dh key too small` donde OpenSSL
 * usa SECLEVEL=2 (Debian y otras distros). Sin DHE negocian otra suite y nada más se afloja, a diferencia de
 * `useHttpsAgent` del SDK, que baja a SECLEVEL=1 y habilita la renegociación insegura en todas las conexiones.
 */
export function avoidWeakDhe(production: boolean): void {
  if (production && !tls.DEFAULT_CIPHERS.includes('!DHE')) {
    tls.DEFAULT_CIPHERS += ':!DHE';
  }
}
