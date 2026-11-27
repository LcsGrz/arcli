import {
  Arca,
  type ArcaServiceName,
  ArcaServiceNames,
  AuthRepository,
  type Context,
  FileSystemTicketStorage,
  type ITicketStoragePort,
  MemoryTicketStorage,
} from '@arcasdk/core';

import { readPemFile } from '../../lib/security/pem';
import type { ArcaProfile } from '../../modules/config/arca-profile';
import {
  CertificateExpiredError,
  inspectCertificateExpiry,
  ownExportCertificate,
} from '../../modules/config/certificate-expiry';
import { resolveExportCredentials } from '../../modules/config/config.export-credentials';
import { nodeLocalFiles } from '../files/local-files';
import { systemClock } from '../time/system-clock';

import { ArcaExportGateway, type WsfexAuthenticator } from './arca-export.gateway';
import { installSoapDeadlines } from './soap-deadline';
import { avoidWeakDhe } from './tls';
import { ArcaVoucherCheckGateway, WSCDC_SERVICE, type WscdcAuthenticator } from './wscdc/arca-voucher-check.gateway';

/** El cliente de ARCA: quien lo pide se lo pasa a un gateway y no conoce el SDK. */
export type ArcaClient = Arca;

function createArcaClient(context: Context): ArcaClient {
  avoidWeakDhe(context.production === true);
  installSoapDeadlines();

  return new Arca(context);
}

/**
 * El login de WSAA con la misma configuracion que arma `Arca`, y el mismo almacenamiento: el ticket que guarda una
 * llamada lo reusa la otra.
 */
function createAuthRepository(context: Context): AuthRepository {
  installSoapDeadlines();

  const production = context.production ?? false;
  const ticketStorage =
    context.ticketStorage ??
    (context.ticketPath
      ? new FileSystemTicketStorage({ cuit: context.cuit, production, ticketPath: context.ticketPath })
      : new MemoryTicketStorage({ cuit: context.cuit, production }));

  return new AuthRepository({
    cert: context.cert,
    credentials: context.credentials,
    cuit: context.cuit,
    handleTicket: context.handleTicket ?? false,
    key: context.key,
    production,
    ticketStorage,
    useHttpsAgent: context.useHttpsAgent,
  });
}

/** El ticket de wsfex, para `FEXGetLast_CMP` (ver `ArcaExportGateway.getLastVoucherNumber`). */
function createWsfexAuthenticator(context: Context): WsfexAuthenticator {
  const auth = createAuthRepository(context);

  return async () => auth.getAuthParams(await auth.login(ArcaServiceNames.WSFEX), context.cuit).Auth;
}

/**
 * El ticket de wscdc. El SDK no conoce el servicio, pero `login` solo lo pone en el pedido a WSAA y en el nombre del
 * ticket guardado: el tipo se fuerza.
 */
function createWscdcAuthenticator(context: Context): WscdcAuthenticator {
  const auth = createAuthRepository(context);

  return async () => auth.getAuthParams(await auth.login(WSCDC_SERVICE as ArcaServiceName), context.cuit).Auth;
}

/** Los pedidos simultaneos comparten el login. Ni el ticket ni un error quedan guardados aca: el ticket, en su storage. */
function shareLogin(authenticate: WsfexAuthenticator): WsfexAuthenticator {
  let pending: ReturnType<WsfexAuthenticator> | undefined;

  return () => {
    pending ??= authenticate().finally(() => {
      pending = undefined;
    });

    return pending;
  };
}

/**
 * Si el cliente del SDK encuentra el ticket que pide el autenticador. Con `handleTicket` nadie lo guarda, y sin
 * `ticketPath` ni storage el SDK usa una carpeta propia: ahi el login previo de las lecturas seria uno de mas.
 */
function sharesTicket(context: Context): boolean {
  return !context.handleTicket && Boolean(context.ticketStorage ?? context.ticketPath);
}

export interface ArcaClientFactoryOptions {
  /**
   * Donde guardar los tickets de WSAA. Sin definir, en disco, en el `ticketPath` del perfil. Los del SDK fijan el CUIT
   * y el entorno al construirse: una fabrica con storage propio es de un solo CUIT y entorno.
   */
  readonly ticketStorage?: ITicketStoragePort;
}

export class ArcaClientFactory {
  private readonly ticketStorage?: ITicketStoragePort;

  public constructor(options: ArcaClientFactoryOptions = {}) {
    this.ticketStorage = options.ticketStorage;
  }

  /** Todo cliente de ARCA sale de aca: con el certificado vencido se corta antes de pedir el ticket a WSAA. */
  public create(runtime: Pick<ArcaProfile, 'certificateExpiry' | 'context'>): ArcaClient {
    if (runtime.certificateExpiry?.expired) {
      throw new CertificateExpiredError(runtime.certificateExpiry);
    }

    return createArcaClient(this.withTicketStorage(runtime.context));
  }

  /** WSCDC (`arcli constatar`), con el certificado de facturacion: lo que corta en `create` corta aca. */
  public createVoucherCheckGateway(
    runtime: Pick<ArcaProfile, 'certificateExpiry' | 'context' | 'environment'>,
  ): ArcaVoucherCheckGateway {
    if (runtime.certificateExpiry?.expired) {
      throw new CertificateExpiredError(runtime.certificateExpiry);
    }

    return new ArcaVoucherCheckGateway({
      authenticate: createWscdcAuthenticator(this.withTicketStorage(runtime.context)),
      environment: runtime.environment,
    });
  }

  /** El cliente de WSFEX, con su certificado (ver `resolveExportContext`). */
  public createForExport(
    runtime: Pick<ArcaProfile, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): ArcaClient {
    return createArcaClient(this.resolveExportContext(runtime));
  }

  /** El gateway de WSFEX, con el cliente y el autenticador del mismo certificado. */
  public createExportGateway(
    runtime: Pick<ArcaProfile, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): ArcaExportGateway {
    const context = this.resolveExportContext(runtime);

    const authenticate = shareLogin(createWsfexAuthenticator(context));

    return new ArcaExportGateway(
      createArcaClient(context),
      authenticate,
      sharesTicket(context) ? authenticate : undefined,
    );
  }

  /**
   * WSFEX se autentica con el certificado autorizado al servicio wsfex. Si `exportacion.cert`/`exportacion.key`
   * estan configurados usa esos archivos (y su propio vencimiento); si no, los mismos de facturacion.
   */
  private resolveExportContext(
    runtime: Pick<ArcaProfile, 'certificateExpiry' | 'config' | 'context' | 'environment'>,
  ): Context {
    const credentials = resolveExportCredentials(runtime.config, runtime.environment);

    if (!credentials.dedicated) {
      // El mismo certificado de facturacion: su vencimiento corta igual que en `create`.
      if (runtime.certificateExpiry?.expired) {
        throw new CertificateExpiredError(runtime.certificateExpiry);
      }

      return this.withTicketStorage(runtime.context);
    }

    const cert = readPemFile(nodeLocalFiles, credentials.cert, 'certificado');
    const notice = inspectCertificateExpiry(
      cert,
      runtime.environment,
      systemClock.now(),
      ownExportCertificate(runtime.config, runtime.environment) ? 'exportacion' : undefined,
    );

    if (notice?.expired) {
      throw new CertificateExpiredError(notice);
    }

    return this.withTicketStorage({
      ...runtime.context,
      cert,
      key: readPemFile(nodeLocalFiles, credentials.key, 'clave privada'),
    });
  }

  private withTicketStorage(context: Context): Context {
    return this.ticketStorage ? { ...context, ticketStorage: this.ticketStorage } : context;
  }
}
