import { Arca } from '@arcasdk/core';

import { readPemFile } from '../../lib/security/pem';
import { CertificateExpiredError, inspectCertificateExpiry } from '../../modules/config/certificate-expiry';
import { resolveExportCredentials } from '../../modules/config/config.export-credentials';

import type { ResolvedArcaRuntime } from './arca-context.resolver';

export class ArcaClientFactory {
  /** Todo cliente de ARCA sale de aca: con el certificado vencido se corta antes de pedir el ticket a WSAA. */
  public create(runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'context'>): Arca {
    if (runtime.certificateExpiry?.expired) {
      throw new CertificateExpiredError(runtime.certificateExpiry);
    }

    return new Arca(runtime.context);
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

    return new Arca({
      ...runtime.context,
      cert,
      key: readPemFile(credentials.key, 'clave privada'),
    });
  }
}
