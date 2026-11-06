import { Arca, type Context } from '@arcasdk/core';
import tls from 'node:tls';

import { readPemFile } from '../../lib/security/pem';
import { CertificateExpiredError, inspectCertificateExpiry } from '../../modules/config/certificate-expiry';
import { resolveExportCredentials } from '../../modules/config/config.export-credentials';

import type { ResolvedArcaRuntime } from './arca-context.resolver';

function createArcaClient(context: Context): Arca {
  // WSFE y WSFEX de producción prefieren DHE con una clave de 1024 bits, que corta con `dh key too small` donde OpenSSL
  // usa SECLEVEL=2 (Debian y otras distros). Sin DHE negocian otra suite y nada más se afloja, a diferencia de
  // `useHttpsAgent` del SDK, que baja a SECLEVEL=1 y habilita la renegociación insegura en todas las conexiones.
  if (context.production === true && !tls.DEFAULT_CIPHERS.includes('!DHE')) {
    tls.DEFAULT_CIPHERS += ':!DHE';
  }

  return new Arca(context);
}

export class ArcaClientFactory {
  /** Todo cliente de ARCA sale de aca: con el certificado vencido se corta antes de pedir el ticket a WSAA. */
  public create(runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'context'>): Arca {
    if (runtime.certificateExpiry?.expired) {
      throw new CertificateExpiredError(runtime.certificateExpiry);
    }

    return createArcaClient(runtime.context);
  }

  /**
   * WSFEX se autentica con el certificado autorizado al servicio wsfex. Si `exportacion.cert`/`exportacion.key`
   * estan configurados usa esos archivos (y su propio vencimiento); si no, los mismos de facturacion.
   */
  public createForExport(
    runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): Arca {
    const credentials = resolveExportCredentials(runtime.config, runtime.environment);

    if (!credentials.dedicated) {
      return this.create(runtime);
    }

    const cert = readPemFile(credentials.cert, 'certificado');
    const notice = inspectCertificateExpiry(cert, runtime.environment);

    if (notice?.expired) {
      throw new CertificateExpiredError(notice);
    }

    return createArcaClient({
      ...runtime.context,
      cert,
      key: readPemFile(credentials.key, 'clave privada'),
    });
  }
}
