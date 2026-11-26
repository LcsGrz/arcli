import type { LocalFiles } from '../../lib/files/local-files';
import { readCertificateExpiry } from '../../lib/security/certificate';
import { readPemFile } from '../../lib/security/pem';
import { inspectCertificateExpiry } from '../config/certificate-expiry';
import type { ArcliConfig } from '../config/config.schemas';

type CredentialState = 'falta' | 'ilegible' | 'ok';

interface ProductionCredentials {
  readonly certificate: CredentialState;
  /** Que el certificado general de produccion vencio, si vencio. */
  readonly expiredSummary?: string;
  readonly key: CredentialState;
}

/** `read` tira si el archivo no existe, no se puede leer o no es lo que tiene que ser. */
function credentialState(path: string | undefined, read: (path: string) => void): CredentialState {
  if (!path) return 'falta';

  try {
    read(path);

    return 'ok';
  } catch {
    return 'ilegible';
  }
}

/** Con que se emitiria en produccion: que falta, que no se puede leer y si el certificado vencio. Sin red. */
export function inspectProductionCredentials(
  config: Pick<ArcliConfig, 'cert' | 'key'>,
  now: Date,
  files: LocalFiles,
): ProductionCredentials {
  let expiredSummary: string | undefined;
  const certificate = credentialState(config.cert.produccion, (path) => {
    const pem = readPemFile(files, path, 'certificado');

    // `inspectCertificateExpiry` calla si el contenido no es un certificado: esta lectura es la que tira.
    if (readCertificateExpiry(pem, now).isExpired) {
      expiredSummary = inspectCertificateExpiry(pem, 'produccion', now)?.summary;
    }
  });

  return {
    certificate,
    expiredSummary,
    key: credentialState(config.key.produccion, (path) => readPemFile(files, path, 'clave privada')),
  };
}
