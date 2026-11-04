import { maskPath } from '../../lib/paths/mask-path';
import { keyValuePanel, noticePanel } from '../../ui';
import type { ArcliEnvironment } from '../config/config.schemas';

import type { GeneratedCertificateRequest, ImportedCertificate } from './certificate.service';

const GUIDE_URL = 'https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md';
const SERVICES_URL = `${GUIDE_URL}#qué-servicios-autorizar`;

const ENVIRONMENT_NAMES: Record<ArcliEnvironment, string> = { produccion: 'producción', testing: 'testing' };

/** Lo que hay que hacer en ARCA con el CSR. Testing usa WSASS; producción, Administración de Certificados Digitales. */
export function certificateSteps(request: GeneratedCertificateRequest): string[] {
  const importCommand = 'arcli certificado importar <archivo.crt>';

  if (request.environment === 'testing') {
    return [
      '1. Entrá a ARCA con tu clave fiscal y abrí "WSASS - Autoservicio de Acceso a WebServices".',
      `2. "Nuevo certificado": nombre simbólico del DN "${request.alias}" y pegá el CSR de abajo.`,
      '3. Copiá el certificado que te devuelve en un archivo .crt.',
      `4. Cargalo: ${importCommand}`,
      '5. En WSASS, "Crear autorización a servicio" con el mismo DN para wsfe y los demás servicios que uses.',
    ];
  }

  return [
    '1. Entrá a ARCA con tu clave fiscal y abrí "Administración de Certificados Digitales".',
    `2. Agregá el alias "${request.alias}" (o elegí ese alias si ya existe) y subí el CSR.`,
    '3. Descargá el certificado (.crt).',
    `4. Cargalo: ${importCommand}`,
    '5. En el "Administrador de Relaciones de Clave Fiscal", creá la relación de cada servicio que uses con ese alias.',
  ];
}

export function formatGeneratedRequestAsText(request: GeneratedCertificateRequest): string {
  const panel = keyValuePanel(`Pedido de certificado de ${ENVIRONMENT_NAMES[request.environment]}`, [
    `CUIT: ${request.cuit}`,
    `Alias: ${request.alias}`,
    `CSR: ${maskPath(request.requestPath)}`,
    `Clave privada: ${maskPath(request.keyPath)} (no la compartas)`,
    '',
    ...certificateSteps(request),
    '',
    'Tu certificado actual sigue andando hasta que importes el nuevo.',
  ]);

  // El CSR y el link van sueltos, sin bordes: el panel los cortaria y no se podrian copiar ni abrir.
  return `${panel}\nQué servicios autorizar: ${SERVICES_URL}\n\n${request.csrPem.trim()}\n`;
}

export function formatGeneratedRequestAsJson(request: GeneratedCertificateRequest): string {
  return JSON.stringify(
    {
      alias: request.alias,
      csr: request.csrPem,
      cuit: request.cuit,
      entorno: request.environment,
      guia: GUIDE_URL,
      pasos: certificateSteps(request),
      rutaClave: request.keyPath,
      rutaCsr: request.requestPath,
    },
    null,
    2,
  );
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC', year: 'numeric' });
}

export function formatImportedCertificateAsText(imported: ImportedCertificate): string {
  return [
    noticePanel(
      `Certificado de ${ENVIRONMENT_NAMES[imported.environment].toUpperCase()} cargado${imported.replaced ? ' (reemplaza al anterior)' : ''}.`,
      'success',
    ),
    keyValuePanel('Certificado', [
      `Entorno: ${ENVIRONMENT_NAMES[imported.environment]}`,
      `CUIT: ${imported.cuit}`,
      `Alias: ${imported.alias ?? '- -'}`,
      `Vence: ${formatDate(imported.expiresAt)}`,
      `Certificado: ${maskPath(imported.certificatePath)}`,
      `Clave privada: ${maskPath(imported.keyPath)}`,
      '',
      'Para revisar todo: arcli config revisar',
    ]),
    `Si todavía no lo autorizaste a los servicios que usás: ${SERVICES_URL}`,
  ].join('\n');
}

export function formatImportedCertificateAsJson(imported: ImportedCertificate): string {
  return JSON.stringify(
    {
      alias: imported.alias ?? null,
      cuit: imported.cuit,
      entorno: imported.environment,
      reemplazado: imported.replaced,
      rutaCertificado: imported.certificatePath,
      rutaClave: imported.keyPath,
      vence: imported.expiresAt.toISOString(),
    },
    null,
    2,
  );
}
