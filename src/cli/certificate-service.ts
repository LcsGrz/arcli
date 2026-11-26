import { CertificateService } from '../modules/certificates/certificate.service';
import type { ConfigService } from '../modules/config/config.service';
import { nodeCertificateStore } from '../services/files/certificate-store';
import { systemClock } from '../services/time/system-clock';

import { type Synchronous, withConfigService } from './config-service';

/** El servicio de certificados sobre una config ya abierta, con los archivos en el disco. */
export function createCertificateService(config: ConfigService): CertificateService {
  return new CertificateService({
    certificatesRoot: config.getCertificatesPath(),
    clock: systemClock,
    config,
    store: nodeCertificateStore,
  });
}

/** Cada operacion abre y cierra la config: entre una pregunta y otra el usuario puede tardar lo que quiera. */
export function withCertificateService<T>(
  run: (service: CertificateService, config: ConfigService) => Synchronous<T>,
): Synchronous<T> {
  return withConfigService<T>((config) => run(createCertificateService(config), config));
}
