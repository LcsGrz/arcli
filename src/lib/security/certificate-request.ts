import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export interface CertificateRequestInput {
  /** Nombre del certificado en ARCA: el "nombre simbolico del DN" de WSASS o el alias del Administrador. */
  readonly alias: string;
  readonly cuit: string;
  /** Razon social; ARCA no la exige, pero queda en el certificado. */
  readonly organization?: string;
}

export interface CertificateRequest {
  readonly csrPem: string;
  readonly privateKeyPem: string;
}

/**
 * Clave RSA de 2048 bits y el pedido de certificado (CSR) que ARCA pide subir, con el sujeto que espera:
 * `C=AR, O=<razon social>, CN=<alias>, serialNumber=CUIT <cuit>`. La clave la genera `node:crypto` (nativo, rapido)
 * y el CSR `node-forge`, porque `node:crypto` no arma CSRs y en Windows no suele haber `openssl`.
 */
export function createCertificateRequest(input: CertificateRequestInput): CertificateRequest {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const csr = forge.pki.createCertificationRequest();

  csr.publicKey = forge.pki.publicKeyFromPem(publicKey);
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    ...(input.organization ? [{ name: 'organizationName', value: input.organization }] : []),
    { name: 'commonName', value: input.alias },
    { name: 'serialNumber', value: `CUIT ${input.cuit}` },
  ]);
  csr.sign(forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

  return { csrPem: forge.pki.certificationRequestToPem(csr), privateKeyPem: privateKey };
}
