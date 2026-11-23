import { roundToCents } from '../../lib/numbers/argentine-amount';
import type { IIva } from '../../services/arca/arca-sdk.types';
import { conceptCode, CONSUMER_DOCUMENT_TYPE_CODE, documentTypeLabel } from '../billing/arca-codes';
import { resolveIvaRateLabel } from '../billing/billing.amounts';
import { formatIvaConditionLabel } from '../billing/billing.labels';
import type { BillingExecutionResult } from '../billing/billing.types.internal';
import { toIsoCurrencyCode } from '../billing/currency-codes';
import { formatSaleCondition } from '../billing/sale-condition';
import { discriminatesIva, isReceipt } from '../billing/voucher-kind-map';
import { SERVICES_EXPORT_TYPE } from '../export/export.mappers';
import type { ExportExecutionResult } from '../export/export.types';

import { PdfError } from './pdf.errors';
import type { InvoicePdfData, InvoicePdfIssuer, InvoicePdfItem, InvoicePdfIva, PdfVoucherExtras } from './pdf.types';
import { buildPdfLegends, EXPORT_IVA_LEGEND } from './pdf-legends';

const DEFAULT_ITEM_DESCRIPTION = 'Según detalle';

/**
 * El nombre del tipo de documento, el mismo que usa la plantilla del SDK para calcular el tipo del QR (`CUIT`, `CUIL`,
 * `DNI`). El consumidor final no tiene nombre ahi: sale con su codigo.
 */
function documentTypeName(code: number): string {
  return (code === CONSUMER_DOCUMENT_TYPE_CODE ? undefined : documentTypeLabel(code)) ?? String(code);
}

// Un solo guion para el dato que falta. La plantilla escribe el valor tal cual (el helper `docNumber` no agrega nada),
// pero si el domicilio llega vacio pone su propio "- -": por eso se lo manda siempre.
const EMPTY_TEXT = '-';

