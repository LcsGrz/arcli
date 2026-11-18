/**
 * Una sola fuente para las páginas de cada comprobante (`docs/comprobantes/*.md`): qué opciones lleva cada uno, con
 * su corto, su largo y qué es. `generar-comprobantes.ts` escribe los `.md` y `scripts/docs/comprobantes-docs.test.ts` controla que
 * estén al día y que cada flag del CLI esté acá. El sitio los toma de `docs/` y dibuja cada opción como tarjeta.
 *
 * Los textos siguen el design system: voseo, corto primero, y el valor de cada flag explicado fila por fila.
 */
import { listAllowedIvaConditions } from '../../src/modules/billing/billing.iva-receptor';
import type { BillingIvaCondition } from '../../src/modules/billing/billing.schemas';
import type { VoucherLetter as BillingLetter } from '../../src/modules/billing/billing.types';

/** A, B y C (wsfe) y E (wsfex). */
export type VoucherLetter = BillingLetter | 'e';

/** [corto, largo, qué es]. El corto puede faltar (''). */
export type OptionRow = readonly [string, string, string];

export interface OptionGroup {
  readonly ej: string;
  readonly name: string;
  readonly rows: readonly OptionRow[] | ((letter: VoucherLetter) => readonly OptionRow[]);
  readonly text: string;
}

const IR: Record<BillingIvaCondition, readonly [string, string]> = {
  'consumidor-final': ['--ir-cf', 'Consumidor final'],
  'responsable-inscripto': ['--ir-ri', 'Responsable inscripto'],
  'responsable-monotributo': ['--ir-rm', 'Monotributo'],
  'sujeto-exento': ['--ir-se', 'Exento'],
  'sujeto-no-categorizado': ['--ir-snc', 'Sujeto no categorizado'],
  'monotributista-social': ['--ir-ms', 'Monotributista social'],
  'monotributo-trabajador-independiente-promovido': ['--ir-mtip', 'Monotributo trabajador independiente promovido'],
  'cliente-del-exterior': ['--ir-ce', 'Cliente del exterior'],
  'proveedor-del-exterior': ['--ir-pe', 'Proveedor del exterior'],
  'iva-liberado': ['--ir-il', 'IVA liberado'],
  'iva-no-alcanzado': ['--ir-ina', 'IVA no alcanzado'],
};

/** Las condiciones que ARCA acepta en cada letra, en el orden de `IR` (las más usadas primero). */
const irRows = (letter: VoucherLetter): readonly OptionRow[] => {
  const allowed = new Set(letter === 'e' ? [] : listAllowedIvaConditions(letter));

  return (Object.keys(IR) as BillingIvaCondition[])
    .filter((condition) => allowed.has(condition))
    .map((condition) => [IR[condition][0], `--iva-receptor ${condition}`, IR[condition][1]] as const);
};

