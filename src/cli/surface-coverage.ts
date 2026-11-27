import type { SurfaceCoverage } from '../modules/operations/operations';

/**
 * Donde cubren los comandos y el asistente cada operacion (ARQ-5). `surface-parity.test.ts` lo compara con commander y
 * con los menus reales: si falla por un comando o una pantalla nueva, sumala a su operacion (o crea la operacion y
 * declarala en los dos).
 */

const INVOICES = ['factura', 'fa', 'fb', 'fc', 'fe'];
const FCE_INVOICES = ['factura-credito-electronica', 'fcea', 'fceb', 'fcec'];
const CREDIT_NOTES = ['nota-credito', 'nca', 'ncb', 'ncc', 'nce'];
const FCE_CREDIT_NOTES = ['nota-credito-electronica', 'ncea', 'nceb', 'ncec'];
const DEBIT_NOTES = ['nota-debito', 'nda', 'ndb', 'ndc', 'nde'];
const FCE_DEBIT_NOTES = ['nota-debito-electronica', 'ndea', 'ndeb', 'ndec'];
const RECEIPTS = ['recibo', 'ra', 'rb', 'rc'];
const WSFE = [
  ...['factura', 'fa', 'fb', 'fc'],
  ...FCE_INVOICES,
  ...['nota-credito', 'nca', 'ncb', 'ncc'],
  ...FCE_CREDIT_NOTES,
  ...['nota-debito', 'nda', 'ndb', 'ndc'],
  ...FCE_DEBIT_NOTES,
  ...RECEIPTS,
];
const WSFEX = ['fe', 'nce', 'nde'];

/** Que emite cada opcion del asistente se elige adentro: A, B, C, FCE y E. */
const EMISSION_SCREENS = ['Emitir factura', 'Emitir recibo', 'Emitir nota de crédito', 'Emitir nota de débito'];

const withFlag = (commands: readonly string[], flag: string) => commands.map((command) => `${command} ${flag}`);

/**
 * Cada lugar es un comando como se escribe, sin `arcli`; con un flag al final, si lo que la cubre es el flag.
 *
 * @internal Lo lee el test de paridad.
 */
export const COMMAND_COVERAGE: SurfaceCoverage = {
  'certificado-estado': { en: ['certificado'] },
  'certificado-generar': { en: ['certificado generar'] },
  'certificado-importar': { en: ['certificado importar'] },
  'config-borrar': { en: ['config eliminar'] },
  'config-cambiar': { en: ['config establecer'] },
  'config-guiada': {
    en: [],
    excepcion: 'docs/architecture.md: la configuración guiada está solo en el asistente, porque son preguntas',
  },
  'config-revisar': { en: ['config revisar'] },
  'config-ruta': { en: ['config ruta'] },
  'config-ver': { en: ['config'] },
  'consultar-comprobante': { en: ['consultar'] },
  'consultar-cotizacion': { en: ['parametros'] },
  'consultar-fce-obligado': { en: ['fce-obligado'] },
  'consultar-monotributo': { en: ['monotributo'] },
  'consultar-padron': { en: ['padron'] },
  'constatar-comprobante': { en: ['constatar'] },
  'consultar-parametros': { en: ['parametros'] },
  'emitir-factura': { en: withFlag(INVOICES, '--emitir') },
  'emitir-factura-credito-electronica': { en: withFlag(FCE_INVOICES, '--emitir') },
  // La E emite de a una: `--cargar` trae un solo comprobante.
  'emitir-lote': { en: withFlag(WSFE, '--cargar') },
  'emitir-nota-credito': { en: withFlag(CREDIT_NOTES, '--emitir') },
  'emitir-nota-credito-electronica': { en: withFlag(FCE_CREDIT_NOTES, '--emitir') },
  'emitir-nota-debito': { en: withFlag(DEBIT_NOTES, '--emitir') },
  'emitir-nota-debito-electronica': { en: withFlag(FCE_DEBIT_NOTES, '--emitir') },
  'emitir-recibo': { en: withFlag(RECEIPTS, '--emitir') },
  'estado-arca': { en: ['estado'] },
  'generar-pdf': { en: withFlag([...WSFE, ...WSFEX], '--exportar-pdf') },
  'listar-ultimos': { en: ['ultimos'] },
  'pdf-desinstalar': { en: ['pdf desinstalar'] },
  'pdf-estado': { en: ['pdf', 'pdf estado'] },
  'pdf-instalar': { en: ['pdf instalar'] },
  previsualizar: { en: withFlag([...WSFE, ...WSFEX], '--previsualizar') },
  'repetir-comprobante': {
    en: [],
    excepcion:
      'docs/architecture.md: repetir un comprobante está solo en el asistente, porque en la terminal alcanza con el historial',
  },
};

