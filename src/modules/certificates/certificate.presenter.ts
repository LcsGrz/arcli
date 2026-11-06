import { basename, dirname } from 'node:path';

import { formatCuit } from '../../lib/identity/format-cuit';
import { CERTIFICATE_GUIDE_URL } from '../../lib/links';
import {
  bold,
  colorize,
  hyperlink,
  pathLink,
  renderPanel,
  supportsHyperlinks,
  toneText,
  type UiColorToken,
} from '../../ui';
import { formatCertificateExpiryDate } from '../config/certificate-expiry';
import type { ArcliEnvironment } from '../config/config.schemas';

import type { CertificateStatus, GeneratedCertificateRequest, ImportedCertificate } from './certificate.service';

const SERVICES_URL = `${CERTIFICATE_GUIDE_URL}#qué-servicios-autorizar`;

const ENVIRONMENT_NAMES: Record<ArcliEnvironment, string> = { produccion: 'producción', testing: 'testing' };
const ENVIRONMENT_COLORS: Record<ArcliEnvironment, UiColorToken> = { produccion: 'production', testing: 'testing' };

/** Lo mismo que la tabla "Qué servicios autorizar" de la guía de certificados. */
const SERVICES: ReadonlyArray<readonly [service: string, usage: string]> = [
  ['wsfe', 'facturas y notas A, B, C y FCE'],
  ['ws_sr_constancia_inscripcion', 'arcli padron y el IVA del receptor'],
  ['wsfecred', 'arcli fce-obligado y el aviso de FCE'],
  ['wsfex', 'arcli fe, la factura de exportación E'],
];