export const OPTIONS = {
  monto: {
    ej: '-m 15000',
    name: 'Importe',
    rows: [['-m', '--monto <número>', '15000, 15.000 o 1.500,50']],
    text: 'El total del comprobante, en formato argentino: punto para miles y coma para decimales.',
  },
  concepto: {
    ej: '--cs',
    name: 'Concepto',
    rows: [
      ['--cs', '--concepto servicios', 'Servicios'],
      ['--cp', '--concepto productos', 'Productos'],
      ['--csp', '--concepto productos-servicios', 'Productos y servicios'],
    ],
    text: 'Qué facturás. `-c` es el corto de `--concepto`. Si lo guardás en la config (`concepto`), no hace falta.',
  },
  ir: {
    ej: '--ir-cf',
    name: 'Condición IVA del receptor',
    rows: irRows,
    text: 'Cómo está inscripto a quien le facturás. `--ir` es el corto de `--iva-receptor`. Con `--cuit` sale sola del padrón de ARCA; si no, va una de estas o la de la config (`ivaReceptor`).',
  },
  irOpt: {
    ej: '--ir-ri',
    name: 'Condición IVA del receptor',
    rows: irRows,
    text: 'Sale sola del padrón de ARCA con el CUIT. Usala solo si querés indicarla vos.',
  },
  receptor: {
    ej: '--cuit 20168598204',
    name: 'Receptor',
    rows: [
      ['--cfinal', '--consumidor-final', 'Consumidor final, sin identificar'],
      ['', '--cuit <número>', 'Con CUIT: la condición IVA sale del padrón'],
      ['', '--cuil <número>', 'Con CUIL'],
      ['', '--dni <número>', 'Con DNI'],
    ],
    text: 'A quién le facturás. Sin ninguno, consumidor final. Desde $ 10.000.000 hay que identificarlo.',
  },
  receptorCuit: {
    ej: '--cuit 20168598204',
    name: 'Receptor',
    rows: [['', '--cuit <número>', 'El CUIT del receptor']],
    text: 'Su condición IVA sale del padrón de ARCA.',
  },
  pv: {
    ej: '--pv 3',
    name: 'Punto de venta',
    rows: [['--pv', '--punto-venta <número>', 'Un punto de venta para web service']],
    text: 'Si no es el de la config.',
  },
  fecha: {
    ej: '-f 31/10',
    name: 'Fecha',
    rows: [['-f', '--fecha <fecha>', 'D, D/M, D/M/AA o D/M/AAAA']],
    text: 'Si no es hoy.',
  },
  servicio: {
    ej: '--sd 1/10 --sh 31/10',
    name: 'Período del servicio',
    rows: [
      ['--sd', '--servicio-desde <fecha>', 'Inicio del servicio'],
      ['--sh', '--servicio-hasta <fecha>', 'Fin del servicio'],
      ['--vto', '--vencimiento <fecha>', 'Vencimiento del pago; por defecto, el fin del servicio'],
    ],
    text: 'Solo con servicios. Sin estos flags, el mes en curso.',
  },
  moneda: {
    ej: '--moneda USD',
    name: 'Moneda extranjera',
    rows: [
      ['--mda', '--moneda <código>', 'ISO (USD, EUR) o de ARCA (DOL, 060)'],
      ['--cm', '--cotizacion-moneda <número>', 'Cotización, por ejemplo 1.452,50'],
      ['', '--misma-moneda', 'Te pagan en esa misma moneda'],
    ],
    text: 'Sin `--cm`, la cotización oficial de ARCA.',
  },
  monedaE: {
    ej: '--moneda EUR',
    name: 'Moneda',
    rows: [
      ['--mda', '--moneda <código>', 'ISO (USD, EUR) o de ARCA (DOL, 060)'],
      ['--cm', '--cotizacion-moneda <número>', 'Cotización'],
      ['', '--misma-moneda', 'Te pagan en esa misma moneda'],
      ['', '--fecha-pago <fecha>', 'Fecha de pago, solo en servicios y otros; por defecto, la del comprobante'],
    ],
    text: 'Por defecto, dólares. Sin `--cm`, la cotización de aduana que publica ARCA.',
  },
  iva: {
    ej: '--alicuota 10.5',
    name: 'IVA',
    rows: [
      [
        '',
        '--alicuota <tasa>',
        'general (21, por defecto), reducida (10.5), incrementada (27), cero (0), 5 o 2.5. Varias: TASA:MONTO',
      ],
      ['', '--exento <número>', 'La parte exenta del total'],
      ['', '--nogravado <número>', 'La parte no gravada del total'],
    ],
    text: 'El monto es el total con IVA: ARCLI calcula el neto y el IVA.',
  },
  asociado: {
    ej: '--ac fc --apv 3 --ar 142 --acuit 20333333334',
    name: 'Comprobante que ajusta',
    rows: [
      ['', '--ac <atajo>', 'Atajo del comprobante: fc, rc, ndc…'],
      ['--apv', '--asociado-punto-venta <número>', 'Su punto de venta'],
      ['', '--ar <número>', 'Su número'],
      ['', '--acuit <cuit>', 'El CUIT del emisor: el tuyo'],
      ['', '--at <número>', 'Tipo ARCA, en vez de --ac'],
    ],
    text: 'Atajo, punto de venta y número del comprobante: una factura u otra nota de la misma letra. O un período entero, con `--pd` y `--ph`.',
  },
  periodo: {
    ej: '--pd 1/9 --ph 30/9',
    name: 'Período, en vez de un comprobante',
    rows: [
      ['--pd', '--periodo-desde <fecha>', 'Inicio del período'],
      ['--ph', '--periodo-hasta <fecha>', 'Fin del período'],
    ],
    text: 'Para ajustar un período entero, por ejemplo un descuento sobre el mes. No va con `--ac`.',
  },
  cbu: {
    ej: '--cbu 0110599520000012345678',
    name: 'CBU',
    rows: [['', '--cbu <22 dígitos>', 'Tu CBU']],
    text: 'Donde te pagan. Una vez guardado en la config, no hace falta.',
  },
  cobro: {
    ej: '--transferencia adc',
    name: 'Cobro',
    rows: [
      ['', '--alias <alias>', 'Alias del CBU'],
      ['', '--transferencia <sca|adc>', 'Modalidad de transferencia; por defecto sca'],
    ],
    text: 'Datos extra del cobro de la FCE.',
  },
  asociadoFce: {
    ej: '--ac fcec --apv 3 --ar 15',
    name: 'Factura que ajusta',
    rows: [
      ['', '--ac <atajo>', 'fcec, fcea o fceb; con --anulacion, también una nota FCE'],
      ['--apv', '--asociado-punto-venta <número>', 'Su punto de venta'],
      ['', '--ar <número>', 'Su número'],
      ['', '--at <número>', 'Tipo ARCA, en vez de --ac'],
    ],
    text: '`--acuit` no va: toma tu CUIT.',
  },
  fceNota: {
    ej: '--anulacion',
    name: 'Datos de la FCE',
    rows: [
      ['', '--afecha <fecha>', 'Fecha de la factura; sin el flag, ARCLI la consulta en ARCA'],
      [
        '',
        '--anulacion',
        'Anula un comprobante que el comprador rechazó: la NC ajusta la factura o una ND FCE, y la ND solo una NC FCE',
      ],
    ],
    text: '',
  },
  pdfDatos: {
    ej: '--cv transferencia',
    name: 'Datos del PDF',
    rows: [
      ['', '--descripcion <texto>', 'Detalle; por defecto, "Según detalle"'],
      [
        '--cv',
        '--condicion-venta <tipo>',
        'contado, transferencia, tarjeta-debito, tarjeta-credito, cuenta-corriente, cheque, otros-medios-electronicos, otra o un texto',
      ],
      ['', '--sin-condicion-venta', 'Sin condición de venta, aunque esté en la config'],
      ['', '--receptor-nombre <texto>', 'Nombre o razón social del receptor'],
      ['', '--receptor-domicilio <texto>', 'Domicilio del receptor'],
    ],
    text: 'Solo cambian el PDF, no lo que se informa a ARCA.',
  },
  cliente: {
    ej: '--cliente "ACME LLC"',
    name: 'Cliente del exterior',
    rows: [
      ['', '--cliente <texto>', 'Nombre o razón social'],
      ['', '--domicilio-cliente <texto>', 'Domicilio en el exterior'],
    ],
    text: '',
  },
  pais: {
    ej: '--pais-destino Brasil',
    name: 'País de destino',
    rows: [['', '--pais-destino <código|nombre>', 'Por código (203) o nombre (Brasil)']],
    text: 'El CUIT del país sale solo de la tabla de ARCA.',
  },
  actividad: {
    ej: '--actividad 620100',
    name: 'Actividad',
    rows: [['', '--actividad <código>', 'Código de la tabla de actividades de WSFEX']],
    text: 'Mejor guardarla en la config (`exportacion.actividad`).',
  },
  clienteExtra: {
    ej: '--id-impositivo 12-3456789',
    name: 'Más datos del cliente',
    rows: [
      ['', '--id-impositivo <texto>', 'Su ID impositivo en su país'],
      ['', '--cuit-pais <número>', 'CUIT del país, si no querés el de la tabla'],
    ],
    text: '',
  },
  tipoExpo: {
    ej: '--tipo-expo 1',
    name: 'Tipo de exportación',
    rows: [
      ['', '--tipo-expo 1', 'Bienes'],
      ['', '--tipo-expo 2', 'Servicios (por defecto)'],
      ['', '--tipo-expo 4', 'Otros'],
    ],
    text: '',
  },
  item: {
    ej: '--item "001|Servicio|1|1500|7"',
    name: 'Ítems',
    rows: [
      ['', '--item <partes>', '"código|descripción|cantidad|precio|unidad"'],
      ['', '--descripcion <texto>', 'Detalle cuando no hay ítems'],
    ],
    text: 'Repetible. La suma tiene que dar el monto. Sin ítems, va un renglón con `--descripcion`.',
  },
  expoDatos: {
    ej: '--idioma 2',
    name: 'Datos del comprobante',
    rows: [
      ['', '--incoterm <código>', 'En bienes, por ejemplo FOB'],
      ['', '--incoterms-desc <texto>', 'Descripción del incoterm'],
      ['', '--idioma <1|2|3>', 'Español (por defecto), inglés o portugués'],
      ['', '--forma-pago <texto>', 'Por defecto, "Transferencia Internacional"'],
      ['', '--observaciones <texto>', 'Observaciones'],
      ['', '--obs-comerciales <texto>', 'Observaciones comerciales'],
    ],
    text: '',
  },
  permiso: {
    ej: '--permiso 26001EC01000123A',
    name: 'Permisos de embarque',
    rows: [
      ['', '--permiso <id>', 'Un permiso de embarque'],
      ['', '--permiso-existente', 'El permiso ya existe en ARCA'],
    ],
    text: 'Solo en bienes (`--tipo-expo 1`). Repetible.',
  },
  permisoNota: {
    ej: '--permiso 26001EC01000123A',
    name: 'Permisos de embarque',
    rows: [['', '--permiso <id>', 'Un permiso de embarque']],
    text: 'Solo si la factura es de bienes. Repetible.',
  },
  numeracion: {
    ej: '--numero 12',
    name: 'Numeración',
    rows: [
      ['', '--numero <número>', 'Número del comprobante'],
      ['', '--id-solicitud <número>', 'ID de la solicitud'],
    ],
    text: 'Por defecto, la que sigue en ARCA.',
  },
  asociadoE: {
    ej: '--ar 1 --apv 4',
    name: 'Factura que ajusta',
    rows: [
      ['', '--ar <número>', 'Su número'],
      ['--apv', '--asociado-punto-venta <número>', 'Su punto de venta; por defecto, el de la nota'],
      ['', '--ac <atajo>', 'fe (por defecto), nde o nce'],
      ['', '--at <número>', 'Tipo ARCA: 19, 20 o 21'],
    ],
    text: 'Cliente, destino, moneda y actividad salen de ella.',
  },

  // Al ejecutar: no cambian el comprobante.
  modo: {
    ej: '--emitir',
    name: 'Vista previa o emisión',
    rows: [
      ['', '--previsualizar', 'Solo la vista previa: no emite'],
      ['', '--emitir', 'Emite sin preguntar'],
    ],
    text: 'Sin ninguno, muestra la vista previa y pregunta antes de emitir.',
  },
  entorno: {
    ej: '--produccion',
    name: 'Entorno',
    rows: [
      ['', '--testing', 'Homologación: no vale fiscalmente'],
      ['', '--produccion', 'Comprobantes reales'],
    ],
    text: 'Si no es el de la config.',
  },
  pdf: {
    ej: '--pdf',
    name: 'PDF',
    rows: [
      ['--pdf', '--exportar-pdf', 'Genera el PDF'],
      ['', '--sin-pdf', 'No lo genera'],
    ],
    text: 'Aunque la config diga otra cosa.',
  },
  salida: {
    ej: '--json',
    name: 'Salida',
    rows: [
      ['', '--json', 'JSON, para scripts e IAs'],
      ['', '--bruto', 'Suma la respuesta cruda de ARCA'],
    ],
    text: '',
  },
  cargar: {
    ej: '--cargar facturas.json',
    name: 'Desde un archivo',
    rows: [['', '--cargar <archivo>', 'Los datos desde un JSON, también varios comprobantes']],
    text: '',
  },
} as const satisfies Record<string, OptionGroup>;