/**
 * Cada lugar es la opcion del menu, con su submenu adelante.
 *
 * @internal Lo lee el test de paridad.
 */
export const ASSISTANT_COVERAGE: SurfaceCoverage = {
  'certificado-estado': { en: ['Configuración > Certificados de ARCA'] },
  'certificado-generar': { en: ['Configuración > Certificados de ARCA'] },
  'certificado-importar': { en: ['Configuración > Certificados de ARCA'] },
  'config-borrar': { en: ['Configuración > Modificar configuración'] },
  'config-cambiar': { en: ['Configuración > Modificar configuración'] },
  'config-guiada': { en: ['Configuración > Configuración guiada'] },
  'config-revisar': { en: ['Configuración > Revisar configuración'] },
  'config-ruta': {
    en: [],
    excepcion:
      'docs/architecture.md: la ruta de la config está solo en los comandos, porque es para quien usa la terminal',
  },
  'config-ver': { en: ['Configuración > Ver configuración'] },
  'consultar-comprobante': { en: ['Consultas > Mis comprobantes'] },
  'consultar-cotizacion': { en: ['Consultas > Monedas y cotizaciones'] },
  'consultar-fce-obligado': { en: ['Consultas > Si un cliente recibe FCE'] },
  'consultar-monotributo': { en: ['Consultas > Categorías del monotributo'] },
  'consultar-padron': { en: ['Consultas > Datos de un CUIT'] },
  'constatar-comprobante': {
    en: [],
    excepcion: 'SDK-10: el asistente lo suma en el PR 2, en Consultas > Constatar un comprobante recibido',
  },
  'consultar-parametros': { en: ['Consultas > Tablas de ARCA'] },
  'emitir-factura': { en: ['Emitir factura'] },
  'emitir-factura-credito-electronica': { en: ['Emitir factura'] },
  'emitir-lote': {
    en: [],
    excepcion: 'docs/modo-interactivo.md: Facturas por lote: siguen siendo `--cargar` con un JSON.',
  },
  'emitir-nota-credito': { en: ['Emitir nota de crédito'] },
  'emitir-nota-credito-electronica': { en: ['Emitir nota de crédito'] },
  'emitir-nota-debito': { en: ['Emitir nota de débito'] },
  'emitir-nota-debito-electronica': { en: ['Emitir nota de débito'] },
  'emitir-recibo': { en: ['Emitir recibo'] },
  'estado-arca': { en: ['Estado de ARCA'] },
  // Se elige en "¿Emitimos?".
  'generar-pdf': { en: EMISSION_SCREENS },
  'listar-ultimos': { en: ['Consultas > Mis comprobantes'] },
  'pdf-desinstalar': { en: ['Configuración > Plugin de PDF'] },
  'pdf-estado': { en: ['Configuración > Plugin de PDF'] },
  'pdf-instalar': { en: ['Configuración > Plugin de PDF'] },
  previsualizar: { en: EMISSION_SCREENS },
  'repetir-comprobante': { en: ['Repetir un comprobante anterior'] },
};

const APP_MODULES =
  'docs/architecture.md: Los módulos que son de la app (`completion`, `desktop-shortcut`, `examples`, `storybook`, `update-check`)';

/**
 * Comandos de la app que no son una operacion del nucleo, con el motivo (como en `excepcion`).
 *
 * @internal Lo lee el test de paridad.
 */
export const APP_COMMANDS: Readonly<Record<string, string>> = {
  __completar: APP_MODULES,
  'acceso-directo': APP_MODULES,
  completado: APP_MODULES,
  'completado desinstalar': APP_MODULES,
  'completado instalar': APP_MODULES,
  ejemplos: APP_MODULES,
  interactivo: 'docs/modo-interactivo.md: `arcli` sin argumentos abre un asistente',
  storybook: APP_MODULES,
};

/**
 * Opciones del asistente que no son una operacion del nucleo, con el motivo (como en `excepcion`).
 *
 * @internal Lo lee el test de paridad.
 */
export const APP_SCREENS: Readonly<Record<string, string>> = {
  'Actualizar a la versión': APP_MODULES,
  'Configuración > Acceso directo en el escritorio': APP_MODULES,
  'Configuración > Autocompletado': APP_MODULES,
  Salir: 'docs/modo-interactivo.md: elegir **Salir**, cierra el asistente',
};
