/**
 * Lo que ARCLI sabe hacer, sin decir por donde se pide (ARQ-5). Cada adaptador declara donde cubre cada una, o por que
 * no (`src/cli/surface-coverage.ts`), y `surface-parity.test.ts` lo compara con los comandos y los menus reales. Son
 * datos: nada se ejecuta desde aca.
 *
 * @internal Lo leen las coberturas y su test.
 */
export const OPERATIONS = [
  'previsualizar',
  'emitir-factura',
  'emitir-factura-credito-electronica',
  'emitir-nota-credito',
  'emitir-nota-credito-electronica',
  'emitir-nota-debito',
  'emitir-nota-debito-electronica',
  'emitir-recibo',
  'emitir-lote',
  'repetir-comprobante',
  'generar-pdf',
  'consultar-comprobante',
  'listar-ultimos',
  'consultar-padron',
  'consultar-fce-obligado',
  'constatar-comprobante',
  'consultar-parametros',
  'consultar-cotizacion',
  'consultar-monotributo',
  'estado-arca',
  'config-ver',
  'config-revisar',
  'config-guiada',
  'config-cambiar',
  'config-borrar',
  'config-ruta',
  'certificado-estado',
  'certificado-generar',
  'certificado-importar',
  'pdf-estado',
  'pdf-instalar',
  'pdf-desinstalar',
] as const;

/** @internal Lo lee el test de paridad. */
export type Operation = (typeof OPERATIONS)[number];

/** Donde la cubre un adaptador: al menos un lugar, o el motivo de no tenerla. */
interface OperationCoverage {
  readonly en: readonly string[];
  /** Solo sin lugares. El motivo: `docs/<doc>.md: <cita textual>` o `<ticket>: <motivo>`. */
  readonly excepcion?: string;
}

/** Exhaustivo: una operacion nueva no compila hasta que cada adaptador la declara. */
export type SurfaceCoverage = Readonly<Record<Operation, OperationCoverage>>;
