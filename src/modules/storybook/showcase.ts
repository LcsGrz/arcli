import { ConfigurationError, InputValidationError } from '../../lib/errors/app-error';
import { CERTIFICATE_GUIDE_URL } from '../../lib/links';
import type { ArcaRuntimeValidation } from '../../services/arca/arca-context.resolver';
import {
  attentionPanel,
  certificateBanner,
  dataPanel,
  errorListPanel,
  sectionHeading,
  sheetPanel,
  statusBar,
  testingBanner,
  ticketPanel,
  tipPanel,
} from '../../ui/components';
import { formatAppError } from '../../ui/presenters';
import {
  badge,
  colorize,
  highlightJsonValues,
  renderKeyValueRows,
  renderLogo,
  renderObject,
  renderPanel,
  resolveKeyValueLabelWidth,
  toneText,
  uiSymbol,
  type UiTextColor,
} from '../../ui/primitives';
import { type UiBorderType } from '../../ui/theme';
import { formatBillingResultAsJson, formatBillingResultAsText } from '../billing/billing.presenter';
import type { VoucherKindDefinition } from '../billing/billing.types';
import type { BillingExecutionResult } from '../billing/billing.types.internal';
import { formatCertificateStatusAsText, formatGeneratedRequestAsText } from '../certificates/certificate.presenter';
import {
  formatConfig,
  formatConfigAsText,
  formatConfigDoctor,
  formatConfigDoctorAsText,
} from '../config/config.presenter';
import type { ArcliConfig } from '../config/config.schemas';
import { buildConfigDoctorReport } from '../config/config-doctor';
import { formatPadronAsText } from '../padron/padron.presenter';
import { formatParameterTablesAsText, formatStatusAsText } from '../parameters/parameters.presenter';
import { formatPdfPluginStatusAsText } from '../pdf/pdf.presenter';
import { renderUpdateNoticePanel } from '../update-check/update-check.presenter';
import type { UpdateCheckResult } from '../update-check/update-check.service';
import type { IssuedVoucher } from '../vouchers/voucher-history';
import { formatVoucherDetailAsText, formatVoucherListAsText } from '../vouchers/voucher-history.presenter';

import { STORYBOOK_SHOWCASE_THEME } from './showcase-theme';

export type StorybookScene =
  | 'bordes'
  | 'certificados'
  | 'colores'
  | 'componentes'
  | 'comprobantes'
  | 'configuracion'
  | 'consultas'
  | 'errores'
  | 'json';

function createVoucherKind(partial: Partial<VoucherKindDefinition>): VoucherKindDefinition {
  return {
    arcaType: partial.arcaType ?? 11,
    displayName: partial.displayName ?? 'Factura C',
    family: partial.family ?? 'factura',
    isElectronicCredit: partial.isElectronicCredit ?? false,
    letter: partial.letter ?? 'c',
    requiresAssociatedVoucher: partial.requiresAssociatedVoucher ?? false,
    shortcut: partial.shortcut ?? 'fc',
  };
}

function createBillingResult(partial: Partial<BillingExecutionResult> = {}): BillingExecutionResult {
  return {
    dryRun: partial.dryRun ?? false,
    environment: partial.environment ?? 'produccion',
    payload: {
      CantReg: 1,
      CbteFch: '20260320',
      CbteTipo: 11,
      Concepto: 2,
      CondicionIVAReceptorId: 5,
      DocNro: 0,
      DocTipo: 99,
      FchServDesde: '20260320',
      FchServHasta: '20260320',
      FchVtoPago: '20260320',
      ImpIVA: 0,
      ImpNeto: 1,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 1,
      ImpTrib: 0,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
      ...(partial.payload ?? {}),
    } as BillingExecutionResult['payload'],
    response: {
      cae: '86120020280000',
      caeVencimiento: '20260330',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: {
        cae: '86120020280000',
        caeFchVto: '20260330',
        response: {
          FeDetResp: {
            FECAEDetResponse: [{ Resultado: 'A' }],
          },
        },
      } as BillingExecutionResult['response']['raw'],
      resultado: 'A',
      status: 'aprobado',
      suggestions: [],
      ...(partial.response ?? {}),
    },
    voucherKind: partial.voucherKind ?? createVoucherKind({}),
  };
}

