import { X509Certificate } from 'node:crypto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CertificateExpiry {
  readonly daysRemaining: number;
  readonly expiresAt: Date;
  readonly isExpired: boolean;
}

export function readCertificateExpiry(pemContent: string): CertificateExpiry {
  const certificate = new X509Certificate(pemContent);
  const expiresAt = new Date(certificate.validTo);
  const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / MS_PER_DAY);

  return {
    daysRemaining,
    expiresAt,
    isExpired: daysRemaining < 0,
  };
}

export function isCertificateExpiringSoon(expiry: CertificateExpiry, thresholdDays: number): boolean {
  return !expiry.isExpired && expiry.daysRemaining <= thresholdDays;
}
