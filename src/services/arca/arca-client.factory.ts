import {
  Arca,
  ArcaServiceNames,
  AuthRepository,
  type Context,
  FileSystemTicketStorage,
  MemoryTicketStorage,
} from '@arcasdk/core';
import tls from 'node:tls';

import { readPemFile } from '../../lib/security/pem';
import { CertificateExpiredError, inspectCertificateExpiry } from '../../modules/config/certificate-expiry';
import { resolveExportCredentials } from '../../modules/config/config.export-credentials';

import type { ResolvedArcaRuntime } from './arca-context.resolver';
import { ArcaExportGateway, type WsfexAuthenticator } from './arca-export.gateway';

function createArcaClient(context: Context): Arca {
  // WSFE y WSFEX de producción prefieren DHE con una clave de 1024 bits, que corta con `dh key too small` donde OpenSSL
  // usa SECLEVEL=2 (Debian y otras distros). Sin DHE negocian otra suite y nada más se afloja, a diferencia de
  // `useHttpsAgent` del SDK, que baja a SECLEVEL=1 y habilita la renegociación insegura en todas las conexiones.
  if (context.production === true && !tls.DEFAULT_CIPHERS.includes('!DHE')) {
    tls.DEFAULT_CIPHERS += ':!DHE';
  }

  return new Arca(context);
}

/**
 * Pide el ticket de wsfex con la misma configuracion que arma `Arca`, y el mismo almacenamiento: el ticket que
 * guarda una llamada lo reusa la otra. Es para `FEXGetLast_CMP` (ver `ArcaExportGateway.getLastVoucherNumber`).
 */
function createWsfexAuthenticator(context: Context): WsfexAuthenticator {
  const production = context.production ?? false;
  const ticketStorage =
    context.ticketStorage ??
    (context.ticketPath
      ? new FileSystemTicketStorage({ cuit: context.cuit, production, ticketPath: context.ticketPath })
      : new MemoryTicketStorage({ cuit: context.cuit, production }));
  const auth = new AuthRepository({
    cert: context.cert,
    credentials: context.credentials,
    cuit: context.cuit,
    handleTicket: context.handleTicket ?? false,
    key: context.key,
    production,
    ticketStorage,
    useHttpsAgent: context.useHttpsAgent,
  });

  return async () => auth.getAuthParams(await auth.login(ArcaServiceNames.WSFEX), context.cuit).Auth;
}

export class ArcaClientFactory {
  /** Todo cliente de ARCA sale de aca: con el certificado vencido se corta antes de pedir el ticket a WSAA. */
  public create(runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'context'>): Arca {
    if (runtime.certificateExpiry?.expired) {
      throw new CertificateExpiredError(runtime.certificateExpiry);
    }

    return createArcaClient(runtime.context);
  }

  /** El cliente de WSFEX, con su certificado (ver `resolveExportContext`). */
  public createForExport(
    runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): Arca {
    return createArcaClient(this.resolveExportContext(runtime));
  }

  /** El gateway de WSFEX, con el cliente y el autenticador del mismo certificado. */
  public createExportGateway(
    runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): ArcaExportGateway {
    const context = this.resolveExportContext(runtime);

    return new ArcaExportGateway(createArcaClient(context), createWsfexAuthenticator(context));
  }

  /**
   * WSFEX se autentica con el certificado autorizado al servicio wsfex. Si `exportacion.cert`/`exportacion.key`
   * estan configurados usa esos archivos (y su propio vencimiento); si no, los mismos de facturacion.
   */
  private resolveExportContext(
    runtime: Pick<ResolvedArcaRuntime, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): Context {
    const credentials = resolveExportCredentials(runtime.config, runtime.environment);

    if (!credentials.dedicated) {
      // El mismo certificado de facturacion: su vencimiento corta igual que en `create`.
      if (runtime.certificateExpiry?.expired) {
        throw new CertificateExpiredError(runtime.certificateExpiry);
      }

      return runtime.context;
    }

    const cert = readPemFile(credentials.cert, 'certificado');
    const notice = inspectCertificateExpiry(cert, runtime.environment);

    if (notice?.expired) {
      throw new CertificateExpiredError(notice);
    }

    return { ...runtime.context, cert, key: readPemFile(credentials.key, 'clave privada') };
  }
}