function capitalizeWords(value: string): string {
  return value.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

/** "10,5%" -> 10.5 */
function resolveIvaRateNumber(aliquotId: number): number | undefined {
  const label = resolveIvaRateLabel(aliquotId);

  return label ? Number(label.replaceAll('%', '').replaceAll(',', '.')) : undefined;
}

// La plantilla busca cada alicuota por este texto exacto ("10.5%", con punto).
function buildIvaEntries(iva: readonly IIva[] | undefined): InvoicePdfIva[] {
  return (iva ?? []).map((entry) => ({
    baseImponible: entry.BaseImp,
    descripcion: `${resolveIvaRateNumber(entry.Id) ?? entry.Id}%`,
    id: entry.Id,
    importe: entry.Importe,
  }));
}

/**
 * wsfe no guarda items: se arma un renglon por alicuota con la descripcion del usuario, o uno solo con
 * el total cuando no se discrimina IVA (letra C). Exento y no gravado van en renglones aparte.
 */
function buildItems(result: BillingExecutionResult, description: string): InvoicePdfItem[] {
  const { payload, voucherKind } = result;
  const line = (subtotal: number, alicuotaIva?: number, suffix = ''): InvoicePdfItem => ({
    alicuotaIva,
    cantidad: 1,
    descripcion: `${description}${suffix}`,
    precioUnitario: subtotal,
    subtotal,
    unidadMedida: 'unidad',
  });

  if (!discriminatesIva(voucherKind.letter)) {
    return [line(payload.ImpTotal)];
  }

  // La B no discrimina IVA: cada renglon va con el IVA incluido, como lo ve el cliente.
  const includesIva = voucherKind.letter === 'b';
  const items = (payload.Iva ?? []).map((entry) =>
    includesIva
      ? line(roundToCents(entry.BaseImp + entry.Importe))
      : line(entry.BaseImp, resolveIvaRateNumber(entry.Id)),
  );

  if (payload.ImpOpEx > 0) {
    items.push(line(payload.ImpOpEx, undefined, ' (exento)'));
  }

  if (payload.ImpTotConc > 0) {
    items.push(line(payload.ImpTotConc, undefined, ' (no gravado)'));
  }

  return items.length > 0 ? items : [line(payload.ImpTotal)];
}

/** ARCA asigna el numero al emitir: sale de la respuesta, no del payload. */
function resolveVoucherNumber(result: BillingExecutionResult): number {
  const number = result.response.raw?.response?.FeDetResp?.FECAEDetResponse?.[0]?.CbteDesde ?? result.payload.CbteDesde;

  if (!number) {
    throw new PdfError('PDF_GENERATION_ERROR', 'La respuesta de ARCA no trae el número del comprobante.');
  }

  return number;
}

export function mapBillingResultToPdfData(
  result: BillingExecutionResult,
  issuer: InvoicePdfIssuer,
  extras: PdfVoucherExtras = {},
): InvoicePdfData {
  const { payload, response, voucherKind } = result;

  if (!response.cae || !response.caeVencimiento) {
    throw new PdfError('PDF_GENERATION_ERROR', 'El comprobante no tiene CAE: no se puede generar el PDF.');
  }

  const number = resolveVoucherNumber(result);
  const isConsumer = payload.DocTipo === CONSUMER_DOCUMENT_TYPE_CODE;
  const isUnidentified = isConsumer && !payload.DocNro;
  const iva = discriminatesIva(voucherKind.letter) ? buildIvaEntries(payload.Iva) : [];

  return {
    cae: response.cae,
    caeFechaVencimiento: response.caeVencimiento,
    ...(isReceipt(voucherKind) ? { cbteDescripcion: 'RECIBO' } : {}),
    cbteDesde: number,
    cbteFecha: payload.CbteFch,
    cbteHasta: number,
    cbteLetra: voucherKind.letter.toUpperCase(),
    cbteTipo: voucherKind.arcaType,
    cbtesAsociados: payload.CbtesAsoc?.map((voucher) => ({
      cuit: voucher.Cuit,
      fecha: voucher.CbteFch,
      numero: voucher.Nro,
      puntoVenta: voucher.PtoVta,
      tipo: voucher.Tipo,
    })),
    concepto: payload.Concepto,
    condicionVenta: formatSaleCondition(extras.condicionVenta),
    cotizacion: payload.MonCotiz,
    emisor: issuer,
    fechaServicioDesde: payload.FchServDesde,
    fechaServicioHasta: payload.FchServHasta,
    fechaVtoPago: payload.FchVtoPago,
    importeExento: payload.ImpOpEx || undefined,
    importeIva: discriminatesIva(voucherKind.letter) ? payload.ImpIVA : 0,
    // La plantilla muestra este importe como "Subtotal" en la B y como neto gravado en la A.
    importeNetoGravado: !discriminatesIva(voucherKind.letter)
      ? payload.ImpTotal
      : voucherKind.letter === 'b'
        ? roundToCents(payload.ImpTotal - payload.ImpTrib)
        : payload.ImpNeto,
    importeNetoNoGravado: payload.ImpTotConc || undefined,
    importeTotal: roundToCents(payload.ImpTotal),
    items: buildItems(result, extras.descripcion?.trim() || DEFAULT_ITEM_DESCRIPTION),
    iva: iva.length > 0 ? iva : undefined,
    // La plantilla del SDK solo conoce pesos y dolares; el resto se muestra con su codigo ARCA.
    moneda: payload.MonId,
    observaciones: buildPdfLegends(result),
    puntoVenta: payload.PtoVta,
    receptor: {
      condicionIva: capitalizeWords(formatIvaConditionLabel(payload.CondicionIVAReceptorId)),
      // Consumidor final sin documento: el QR igual sale con tipo 99 y numero 0 (el SDK usa `Number(nro) || 0`).
      documentoNro: isUnidentified ? EMPTY_TEXT : String(payload.DocNro),
      documentoTipo: isUnidentified ? 'Documento' : documentTypeName(payload.DocTipo),
      domicilio: extras.receptorDomicilio?.trim() || EMPTY_TEXT,
      razonSocial: extras.receptorNombre?.trim() || (isConsumer ? 'Consumidor Final' : EMPTY_TEXT),
    },
  };
}

/** En WSFEX el numero tambien lo asigna ARCA al autorizar. */
function resolveExportVoucherNumber(result: ExportExecutionResult): number {
  const number = result.response.raw?.FEXAuthorizeResult?.FEXResultAuth?.Cbte_nro || result.payload.Cbte_nro;

  if (!number) {
    throw new PdfError('PDF_GENERATION_ERROR', 'La respuesta de ARCA no trae el número del comprobante.');
  }

  return number;
}

/**
 * WSFEX usa sus propios codigos de moneda (`DOL`, `060`), pero la E de Comprobantes en linea muestra la divisa con
 * el codigo ISO: "USD - Dólar Estadounidense". Las que no tienen ISO salen con el codigo de WSFEX.
 */
function formatExportDivisa(result: ExportExecutionResult): string {
  const isoCode = toIsoCurrencyCode(result.payload.Moneda_Id);

  return result.display.currencyName ? `${isoCode} - ${result.display.currencyName}` : isoCode;
}

/**
 * Como en ARCA: "55000004242 (POLONIA - Persona Jurídica)", con el tipo de entidad de la tabla DST_CUIT. Sin CUIT del
 * pais (la E va solo con el ID impositivo, error 1580) no hay que mostrar.
 */
function formatExportCountryCuit(result: ExportExecutionResult): string | undefined {
  const { Cuit_pais_cliente: cuit } = result.payload;

  if (cuit === undefined) {
    return undefined;
  }

  const name = result.display.countryCuitName ?? result.display.countryName;

  return name ? `${cuit} (${name})` : String(cuit);
}

function formatExportIncoterm(payload: ExportExecutionResult['payload']): string | undefined {
  const code = payload.Incoterms.trim();
  const description = payload.Incoterms_Ds.trim();

  if (!code) {
    return undefined;
  }

  return description && description.toUpperCase() !== code.toUpperCase() ? `${code} - ${description}` : code;
}

/**
 * La letra E tiene su propio diseno en `@arcasdk/pdf`: destino, divisa, forma y fecha de pago, incoterm y la leyenda
 * de IVA exento, con los items reales de WSFEX. `concepto` e `importeNetoGravado` los pide el tipo del plugin, pero la
 * plantilla de la E no los muestra.
 */
export function mapExportResultToPdfData(
  result: ExportExecutionResult,
  issuer: InvoicePdfIssuer,
  extras: PdfVoucherExtras = {},
): InvoicePdfData {
  const { display, payload, response } = result;

  if (!response.cae || !response.caeVencimiento) {
    throw new PdfError('PDF_GENERATION_ERROR', 'El comprobante no tiene CAE: no se puede generar el PDF.');
  }

  const number = resolveExportVoucherNumber(result);
  const items: InvoicePdfItem[] = payload.Items.Item.map((item) => ({
    cantidad: item.Pro_qty,
    codigo: item.Pro_codigo || undefined,
    descripcion: item.Pro_ds,
    precioUnitario: item.Pro_precio_uni,
    subtotal: item.Pro_total_item,
    unidadMedida: display.unitNames[item.Pro_umed] ?? 'unidad',
  }));
  const observaciones = [payload.Obs_comerciales, payload.Obs].map((value) => value.trim()).filter(Boolean);

  return {
    cae: response.cae,
    caeFechaVencimiento: response.caeVencimiento,
    cbteDesde: number,
    cbteFecha: payload.Fecha_cbte,
    cbteDescripcion: result.voucherKind.pdfTitle,
    cbteHasta: number,
    cbteLetra: result.voucherKind.letter.toUpperCase(),
    cbteTipo: payload.Cbte_Tipo,
    cbtesAsociados: payload.Cmps_asoc?.Cmp_asoc.map((voucher) => ({
      cuit: String(voucher.Cbte_cuit),
      fecha: display.associatedVoucher?.date,
      numero: voucher.Cbte_nro,
      puntoVenta: voucher.Cbte_punto_vta,
      tipo: voucher.Cbte_tipo,
    })),
    concepto: conceptCode(payload.Tipo_expo === SERVICES_EXPORT_TYPE ? 'servicios' : 'productos'),
    condicionIvaExportacion: EXPORT_IVA_LEGEND,
    cotizacion: payload.Moneda_ctz,
    destinoComprobante: display.countryName ?? String(payload.Dst_cmp),
    divisa: formatExportDivisa(result),
    emisor: issuer,
    fechaPago: payload.Fecha_pago,
    formaPago: payload.Forma_pago,
    importeIva: 0,
    importeNetoGravado: payload.Imp_total,
    importeTotal: roundToCents(payload.Imp_total),
    incoterms: formatExportIncoterm(payload),
    items,
    moneda: payload.Moneda_Id,
    observaciones: observaciones.length > 0 ? observaciones.join(' · ') : undefined,
    puntoVenta: payload.Punto_vta,
    receptor: {
      condicionIva: 'Cliente del exterior',
      cuitPais: formatExportCountryCuit(result),
      // Sin CUIT del pais, el documento del cliente es su ID impositivo.
      documentoNro: payload.Cuit_pais_cliente === undefined ? payload.Id_impositivo : String(payload.Cuit_pais_cliente),
      documentoTipo: payload.Cuit_pais_cliente === undefined ? 'Otro' : 'CUIT',
      domicilio: extras.receptorDomicilio?.trim() || payload.Domicilio_cliente,
      idImpositivo: payload.Id_impositivo || undefined,
      razonSocial: extras.receptorNombre?.trim() || payload.Cliente,
    },
  };
}