export type OptionKey = keyof typeof OPTIONS;

const BASE_OPT: readonly OptionKey[] = ['pv', 'fecha', 'servicio', 'moneda', 'pdfDatos'];
const EXPO_OPT: readonly OptionKey[] = ['pv', 'fecha', 'numeracion'];
export const RUN: readonly OptionKey[] = ['modo', 'entorno', 'pdf', 'salida', 'cargar'];

const NC_TIP =
  'La nota de crédito no puede superar el total del comprobante que ajusta, si van en la misma moneda: ARCLI lo revisa antes de emitir.';
const ND_TIP = 'La nota de débito suma: no tiene tope.';
const PERIOD_TIP =
  'Con un período (`--pd` y `--ph`) en vez de un comprobante, el período no puede terminar después de la fecha de la nota.';

export type Family = 'Monotributo · C' | 'Responsable inscripto · A' | 'Responsable inscripto · B' | 'Exportación · E';

/** Icono del menú del sitio (`site/src/icons.ts`). */
export type VoucherIcon = 'banco' | 'factura' | 'mas' | 'menos' | 'mundo' | 'recibo';

export interface VoucherPage {
  readonly atajo: string;
  readonly ej: string;
  readonly familia: Family;
  readonly familiaComando: string;
  readonly file: string;
  readonly icon: VoucherIcon;
  readonly intro: string;
  readonly letter: VoucherLetter;
  readonly na: readonly string[];
  readonly opt: readonly OptionKey[];
  readonly req: readonly OptionKey[];
  readonly tips: readonly string[];
  readonly title: string;
}

