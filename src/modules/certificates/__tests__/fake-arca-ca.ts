import forge from 'node-forge';

/**
 * Una autoridad que firma como ARCA ("Computadores Test" o "Computadores", con O=AFIP), para probar `importar` sin
 * certificados reales. Las claves RSA de forge tardan: se generan una vez por autoridad.
 */
const authorities = new Map<string, { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }>();

function authority(commonName: string) {
  const cached = authorities.get(commonName);

  if (cached) {
    return cached;
  }

  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  const name = [
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'AFIP' },
    { name: 'commonName', value: commonName },
  ];

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2040-01-01T00:00:00Z');
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const created = { cert, key: keys.privateKey };

  authorities.set(commonName, created);

  return created;
}

/** Firma el CSR como lo haria ARCA: mismo sujeto, el emisor de la autoridad y el vencimiento pedido. */
export function signRequestLikeArca(
  csrPem: string,
  options: { readonly issuer?: string; readonly notAfter?: Date } = {},
): string {
  const ca = authority(options.issuer ?? 'Computadores Test');
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  const cert = forge.pki.createCertificate();

  cert.publicKey = csr.publicKey as forge.pki.rsa.PublicKey;
  cert.serialNumber = String(Date.now());
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = options.notAfter ?? new Date('2028-01-01T00:00:00Z');
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.sign(ca.key, forge.md.sha256.create());

  return forge.pki.certificateToPem(cert);
}