function createSampleConfig(): ArcliConfig {
  return {
    cert: {
      produccion: '/Users/demo/.arcli/produccion/certificado.crt',
      testing: '/Users/demo/.arcli/testing/certificado.crt',
    },
    cuit: '20333333334',
    conceptoPorDefecto: 'servicios',
    cotizacionPorDefecto: 1,
    emisor: {},
    entornoPorDefecto: 'testing',
    ivaReceptorPorDefecto: 'consumidor-final',
    key: {
      produccion: '/Users/demo/.arcli/produccion/clave.key',
      testing: '/Users/demo/.arcli/testing/clave.key',
    },
    monedaPorDefecto: 'PES',
    output: {
      emitirPorDefecto: false,
      jsonPorDefecto: false,
      brutoPorDefecto: false,
    },
    puntoVentaPorDefecto: 3,
  };
}

function createSampleUpdateCheckResult(): UpdateCheckResult {
  return {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
  };
}

function createSampleValidation(): ArcaRuntimeValidation {
  return {
    certPath: '/Users/demo/.arcli/testing/certificado.crt',
    cuit: 20333333334,
    environment: 'testing',
    keyPath: '/Users/demo/.arcli/testing/clave.key',
    outputJson: false,
    outputRaw: false,
    pointOfSale: 3,
    ticketPath: '/Users/demo/.arcli/tickets',
  };
}

function sceneTitle(title: string, subtitle?: string): string {
  return renderPanel({
    borderColor: STORYBOOK_SHOWCASE_THEME.borderColor,
    borderType: 'debug',
    content: [],
    subtitle,
    subtitleColor: 'debug',
    title,
    width: STORYBOOK_SHOWCASE_THEME.sceneWidth,
  });
}

function showcaseIndex(): string {
  return renderPanel({
    borderColor: STORYBOOK_SHOWCASE_THEME.borderColor,
    borderType: 'debug',
    content: [],
    subtitle: 'Galería visual del CLI',
    subtitleColor: 'debug',
    title: 'Terminal Storybook',
    width: STORYBOOK_SHOWCASE_THEME.indexPanelWidth,
  });
}

function buildColorsScene(): string {
  return [
    sceneTitle('Colores UI', 'Paleta semántica y tono debug'),
    `${badge('OK', 'success')} ${toneText('Paneles base listos', 'success')}`,
    `${badge('INFO', 'info')} ${toneText('Paneles informativos y comandos', 'info')}`,
    `${badge('DATA', 'subtle')} ${toneText('JSON, respuesta bruta y eventos', 'subtle')}`,
    `${badge('WARN', 'warning')} ${toneText('Observaciones o sugerencias', 'warning')}`,
    `${badge('ERROR', 'danger')} ${toneText('Errores o bloqueos', 'danger')}`,
    `${badge('DEBUG', 'debug')} ${toneText('Storybook y debug visual', 'debug')}`,
  ].join('\n\n');
}

const BORDER_SAMPLES: ReadonlyArray<
  readonly [
    borderType: UiBorderType,
    title: string,
    description: string,
    color: UiTextColor | undefined,
    footer?: string,
  ]
> = [
  ['ticket', 'Factura', 'Comprobantes: vista previa y resultado', 'success', 'RESULTADO'],
  ['error', 'Error', 'Errores del CLI o de ARCA', 'danger'],
  ['attention', 'Observaciones', 'Observaciones de ARCA y avisos del régimen FCE', 'warning'],
  ['tip', 'Sugerencias', 'Sugerencias para resolver un problema', 'warning'],
  ['sheet', 'Configuración', 'Fichas de consulta: configuración y régimen FCE', 'info'],
  ['checklist', 'Revisión', 'Revisión de configuración', 'success', 'VEREDICTO'],
  ['listing', 'Últimos comprobantes', 'Listados en tabla, como los últimos comprobantes', 'info'],
  ['note', 'Aviso', 'Avisos simples, por ejemplo "No se emitió nada"', undefined],
  ['warning', 'Testing', 'Banners del entorno de testing y del certificado por vencer', 'warning'],
  ['info', 'Nueva versión', 'Aviso de nueva versión disponible', 'info'],
  ['data', 'Billing json', 'JSON y respuestas crudas', 'subtle'],
  ['common', 'Contenido', 'Base para paneles sin estilo propio', undefined],
  ['debug', 'Storybook', 'Storybook y debug visual', 'debug'],
];

