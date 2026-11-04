import { basename, dirname } from 'node:path';

import { CERTIFICATE_GUIDE_URL } from '../../lib/links';
import { maskPath } from '../../lib/paths/mask-path';
import {
  bold,
  colorize,
  fileHyperlink,
  hyperlink,
  renderPanel,
  supportsHyperlinks,
  toneText,
  type UiColorToken,
} from '../../ui';
import type { ArcliEnvironment } from '../config/config.schemas';

import type { GeneratedCertificateRequest, ImportedCertificate } from './certificate.service';

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
export function certificateSteps(request: Pick<GeneratedCertificateRequest, 'alias' | 'environment'>): string[] {
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
  return toneText(text, 'info');
}

/** Filas "etiqueta  valor": con dos espacios o mas, el panel parte el valor sin perder la columna. */
function rows(entries: ReadonlyArray<readonly [label: string, value: string]>): string[] {
  const width = Math.max(...entries.map(([label]) => label.length));

  return entries.map(([label, value]) => `  ${bold(label.padEnd(width))}  ${value}`);
}

function servicesSection(title = 'Servicios a autorizar'): string[] {
  const guide = supportsHyperlinks() ? [`  ${hyperlink('Guía con capturas de cada pantalla', SERVICES_URL)}`] : [];

  return [heading(title), ...rows(SERVICES.map(([service, usage]) => [`• ${service}`, usage])), ...guide];
}

/** Sin links en la terminal, la URL va afuera de la caja: adentro se partiria y no se podria abrir. */
function guideLine(): string {
  return supportsHyperlinks() ? '' : `\nQué servicios autorizar, con capturas: ${SERVICES_URL}\n`;
}

function folderLink(path: string): string {
  return fileHyperlink(maskPath(path, 3), path);
}

function fileLink(path: string): string {
  return fileHyperlink(basename(path), path);
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC', year: 'numeric' });
}

export function formatGeneratedRequestAsText(request: GeneratedCertificateRequest): string {
  const color = ENVIRONMENT_COLORS[request.environment];
  const panel = renderPanel({
    borderType: 'sheet',
    content: [
      heading('Pedido'),
      ...rows([
        ['CUIT', request.cuit],
        ['Alias', request.alias],
        ['Carpeta', folderLink(dirname(request.requestPath))],
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
        ['CUIT', imported.cuit],
        ['Alias', imported.alias ?? '- -'],
        ['Vence', bold(formatDate(imported.expiresAt))],
      ]),
      '',
      heading('Archivos'),
      ...rows([
        ['Carpeta', folderLink(dirname(imported.certificatePath))],
        ['Certificado', fileLink(imported.certificatePath)],
        ['Clave privada', fileLink(imported.keyPath)],
      ]),
      '',
      ...servicesSection('Si todavía no los autorizaste'),
    ],
    contentAlign: 'left',
    footer: 'Para revisar todo: arcli config revisar',
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
