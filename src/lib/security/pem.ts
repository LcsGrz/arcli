import { existsSync, readFileSync } from 'node:fs';

import { ConfigurationError } from '../errors/app-error';
import { maskPath } from '../paths/mask-path';

type PemKind = 'certificado' | 'clave privada';

function expectedPemHeader(kind: PemKind): string {
  return kind === 'certificado' ? '-----BEGIN CERTIFICATE-----' : '-----BEGIN PRIVATE KEY-----';
}

function acceptedPemHeaders(kind: PemKind): string[] {
  if (kind === 'certificado') {
    return ['BEGIN CERTIFICATE'];
  }

  return ['BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'BEGIN EC PRIVATE KEY', 'BEGIN ENCRYPTED PRIVATE KEY'];
}

export function ensurePathExists(filePath: string, label: PemKind): void {
  if (!existsSync(filePath)) {
    throw new ConfigurationError(`La ruta del ${label} no existe: ${maskPath(filePath)}`, {
      path: maskPath(filePath),
    });
  }
}

export function ensurePemFormat(content: string, filePath: string, label: PemKind): void {
  const normalizedContent = content.trim();
  const hasAcceptedHeader = acceptedPemHeaders(label).some((header) =>
    normalizedContent.includes(`-----${header}-----`),
  );
  const hasAcceptedFooter = normalizedContent.includes('-----END');

  if (!hasAcceptedHeader || !hasAcceptedFooter) {
    throw new ConfigurationError(
      `La ${label === 'certificado' ? 'ruta del certificado' : 'ruta de la clave privada'} apunta a un archivo con formato PEM invalido: ${maskPath(filePath)}. Debe contener un bloque como ${expectedPemHeader(label)}.`,
      {
        path: maskPath(filePath),
      },
    );
  }
}

export function readPemFile(filePath: string, label: PemKind): string {
  ensurePathExists(filePath, label);

  const content = readFileSync(filePath, 'utf8');

  ensurePemFormat(content, filePath, label);

  return content;
}