function buildBordersScene(): string {
  const boxes = BORDER_SAMPLES.map(([borderType, title, description, color, footer]) =>
    renderPanel({
      borderType,
      content: [description],
      footer,
      footerColor: color,
      footerDivider: Boolean(footer),
      title,
      titleColor: color,
      width: 'compact',
    }),
  );
  const command = renderPanel({
    borderType: 'command',
    content: [
      colorize('Esto equivale a:', 'muted'),
      'arcli fc -m 1000 --cs --consumidor-final --ir consumidor-final --emitir',
    ],
  });

  return [
    sceneTitle('Bordes', 'Un estilo por tipo de panel; ARCLI_ASCII=1 los cambia por ASCII'),
    ...boxes,
    `${colorize('Barra de estado (modo interactivo):', 'muted')}\n${statusBar(
      [{ text: '20-33333333-4' }, { text: 'PV 3' }],
      [
        { color: 'success', text: 'ARCA FUNCIONANDO' },
        { color: 'testing', text: 'TESTING' },
      ],
      { rightSeparator: 'rule' },
    )}`,
    `${colorize('Sección (arcli ejemplos):', 'muted')}\n${sectionHeading('Factura C')}`,
    `${colorize('Comando para copiar:', 'muted')}\n${command}`,
  ].join('\n\n');
}

function buildBillingScene(): string {
  const preview = formatBillingResultAsText(
    createBillingResult({
      dryRun: true,
      response: {
        ...createBillingResult().response,
        raw: null,
        status: 'observado',
        resultado: null,
      },
    }),
  );

  const approved = formatBillingResultAsText(createBillingResult());

  const observed = formatBillingResultAsText(
    createBillingResult({
      response: {
        ...createBillingResult().response,
        observaciones: ['La CUIT receptora no existe en padrón.'],
        observacion: 'La CUIT receptora no existe en padrón.',
        raw: {
          response: {
            FeDetResp: {
              FECAEDetResponse: [{ Resultado: 'A' }],
            },
          },
        } as BillingExecutionResult['response']['raw'],
        status: 'observado',
        suggestions: ['Revisá el CUIT del receptor o usá uno válido de testing.'],
      },
      voucherKind: createVoucherKind({ displayName: 'Factura A', shortcut: 'fa', letter: 'a', arcaType: 1 }),
      payload: {
        ...createBillingResult().payload,
        CbteTipo: 1,
        DocTipo: 80,
        DocNro: 20123456786,
        CondicionIVAReceptorId: 1,
        ImpNeto: 0.83,
        ImpIVA: 0.17,
      } as BillingExecutionResult['payload'],
    }),
  );

  const rejected = formatBillingResultAsText(
    createBillingResult({
      response: {
        ...createBillingResult().response,
        cae: null,
        caeVencimiento: null,
        errors: [{ Code: 502, Msg: 'Error interno de base de datos - Autorizador CAE - Transacción Activa' }],
        raw: {
          response: {
            Errors: {
              Err: [{ Code: 502, Msg: 'Error interno de base de datos - Autorizador CAE - Transacción Activa' }],
            },
          },
        } as BillingExecutionResult['response']['raw'],
        resultado: 'R',
        status: 'rechazado',
        suggestions: ['ARCA devolvió un error transitorio. Esperá unos segundos y volvé a intentar la emisión.'],
      },
    }),
  );

  const bruto = formatBillingResultAsText(createBillingResult(), { raw: true });

  return [
    sceneTitle('Comprobantes', 'Preview, aprobado, observado, rechazado y bruto'),
    preview,
    approved,
    observed,
    rejected,
    bruto,
  ].join('\n\n');
}

function buildConfigScene(): string {
  const config = createSampleConfig();
  const doctor = buildConfigDoctorReport(config, [{ environment: 'testing' }]);

  return [
    sceneTitle('Configuración', 'Vista actual y revisión'),
    formatConfigAsText(config, { pdfFolder: '~/arcli/comprobantes', ticketPath: createSampleValidation().ticketPath }),
    formatConfigDoctorAsText(doctor),
  ].join('\n\n');
}

