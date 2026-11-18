import { POINT_OF_SALE_GUIDE_URL, TROUBLESHOOTING_URL } from '../../lib/links';

/**
 * Rechazos y observaciones de WSFE que arcli no puede anticipar, con que paso y que hacer. Los que arcli valida antes
 * de enviar (ventana de fechas, IVA por letra, opcionales FCE...) estan igual: si ARCA los devuelve, el texto ayuda.
 * Cada codigo tiene su fila en la tabla "Rechazos de ARCA por codigo" de docs/troubleshooting.md (un test lo verifica).
 * Los que ARCA no informa con codigo se reconocen por el mensaje.
 */
export interface ArcaRejection {
  /** Codigos de `Errors` u `Observaciones` de WSFE. */
  readonly codes: readonly number[];
  readonly guide?: string;
  /** Para los que llegan sin codigo o con uno que varia. */
  readonly pattern?: RegExp;
  readonly what: string;
  readonly todo: string;
}

export const ARCA_REJECTIONS: readonly ArcaRejection[] = [
  {
    codes: [10005, 11002],
    guide: POINT_OF_SALE_GUIDE_URL,
    pattern: /punto de venta.*tipo RECE/i,
    todo: 'Revisá los habilitados con `arcli parametros puntos-venta` o creá uno para web service.',
    what: 'El punto de venta no está habilitado para web service (los de "Factura en línea" no sirven).',
  },
  {
    codes: [10016],
    guide: `${TROUBLESHOOTING_URL}#rechazos-de-arca-por-código`,
    todo: 'Mirá el último emitido con `arcli ultimos` y reintentá; si emitís varios del mismo tipo y punto de venta, hacelo de a uno.',
    what: 'ARCA no aceptó el número o la fecha: no es el próximo a autorizar (otro comprobante se emitió en el medio) o la fecha es anterior a la del último emitido.',
  },
  {
    codes: [10152],
    guide: `${TROUBLESHOOTING_URL}#fecha-del-comprobante-fuera-de-rango`,
    todo: 'Revisá `--fecha`: tiene que estar cerca de hoy (hasta 5 días en productos y FCE, 10 en servicios).',
    what: 'La fecha del comprobante está fuera del rango que acepta ARCA.',
  },
  {
    codes: [10243],
    guide: `${TROUBLESHOOTING_URL}#el-comprobante-no-admite-el-iva-receptor`,
    todo: 'Usá un IVA receptor válido para la letra (con `--ir`) o consultá el del receptor con `arcli padron <cuit>`.',
    what: 'El IVA receptor no es válido para la letra del comprobante.',
  },
  {
    codes: [10174],
    guide: `${TROUBLESHOOTING_URL}#rechazos-de-arca-por-código`,
    todo: 'Usá un CBU propio (`--cbu` o la clave cbu de la config) que esté registrado en ARCA.',
    what: 'El CBU no está registrado a nombre del emisor.',
  },
  {
    codes: [10154],
    guide: `${TROUBLESHOOTING_URL}#arca-rechaza-la-nota-fce-de-anulación`,
    pattern: /NO rechazado por el Comprador/i,
    todo: 'Pedile al comprador que lo rechace en el Registro de Facturas de Crédito Electrónica y volvé a emitir; si es sobre una factura y no es una anulación, emitila sin `--anulacion`.',
    what: 'Una nota FCE de anulación necesita que el comprador haya rechazado antes el comprobante asociado, y no lo rechazó.',
  },
  {
    codes: [10119],
    guide: `${TROUBLESHOOTING_URL}#rechazos-de-arca-por-código`,
    todo: 'Revisá `--cotizacion-moneda` contra la oficial (`arcli parametros cotizacion <moneda>`).',
    what: 'La cotización está fuera del rango que acepta ARCA: entre el 2% y el 400% de la oficial.',
  },
  {
    codes: [10038],
    guide: `${TROUBLESHOOTING_URL}#rechazos-de-arca-por-código`,
    todo: 'Volvé a emitir con `--misma-moneda`: ARCLI consulta la oficial en ese momento.',
    what: 'Con `--misma-moneda` ARCA exige la cotización oficial exacta y la que se envió ya no coincide.',
  },
  {
    codes: [10017],
    guide: `${TROUBLESHOOTING_URL}#observaciones-de-padrón`,
    todo: 'Consultá el receptor con `arcli padron <cuit>`: si no está activo, revisá si le corresponde una factura A. Si el comprobante salió aprobado, no es un rechazo.',
    what: 'El CUIT del receptor no figura activo en el padrón de ARCA, y en A y M ARCA lo pide.',
  },
  {
    codes: [10217],
    guide: `${TROUBLESHOOTING_URL}#observaciones-de-padrón`,
    todo: 'No es un rechazo: el comprobante está emitido. Si el receptor no es monotributista, revisalo con `arcli padron <cuit>`; en testing la observación sale también con otros CUITs.',
    what: 'ARCA ve al receptor como monotributista: el crédito fiscal de la factura A solo lo puede computar por el "Procedimiento permanente de transición al Régimen General".',
  },
  {
    codes: [],
    guide: `${TROUBLESHOOTING_URL}#el-receptor-coincide-con-el-emisor`,
    pattern: /DocNro no puede ser igual al del emisor/i,
    todo: 'Usá otro CUIT como receptor.',
    what: 'El receptor es el mismo CUIT que emite.',
  },
  {
    codes: [],
    pattern: /transacci[oó]n activa|error interno de base de datos/i,
    todo: 'Esperá unos segundos y volvé a intentar la emisión.',
    what: 'ARCA devolvió un error transitorio.',
  },
  {
    // 10015 tambien se usa para otras validaciones del documento: se reconoce por el mensaje.
    codes: [],
    guide: `${TROUBLESHOOTING_URL}#el-receptor-no-está-en-los-padrones-de-arca`,
    pattern: /no se encuentra registrado en los padrones/i,
    todo: 'Revisá el documento del receptor (`--cuit`, `--cuil` o `--dni`). En testing muchos CUITs no están en el padrón de facturación, aunque `arcli padron` los encuentre: usá uno de prueba o emití a consumidor final.',
    what: 'ARCA no encuentra el documento del receptor en sus padrones.',
  },
  {
    codes: [],
    pattern: /cuit receptora.*no existe/i,
    todo: 'Revisá el CUIT del receptor o, en testing, emití con uno válido del padrón de prueba.',
    what: 'ARCA no encuentra el CUIT del receptor.',
  },
  {
    codes: [],
    pattern: /objeto IVA es obligatorio/i,
    todo: 'Revisá el IVA receptor y el cálculo de IVA del comprobante antes de reintentar.',
    what: 'ARCA pide el detalle de IVA.',
  },
];

export function formatArcaRejection(rejection: ArcaRejection): string {
  const text = `${rejection.what} ${rejection.todo}`;

  return rejection.guide ? `${text} Más info: ${rejection.guide}` : text;
}

/** Las filas que coinciden por codigo o por mensaje, en el orden de la tabla. */
export function findArcaRejections(codes: readonly number[], messages: string): ArcaRejection[] {
  return ARCA_REJECTIONS.filter(
    (rejection) => rejection.codes.some((code) => codes.includes(code)) || Boolean(rejection.pattern?.test(messages)),
  );
}
