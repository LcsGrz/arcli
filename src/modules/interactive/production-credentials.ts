import { inspectConfiguredCertificates } from '../config/certificate-expiry';
import type { ArcliConfig } from '../config/config.schemas';

import { listMissingSetupKeys } from './config-fields';

interface ProductionCredentials {
  /** Que el certificado general de produccion vencio, si vencio. */
  readonly expiredSummary?: string;
  readonly missesCertificate: boolean;
  readonly missesKey: boolean;
}

/** Con que se emitiria en produccion: que falta y si el certificado vencio. Lee el certificado, sin red. */
export function inspectProductionCredentials(config: ArcliConfig, now: Date): ProductionCredentials {
  const missing = listMissingSetupKeys(config, 'produccion');

  return {
    expiredSummary: inspectConfiguredCertificates(config, { activeEnvironment: 'produccion', now }).find(
      (notice) => notice.environment === 'produccion' && !notice.use && notice.expired,
    )?.summary,
    missesCertificate: missing.includes('cert.produccion'),
    missesKey: missing.includes('key.produccion'),
  };
}