function createSampleVoucher(partial: Partial<IssuedVoucher> = {}): IssuedVoucher {
  return {
    cae: '76123456789012',
    caeExpiration: '20260405',
    date: '20260326',
    documentNumber: 20333333334,
    documentTypeCode: 80,
    ivaAmount: 0,
    netAmount: 1500.5,
    number: 1234,
    result: 'A',
    total: 1500.5,
    ...partial,
  };
}

function buildQueriesScene(): string {
  const voucherKind = createVoucherKind({});

  return [
    sceneTitle('Consultas', 'Padrón, estado, listados, parámetros y plugin de PDF'),
    formatPadronAsText({
      environment: 'testing',
      taxpayer: {
        activities: [
          { description: 'Servicios de consultores en informática', id: 620200 },
          { description: 'Servicios de diseño', id: 741000 },
        ],
        address: 'Av. Siempreviva 742, CABA',
        cuit: 20333333334,
        ivaCondition: 'responsable-monotributo',
        keyStatus: 'ACTIVO',
        monotributoCategory: 'D',
        name: 'Empresa de Ejemplo SRL',
        notices: ['El domicilio fiscal no está confirmado.'],
        personType: 'juridica',
        taxes: [{ active: true, description: 'Monotributo', id: 20 }],
      },
    }),
    formatStatusAsText({
      environment: 'testing',
      latencyMs: 180,
      pointOfSale: { kind: 'sin-datos' },
      pointOfSaleNumber: 3,
      ready: true,
      servers: { app: 'OK', auth: 'OK', db: 'OK' },
    }),
    formatStatusAsText({
      environment: 'produccion',
      latencyMs: 240,
      pointOfSale: { kind: 'bloqueado', point: { blocked: true, emissionType: 'CAE', number: 3 } },
      pointOfSaleNumber: 3,
      ready: false,
      servers: { app: 'OK', auth: 'OK', db: 'OK' },
    }),
    formatVoucherListAsText({
      environment: 'testing',
      pointOfSale: 3,
      voucherKind,
      vouchers: [
        createSampleVoucher(),
        createSampleVoucher({ documentNumber: 12345678, documentTypeCode: 96, number: 1233 }),
      ],
    }),
    formatVoucherListAsText({ environment: 'testing', pointOfSale: 3, voucherKind, vouchers: [] }),
    formatVoucherDetailAsText({ environment: 'testing', pointOfSale: 3, voucher: createSampleVoucher(), voucherKind }),
    formatParameterTablesAsText(),
    formatPdfPluginStatusAsText({
      browser: '/ruta/al/navegador',
      browserSource: 'sistema',
      installed: true,
      installedVersion: '0.2.1',
      path: '/ruta/a/plugins/pdf',
      version: '0.2.1',
    }),
    formatPdfPluginStatusAsText({ installed: false, path: '/ruta/a/plugins/pdf', version: '0.2.1' }),
  ].join('\n\n');
}

function buildCertificatesScene(): string {
  // Una fecha fija, para que la escena no cambie con los dias.
  const now = new Date('2026-03-26T12:00:00-03:00');

  return [
    sceneTitle('Certificados', 'Estado por entorno y pedido nuevo'),
    formatCertificateStatusAsText(
      [
        {
          alias: 'arcli',
          certificatePath: '/ruta/a/testing.crt',
          environment: 'testing',
          expiresAt: new Date('2026-04-05T12:00:00-03:00'),
          keyPath: '/ruta/a/testing.key',
          unreadable: false,
        },
        { environment: 'produccion', pendingRequestPath: '/ruta/a/produccion.csr', unreadable: false },
      ],
      now,
    ),
    formatGeneratedRequestAsText({
      alias: 'arcli',
      csrPem: '-----BEGIN CERTIFICATE REQUEST-----',
      cuit: '20333333334',
      environment: 'testing',
      keyPath: '/ruta/a/testing.key',
      requestPath: '/ruta/a/testing.csr',
    }),
  ].join('\n\n');
}

