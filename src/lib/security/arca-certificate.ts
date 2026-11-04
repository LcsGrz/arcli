import { createPrivateKey, X509Certificate } from 'node:crypto';

/**
 * Autoridades con las que ARCA firma los certificados de cada entorno (`CN` del emisor, con `O=AFIP`). El de
 * homologacion es "Computadores Test"; el de produccion, "Computadores".
 */
const ISSUER_ENVIRONMENTS: Readonly<Record<string, 'produccion' | 'testing'>> = {
  Computadores: 'produccion',
  'Computadores Test': 'testing',
};

export interface ArcaCertificateInfo {
  /** `CN` del sujeto: el alias con el que se creo en ARCA. */
  readonly alias?: string;
  /** `serialNumber` del sujeto sin el prefijo `CUIT `. */
  readonly cuit?: string;
  /** Sin definir si el emisor no es una autoridad de ARCA conocida. */
  readonly environment?: 'produccion' | 'testing';
  readonly expiresAt: Date;
  readonly issuer: string;
}

function readField(distinguishedName: string, field: string): string | undefined {
  const prefix = `${field}=`;

  return distinguishedName
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

/**
 * Lo que entrega el navegador o el Bloc de notas: con BOM, finales CRLF o espacios alrededor. Devuelve el bloque PEM
 * limpio, o `undefined` si no hay uno.
 */
export function normalizeCertificatePem(content: string): string | undefined {
  const match = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(content.replace(/^\uFEFF/, ''));

  if (!match) {
    return undefined;
  }

  const lines = match[0]
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return `${lines.join('\n')}\n`;
}

/** Tira si el contenido no es un certificado X.509. */
export function readArcaCertificate(pem: string): ArcaCertificateInfo {
  const certificate = new X509Certificate(pem);
  const issuer = readField(certificate.issuer, 'CN') ?? certificate.issuer.replace(/\n/g, ', ');
  const serialNumber = readField(certificate.subject, 'serialNumber');

  return {
    alias: readField(certificate.subject, 'CN'),
    cuit: serialNumber?.replace(/^CUIT\s*/i, ''),
    environment: ISSUER_ENVIRONMENTS[issuer],
    expiresAt: new Date(certificate.validTo),
    issuer,
  };
}

/** El certificado se emitio para esta clave privada: si no, ARCA lo rechaza al pedir el ticket. */
export function certificateMatchesKey(certificatePem: string, privateKeyPem: string): boolean {
  try {
    return new X509Certificate(certificatePem).checkPrivateKey(createPrivateKey(privateKeyPem));
  } catch {
    return false;
  }
}