/** Lo que hay que hacer en ARCA con el CSR. Testing usa WSASS; producción, Administración de Certificados Digitales. */
function certificateSteps(request: Pick<GeneratedCertificateRequest, 'alias' | 'environment'>): string[] {
  const importCommand = 'arcli certificado importar <archivo.crt>';

  if (request.environment === 'testing') {
    return [
      '1. Entrá a ARCA con tu clave fiscal y abrí "WSASS - Autoservicio de Acceso a WebServices".',
      `2. "Nuevo certificado": nombre simbólico del DN "${request.alias}" y pegá el CSR de abajo.`,
      '3. Copiá el certificado que te devuelve en un archivo .crt.',
      `4. Cargalo: ${importCommand}`,
      '5. En WSASS, "Crear autorización a servicio" con el mismo DN, para cada servicio que uses.',
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

function heading(text: string): string {
  return colorize(text, 'info');
}

/** Filas "etiqueta  valor": con dos espacios o mas, el panel parte el valor sin perder la columna. */
function rows(entries: ReadonlyArray<readonly [label: string, value: string]>): string[] {
  const width = Math.max(...entries.map(([label]) => label.length));

  return entries.map(([label, value]) => `  ${bold(label.padEnd(width))}  ${value}`);
}

function servicesSection(title = 'Servicios a autorizar'): string[] {
  const guide = supportsHyperlinks() ? ['', `  ${hyperlink('Guía con capturas de cada pantalla', SERVICES_URL)}`] : [];

  return [heading(title), ...rows(SERVICES.map(([service, usage]) => [`• ${service}`, usage])), ...guide];
}

/** Sin links en la terminal, la URL va afuera de la caja: adentro se partiria y no se podria abrir. */
function guideLine(): string {
  return supportsHyperlinks() ? '' : `\nQué servicios autorizar, con capturas: ${SERVICES_URL}\n`;
}

function fileLink(path: string): string {
  return pathLink(path, basename(path));
}

export function formatGeneratedRequestAsText(request: GeneratedCertificateRequest): string {
  const color = ENVIRONMENT_COLORS[request.environment];
  const panel = renderPanel({
    borderType: 'sheet',
    content: [
      heading('Pedido'),
      ...rows([
        ['CUIT', formatCuit(request.cuit)],
        ['Alias', request.alias],
        ['Carpeta', pathLink(dirname(request.requestPath))],
        ['CSR', fileLink(request.requestPath)],
        ['Clave privada', `${fileLink(request.keyPath)}  ${colorize('(no la compartas)', 'muted')}`],
      ]),
      '',
      heading('Pasos en ARCA'),
      // "1.  texto": con dos espacios despues del numero, una linea larga sigue alineada al texto.
      ...certificateSteps(request).map((step) => `  ${step.replace(/^(\d+\.) /, '$1  ')}`),
      '',
      ...servicesSection(),
    ],
    contentAlign: 'left',
    footer: 'Tu certificado actual sigue andando hasta que importes el nuevo.',
    footerColor: 'muted',
    footerDivider: true,
    title: `Pedido de certificado · ${ENVIRONMENT_NAMES[request.environment]}`,
    titleColor: color,
    width: 'wide',
  });

  // El CSR va suelto, sin bordes: se copia entero para pegarlo en ARCA.
  return `${panel}\n${guideLine()}\n${request.csrPem.trim()}\n`;
}

export function formatGeneratedRequestAsJson(request: GeneratedCertificateRequest): string {
  return JSON.stringify(
    {
      alias: request.alias,
      csr: request.csrPem,
      cuit: request.cuit,
      entorno: request.environment,
      guia: CERTIFICATE_GUIDE_URL,
      pasos: certificateSteps(request),
      rutaClave: request.keyPath,
      rutaCsr: request.requestPath,
    },
    null,
    2,
  );
}

export function formatImportedCertificateAsText(imported: ImportedCertificate): string {
  const color = ENVIRONMENT_COLORS[imported.environment];
  const environment = ENVIRONMENT_NAMES[imported.environment].toUpperCase();
  const panel = renderPanel({
    borderType: 'sheet',
    content: [
      `${toneText('✓', 'success')} ${bold(`Certificado de ${toneText(environment, color)} cargado`)}${
        imported.replaced ? colorize(' (reemplaza al anterior)', 'muted') : ''
      }`,
      '',
      heading('Certificado'),
      ...rows([
        ['CUIT', formatCuit(imported.cuit)],
        ['Alias', imported.alias ?? 'N/D'],
        ['Vence', bold(formatCertificateExpiryDate(imported.expiresAt))],
      ]),
      '',
      heading('Archivos'),
      ...rows([
        ['Carpeta', pathLink(dirname(imported.certificatePath))],
        ['Certificado', fileLink(imported.certificatePath)],
        ['Clave privada', fileLink(imported.keyPath)],
      ]),
      '',
      ...servicesSection('Si todavía no los autorizaste'),
    ],
    contentAlign: 'left',
    footer: 'Para revisar todo: `arcli config revisar`.',
    footerColor: 'muted',
    footerDivider: true,
    title: `Certificado de ${ENVIRONMENT_NAMES[imported.environment]}`,
    titleColor: color,
    width: 'wide',
  });

  return `${panel}\n${guideLine()}`;
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

const EXPIRY_WARNING_DAYS = 30;

function describeExpiry(expiresAt: Date, now: Date): string {
  const days = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
  const date = formatCertificateExpiryDate(expiresAt);

  if (days < 0) {
    return `${toneText(date, 'danger')}  ${colorize('(vencido: renovalo)', 'danger')}`;
  }

  const remaining = days === 0 ? 'vence hoy' : days === 1 ? 'falta 1 día' : `faltan ${days} días`;

  return days <= EXPIRY_WARNING_DAYS
    ? `${toneText(date, 'warning')}  ${colorize(`(${remaining}: renovalo)`, 'warning')}`
    : `${bold(date)}  ${colorize(`(${remaining})`, 'muted')}`;
}

function statusRows(status: CertificateStatus, now: Date): string[] {
  const pending = status.pendingRequestPath
    ? [
        '',
        `  ${toneText('!', 'warning')}  Hay un pedido sin importar: ${pathLink(status.pendingRequestPath, basename(status.pendingRequestPath))}`,
      ]
    : [];

  if (!status.certificatePath) {
    return [colorize('Sin certificado. Sacalo con "Sacar o renovar un certificado".', 'muted'), ...pending];
  }

  if (status.unreadable || !status.expiresAt) {
    return [
      ...rows([['Certificado', pathLink(status.certificatePath)]]),
      '',
      `  ${toneText('x', 'danger')}  ${colorize('No se puede leer: cargalo de nuevo con "Cargar el certificado (.crt)".', 'danger')}`,
      ...pending,
    ];
  }

  return [
    ...rows([
      ['Alias', status.alias ?? 'N/D'],
      ['Vence', describeExpiry(status.expiresAt, now)],
      ['Certificado', pathLink(status.certificatePath)],
      ['Clave privada', status.keyPath ? pathLink(status.keyPath) : colorize('no configurado', 'muted')],
    ]),
    ...pending,
  ];
}

/** Una caja por entorno, con el titulo en su color: alias, vencimiento, archivos y si quedo un pedido sin importar. */
export function formatCertificateStatusAsText(statuses: readonly CertificateStatus[], now = new Date()): string {
  return statuses
    .map((status) =>
      renderPanel({
        borderType: 'sheet',
        content: statusRows(status, now),
        contentAlign: 'left',
        title: `Certificado de ${ENVIRONMENT_NAMES[status.environment]}`,
        titleColor: ENVIRONMENT_COLORS[status.environment],
        width: 'wide',
      }),
    )
    .join('\n\n');
}