interface VoucherSpec extends Omit<VoucherPage, 'atajo' | 'familiaComando' | 'file' | 'icon' | 'title'> {
  readonly atajo: string;
  readonly familiaComando: string;
  readonly icon?: VoucherIcon;
  readonly title: string;
}

/** Una nota de crédito y una de débito con los mismos datos: cambia el atajo, el título y la introducción. */
function notes(spec: {
  readonly atajos: readonly [string, string];
  readonly ej: string;
  readonly familia: Family;
  readonly fce?: boolean;
  readonly letter: VoucherLetter;
  readonly na: readonly string[];
  readonly opt: readonly OptionKey[];
  readonly req: readonly OptionKey[];
  readonly target: string;
  readonly rest?: string;
  readonly tips: readonly string[];
}): VoucherSpec[] {
  const fce = spec.fce ? ' FCE' : '';
  const familyCommand = spec.fce ? 'nota-{tipo}-electronica' : 'nota-{tipo}';
  const rest = spec.rest ? ` ${spec.rest}` : '';
  const upper = spec.letter.toUpperCase();

  return [
    {
      ...spec,
      atajo: spec.atajos[0],
      familiaComando: `arcli ${familyCommand.replace('{tipo}', 'credito')} ${spec.letter}`,
      icon: 'menos',
      intro: `Resta sobre ${spec.target}: un descuento, una devolución o una anulación.${rest}`,
      tips: [NC_TIP, ...spec.tips],
      title: `Nota de crédito${fce} ${upper}`,
    },
    {
      ...spec,
      atajo: spec.atajos[1],
      ej: spec.ej.replace(` ${spec.atajos[0]} `, ` ${spec.atajos[1]} `),
      familiaComando: `arcli ${familyCommand.replace('{tipo}', 'debito')} ${spec.letter}`,
      icon: 'mas',
      intro: `Suma sobre ${spec.target}: un cargo que faltó, intereses o una diferencia de precio.${rest}`,
      tips: [ND_TIP, ...spec.tips],
      title: `Nota de débito${fce} ${upper}`,
    },
  ];
}

