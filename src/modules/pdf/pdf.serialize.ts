import type { PdfOutcome } from './pdf.types';

/** La clave `pdf` del `--json` de un comprobante, A/B/C y E: solo aparece si se intento generar el PDF. */
export function serializePdfOutcome(pdf: PdfOutcome | undefined): Record<string, unknown> {
  if (!pdf) {
    return {};
  }

  if ('path' in pdf) {
    return { pdf: { ruta: pdf.path } };
  }

  const { code, message, suggestion } = pdf.error;

  return { pdf: { error: { codigo: code, mensaje: message, sugerencia: suggestion ?? null } } };
}
