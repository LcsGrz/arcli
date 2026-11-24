import type { VoucherShortcut } from '../../../modules/billing/billing.types';

import { type FieldCase, forms } from './input-precedence.fixtures';

/** Los CBU y CUIT son de prueba. */
export const CBU_A = '0110599520000012345678';
export const CBU_B = '0170099220000067797370';
export const CBU_C = '2850590940090418135201';
export const CUIT_A = 20111111112;
export const CUIT_B = 30712345671;

export const BILLING_BASE = ['--monto', '1000', '--cs', '--ir-cf'];

const CONFIG_USD = { baseConfig: { monedaPorDefecto: 'USD' }, baseExpected: { currencyCode: 'USD' } };

/** Cada dato de A, B, C, FCE, recibos y notas, con los niveles en los que se puede escribir. */
export const BILLING_FIELDS: ReadonlyArray<FieldCase<VoucherShortcut>> = [
  {
    base: ['--cs', '--ir-cf'],
    file: [[{ montoTotal: 250.5 }, { totalAmount: 250.5 }]],
    flags: forms(['--monto', '-m'], '1.500,50', 'totalAmount', 1500.5),
    name: 'monto',
    none: /totalAmount/,
  },
  {
    file: [[{ puntoVenta: 7 }, { pointOfSale: 7 }]],
    flags: forms(['--punto-venta', '--pv'], '9', 'pointOfSale', 9),
    name: 'punto de venta',
  },
  {
    file: [[{ fechaComprobante: '01/10/2026' }, { billingDate: '01/10/2026' }]],
    flags: forms(['--fecha', '-f'], '02/10/2026', 'billingDate', '02/10/2026'),
    name: 'fecha del comprobante',
  },
  {
    file: [[{ vencimientoPago: '01/11/2026' }, { paymentDueDate: '01/11/2026' }]],
    flags: forms(['--vencimiento', '--vto'], '02/11/2026', 'paymentDueDate', '02/11/2026'),
    name: 'vencimiento',
  },
  {
    file: [[{ dia: 5 }, { dueDay: 5, fromFile: ['dueDay'] }]],
    flags: forms(['--dia', '-d'], '10', 'dueDay', 10),
    name: 'día de vencimiento (deprecado)',
  },
  {
    file: [[{ servicioDesde: '01/09/2026' }, { serviceStartDate: '01/09/2026' }]],
    flags: forms(['--servicio-desde', '--sd'], '02/09/2026', 'serviceStartDate', '02/09/2026'),
    name: 'servicio desde',
  },
  {
    file: [[{ servicioHasta: '29/09/2026' }, { serviceEndDate: '29/09/2026' }]],
    flags: forms(['--servicio-hasta', '--sh'], '30/09/2026', 'serviceEndDate', '30/09/2026'),
    name: 'servicio hasta',
  },
  {
    base: ['--monto', '1000', '--ir-cf'],
    config: [[{ conceptoPorDefecto: 'servicios' }, { concept: 'servicios' }]],
    file: [[{ concepto: 'productos' }, { concept: 'productos' }]],
    flags: [
      [['--concepto', 'ps'], { concept: 'productos-servicios' }],
      [['-c', 'servicios'], { concept: 'servicios' }],
      [['--cs'], { concept: 'servicios' }],
      [['--cp'], { concept: 'productos' }],
      [['--csp'], { concept: 'productos-servicios' }],
    ],
    name: 'concepto',
    none: /^Falta el concepto\./,
  },
  {
    base: ['--monto', '1000', '--cs'],
    // Con el padrón prendido el IVA de la config es corregible: se marca de dónde salió.
    config: [
      [{ ivaReceptorPorDefecto: 'sujeto-exento' }, { ivaCondition: 'sujeto-exento', ivaConditionSource: 'default' }],
    ],
    file: [[{ ivaReceptor: 'iva-liberado' }, { ivaCondition: 'iva-liberado' }]],
    flags: [
      ...forms(['--iva-receptor', '--ir'], 'responsable-monotributo', 'ivaCondition', 'responsable-monotributo'),
      [['--ir-ri'], { ivaCondition: 'responsable-inscripto' }],
    ],
    name: 'IVA receptor',
    none: /^Falta IVA receptor/,
  },
  {
    file: [
      [
        { numeroDocumento: CUIT_A, tipoDocumento: 'cuit' },
        { documentNumber: CUIT_A, documentType: 'cuit' },
      ],
      [{ numeroDocumento: 0, tipoDocumento: 'consumidor-final' }, { documentNumber: 0 }],
    ],
    flags: [
      [['--cuit', String(CUIT_B)], { documentNumber: CUIT_B, documentType: 'cuit' }],
      [['--cuil', '20222222223'], { documentNumber: 20222222223, documentType: 'cuil' }],
      [['--dni', '30.111.222'], { documentNumber: 30111222, documentType: 'dni' }],
      [['--consumidor-final'], { documentNumber: 0, documentType: 'consumidor-final' }],
      [['--cfinal'], { documentNumber: 0, documentType: 'consumidor-final' }],
    ],
    name: 'documento del receptor',
  },
  {
    config: [[{ monedaPorDefecto: 'BRL' }, { currencyCode: 'BRL' }]],
    file: [[{ codigoMoneda: 'EUR' }, { currencyCode: 'EUR' }]],
    flags: forms(['--moneda', '--mda'], 'USD', 'currencyCode', 'USD'),
    name: 'moneda',
  },
  {
    ...CONFIG_USD,
    config: [[{ cotizacionPorDefecto: 1200 }, { exchangeRate: 1200, exchangeRateSource: 'config' }]],
    file: [[{ cotizacionMoneda: 1300 }, { exchangeRate: 1300, fromFile: ['exchangeRate'] }]],
    flags: forms(['--cotizacion-moneda', '--cm'], '1.400,50', 'exchangeRate', 1400.5),
    name: 'cotización',
  },
  {
    ...CONFIG_USD,
    file: [
      [{ mismaMoneda: true }, { sameCurrency: true }],
      [{ mismaMoneda: false }, { sameCurrency: false }],
    ],
    flags: [[['--misma-moneda'], { sameCurrency: true }]],
    name: 'misma moneda',
  },
  {
    config: [[{ alicuotaPorDefecto: '27' }, { ivaRate: '27' }]],
    file: [
      [{ alicuotaIva: 0 }, { ivaRate: '0' }],
      [{ alicuotaIva: '5' }, { ivaRate: '5' }],
      [{ alicuotas: [{ monto: 1000, tasa: 'incrementada' }] }, { ivaRateAmounts: [{ amount: 1000, rate: '27' }] }],
    ],
    flags: [
      [['--alicuota', 'reducida'], { ivaRate: '10.5' }],
      [['--alicuota', 'reducida:1.000'], { ivaRateAmounts: [{ amount: 1000, rate: '10.5' }] }],
    ],
    name: 'alícuota',
  },
  {
    // Un 0 del archivo es "no hay" (un JSON generado suele traer los ceros).
    file: [
      [{ importeExento: 20 }, { exemptAmount: 20 }],
      [{ importeExento: 0 }, {}],
    ],
    flags: [[['--exento', '30,50'], { exemptAmount: 30.5 }]],
    name: 'exento',
  },
  {
    file: [
      [{ importeNoGravado: 20 }, { untaxedAmount: 20 }],
      [{ importeNoGravado: 0 }, {}],
    ],
    flags: [[['--nogravado', '30,50'], { untaxedAmount: 30.5 }]],
    name: 'no gravado',
  },
  {
    config: [[{ cbu: CBU_A }, { cbu: CBU_A }]],
    file: [[{ cbu: CBU_B }, { cbu: CBU_B }]],
    flags: [[['--cbu', CBU_C], { cbu: CBU_C }]],
    kind: 'fcea',
    name: 'CBU (sin alias en ningún nivel)',
  },
  {
    baseConfig: { cbu: CBU_A },
    baseExpected: { cbu: CBU_A },
    config: [[{ aliasCbu: 'alias.config' }, { cbuAlias: 'alias.config' }]],
    file: [[{ aliasCbu: 'alias.archivo' }, { cbuAlias: 'alias.archivo' }]],
    flags: [[['--alias', 'alias.flag'], { cbuAlias: 'alias.flag' }]],
    kind: 'fceb',
    name: 'alias del CBU (con el CBU de la config)',
  },
  {
    file: [[{ transferencia: 'adc' }, { transferMode: 'adc' }]],
    flags: [[['--transferencia', 'SCA'], { transferMode: 'sca' }]],
    kind: 'fcec',
    name: 'transferencia',
  },
  {
    file: [
      [{ anulacion: true }, { cancellation: true }],
      [{ anulacion: false }, { cancellation: false }],
    ],
    flags: [[['--anulacion'], { cancellation: true }]],
    kind: 'ncea',
    name: 'anulación',
  },
  {
    file: [
      [{ pdf: true }, { pdf: true }],
      [{ pdf: false }, { pdf: false }],
    ],
    flags: [
      [['--exportar-pdf'], { pdf: true }],
      [['--pdf'], { pdf: true }],
      [['--sin-pdf'], { pdf: false }],
    ],
    name: 'PDF',
  },
  {
    file: [[{ descripcion: 'Del archivo' }, { fromFile: ['pdfDescription'], pdfDescription: 'Del archivo' }]],
    flags: [[['--descripcion', 'Del flag'], { pdfDescription: 'Del flag' }]],
    name: 'descripción',
  },
  {
    file: [[{ receptorNombre: 'Archivo SA' }, { fromFile: ['receiverName'], receiverName: 'Archivo SA' }]],
    flags: [[['--receptor-nombre', 'Flag SA'], { receiverName: 'Flag SA' }]],
    name: 'nombre del receptor',
  },
  {
    file: [[{ receptorDomicilio: 'Archivo 1' }, { fromFile: ['receiverAddress'], receiverAddress: 'Archivo 1' }]],
    flags: [[['--receptor-domicilio', 'Flag 1'], { receiverAddress: 'Flag 1' }]],
    name: 'domicilio del receptor',
  },
  {
    // `null` dice "sin condición": no es lo mismo que no traer la clave, y no avisa (no va en `fromFile`).
    file: [
      [{ condicionVenta: 'cheque' }, { fromFile: ['saleCondition'], saleCondition: 'cheque' }],
      [{ condicionVenta: null }, { saleCondition: null }],
    ],
    flags: [
      ...forms(['--condicion-venta', '--cv'], 'contado', 'saleCondition', 'contado'),
      [['--sin-condicion-venta'], { saleCondition: null }],
    ],
    name: 'condición de venta',
  },
  {
    config: [[{ output: { emitirPorDefecto: true } }, { dryRun: false, emit: true }]],
    file: [
      [{ emitir: true }, { dryRun: false, emit: true, modeSource: 'file' }],
      [{ emitir: false }, { modeSource: 'file' }],
      [{ previsualizar: true }, { modeSource: 'file' }],
    ],
    flags: [
      [['--emitir'], { dryRun: false, emit: true, modeSource: 'flags' }],
      [['--previsualizar'], { dryRun: true, emit: false, modeSource: 'flags' }],
    ],
    name: 'emitir o previsualizar',
  },
  {
    file: [[{ comprobanteAsociado: { atajo: 'fc' } }, { associatedVoucher: { shortcut: 'fc' } }]],
    flags: [
      [['--ac', 'ndc'], { associatedVoucher: { shortcut: 'ndc' } }],
      [['--at', '12'], { associatedVoucher: { tipo: 12 } }],
    ],
    kind: 'ncc',
    name: 'asociado: tipo',
  },
  {
    file: [[{ comprobanteAsociado: { numero: 5 } }, { associatedVoucher: { numero: 5 } }]],
    flags: [[['--ar', '6'], { associatedVoucher: { numero: 6 } }]],
    kind: 'ncc',
    name: 'asociado: número',
  },
  {
    file: [[{ comprobanteAsociado: { puntoVenta: 5 } }, { associatedVoucher: { puntoVenta: 5 } }]],
    flags: [
      [['--apv', '6'], { associatedVoucher: { puntoVenta: 6 } }],
      [['--asociado-punto-venta', '6'], { associatedVoucher: { puntoVenta: 6 } }],
    ],
    kind: 'nda',
    name: 'asociado: punto de venta',
  },
  {
    file: [[{ comprobanteAsociado: { cuit: String(CUIT_A) } }, { associatedVoucher: { cuit: String(CUIT_A) } }]],
    flags: [[['--acuit', String(CUIT_B)], { associatedVoucher: { cuit: String(CUIT_B) } }]],
    kind: 'ncea',
    name: 'asociado: CUIT',
  },
  {
    file: [[{ comprobanteAsociado: { fecha: '01/09/2026' } }, { associatedVoucher: { fecha: '01/09/2026' } }]],
    flags: [[['--afecha', '02/09/2026'], { associatedVoucher: { fecha: '02/09/2026' } }]],
    kind: 'ncb',
    name: 'asociado: fecha',
  },
  {
    file: [
      [
        { periodoAsociado: { desde: '01/08/2026', hasta: '31/08/2026' } },
        { associatedPeriod: { desde: '01/08/2026', hasta: '31/08/2026' } },
      ],
    ],
    flags: [
      [
        ['--periodo-desde', '01/09/2026', '--periodo-hasta', '30/09/2026'],
        { associatedPeriod: { desde: '01/09/2026', hasta: '30/09/2026' } },
      ],
      [
        ['--pd', '01/09/2026', '--ph', '30/09/2026'],
        { associatedPeriod: { desde: '01/09/2026', hasta: '30/09/2026' } },
      ],
    ],
    kind: 'ncc',
    name: 'período asociado (las dos puntas)',
  },
];