const SPECS: readonly VoucherSpec[] = [
  {
    atajo: 'fc',
    ej: 'arcli fc -m 15000 --cs --cfinal',
    familia: 'Monotributo · C',
    familiaComando: 'arcli factura c',
    intro: 'Monotributo a cualquier receptor: consumidor final, empresas u otro monotributista. No discrimina IVA.',
    letter: 'c',
    na: ['--ac', '--alicuota', '--exento'],
    opt: ['receptor', ...BASE_OPT],
    req: ['monto', 'concepto', 'ir'],
    tips: [
      'Si el receptor es una empresa obligada a recibir FCE por el monto, ARCLI te avisa (con `verificarFce` en la config).',
    ],
    title: 'Factura C',
  },
  ...notes({
    atajos: ['ncc', 'ndc'],
    ej: 'arcli ncc -m 5000 --cs --cfinal --ac fc --apv 3 --ar 142 --acuit 20333333334',
    familia: 'Monotributo · C',
    letter: 'c',
    na: ['--cbu', '--alicuota'],
    opt: ['periodo', 'receptor', ...BASE_OPT],
    req: ['monto', 'concepto', 'ir', 'asociado'],
    target: 'una Factura C, un Recibo C u otra nota C',
    tips: ['El comprobante que ajusta también puede ser un Recibo C: `--ac rc`.', PERIOD_TIP],
  }),
  {
    atajo: 'rc',
    ej: 'arcli rc -m 15000 --cs --cfinal',
    familia: 'Monotributo · C',
    familiaComando: 'arcli recibo c',
    icon: 'recibo',
    intro: 'Para documentar un cobro. Se arma como una Factura C: sin IVA discriminado.',
    letter: 'c',
    na: ['--ac', '--cbu', '--alicuota'],
    opt: ['receptor', ...BASE_OPT],
    req: ['monto', 'concepto', 'ir'],
    tips: ['El PDF sale con el título RECIBO C.'],
    title: 'Recibo C',
  },
  {
    atajo: 'fcec',
    ej: 'arcli fcec -m 1500000 --cs --cuit 30546689979 --cbu 0110599520000012345678',
    familia: 'Monotributo · C',
    familiaComando: 'arcli factura-credito-electronica c',
    icon: 'banco',
    intro: 'Factura de Crédito Electrónica C: monotributo a una empresa obligada a recibirla.',
    letter: 'c',
    na: ['--pd', '--ph', '--ac'],
    opt: ['cobro', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'cbu'],
    tips: ['Para saber si el receptor está obligado: `arcli fce-obligado <CUIT>`.'],
    title: 'FCE C',
  },
  ...notes({
    atajos: ['ncec', 'ndec'],
    ej: 'arcli ncec -m 50000 --cs --cuit 30546689979 --ac fcec --apv 3 --ar 15',
    familia: 'Monotributo · C',
    fce: true,
    letter: 'c',
    na: ['--acuit', '--pd', '--ph', '--cbu'],
    opt: ['fceNota', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'asociadoFce'],
    target: 'una FCE C',
    tips: ['No aceptan un período: siempre ajustan una factura.'],
  }),

  {
    atajo: 'fa',
    ej: 'arcli fa -m 121000 --cs --cuit 20168598204',
    familia: 'Responsable inscripto · A',
    familiaComando: 'arcli factura a',
    intro: 'Responsable inscripto a otro responsable inscripto. Discrimina IVA.',
    letter: 'a',
    na: ['--cfinal', '--dni', '--ac'],
    opt: ['irOpt', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit'],
    tips: ['El monto es el total con IVA: ARCLI calcula el neto y el IVA.'],
    title: 'Factura A',
  },
  ...notes({
    atajos: ['nca', 'nda'],
    ej: 'arcli nca -m 1210 --cs --cuit 20168598204 --ac fa --apv 3 --ar 6 --acuit 20333333334',
    familia: 'Responsable inscripto · A',
    letter: 'a',
    na: ['--cbu', '--cfinal'],
    opt: ['periodo', 'irOpt', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'asociado'],
    target: 'una Factura A u otra nota A',
    tips: [PERIOD_TIP],
  }),
  {
    atajo: 'fcea',
    ej: 'arcli fcea -m 1210000 --cs --cuit 30546689979 --cbu 0110599520000012345678',
    familia: 'Responsable inscripto · A',
    familiaComando: 'arcli factura-credito-electronica a',
    icon: 'banco',
    intro: 'Factura de Crédito Electrónica A, a una empresa obligada a recibirla.',
    letter: 'a',
    na: ['--pd', '--ph', '--ac'],
    opt: ['cobro', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'cbu'],
    tips: [],
    title: 'FCE A',
  },
  ...notes({
    atajos: ['ncea', 'ndea'],
    ej: 'arcli ncea -m 121000 --cs --cuit 30546689979 --ac fcea --apv 3 --ar 6',
    familia: 'Responsable inscripto · A',
    fce: true,
    letter: 'a',
    na: ['--acuit', '--pd', '--ph', '--cbu'],
    opt: ['fceNota', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'asociadoFce'],
    target: 'una FCE A',
    tips: ['No aceptan un período: siempre ajustan una factura.'],
  }),

  {
    atajo: 'fb',
    ej: 'arcli fb -m 12100 --cs --cfinal',
    familia: 'Responsable inscripto · B',
    familiaComando: 'arcli factura b',
    intro: 'Responsable inscripto a consumidor final, monotributista o exento.',
    letter: 'b',
    na: ['--ac'],
    opt: ['receptor', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'ir'],
    tips: ['El IVA va incluido en el total y no se muestra discriminado en el PDF.'],
    title: 'Factura B',
  },
  ...notes({
    atajos: ['ncb', 'ndb'],
    ej: 'arcli ncb -m 1210 --cs --cfinal --ac fb --apv 3 --ar 9 --acuit 20333333334',
    familia: 'Responsable inscripto · B',
    letter: 'b',
    na: ['--cbu'],
    opt: ['periodo', 'receptor', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'ir', 'asociado'],
    target: 'una Factura B u otra nota B',
    tips: [PERIOD_TIP],
  }),
  {
    atajo: 'fceb',
    ej: 'arcli fceb -m 1210000 --cs --cuit 30546689979 --cbu 0110599520000012345678',
    familia: 'Responsable inscripto · B',
    familiaComando: 'arcli factura-credito-electronica b',
    icon: 'banco',
    intro: 'Factura de Crédito Electrónica B, a una empresa obligada a recibirla.',
    letter: 'b',
    na: ['--pd', '--ph', '--ac'],
    opt: ['cobro', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'cbu'],
    tips: [],
    title: 'FCE B',
  },
  ...notes({
    atajos: ['nceb', 'ndeb'],
    ej: 'arcli nceb -m 121000 --cs --cuit 30546689979 --ac fceb --apv 3 --ar 4',
    familia: 'Responsable inscripto · B',
    fce: true,
    letter: 'b',
    na: ['--acuit', '--pd', '--ph', '--cbu'],
    opt: ['fceNota', 'iva', ...BASE_OPT],
    req: ['monto', 'concepto', 'receptorCuit', 'asociadoFce'],
    target: 'una FCE B',
    tips: ['No aceptan un período: siempre ajustan una factura.'],
  }),

  {
    atajo: 'fe',
    ej: 'arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212',
    familia: 'Exportación · E',
    familiaComando: 'arcli factura e',
    icon: 'mundo',
    intro:
      'Bienes o servicios a un cliente del exterior. Usa el servicio wsfex, con su propio certificado y punto de venta.',
    letter: 'e',
    na: ['--cuit', '--ir', '--concepto'],
    opt: ['tipoExpo', 'item', 'clienteExtra', 'expoDatos', 'permiso', 'monedaE', ...EXPO_OPT],
    req: ['monto', 'cliente', 'pais', 'actividad'],
    tips: [
      'El CUIT del país de destino sale solo de la tabla de ARCA.',
      'Sin `--numero`, ARCLI toma el que sigue en ARCA para ese punto de venta.',
    ],
    title: 'Factura E',
  },
  ...notes({
    atajos: ['nce', 'nde'],
    ej: 'arcli nce -m 500 --ar 1 --apv 4',
    familia: 'Exportación · E',
    letter: 'e',
    na: ['--fecha-pago', '--misma-moneda', '--permiso-existente'],
    opt: ['permisoNota', 'item', 'expoDatos', ...EXPO_OPT],
    req: ['monto', 'asociadoE'],
    rest: 'Cliente, destino, moneda y actividad salen de la factura, que ARCLI consulta en ARCA.',
    target: 'una Factura E',
    tips: ['Los permisos de embarque van solo si la factura es de bienes (`--tipo-expo 1`).'],
  }),
];

const slug = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^nota-de-/, 'nota-');

export const VOUCHER_PAGES: readonly VoucherPage[] = SPECS.map((spec) => ({
  ...spec,
  file: `${slug(spec.title)}.md`,
  icon: spec.icon ?? 'factura',
}));

/** Las filas de una opción para la letra del comprobante (la condición IVA depende de la letra). */
export function optionRows(key: OptionKey, letter: VoucherLetter): readonly OptionRow[] {
  const { rows } = OPTIONS[key] as OptionGroup;

  return typeof rows === 'function' ? rows(letter) : rows;
}
