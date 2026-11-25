import { CertificateService } from '../modules/certificates/certificate.service';
import { ConfigService } from '../modules/config/config.service';
import { systemClock } from '../services/time/system-clock';

/** Cada operacion abre y cierra la config: entre una pregunta y otra el usuario puede tardar lo que quiera. */
export function withCertificateService<T>(run: (service: CertificateService, config: ConfigService) => T): T {
  const config = new ConfigService();

  try {
    return run(
      new CertificateService({ certificatesRoot: config.getCertificatesPath(), clock: systemClock, config }),
      config,
    );
  } finally {
    config.close();
  }
}
