import { ConfigurationError } from '../../lib/errors/app-error';

import type { ArcliConfig, ArcliEnvironment } from './config.schemas';

export interface ExportCredentials {
  readonly cert: string;
  readonly key: string;
  /** `false` cuando WSFEX usa los mismos archivos que facturacion (`cert` y `key`). */
  readonly dedicated: boolean;
}

/**
 * WSFEX exige un certificado autorizado al servicio `wsfex`, que en general no es el mismo que el de wsfe.
 * `exportacion.cert`/`exportacion.key` son opcionales: sin ellos se usan los certificados generales.
 */
export function resolveExportCredentials(
  config: Pick<ArcliConfig, 'cert' | 'exportacion' | 'key'>,
  environment: ArcliEnvironment,
): ExportCredentials {
  const dedicatedCert = config.exportacion?.cert[environment];
  const dedicatedKey = config.exportacion?.key[environment];

  if (Boolean(dedicatedCert) !== Boolean(dedicatedKey)) {
    throw new ConfigurationError(
      `Para WSFEX en ${environment} configurá el certificado y la clave juntos.`,
      { faltan: dedicatedCert ? [`exportacion.key.${environment}`] : [`exportacion.cert.${environment}`] },
      `Cargalos con "arcli config establecer exportacion.cert.${environment} <ruta>" y "arcli config establecer exportacion.key.${environment} <ruta>".`,
    );
  }

  const cert = dedicatedCert ?? config.cert[environment];
  const key = dedicatedKey ?? config.key[environment];

  if (!cert || !key) {
    throw new ConfigurationError(
      `Falta el certificado de WSFEX para ${environment}.`,
      {
        faltan: [
          ...(cert ? [] : [`exportacion.cert.${environment}`]),
          ...(key ? [] : [`exportacion.key.${environment}`]),
        ],
      },
      `Autorizá un certificado al servicio wsfex y cargalo con "arcli config establecer exportacion.cert.${environment} <ruta>" y "arcli config establecer exportacion.key.${environment} <ruta>".`,
    );
  }

  return { cert, dedicated: Boolean(dedicatedCert), key };
}
