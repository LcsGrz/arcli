import { ConfigurationError } from '../errors/app-error';
import type { LocalFiles } from '../files/local-files';
import { maskPath } from '../paths/mask-path';

type PemKind = 'certificado' | 'clave privada';

function expectedPemHeader(kind: PemKind): string {
  return kind === 'certificado' ? '-----BEGIN CERTIFICATE-----' : '-----BEGIN PRIVATE KEY-----';
}

function acceptedPemHeaders(kind: PemKind): string[] {
  if (kind === 'certificado') {
    return ['BEGIN CERTIFICATE'];
  }

  return ['BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'BEGIN EC PRIVATE KEY'];
}

export function ensurePathExists(files: Pick<LocalFiles, 'exists'>, filePath: string, label: PemKind): void {
  if (!files.exists(filePath)) {
    throw new ConfigurationError(
      `La ruta ${label === 'certificado' ? 'del certificado' : 'de la clave privada'} no existe: ${maskPath(filePath)}`,
      {
        path: maskPath(filePath),
      },
    );
  }
}

function ensurePemFormat(content: string, filePath: string, label: PemKind): void {
  const normalizedContent = content.trim();

  // El SDK no recibe passphrase: con una clave cifrada fallaria recien al hablar con ARCA, con un error confuso.
  if (label === 'clave privada' && normalizedContent.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    throw new ConfigurationError(
      `La clave privada está cifrada con contraseña y ARCLI no puede usarla: ${maskPath(filePath)}. Generala sin contraseña o descifrala con \`openssl pkey -in clave.key -out clave-sin-pass.key\`.`,
      { path: maskPath(filePath) },
    );
  }
  const hasAcceptedHeader = acceptedPemHeaders(label).some((header) =>
    normalizedContent.includes(`-----${header}-----`),
  );
  const hasAcceptedFooter = normalizedContent.includes('-----END');

  if (!hasAcceptedHeader || !hasAcceptedFooter) {
    throw new ConfigurationError(
      `La ${label === 'certificado' ? 'ruta del certificado' : 'ruta de la clave privada'} apunta a un archivo con formato PEM inválido: ${maskPath(filePath)}. Debe contener un bloque como ${expectedPemHeader(label)}.`,
      {
        path: maskPath(filePath),
      },
    );
  }
}

/** Lee el PEM con `files` y valida que exista y su formato; los errores dicen la ruta enmascarada. */
export function readPemFile(files: LocalFiles, filePath: string, label: PemKind): string {
  ensurePathExists(files, filePath, label);

  const content = files.readText(filePath);

  ensurePemFormat(content, filePath, label);

  return content;
}