function buildErrorScene(): string {
  return [
    sceneTitle('Errores', 'Configuración, entrada y error inesperado'),
    formatAppError(
      new ConfigurationError('Falta la ruta de la clave privada para testing.', {
        path: '/Users/demo/.arcli/testing/clave.key',
      }),
      false,
    ),
    formatAppError(new InputValidationError('Falta el concepto.'), false),
    formatAppError(new Error('Fallo inesperado de red.'), false),
  ].join('\n\n');
}

function buildJsonScene(): string {
  const billingJson = highlightJsonValues(formatBillingResultAsJson(createBillingResult(), { raw: true }));
  const configJson = highlightJsonValues(
    formatConfig(createSampleConfig(), {
      pdfFolder: '~/arcli/comprobantes',
      ticketPath: createSampleValidation().ticketPath,
    }),
  );
  const doctorJson = highlightJsonValues(
    formatConfigDoctor(buildConfigDoctorReport(createSampleConfig(), [{ environment: 'testing' }])),
  );

  return [
    sceneTitle('Json', 'Contratos estructurados para automatización y respuesta bruta'),
    dataPanel('Billing json', billingJson),
    dataPanel('Config json', configJson),
    dataPanel('Doctor json', doctorJson),
  ].join('\n\n');
}

function buildComponentsScene(): string {
  const notice = testingBanner();
  const certificateNotice = certificateBanner({
    expired: false,
    guideUrl: CERTIFICATE_GUIDE_URL,
    summary: 'El certificado de producción vence el 20/11/2026 (en 10 días).',
  });
  const expiredCertificateNotice = certificateBanner({
    expired: true,
    guideUrl: CERTIFICATE_GUIDE_URL,
    summary: 'El certificado de producción venció el 20/11/2026.',
  });
  const updateNotice = renderUpdateNoticePanel(createSampleUpdateCheckResult());
  const sheetRows: Array<readonly [string, string | number]> = [
    ['CUIT', '20-33333333-4'],
    ['Punto de venta', 3],
    ['Entorno', 'testing'],
  ];
  const ticketRows: Array<readonly [string, string | number]> = [
    ['CAE', '86120020280000'],
    ['Importe total', '$ 1'],
  ];

  return [
    sceneTitle('Componentes', 'Banners, avisos y un panel de cada rol'),
    notice,
    certificateNotice,
    expiredCertificateNotice,
    updateNotice,
    sheetPanel(
      'Demo ficha',
      renderKeyValueRows(sheetRows, { labelWidth: resolveKeyValueLabelWidth('standard', sheetRows) }),
      { footer: toneText('TODO LISTO', 'success'), tone: 'success' },
    ),
    ticketPanel(
      'Demo comprobante',
      renderKeyValueRows(ticketRows, { labelWidth: resolveKeyValueLabelWidth('ticket', ticketRows) }),
      { footer: toneText('APROBADO', 'success'), tone: 'success' },
    ),
    attentionPanel('Demo avisos', `${uiSymbol('bullet')} La cotización sale de ARCA.`),
    tipPanel('Demo sugerencias', `${uiSymbol('bullet')} Revisá \`--fecha\`.`),
    errorListPanel('Demo errores', '1. 10016: la fecha no corresponde.'),
    dataPanel(
      'Demo datos',
      renderObject({ cae: '86120020280000', payload: { CbteTipo: 11, ImpTotal: 1, PtoVta: 3 }, resultado: 'A' }),
    ),
  ].join('\n\n');
}

export function renderStorybookShowcase(scene?: StorybookScene): string {
  const logo = renderLogo().trim();

  const scenes: Record<StorybookScene, string> = {
    bordes: buildBordersScene(),
    certificados: buildCertificatesScene(),
    colores: buildColorsScene(),
    componentes: buildComponentsScene(),
    comprobantes: buildBillingScene(),
    configuracion: buildConfigScene(),
    consultas: buildQueriesScene(),
    errores: buildErrorScene(),
    json: buildJsonScene(),
  };

  if (!scene) {
    return [
      showcaseIndex(),
      logo,
      scenes.colores,
      scenes.bordes,
      scenes.componentes,
      scenes.configuracion,
      scenes.comprobantes,
      scenes.consultas,
      scenes.certificados,
      scenes.json,
      scenes.errores,
    ].join('\n\n');
  }

  return scenes[scene];
}
